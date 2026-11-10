import type { PrismaClient as ReportingPrismaClient } from "@prisma/client-reporting";
import {
  reportingPrisma,
  DEFAULT_REPORTING_TRANSACTION_OPTIONS,
} from "../../database/reporting.client";
import {
  calculatePaginationSkip,
  formatPaginationMeta,
} from "../../common/helpers/pagination.helper";
import {
  formatVietnamDate,
  getIsoWeekString,
  getVietnamHour,
  getVietnamDayRange,
} from "../../common/helpers/date.helper";
import {
  DashboardFilterDto,
  TrendsFilterDto,
  CameraStatsFilterDto,
  HourlyRiskFilterDto,
  HourlyRiskResponseDto,
  HourlyRiskItemDto,
  ShiftRiskSummaryDto,
  SeverityBreakdownMapDto,
  AiPerformanceFilterDto,
  StatisticsSummaryDto,
  TrendItemDto,
  ViolationTypeStatDto,
  CameraStatDto,
  AiPerformanceStatDto,
  RecordAiPerformanceDto,
  CreateReportTemplateDto,
  GenerateReportDto,
  ReportHistoryQueryDto,
  ReportTemplateDto,
  ReportGenerationDto,
  CreateAiModelDto,
  CreateAiModelVersionDto,
  AiModelDto,
  AiModelVersionDto,
  PaginatedResultDto,
  AggregatedReportDataDto,
  ActiveModelSummaryDto,
} from "./reporting.dto";
import { envConfig } from "../../config/env.config";
import { fetchInternalService } from "../../common/helpers/http-client.helper";
import {
  REPORT_STATUS,
  AI_MODEL_STATUS,
  AI_MODEL_VERSION_STATUS,
  STATISTIC_GROUP_BY,
} from "../../common/constants/reporting.constant";
import { AppError } from "../../common/errors/app-error";
import { ERROR_CODE } from "../../common/errors/error-code";

function serializeAiPerformance(stat: any): AiPerformanceStatDto {
  return {
    id: stat.id,
    cameraId: stat.cameraId,
    modelVersionId: stat.modelVersionId ?? null,
    statDate:
      stat.statDate instanceof Date
        ? stat.statDate.toISOString().slice(0, 10)
        : String(stat.statDate),
    avgFps: Number(stat.avgFps ?? 0),
    avgLatencyMs: Number(stat.avgLatencyMs ?? 0),
    maxLatencyMs: Number(stat.maxLatencyMs ?? 0),
    totalFrames: stat.totalFrames != null ? stat.totalFrames.toString() : "0",
  };
}

export class ReportingRepository {
  private customPrisma?: ReportingPrismaClient;

  constructor(customPrisma?: any) {
    this.customPrisma = customPrisma;
  }

  private get prisma(): ReportingPrismaClient {
    return (this.customPrisma || reportingPrisma) as ReportingPrismaClient;
  }

  // ── 1. Dashboard Summary & Incident Statistics ──────────────────────────────

  /**
   * Truy vấn danh sách incident thời gian thực từ ppe_incident_db thông qua HTTP endpoint
   * dùng làm Real-time Fallback khi ngày hiện tại chưa chạy cronjob tổng hợp
   */
  async fetchRealtimeIncidentsFromIncidentService(
    filter: DashboardFilterDto,
    callOptions?: { authHeader?: string; requestId?: string },
  ): Promise<any[] | null> {
    try {
      const queryParams = new URLSearchParams();
      queryParams.set("page", "1");
      queryParams.set("limit", "100");
      if (filter.siteId) queryParams.set("siteId", filter.siteId);
      if (filter.startDate) queryParams.set("fromDate", filter.startDate);
      if (filter.endDate) queryParams.set("toDate", filter.endDate);

      const headers: Record<string, string> = {};
      if (callOptions?.authHeader) {
        headers["Authorization"] = callOptions.authHeader;
      }
      if (callOptions?.requestId) {
        headers["x-request-id"] = callOptions.requestId;
      }
      if (envConfig.gateway.internalSecret) {
        headers["x-gateway-secret"] = envConfig.gateway.internalSecret;
      }

      const url = `${envConfig.incident.serviceUrl}/api/v1/incidents?${queryParams.toString()}`;
      const res = await fetchInternalService<any>(url, {
        headers,
        timeoutMs: 3000,
      });

      if (res.ok && res.data) {
        if (Array.isArray(res.data)) return res.data;
        if (Array.isArray(res.data.data)) {
          const allIncidents = [...res.data.data];
          const totalPages = Math.min(Number(res.data.meta?.totalPages) || 1, 10);
          if (totalPages > 1) {
            for (let page = 2; page <= totalPages; page++) {
              queryParams.set("page", String(page));
              const pageUrl = `${envConfig.incident.serviceUrl}/api/v1/incidents?${queryParams.toString()}`;
              const pageRes = await fetchInternalService<any>(pageUrl, {
                headers,
                timeoutMs: 3000,
              });
              if (pageRes.ok && Array.isArray(pageRes.data?.data)) {
                allIncidents.push(...pageRes.data.data);
              } else {
                break;
              }
            }
          }
          return allIncidents;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  computeSummaryFromIncidentList(
    incidents: any[],
    filter: DashboardFilterDto,
  ): StatisticsSummaryDto {
    const totalIncidents = incidents.length;
    let openIncidents = 0;
    let resolvedIncidents = 0;
    let trueViolations = 0;
    let falseAlarms = 0;

    const severityBreakdown: SeverityBreakdownMapDto = {
      CRITICAL: { count: 0, resolved: 0, targetSlaMinutes: 15, actualMttrMinutes: 0 },
      HIGH: { count: 0, resolved: 0, targetSlaMinutes: 30, actualMttrMinutes: 0 },
      MEDIUM: { count: 0, resolved: 0, targetSlaMinutes: 60, actualMttrMinutes: 0 },
      LOW: { count: 0, resolved: 0, targetSlaMinutes: 120, actualMttrMinutes: 0 },
    };

    const resolutionMinutesMap = {
      CRITICAL: [] as number[],
      HIGH: [] as number[],
      MEDIUM: [] as number[],
      LOW: [] as number[],
    };

    for (const inc of incidents) {
      const status = String(inc.status || "").toUpperCase();
      if (status === "PENDING_REVIEW") {
        openIncidents++;
      } else if (status === "CONFIRMED") {
        trueViolations++;
      } else if (status === "DISMISSED") {
        falseAlarms++;
      } else if (status === "RESOLVED" || status === "CLOSED") {
        resolvedIncidents++;
      }

      const sev = String(inc.severity || "NORMAL").toUpperCase();
      let sevKey: keyof SeverityBreakdownMapDto = "LOW";
      if (sev === "CRITICAL") sevKey = "CRITICAL";
      else if (sev === "HIGH") sevKey = "HIGH";
      else if (sev === "MEDIUM" || sev === "NORMAL") sevKey = "MEDIUM";
      else sevKey = "LOW";

      severityBreakdown[sevKey].count++;

      if (status === "RESOLVED" || status === "CLOSED") {
        severityBreakdown[sevKey].resolved++;
        if (inc.detectedAt && (inc.resolvedAt || inc.updatedAt)) {
          const resolvedTime = new Date(inc.resolvedAt || inc.updatedAt).getTime();
          const detectedTime = new Date(inc.detectedAt).getTime();
          const diffMinutes = Math.max(0, Math.round((resolvedTime - detectedTime) / (1000 * 60)));
          if (!isNaN(diffMinutes) && diffMinutes > 0) {
            resolutionMinutesMap[sevKey].push(diffMinutes);
          }
        }
      }
    }

    for (const key of ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const) {
      const recorded = resolutionMinutesMap[key];
      if (recorded.length > 0) {
        const avg = Math.round(recorded.reduce((a, b) => a + b, 0) / recorded.length);
        severityBreakdown[key].actualMttrMinutes = avg;
      }
    }

    const reviewedCount = trueViolations + falseAlarms;
    const falseAlarmRate =
      reviewedCount > 0
        ? Number(((falseAlarms / reviewedCount) * 100).toFixed(2))
        : 0;

    const complianceRate =
      totalIncidents > 0
        ? Number(
            Math.max(
              0,
              100 - (trueViolations / totalIncidents) * 100,
            ).toFixed(2),
          )
        : 100;

    return {
      totalIncidents,
      openIncidents,
      resolvedIncidents,
      trueViolations,
      falseAlarms,
      falseAlarmRate,
      complianceRate,
      meanTimeToResolveHours: 0,
      periodStart: filter.startDate,
      periodEnd: filter.endDate,
      severityBreakdown,
    };
  }

  computeViolationBreakdownFromIncidentList(
    incidents: any[],
  ): ViolationTypeStatDto[] {
    const breakdownMap = new Map<
      string,
      {
        count: number;
        severityBreakdown: {
          LOW: number;
          NORMAL: number;
          MEDIUM: number;
          HIGH: number;
          CRITICAL: number;
        };
      }
    >();

    let grandTotal = 0;

    for (const inc of incidents) {
      grandTotal++;
      const vType = inc.violationType || "UNKNOWN";
      const item = breakdownMap.get(vType) || {
        count: 0,
        severityBreakdown: {
          LOW: 0,
          NORMAL: 0,
          MEDIUM: 0,
          HIGH: 0,
          CRITICAL: 0,
        },
      };

      item.count++;
      const sev = String(inc.severity || "NORMAL").toUpperCase();
      if (Object.prototype.hasOwnProperty.call(item.severityBreakdown, sev)) {
        (item.severityBreakdown as any)[sev]++;
      }
      breakdownMap.set(vType, item);
    }

    return Array.from(breakdownMap.entries()).map(([violationType, data]) => ({
      violationType,
      count: data.count,
      percentage:
        grandTotal > 0
          ? Number(((data.count / grandTotal) * 100).toFixed(2))
          : 0,
      severityBreakdown: data.severityBreakdown,
    }));
  }

  async getIncidentSummary(
    filter: DashboardFilterDto,
    callOptions?: { authHeader?: string; requestId?: string },
  ): Promise<StatisticsSummaryDto> {
    const where: any = {};
    if (filter.siteId) {
      where.siteId = filter.siteId;
    }
    if (filter.startDate || filter.endDate) {
      where.statDate = {};
      if (filter.startDate) {
        where.statDate.gte = new Date(filter.startDate);
      }
      if (filter.endDate) {
        where.statDate.lte = new Date(filter.endDate);
      }
    }

    const rows = await this.prisma.incidentStatistic.findMany({
      where,
      take: 5000,
    });

    let totalIncidents = 0;
    let openIncidents = 0;
    let resolvedIncidents = 0;
    let falseAlarms = 0;
    let trueViolations = 0;

    for (const r of rows) {
      totalIncidents += r.totalIncidents;
      openIncidents += r.openIncidents;
      resolvedIncidents += r.resolvedIncidents;
      falseAlarms += r.falseAlarms;
      trueViolations += r.trueViolations;
    }

    // Real-time Fallback nếu bảng incident_statistics chưa có dữ liệu tổng hợp
    if (rows.length === 0 || totalIncidents === 0) {
      const realtimeIncidents = await this.fetchRealtimeIncidentsFromIncidentService(
        filter,
        callOptions,
      );
      if (realtimeIncidents && realtimeIncidents.length > 0) {
        return this.computeSummaryFromIncidentList(realtimeIncidents, filter);
      }
    }

    const reviewedCount = trueViolations + falseAlarms;
    const falseAlarmRate =
      reviewedCount > 0
        ? Number(((falseAlarms / reviewedCount) * 100).toFixed(2))
        : 0;

    // SEC-26: Loại bỏ hệ số phóng đại 1.5 ở mẫu số để đảm bảo tính tuyến tính chính xác của tỷ lệ tuân thủ (0% - 100%)
    const complianceRate =
      totalIncidents > 0
        ? Number(
            Math.max(
              0,
              100 - (trueViolations / totalIncidents) * 100,
            ).toFixed(2),
          )
        : 100;

    // SEC-25: Loại bỏ hằng số ảo 2.5h MTTR; tính toán MTTR thực tế từ thời gian giải quyết thực tế (hoặc 0 khi chưa theo dõi thời lượng)
    const totalResolutionHours = 0;
    const meanTimeToResolveHours =
      resolvedIncidents > 0
        ? Number((totalResolutionHours / resolvedIncidents).toFixed(2))
        : 0;

    const severityBreakdown: SeverityBreakdownMapDto = {
      CRITICAL: { count: 0, resolved: 0, targetSlaMinutes: 15, actualMttrMinutes: 0 },
      HIGH: { count: 0, resolved: 0, targetSlaMinutes: 30, actualMttrMinutes: 0 },
      MEDIUM: { count: 0, resolved: 0, targetSlaMinutes: 60, actualMttrMinutes: 0 },
      LOW: { count: 0, resolved: 0, targetSlaMinutes: 120, actualMttrMinutes: 0 },
    };

    try {
      const statRows = await this.prisma.reportStatistic.findMany({
        where,
        take: 5000,
      });

      for (const s of statRows) {
        const sev = String(s.severity || "NORMAL").toUpperCase();
        let sevKey: keyof SeverityBreakdownMapDto = "LOW";
        if (sev === "CRITICAL") sevKey = "CRITICAL";
        else if (sev === "HIGH") sevKey = "HIGH";
        else if (sev === "MEDIUM" || sev === "NORMAL") sevKey = "MEDIUM";
        else sevKey = "LOW";

        severityBreakdown[sevKey].count += s.totalCount;
        severityBreakdown[sevKey].resolved += s.resolvedCount;
      }
    } catch {
      // Bỏ qua lỗi truy vấn phụ nếu có
    }

    return {
      totalIncidents,
      openIncidents,
      resolvedIncidents,
      trueViolations,
      falseAlarms,
      falseAlarmRate,
      complianceRate,
      meanTimeToResolveHours,
      periodStart: filter.startDate,
      periodEnd: filter.endDate,
      severityBreakdown,
    };
  }

  /**
   * Thống kê rủi ro vi phạm theo 24 giờ và phân ca trực (Sáng 06:00-14:00, Chiều 14:00-22:00, Đêm 22:00-06:00)
   */
  async getHourlyRisk(
    filter: HourlyRiskFilterDto,
    callOptions?: { authHeader?: string; requestId?: string },
  ): Promise<HourlyRiskResponseDto> {
    const targetDate =
      filter.date ||
      filter.startDate ||
      formatVietnamDate(new Date(), "YYYY-MM-DD");

    const { startOfDay, endOfDay } = getVietnamDayRange(targetDate);

    const hourly: HourlyRiskItemDto[] = Array.from({ length: 24 }, (_, hour) => {
      const shift: "MORNING" | "AFTERNOON" | "NIGHT" =
        hour >= 6 && hour < 14
          ? "MORNING"
          : hour >= 14 && hour < 22
          ? "AFTERNOON"
          : "NIGHT";
      return {
        hour,
        label: `${String(hour).padStart(2, "0")}:00`,
        shift,
        count: 0,
        riskLevel: "LOW",
        severityBreakdown: {
          CRITICAL: 0,
          HIGH: 0,
          MEDIUM: 0,
          LOW: 0,
        },
      };
    });

    const realtimeIncidents = await this.fetchRealtimeIncidentsFromIncidentService(
      {
        siteId: filter.siteId,
        startDate: startOfDay.toISOString(),
        endDate: endOfDay.toISOString(),
      },
      callOptions,
    );

    if (realtimeIncidents && Array.isArray(realtimeIncidents)) {
      for (const inc of realtimeIncidents) {
        const rawDate = inc.detectedAt || inc.createdAt;
        if (!rawDate) continue;
        const d = new Date(rawDate);
        if (isNaN(d.getTime())) continue;

        const hour = getVietnamHour(d);
        if (hour >= 0 && hour < 24) {
          const item = hourly[hour];
          item.count++;

          const sev = String(inc.severity || "NORMAL").toUpperCase();
          if (sev === "CRITICAL") item.severityBreakdown.CRITICAL++;
          else if (sev === "HIGH") item.severityBreakdown.HIGH++;
          else if (sev === "MEDIUM" || sev === "NORMAL") item.severityBreakdown.MEDIUM++;
          else item.severityBreakdown.LOW++;
        }
      }
    }

    // Xác định riskLevel từng giờ
    for (const item of hourly) {
      if (item.severityBreakdown.CRITICAL > 0) {
        item.riskLevel = "CRITICAL";
      } else if (item.severityBreakdown.HIGH > 0) {
        item.riskLevel = "HIGH";
      } else if (item.severityBreakdown.MEDIUM > 0 || item.count >= 3) {
        item.riskLevel = "MEDIUM";
      } else {
        item.riskLevel = "LOW";
      }
    }

    // Tổng hợp 3 ca trực
    const morningHours = hourly.filter((h) => h.shift === "MORNING");
    const afternoonHours = hourly.filter((h) => h.shift === "AFTERNOON");
    const nightHours = hourly.filter((h) => h.shift === "NIGHT");

    const aggregateShift = (
      name: string,
      timeRange: string,
      hours: HourlyRiskItemDto[],
    ): ShiftRiskSummaryDto => {
      const totalIncidents = hours.reduce((acc, h) => acc + h.count, 0);
      const criticalCount = hours.reduce((acc, h) => acc + h.severityBreakdown.CRITICAL, 0);
      const highCount = hours.reduce((acc, h) => acc + h.severityBreakdown.HIGH, 0);
      const mediumCount = hours.reduce((acc, h) => acc + h.severityBreakdown.MEDIUM, 0);
      const lowCount = hours.reduce((acc, h) => acc + h.severityBreakdown.LOW, 0);

      let riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "LOW";
      if (criticalCount > 0 || highCount >= 3) {
        riskLevel = "CRITICAL";
      } else if (highCount > 0 || mediumCount >= 3) {
        riskLevel = "HIGH";
      } else if (mediumCount > 0 || totalIncidents >= 2) {
        riskLevel = "MEDIUM";
      }

      return {
        name,
        timeRange,
        totalIncidents,
        criticalCount,
        highCount,
        mediumCount,
        lowCount,
        riskLevel,
      };
    };

    const shifts = {
      morning: aggregateShift("Ca Sáng", "06:00 - 14:00", morningHours),
      afternoon: aggregateShift("Ca Chiều", "14:00 - 22:00", afternoonHours),
      night: aggregateShift("Ca Đêm", "22:00 - 06:00", nightHours),
    };

    const totalIncidents = hourly.reduce((acc, h) => acc + h.count, 0);

    // Xác định giờ cao điểm (peakHour)
    let peakHour = 0;
    let maxHourCount = -1;
    for (const h of hourly) {
      if (h.count > maxHourCount) {
        maxHourCount = h.count;
        peakHour = h.hour;
      }
    }

    // Xác định ca cao điểm (peakShift)
    let peakShift: "MORNING" | "AFTERNOON" | "NIGHT" = "MORNING";
    const maxShiftCount = Math.max(
      shifts.morning.totalIncidents,
      shifts.afternoon.totalIncidents,
      shifts.night.totalIncidents,
    );
    if (maxShiftCount === shifts.afternoon.totalIncidents && shifts.afternoon.totalIncidents > shifts.morning.totalIncidents) {
      peakShift = "AFTERNOON";
    } else if (maxShiftCount === shifts.night.totalIncidents && shifts.night.totalIncidents > shifts.morning.totalIncidents) {
      peakShift = "NIGHT";
    }

    let overallRiskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "LOW";
    if (shifts.morning.riskLevel === "CRITICAL" || shifts.afternoon.riskLevel === "CRITICAL" || shifts.night.riskLevel === "CRITICAL") {
      overallRiskLevel = "CRITICAL";
    } else if (shifts.morning.riskLevel === "HIGH" || shifts.afternoon.riskLevel === "HIGH" || shifts.night.riskLevel === "HIGH") {
      overallRiskLevel = "HIGH";
    } else if (shifts.morning.riskLevel === "MEDIUM" || shifts.afternoon.riskLevel === "MEDIUM" || shifts.night.riskLevel === "MEDIUM") {
      overallRiskLevel = "MEDIUM";
    }

    return {
      date: targetDate,
      siteId: filter.siteId,
      hourly,
      shifts,
      summary: {
        totalIncidents,
        peakHour,
        peakShift,
        riskLevel: overallRiskLevel,
      },
    };
  }

  // ── 2. Time-Series Trends ───────────────────────────────────────────────────

  async getIncidentTrends(filter: TrendsFilterDto): Promise<TrendItemDto[]> {
    const where: any = {};
    if (filter.siteId) {
      where.siteId = filter.siteId;
    }
    if (filter.startDate || filter.endDate) {
      where.statDate = {};
      if (filter.startDate) {
        where.statDate.gte = new Date(filter.startDate);
      }
      if (filter.endDate) {
        where.statDate.lte = new Date(filter.endDate);
      }
    }

    const rows = await this.prisma.incidentStatistic.findMany({
      where,
      orderBy: { statDate: "asc" },
      take: 5000,
    });

    const groupBy = filter.groupBy || STATISTIC_GROUP_BY.DAY;
    const groups = new Map<string, TrendItemDto>();

    for (const r of rows) {
      const d =
        r.statDate instanceof Date ? r.statDate : new Date(r.statDate);
      let key = d.toISOString().slice(0, 10);

      if (groupBy === STATISTIC_GROUP_BY.WEEK) {
        // SEC-37: Gom theo tuần ISO: YYYY-Www dùng thuật toán chuẩn ISO 8601
        key = getIsoWeekString(d);
      } else if (groupBy === STATISTIC_GROUP_BY.MONTH) {
        key = d.toISOString().slice(0, 7); // YYYY-MM
      }

      const existing = groups.get(key) || {
        date: key,
        totalIncidents: 0,
        trueViolations: 0,
        falseAlarms: 0,
        resolvedCount: 0,
      };

      existing.totalIncidents += r.totalIncidents;
      existing.trueViolations += r.trueViolations;
      existing.falseAlarms += r.falseAlarms;
      existing.resolvedCount += r.resolvedIncidents;
      groups.set(key, existing);
    }

    return Array.from(groups.values());
  }

  // ── 3. Violation Type & Severity Breakdown ──────────────────────────────────

  async getViolationBreakdown(
    filter: DashboardFilterDto,
    callOptions?: { authHeader?: string; requestId?: string },
  ): Promise<ViolationTypeStatDto[]> {
    const where: any = {};
    if (filter.siteId) {
      where.siteId = filter.siteId;
    }
    if (filter.startDate || filter.endDate) {
      where.statDate = {};
      if (filter.startDate) {
        where.statDate.gte = new Date(filter.startDate);
      }
      if (filter.endDate) {
        where.statDate.lte = new Date(filter.endDate);
      }
    }

    const rows = await this.prisma.reportStatistic.findMany({
      where,
      take: 5000,
    });

    const breakdownMap = new Map<
      string,
      {
        count: number;
        severityBreakdown: {
          LOW: number;
          NORMAL: number;
          MEDIUM: number;
          HIGH: number;
          CRITICAL: number;
        };
      }
    >();

    let grandTotal = 0;

    for (const r of rows) {
      grandTotal += r.totalCount;
      const vType = r.violationType;
      const item = breakdownMap.get(vType) || {
        count: 0,
        severityBreakdown: {
          LOW: 0,
          NORMAL: 0,
          MEDIUM: 0,
          HIGH: 0,
          CRITICAL: 0,
        },
      };

      item.count += r.totalCount;
      const sev = r.severity.toUpperCase();
      if (Object.prototype.hasOwnProperty.call(item.severityBreakdown, sev)) {
        (item.severityBreakdown as any)[sev] += r.totalCount;
      }
      breakdownMap.set(vType, item);
    }

    // Real-time Fallback nếu bảng report_statistics rỗng (chưa chạy cronjob hôm nay)
    // Query realtime từ incident-service để biểu đồ Donut vi phạm không bị rỗng
    if (rows.length === 0 || grandTotal === 0) {
      const realtimeIncidents = await this.fetchRealtimeIncidentsFromIncidentService(
        filter,
        callOptions,
      );
      if (realtimeIncidents && realtimeIncidents.length > 0) {
        return this.computeViolationBreakdownFromIncidentList(realtimeIncidents);
      }
    }

    return Array.from(breakdownMap.entries()).map(([violationType, data]) => ({
      violationType,
      count: data.count,
      percentage:
        grandTotal > 0
          ? Number(((data.count / grandTotal) * 100).toFixed(2))
          : 0,
      severityBreakdown: data.severityBreakdown,
    }));
  }

  // ── 4. Camera Violation Rankings ───────────────────────────────────────────

  async getCameraRankings(
    filter: CameraStatsFilterDto,
  ): Promise<CameraStatDto[]> {
    const where: any = {
      cameraId: { not: null },
    };
    if (filter.siteId) {
      where.siteId = filter.siteId;
    }
    if (filter.startDate || filter.endDate) {
      where.statDate = {};
      if (filter.startDate) {
        where.statDate.gte = new Date(filter.startDate);
      }
      if (filter.endDate) {
        where.statDate.lte = new Date(filter.endDate);
      }
    }

    const rows = await this.prisma.reportStatistic.findMany({
      where,
      take: 5000,
    });

    const cameraMap = new Map<
      string,
      {
        totalViolations: number;
        confirmedCount: number;
        falseAlarmCount: number;
        resolvedCount: number;
      }
    >();

    for (const r of rows) {
      if (!r.cameraId) continue;
      const camId = r.cameraId;
      const item = cameraMap.get(camId) || {
        totalViolations: 0,
        confirmedCount: 0,
        falseAlarmCount: 0,
        resolvedCount: 0,
      };

      item.totalViolations += r.totalCount;
      item.confirmedCount += r.confirmedCount;
      // SEC-38: Không gán nhầm các vi phạm chưa kiểm duyệt thành cảnh báo sai
      item.falseAlarmCount += (r as any).falseAlarmCount ?? 0;
      item.resolvedCount += r.resolvedCount;
      cameraMap.set(camId, item);
    }

    const result = Array.from(cameraMap.entries())
      .map(([cameraId, stats]) => ({
        cameraId,
        totalViolations: stats.totalViolations,
        confirmedCount: stats.confirmedCount,
        falseAlarmCount: stats.falseAlarmCount,
        resolvedCount: stats.resolvedCount,
      }))
      .sort((a, b) => b.totalViolations - a.totalViolations);

    const limit = filter.limit || 10;
    return result.slice(0, limit);
  }

  // ── 5. AI Performance Statistics & Telemetry ───────────────────────────────

  async getAiPerformanceStats(
    filter: AiPerformanceFilterDto,
  ): Promise<AiPerformanceStatDto[]> {
    const where: any = {};
    if (filter.cameraId) {
      where.cameraId = filter.cameraId;
    }
    if (filter.startDate || filter.endDate) {
      where.statDate = {};
      if (filter.startDate) {
        where.statDate.gte = new Date(filter.startDate);
      }
      if (filter.endDate) {
        where.statDate.lte = new Date(filter.endDate);
      }
    }

    const rows = await this.prisma.aiPerformanceStatistic.findMany({
      where,
      orderBy: { statDate: "desc" },
      take: 5000,
    });

    return rows.map(serializeAiPerformance);
  }

  async recordAiPerformanceMetric(
    dto: RecordAiPerformanceDto,
  ): Promise<AiPerformanceStatDto> {
    if (!Number.isFinite(dto.fps) || !Number.isFinite(dto.latencyMs)) {
      throw new AppError(
        "Dữ liệu hiệu năng không hợp lệ (phải là số thực hữu hạn)",
        400,
        ERROR_CODE.VALIDATION_ERROR,
      );
    }

    const statDateString =
      dto.statDate || formatVietnamDate(new Date(), "YYYY-MM-DD");
    const normalizedDate = new Date(statDateString);
    const frameCount = BigInt(dto.frameCount || 1);

    // SEC-34: Xác thực sự tồn tại của modelVersionId trong cơ sở dữ liệu nếu được cung cấp
    if (dto.modelVersionId && this.prisma.aiModelVersion) {
      const version = await this.prisma.aiModelVersion.findUnique({
        where: { id: dto.modelVersionId },
      });
      if (!version) {
        throw new AppError(
          "AI Model Version not found",
          404,
          ERROR_CODE.AI_MODEL_VERSION_NOT_FOUND,
        );
      }
    }

    const applyWeightedUpdate = async (existing: any) => {
      const prevTotalFrames = existing.totalFrames;
      const newTotalFrames = prevTotalFrames + frameCount;
      const prevAvgFps = Number(existing.avgFps);
      const prevAvgLatency = Number(existing.avgLatencyMs);

      // Tính trung bình có trọng số
      const updatedAvgFps = Number(
        (
          (prevAvgFps * Number(prevTotalFrames) +
            dto.fps * Number(frameCount)) /
          Number(newTotalFrames)
        ).toFixed(2),
      );
      const updatedAvgLatency = Number(
        (
          (prevAvgLatency * Number(prevTotalFrames) +
            dto.latencyMs * Number(frameCount)) /
          Number(newTotalFrames)
        ).toFixed(2),
      );
      const updatedMaxLatency = Math.max(
        existing.maxLatencyMs,
        Math.round(dto.latencyMs),
      );

      if (!Number.isFinite(updatedAvgFps) || !Number.isFinite(updatedAvgLatency)) {
        throw new AppError(
          "Dữ liệu hiệu năng tính toán không hợp lệ (vượt quá giới hạn)",
          400,
          ERROR_CODE.VALIDATION_ERROR,
        );
      }

      const updated = await this.prisma.aiPerformanceStatistic.update({
        where: { id: existing.id },
        data: {
          avgFps: updatedAvgFps,
          avgLatencyMs: updatedAvgLatency,
          maxLatencyMs: updatedMaxLatency,
          totalFrames: newTotalFrames,
          modelVersionId: dto.modelVersionId ?? existing.modelVersionId,
        },
      });
      return serializeAiPerformance(updated);
    };

    // Tìm bản ghi hiện tại cho camera trong ngày theo unique compound key
    const existing = await this.prisma.aiPerformanceStatistic.findUnique({
      where: {
        cameraId_statDate: {
          cameraId: dto.cameraId,
          statDate: normalizedDate,
        },
      },
    });

    if (existing) {
      return applyWeightedUpdate(existing);
    }

    try {
      const created = await this.prisma.aiPerformanceStatistic.create({
        data: {
          cameraId: dto.cameraId,
          modelVersionId: dto.modelVersionId ?? null,
          statDate: normalizedDate,
          avgFps: Number(dto.fps.toFixed(2)),
          avgLatencyMs: Number(dto.latencyMs.toFixed(2)),
          maxLatencyMs: Math.round(dto.latencyMs),
          totalFrames: frameCount,
        },
      });

      return serializeAiPerformance(created);
    } catch (error: any) {
      // SEC-34: Bắt lỗi khóa ngoại nếu modelVersionId không tồn tại hoặc bị xóa đồng thời
      if (
        error?.code === "P2003" ||
        error?.message?.includes("foreign key constraint") ||
        error?.message?.includes("ai_performance_statistics_model_version_id_fkey")
      ) {
        throw new AppError(
          "AI Model Version not found",
          404,
          ERROR_CODE.AI_MODEL_VERSION_NOT_FOUND,
        );
      }

      // Xử lý race condition khi 2 request gửi đồng thời (P2002 Unique constraint violation)
      if (
        error?.code === "P2002" ||
        error?.message?.includes("Unique constraint") ||
        error?.message?.includes("ai_performance_statistics_camera_id_stat_date_key")
      ) {
        const concurrentExisting =
          await this.prisma.aiPerformanceStatistic.findUnique({
            where: {
              cameraId_statDate: {
                cameraId: dto.cameraId,
                statDate: normalizedDate,
              },
            },
          });
        if (concurrentExisting) {
          return applyWeightedUpdate(concurrentExisting);
        }
      }
      throw error;
    }
  }

  // ── 6. Daily Rollup Aggregation ────────────────────────────────────────────

  async findIncidentStatistic(
    siteId: string,
    statDate: Date,
  ) {
    return this.prisma.incidentStatistic.findUnique({
      where: {
        siteId_statDate: {
          siteId,
          statDate,
        },
      },
    });
  }

  async upsertIncidentStatistic(data: {
    siteId: string;
    statDate: Date;
    totalIncidents: number;
    openIncidents: number;
    resolvedIncidents: number;
    falseAlarms: number;
    trueViolations: number;
  }) {
    return this.prisma.incidentStatistic.upsert({
      where: {
        siteId_statDate: {
          siteId: data.siteId,
          statDate: data.statDate,
        },
      },
      update: {
        totalIncidents: data.totalIncidents,
        openIncidents: data.openIncidents,
        resolvedIncidents: data.resolvedIncidents,
        falseAlarms: data.falseAlarms,
        trueViolations: data.trueViolations,
      },
      create: {
        siteId: data.siteId,
        statDate: data.statDate,
        totalIncidents: data.totalIncidents,
        openIncidents: data.openIncidents,
        resolvedIncidents: data.resolvedIncidents,
        falseAlarms: data.falseAlarms,
        trueViolations: data.trueViolations,
      },
    });
  }

  async upsertReportStatistic(data: {
    siteId: string;
    cameraId?: string | null;
    violationType: string;
    severity: string;
    statDate: Date;
    totalCount: number;
    confirmedCount?: number;
    resolvedCount?: number;
    falseAlarmCount?: number;
    increment?: boolean;
  }) {
    // Tìm bản ghi phù hợp
    const existing = await this.prisma.reportStatistic.findFirst({
      where: {
        siteId: data.siteId,
        cameraId: data.cameraId ?? null,
        violationType: data.violationType,
        severity: data.severity,
        statDate: data.statDate,
      },
    });

    const confirmedCount = data.confirmedCount ?? 0;
    const resolvedCount = data.resolvedCount ?? 0;

    if (existing) {
      return this.prisma.reportStatistic.update({
        where: { id: existing.id },
        data: {
          totalCount: data.increment ? { increment: data.totalCount } : data.totalCount,
          confirmedCount: data.increment ? { increment: confirmedCount } : confirmedCount,
          resolvedCount: data.increment ? { increment: resolvedCount } : resolvedCount,
        },
      });
    }

    return this.prisma.reportStatistic.create({
      data: {
        siteId: data.siteId,
        cameraId: data.cameraId ?? null,
        violationType: data.violationType,
        severity: data.severity,
        statDate: data.statDate,
        totalCount: data.totalCount,
        confirmedCount,
        resolvedCount,
      },
    });
  }

  // ── 7. Report Templates ────────────────────────────────────────────────────

  async findReportTemplates(): Promise<ReportTemplateDto[]> {
    const list = await this.prisma.reportTemplate.findMany({
      orderBy: { createdAt: "desc" },
    });
    return list.map((t) => ({
      id: t.id,
      name: t.name,
      code: t.code,
      description: t.description,
      filePath: t.filePath,
      fileName: t.fileName,
      fileType: t.fileType,
      version: t.version,
      status: t.status,
      createdBy: t.createdBy,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    }));
  }

  async findReportTemplateById(id: string): Promise<ReportTemplateDto | null> {
    const t = await this.prisma.reportTemplate.findUnique({
      where: { id },
    });
    if (!t) return null;
    return {
      id: t.id,
      name: t.name,
      code: t.code,
      description: t.description,
      filePath: t.filePath,
      fileName: t.fileName,
      fileType: t.fileType,
      version: t.version,
      status: t.status,
      createdBy: t.createdBy,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  async findReportTemplateByCode(
    code: string,
  ): Promise<ReportTemplateDto | null> {
    const t = await this.prisma.reportTemplate.findUnique({
      where: { code },
    });
    if (!t) return null;
    return {
      id: t.id,
      name: t.name,
      code: t.code,
      description: t.description,
      filePath: t.filePath,
      fileName: t.fileName,
      fileType: t.fileType,
      version: t.version,
      status: t.status,
      createdBy: t.createdBy,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  async createReportTemplate(
    dto: CreateReportTemplateDto,
    createdBy?: string,
  ): Promise<ReportTemplateDto> {
    const t = await this.prisma.reportTemplate.create({
      data: {
        name: dto.name,
        code: dto.code,
        description: dto.description ?? null,
        filePath: dto.filePath ?? null,
        fileName: dto.fileName ?? null,
        fileType: dto.fileType || "PDF",
        version: dto.version || "1.0.0",
        createdBy: createdBy ?? null,
      },
    });
    return {
      id: t.id,
      name: t.name,
      code: t.code,
      description: t.description,
      filePath: t.filePath,
      fileName: t.fileName,
      fileType: t.fileType,
      version: t.version,
      status: t.status,
      createdBy: t.createdBy,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  async deleteReportTemplate(id: string): Promise<void> {
    try {
      await this.prisma.reportTemplate.delete({
        where: { id },
      });
    } catch (err: any) {
      // SEC-08: Chặn xóa mẫu báo cáo khi đã có lịch sử xuất báo cáo pháp lý (onDelete: Restrict)
      if (
        err?.code === "P2003" ||
        err?.message?.includes("foreign key constraint") ||
        err?.message?.includes("report_generations_template_id_fkey")
      ) {
        throw new AppError(
          "Không thể xóa mẫu báo cáo đã có lịch sử xuất báo cáo pháp lý. Vui lòng chuyển trạng thái sang INACTIVE",
          400,
          ERROR_CODE.VALIDATION_ERROR,
        );
      }
      throw err;
    }
  }

  // ── 8. Report Generations ──────────────────────────────────────────────────

  async createReportGeneration(
    dto: GenerateReportDto,
    generatedBy: string,
    fileType?: string,
  ): Promise<ReportGenerationDto> {
    let resolvedFileType = fileType;
    if (!resolvedFileType) {
      const tmpl = await this.prisma.reportTemplate.findUnique({
        where: { id: dto.templateId },
        select: { fileType: true },
      });
      resolvedFileType = tmpl?.fileType;
    }

    // SEC-35: Xác định phần mở rộng tệp tin theo đúng định dạng template (EXCEL -> xlsx, CSV -> csv, JSON -> json, PDF -> pdf)
    const normalizedType = (resolvedFileType || "PDF").toUpperCase();
    const ext =
      normalizedType === "EXCEL"
        ? "xlsx"
        : normalizedType === "CSV"
          ? "csv"
          : normalizedType === "JSON"
            ? "json"
            : "pdf";

    const timestamp = Date.now();
    const fileName = `report_${dto.reportType.toLowerCase()}_${timestamp}.${ext}`;
    const filePath = `reports/${dto.siteId}/${timestamp}.${ext}`;

    const gen = await this.prisma.reportGeneration.create({
      data: {
        templateId: dto.templateId,
        siteId: dto.siteId,
        reportType: dto.reportType,
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        generatedBy,
        status: REPORT_STATUS.COMPLETED,
        fileName,
        filePath,
      },
      include: {
        template: true,
      },
    });

    return {
      id: gen.id,
      templateId: gen.templateId,
      siteId: gen.siteId,
      reportType: gen.reportType,
      periodStart: gen.periodStart.toISOString().slice(0, 10),
      periodEnd: gen.periodEnd.toISOString().slice(0, 10),
      generatedBy: gen.generatedBy,
      status: gen.status,
      filePath: undefined, // SEC-12: Không để lộ đường dẫn tệp tin nội bộ ra API công khai
      fileName: gen.fileName,
      errorMessage: gen.errorMessage,
      generatedAt: gen.generatedAt.toISOString(),
      createdAt: gen.createdAt.toISOString(),
      template: gen.template
        ? {
            id: gen.template.id,
            name: gen.template.name,
            code: gen.template.code,
            fileType: gen.template.fileType,
            version: gen.template.version,
            status: gen.template.status,
            createdAt: gen.template.createdAt.toISOString(),
            updatedAt: gen.template.updatedAt.toISOString(),
          }
        : undefined,
    };
  }

  async findReportGenerationById(
    id: string,
  ): Promise<ReportGenerationDto | null> {
    const gen = await this.prisma.reportGeneration.findUnique({
      where: { id },
      include: { template: true },
    });
    if (!gen) return null;
    return {
      id: gen.id,
      templateId: gen.templateId,
      siteId: gen.siteId,
      reportType: gen.reportType,
      periodStart: gen.periodStart.toISOString().slice(0, 10),
      periodEnd: gen.periodEnd.toISOString().slice(0, 10),
      generatedBy: gen.generatedBy,
      status: gen.status,
      filePath: undefined, // SEC-12: Không để lộ đường dẫn tệp tin nội bộ ra API công khai
      fileName: gen.fileName,
      errorMessage: gen.errorMessage,
      generatedAt: gen.generatedAt.toISOString(),
      createdAt: gen.createdAt.toISOString(),
      template: gen.template
        ? {
            id: gen.template.id,
            name: gen.template.name,
            code: gen.template.code,
            fileType: gen.template.fileType,
            version: gen.template.version,
            status: gen.template.status,
            createdAt: gen.template.createdAt.toISOString(),
            updatedAt: gen.template.updatedAt.toISOString(),
          }
        : undefined,
    };
  }

  async findReportGenerations(
    query: ReportHistoryQueryDto,
  ): Promise<PaginatedResultDto<ReportGenerationDto>> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const { skip, take, page: safePage, limit: safeLimit } =
      calculatePaginationSkip(page, limit);

    const where: any = {};
    if (query.siteId) {
      where.siteId = query.siteId;
    }
    if (query.reportType) {
      where.reportType = query.reportType;
    }
    if (query.status) {
      where.status = query.status;
    }

    const [total, items] = await Promise.all([
      this.prisma.reportGeneration.count({ where }),
      this.prisma.reportGeneration.findMany({
        where,
        skip,
        take,
        orderBy: { generatedAt: "desc" },
        include: { template: true },
      }),
    ]);

    const data: ReportGenerationDto[] = (items as any[]).map((gen) => ({
      id: gen.id,
      templateId: gen.templateId,
      siteId: gen.siteId,
      reportType: gen.reportType,
      periodStart: gen.periodStart.toISOString().slice(0, 10),
      periodEnd: gen.periodEnd.toISOString().slice(0, 10),
      generatedBy: gen.generatedBy,
      status: gen.status,
      filePath: undefined, // SEC-12: Không để lộ đường dẫn tệp tin nội bộ ra API công khai
      fileName: gen.fileName,
      errorMessage: gen.errorMessage,
      generatedAt: gen.generatedAt.toISOString(),
      createdAt: gen.createdAt.toISOString(),
      template: gen.template
        ? {
            id: gen.template.id,
            name: gen.template.name,
            code: gen.template.code,
            fileType: gen.template.fileType,
            version: gen.template.version,
            status: gen.template.status,
            createdAt: gen.template.createdAt.toISOString(),
            updatedAt: gen.template.updatedAt.toISOString(),
          }
        : undefined,
    }));

    return {
      data,
      meta: formatPaginationMeta(safePage, safeLimit, total),
    };
  }

  // ── 9. AI Models & Versions ────────────────────────────────────────────────

  async findAiModels(): Promise<AiModelDto[]> {
    const models = await this.prisma.aiModel.findMany({
      include: {
        versions: {
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return models.map((m) => ({
      id: m.id,
      name: m.name,
      code: m.code,
      modelType: m.modelType,
      description: m.description,
      status: m.status,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      versions: m.versions.map((v) => ({
        id: v.id,
        modelId: v.modelId,
        version: v.version,
        modelPath: v.modelPath,
        framework: v.framework,
        inputSize: v.inputSize,
        status: v.status,
        metrics: v.metrics as any,
        deployedAt: v.deployedAt?.toISOString() ?? null,
        createdAt: v.createdAt.toISOString(),
      })),
    }));
  }

  async findAiModelById(id: string): Promise<AiModelDto | null> {
    const m = await this.prisma.aiModel.findUnique({
      where: { id },
      include: {
        versions: {
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!m) return null;

    return {
      id: m.id,
      name: m.name,
      code: m.code,
      modelType: m.modelType,
      description: m.description,
      status: m.status,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      versions: m.versions.map((v) => ({
        id: v.id,
        modelId: v.modelId,
        version: v.version,
        modelPath: v.modelPath,
        framework: v.framework,
        inputSize: v.inputSize,
        status: v.status,
        metrics: v.metrics as any,
        deployedAt: v.deployedAt?.toISOString() ?? null,
        createdAt: v.createdAt.toISOString(),
      })),
    };
  }

  async findAiModelByCode(code: string): Promise<AiModelDto | null> {
    const m = await this.prisma.aiModel.findUnique({
      where: { code },
    });
    if (!m) return null;
    return {
      id: m.id,
      name: m.name,
      code: m.code,
      modelType: m.modelType,
      description: m.description,
      status: m.status,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    };
  }

  async createAiModel(dto: CreateAiModelDto): Promise<AiModelDto> {
    const m = await this.prisma.aiModel.create({
      data: {
        name: dto.name,
        code: dto.code,
        modelType: dto.modelType,
        description: dto.description ?? null,
      },
    });
    return {
      id: m.id,
      name: m.name,
      code: m.code,
      modelType: m.modelType,
      description: m.description,
      status: m.status,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
      versions: [],
    };
  }

  async findAiModelVersionById(
    versionId: string,
  ): Promise<AiModelVersionDto | null> {
    const v = await this.prisma.aiModelVersion.findUnique({
      where: { id: versionId },
    });
    if (!v) return null;
    return {
      id: v.id,
      modelId: v.modelId,
      version: v.version,
      modelPath: v.modelPath,
      framework: v.framework,
      inputSize: v.inputSize,
      status: v.status,
      metrics: v.metrics as any,
      deployedAt: v.deployedAt?.toISOString() ?? null,
      createdAt: v.createdAt.toISOString(),
    };
  }

  async findActiveDeployedModelVersion(filter?: {
    modelId?: string;
    modelType?: string;
  }): Promise<AiModelVersionDto | null> {
    const modelFilter: any = {
      status: AI_MODEL_STATUS.ACTIVE,
    };

    if (filter?.modelType) {
      modelFilter.modelType = filter.modelType;
    }

    const where: any = {
      status: "DEPLOYED",
      deployedAt: { not: null },
      modelPath: { not: null },
      model: modelFilter,
    };

    if (filter?.modelId) {
      where.modelId = filter.modelId;
    }

    const v = await this.prisma.aiModelVersion.findFirst({
      where,
      orderBy: { deployedAt: "desc" },
    });
    if (!v) return null;
    return {
      id: v.id,
      modelId: v.modelId,
      version: v.version,
      modelPath: v.modelPath,
      framework: v.framework,
      inputSize: v.inputSize,
      status: v.status,
      metrics: v.metrics as any,
      deployedAt: v.deployedAt?.toISOString() ?? null,
      createdAt: v.createdAt.toISOString(),
    };
  }

  async findAiModelVersionByModelAndVersion(
    modelId: string,
    version: string,
  ): Promise<AiModelVersionDto | null> {
    const v = await this.prisma.aiModelVersion.findUnique({
      where: {
        modelId_version: { modelId, version },
      },
    });
    if (!v) return null;
    return {
      id: v.id,
      modelId: v.modelId,
      version: v.version,
      modelPath: v.modelPath,
      framework: v.framework,
      inputSize: v.inputSize,
      status: v.status,
      metrics: v.metrics as any,
      deployedAt: v.deployedAt?.toISOString() ?? null,
      createdAt: v.createdAt.toISOString(),
    };
  }

  async createAiModelVersion(
    modelId: string,
    dto: CreateAiModelVersionDto,
  ): Promise<AiModelVersionDto> {
    const v = await this.prisma.aiModelVersion.create({
      data: {
        modelId,
        version: dto.version,
        modelPath: dto.modelPath ?? null,
        framework: dto.framework || "PyTorch",
        inputSize: dto.inputSize || "640x640",
        metrics: dto.metrics ? (dto.metrics as any) : undefined,
        status: AI_MODEL_VERSION_STATUS.DEVELOPMENT,
      },
    });

    return {
      id: v.id,
      modelId: v.modelId,
      version: v.version,
      modelPath: v.modelPath,
      framework: v.framework,
      inputSize: v.inputSize,
      status: v.status,
      metrics: v.metrics as any,
      deployedAt: v.deployedAt?.toISOString() ?? null,
      createdAt: v.createdAt.toISOString(),
    };
  }

  async deployAiModelVersion(
    modelId: string,
    versionId: string,
  ): Promise<AiModelVersionDto> {
    return this.prisma.$transaction(async (tx) => {
      // Đánh dấu các version cũ cùng model là ARCHIVED
      await tx.aiModelVersion.updateMany({
        where: {
          modelId,
          status: AI_MODEL_VERSION_STATUS.DEPLOYED,
        },
        data: {
          status: AI_MODEL_VERSION_STATUS.ARCHIVED,
        },
      });

      const updated = await tx.aiModelVersion.update({
        where: { id: versionId },
        data: {
          status: AI_MODEL_VERSION_STATUS.DEPLOYED,
          deployedAt: new Date(),
        },
      });

      return {
        id: updated.id,
        modelId: updated.modelId,
        version: updated.version,
        modelPath: updated.modelPath,
        framework: updated.framework,
        inputSize: updated.inputSize,
        status: updated.status,
        metrics: updated.metrics as any,
        deployedAt: updated.deployedAt?.toISOString() ?? null,
        createdAt: updated.createdAt.toISOString(),
      };
    }, DEFAULT_REPORTING_TRANSACTION_OPTIONS);
  }

  async getAggregatedReportData(report: {
    id: string;
    siteId: string;
    reportType: string;
    periodStart: Date | string;
    periodEnd: Date | string;
    generatedBy: string;
    generatedAt: Date | string;
    template?: { code?: string; name?: string; fileType?: string } | null;
  }): Promise<AggregatedReportDataDto> {
    const startDate =
      report.periodStart instanceof Date
        ? report.periodStart.toISOString().slice(0, 10)
        : String(report.periodStart).slice(0, 10);
    const endDate =
      report.periodEnd instanceof Date
        ? report.periodEnd.toISOString().slice(0, 10)
        : String(report.periodEnd).slice(0, 10);

    const filter = {
      siteId: report.siteId,
      startDate,
      endDate,
    };

    const [summary, violationsBreakdown, cameraRankings, trends, rawAiPerformance] =
      await Promise.all([
        this.getIncidentSummary(filter),
        this.getViolationBreakdown(filter),
        this.getCameraRankings({ ...filter, limit: 10 }),
        this.getIncidentTrends({
          ...filter,
          groupBy:
            report.reportType === "MONTHLY"
              ? STATISTIC_GROUP_BY.WEEK
              : STATISTIC_GROUP_BY.DAY,
        }),
        this.getAiPerformanceStats({ startDate, endDate }).catch(() => []),
      ]);

    // SEC: Đảm bảo cách ly đa công trường (multi-tenant isolation) cho số liệu hiệu năng AI.
    // Khi báo cáo được tạo theo phạm vi công trường (siteId), số liệu AI Telemetry
    // chỉ được phép hiển thị các camera thực tế thuộc công trường đó, triệt tiêu nguy cơ rò rỉ chéo.
    const siteCameraIds = new Set(
      cameraRankings.map((c) => c.cameraId).filter(Boolean) as string[],
    );
    const aiPerformance = filter.siteId
      ? rawAiPerformance.filter((stat) => siteCameraIds.has(stat.cameraId))
      : rawAiPerformance;

    return {
      reportId: report.id,
      reportType: report.reportType,
      templateCode: report.template?.code,
      templateName: report.template?.name,
      siteId: report.siteId,
      periodStart: startDate,
      periodEnd: endDate,
      generatedBy: report.generatedBy,
      generatedAt:
        report.generatedAt instanceof Date
          ? report.generatedAt.toISOString()
          : String(report.generatedAt),
      summary,
      violationsBreakdown,
      cameraRankings,
      trends,
      aiPerformance,
    };
  }

  async findActiveModelDetails(): Promise<ActiveModelSummaryDto> {
    try {
      const v = await (this.prisma as any).aiModelVersion.findFirst({
        where: {
          status: "DEPLOYED",
          model: { status: AI_MODEL_STATUS.ACTIVE },
        },
        include: {
          model: true,
          performanceStatistics: {
            orderBy: { statDate: "desc" },
            take: 1,
          },
        },
        orderBy: { deployedAt: "desc" },
      });

      if (v) {
        const perf = v.performanceStatistics?.[0];
        const metrics = (v.metrics as any) || {};
        return {
          name: v.model?.name || "YOLO11m-PPE",
          version: v.version || "1.0.0",
          latencyMs:
            metrics.latencyMs ??
            (perf?.avgLatencyMs ? Math.round(Number(perf.avgLatencyMs)) : 18),
          fps:
            metrics.fps ??
            (perf?.avgFps ? Math.round(Number(perf.avgFps)) : 28),
        };
      }
    } catch {
      // Fallback an toàn khi DB chưa có bản ghi model nào
    }

    return {
      name: "YOLO11m-PPE",
      version: "1.0.0",
      latencyMs: 18,
      fps: 28,
    };
  }

  async checkDatabaseHealth(): Promise<boolean> {
    try {
      await (reportingPrisma as any).$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

export const reportingRepository = new ReportingRepository();
