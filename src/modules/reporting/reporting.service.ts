import IORedis from "ioredis";
import {
  ReportingRepository,
  ReportingCallOptions,
} from "./reporting.repository";
import {
  DashboardFilterDto,
  DashboardKpiFilterDto,
  DashboardKpiDto,
  HourlyRiskFilterDto,
  HourlyRiskResponseDto,
  CameraStatusSummaryDto,
  ActiveModelSummaryDto,
  TrendsFilterDto,
  CameraStatsFilterDto,
  AiPerformanceFilterDto,
  StatisticsSummaryDto,
  TrendItemDto,
  ViolationTypeStatDto,
  CameraStatDto,
  AiPerformanceStatDto,
  RecordAiPerformanceDto,
  AggregateDailyDto,
  ReportTemplateDto,
  CreateReportTemplateDto,
  GenerateReportDto,
  ReportGenerationDto,
  ReportHistoryQueryDto,
  AiModelDto,
  CreateAiModelDto,
  AiModelVersionDto,
  CreateAiModelVersionDto,
  AiModelDeploySyncResultDto,
  DeployedAiModelVersionDto,
  PaginatedResultDto,
  AggregatedReportDataDto,
} from "./reporting.dto";
import { ExcelReportEngine } from "./engines/excel.engine";
import { PdfReportEngine } from "./engines/pdf.engine";
import { CsvReportEngine } from "./engines/csv.engine";
import { AppError } from "../../common/errors/app-error";
import { ERROR_CODE } from "../../common/errors/error-code";
import { ROLES } from "../../common/constants/role.constant";
import {
  AI_MODEL_DEPLOY_SYNC_CHANNEL,
  AI_MODEL_DEPLOY_SYNC_STATUS,
  AI_MODEL_STATUS,
  REPORT_TEMPLATE_STATUS,
} from "../../common/constants/reporting.constant";
import {
  AUDIT_ACTION,
  AUDIT_TARGET_TYPE,
} from "../../common/constants/audit-log.constant";
import { EVENT_NAMES } from "../../common/constants/event.constant";
import { GATEWAY_HEADERS } from "../../common/constants/gateway.constant";
import { envConfig } from "../../config/env.config";
import { fetchInternalService } from "../../common/helpers/http-client.helper";

export interface AiModelDeployEventPayload {
  eventName: string;
  modelId: string;
  modelCode: string;
  modelName: string;
  modelType: string;
  versionId: string;
  version: string;
  modelPath: string | null;
  framework: string;
  inputSize: string;
  deployedAt: string;
  actorId?: string;
  requestId?: string;
}

export interface AiModelDeployNotifier {
  notifyModelDeployed(
    payload: AiModelDeployEventPayload,
  ): Promise<AiModelDeploySyncResultDto>;
}

export interface DefaultAiModelDeployNotifierOptions {
  serviceUrl?: string;
  syncEnabled?: boolean;
  timeoutMs?: number;
  internalServiceToken?: string;
  gatewayInternalSecret?: string;
  httpClient?: typeof fetchInternalService;
  redisPublisher?: (channel: string, message: string) => Promise<boolean>;
  skipInTestEnv?: boolean;
}

function isRunningInTestEnvironment(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.argv.some((arg) => arg.includes("test"))
  );
}

/**
 * Đồng bộ sự kiện deploy model sang AI Service (HTTP M2M /api/live/sync và Redis Pub/Sub).
 * Luôn fallback an toàn (không throw) để không làm gián đoạn quá trình cập nhật CSDL.
 */
export class DefaultAiModelDeployNotifier implements AiModelDeployNotifier {
  private readonly serviceUrl: string;
  private readonly syncEnabled: boolean;
  private readonly timeoutMs: number;
  private readonly internalServiceToken: string;
  private readonly gatewayInternalSecret: string;
  private readonly httpClient: typeof fetchInternalService;
  private readonly redisPublisher?: (
    channel: string,
    message: string,
  ) => Promise<boolean>;
  private readonly skipInTestEnv: boolean;

  constructor(options: DefaultAiModelDeployNotifierOptions = {}) {
    this.serviceUrl = (
      options.serviceUrl ?? envConfig.aiService.serviceUrl
    ).replace(/\/+$/, "");
    this.syncEnabled = options.syncEnabled ?? envConfig.aiService.syncEnabled;
    this.timeoutMs = options.timeoutMs ?? envConfig.aiService.syncTimeoutMs;
    this.internalServiceToken =
      options.internalServiceToken ?? envConfig.internalService.token;
    this.gatewayInternalSecret =
      options.gatewayInternalSecret ?? envConfig.gateway.internalSecret;
    this.httpClient = options.httpClient ?? fetchInternalService;
    this.redisPublisher = options.redisPublisher;

    const hasCustomTransport = Boolean(
      options.httpClient || options.serviceUrl || options.redisPublisher,
    );
    this.skipInTestEnv =
      options.skipInTestEnv ??
      (!hasCustomTransport && isRunningInTestEnvironment());
  }

  private async publishRedisDeployEvent(
    channel: string,
    message: string,
  ): Promise<boolean> {
    if (this.redisPublisher) {
      try {
        return await this.redisPublisher(channel, message);
      } catch {
        return false;
      }
    }

    if (!envConfig.redis.enabled || this.skipInTestEnv) {
      return false;
    }

    const client = new IORedis({
      host: envConfig.redis.host,
      port: envConfig.redis.port,
      password: envConfig.redis.password,
      lazyConnect: true,
      connectTimeout: Math.min(this.timeoutMs, 1500),
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });
    client.on("error", () => {});

    try {
      await client.connect();
      await client.publish(channel, message);
      return true;
    } catch {
      return false;
    } finally {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    }
  }

  async notifyModelDeployed(
    payload: AiModelDeployEventPayload,
  ): Promise<AiModelDeploySyncResultDto> {
    const syncedAt = new Date().toISOString();

    if (!this.syncEnabled || this.skipInTestEnv) {
      return {
        status: AI_MODEL_DEPLOY_SYNC_STATUS.SKIPPED,
        channel: AI_MODEL_DEPLOY_SYNC_CHANNEL.NONE,
        synced: false,
        eventName: payload.eventName,
        syncedAt,
        message: !this.syncEnabled
          ? "AI runtime sync is disabled via AI_SERVICE_SYNC_ENABLED=false"
          : "AI runtime sync skipped in test environment without custom transport",
      };
    }

    const targetUrl = `${this.serviceUrl}/api/live/sync`;
    const headers: Record<string, string> = {};
    if (this.internalServiceToken) {
      headers[GATEWAY_HEADERS.INTERNAL_SERVICE_TOKEN] =
        this.internalServiceToken;
      headers["Authorization"] = `Bearer ${this.internalServiceToken}`;
    }
    if (this.gatewayInternalSecret) {
      headers[GATEWAY_HEADERS.INTERNAL_SECRET] = this.gatewayInternalSecret;
    }
    if (payload.requestId) {
      headers[GATEWAY_HEADERS.REQUEST_ID] = payload.requestId;
    }

    const eventBody = {
      trigger: payload.eventName,
      modelId: payload.modelId,
      modelCode: payload.modelCode,
      modelName: payload.modelName,
      modelType: payload.modelType,
      versionId: payload.versionId,
      version: payload.version,
      modelPath: payload.modelPath,
      framework: payload.framework,
      inputSize: payload.inputSize,
      deployedAt: payload.deployedAt,
      actorId: payload.actorId,
    };

    const [httpRes, redisPublished] = await Promise.all([
      this.httpClient(targetUrl, {
        method: "POST",
        headers,
        body: eventBody,
        timeoutMs: this.timeoutMs,
      }).catch((err: any) => ({
        ok: false,
        status: 500,
        error: err?.message || "HTTP sync failed",
      })),
      this.publishRedisDeployEvent(
        payload.eventName,
        JSON.stringify(eventBody),
      ),
    ]);

    const httpOk = Boolean(httpRes.ok);
    const httpStatus = typeof httpRes.status === "number" ? httpRes.status : null;

    if (httpOk && redisPublished) {
      return {
        status: AI_MODEL_DEPLOY_SYNC_STATUS.SYNCED,
        channel: AI_MODEL_DEPLOY_SYNC_CHANNEL.HTTP_AND_REDIS,
        synced: true,
        eventName: payload.eventName,
        targetUrl,
        httpStatus,
        redisPublished: true,
        syncedAt,
        message:
          "Synchronized deployed AI model to AI Service HTTP runtime and Redis channel",
      };
    }

    if (httpOk) {
      return {
        status: AI_MODEL_DEPLOY_SYNC_STATUS.SYNCED,
        channel: AI_MODEL_DEPLOY_SYNC_CHANNEL.HTTP,
        synced: true,
        eventName: payload.eventName,
        targetUrl,
        httpStatus,
        redisPublished,
        syncedAt,
        message: "Synchronized deployed AI model to AI Service HTTP runtime",
      };
    }

    if (redisPublished) {
      return {
        status: AI_MODEL_DEPLOY_SYNC_STATUS.EVENT_PUBLISHED,
        channel: AI_MODEL_DEPLOY_SYNC_CHANNEL.REDIS,
        synced: true,
        eventName: payload.eventName,
        targetUrl,
        httpStatus,
        redisPublished: true,
        syncedAt,
        message: `Published model deploy event via Redis fallback (${httpRes.error || `HTTP ${httpStatus}`})`,
      };
    }

    return {
      status: AI_MODEL_DEPLOY_SYNC_STATUS.FAILED,
      channel: AI_MODEL_DEPLOY_SYNC_CHANNEL.NONE,
      synced: false,
      eventName: payload.eventName,
      targetUrl,
      httpStatus,
      redisPublished: false,
      syncedAt,
      message: `AI runtime unreachable (${httpRes.error || `HTTP ${httpStatus}`}); version remains DEPLOYED in database`,
    };
  }
}

export interface AuditLogger {
  createAuditLog(data: {
    actorId?: string;
    action: string;
    targetType: string;
    targetId: string;
    details?: any;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<any>;
}

/**
 * SEC-32: Default structured audit logger for administrative governance events.
 * Logs structured JSON events to console/stdout when a specialized central logger (Kafka/HTTP) is not injected.
 */
export class DefaultReportingAuditLogger implements AuditLogger {
  async createAuditLog(data: {
    actorId?: string;
    action: string;
    targetType: string;
    targetId: string;
    details?: any;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<any> {
    const logEntry = {
      level: "audit",
      timestamp: new Date().toISOString(),
      action: data.action,
      targetType: data.targetType,
      targetId: data.targetId,
      actorId: data.actorId || "SYSTEM",
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      details: data.details,
    };
    console.info(`[AUDIT] ${JSON.stringify(logEntry)}`);
    return logEntry;
  }
}

export class ReportingService {
  private readonly repository: ReportingRepository;
  private readonly auditLogger?: AuditLogger;
  private readonly aiModelDeployNotifier: AiModelDeployNotifier;

  constructor(
    repository?: ReportingRepository,
    auditLogger?: AuditLogger,
    aiModelDeployNotifier?: AiModelDeployNotifier,
  ) {
    this.repository = repository || new ReportingRepository();
    this.auditLogger = auditLogger || new DefaultReportingAuditLogger();
    this.aiModelDeployNotifier =
      aiModelDeployNotifier || new DefaultAiModelDeployNotifier();
  }

  private async logAudit(data: {
    actorId?: string;
    action: string;
    targetType: string;
    targetId: string;
    details?: any;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const actorId = data.actorId || "SYSTEM";
    if (!this.auditLogger) {
      console.warn(
        `[AUDIT-FALLBACK] Action: ${data.action}, Target: ${data.targetType}:${data.targetId}, Actor: ${actorId}`,
      );
      return;
    }
    try {
      await this.auditLogger.createAuditLog({
        actorId,
        action: data.action,
        targetType: data.targetType,
        targetId: data.targetId,
        details: data.details,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      });
    } catch (err: any) {
      console.warn(
        `[ReportingService] Failed to record audit log: ${err?.message}`,
      );
      console.warn(
        `[AUDIT-FALLBACK] Action: ${data.action}, Target: ${data.targetType}:${data.targetId}, Actor: ${actorId}`,
      );
    }
  }

  private resolveTenantSiteFilter<T extends { siteId?: string }>(
    filter: T,
    user?: { role?: string; siteIds?: string[]; siteId?: string },
  ): T {
    if (!user || user.role === ROLES.ADMIN) {
      return filter;
    }

    const permittedSites = user.siteIds || (user.siteId ? [user.siteId] : []);
    if (permittedSites.length === 0) {
      return filter;
    }

    if (filter.siteId && !permittedSites.includes(filter.siteId)) {
      throw new AppError(
        "Bạn không có quyền truy cập dữ liệu thống kê của cơ sở này",
        403,
        ERROR_CODE.FORBIDDEN,
      );
    }

    if (!filter.siteId && permittedSites.length > 0) {
      return {
        ...filter,
        siteId: permittedSites[0],
      };
    }

    return filter;
  }

  // ── 1. Dashboard Statistics & Overview KPIs ─────────────────────────────────

  async getDashboardKpi(
    filter: DashboardKpiFilterDto,
    user?: { role?: string; siteIds?: string[]; siteId?: string },
    callOptions?: ReportingCallOptions,
  ): Promise<DashboardKpiDto> {
    const scopedFilter = this.resolveTenantSiteFilter(filter, user);

    // 1. Lấy Incident Summary (tích hợp Real-time Fallback từ ppe_incident_db khi cronjob chưa chạy)
    const summaryPromise = this.repository.getIncidentSummary(scopedFilter, callOptions);

    // 2. Lấy Camera Status Counts từ Camera Service via HTTP
    const cameraStatusPromise = this.fetchCameraStatusCounts(scopedFilter.siteId, callOptions);

    // 3. Lấy Active AI Model từ CSDL nội bộ
    const activeModelPromise = this.repository.findActiveModelDetails();

    const [summary, cameraStatus, activeModel] = await Promise.all([
      summaryPromise,
      cameraStatusPromise,
      activeModelPromise,
    ]);

    return {
      totalIncidents: summary.totalIncidents,
      pendingReview: summary.openIncidents,
      complianceRate: summary.complianceRate,
      cameraStatus,
      activeModel,
    };
  }

  private async fetchCameraStatusCounts(
    siteId?: string,
    callOptions?: { authHeader?: string; requestId?: string },
  ): Promise<CameraStatusSummaryDto> {
    try {
      const url = new URL(`${envConfig.camera.serviceUrl}/api/v1/cameras/status-counts`);
      if (siteId) {
        url.searchParams.set("siteId", siteId);
      }

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

      const res = await fetchInternalService<CameraStatusSummaryDto>(url.toString(), {
        headers,
        timeoutMs: 3000,
      });

      if (res.ok && res.data) {
        return {
          total: Number(res.data.total ?? 0),
          online: Number(res.data.online ?? 0),
          offline: Number(res.data.offline ?? 0),
        };
      }
    } catch {
      // Fallback an toàn khi camera service chưa sẵn sàng hoặc lỗi mạng
    }

    return {
      total: 0,
      online: 0,
      offline: 0,
    };
  }

  async getDashboardSummary(
    filter: DashboardFilterDto,
    user?: { role?: string; siteIds?: string[]; siteId?: string },
    callOptions?: ReportingCallOptions,
  ): Promise<StatisticsSummaryDto> {
    const scopedFilter = this.resolveTenantSiteFilter(filter, user);
    return this.repository.getIncidentSummary(scopedFilter, callOptions);
  }

  async getHourlyRisk(
    filter: HourlyRiskFilterDto,
    user?: { role?: string; siteIds?: string[]; siteId?: string },
    callOptions?: ReportingCallOptions,
  ): Promise<HourlyRiskResponseDto> {
    const scopedFilter = this.resolveTenantSiteFilter(filter, user);
    return this.repository.getHourlyRisk(scopedFilter, callOptions);
  }

  async getViolationTrends(
    filter: TrendsFilterDto,
    user?: { role?: string; siteIds?: string[]; siteId?: string },
    callOptions?: ReportingCallOptions,
  ): Promise<TrendItemDto[]> {
    const scopedFilter = this.resolveTenantSiteFilter(filter, user);
    return this.repository.getIncidentTrends(scopedFilter, callOptions);
  }

  async getViolationDistribution(
    filter: DashboardFilterDto,
    user?: { role?: string; siteIds?: string[]; siteId?: string },
    callOptions?: ReportingCallOptions,
  ): Promise<ViolationTypeStatDto[]> {
    const scopedFilter = this.resolveTenantSiteFilter(filter, user);
    return this.repository.getViolationBreakdown(scopedFilter, callOptions);
  }

  async getCameraRankings(
    filter: CameraStatsFilterDto,
    user?: { role?: string; siteIds?: string[]; siteId?: string },
    callOptions?: ReportingCallOptions,
  ): Promise<CameraStatDto[]> {
    const scopedFilter = this.resolveTenantSiteFilter(filter, user);
    return this.repository.getCameraRankings(scopedFilter, callOptions);
  }

  // ── 2. AI Performance Statistics & Telemetry ───────────────────────────────

  async getAiPerformanceMetrics(
    filter: AiPerformanceFilterDto,
  ): Promise<AiPerformanceStatDto[]> {
    return this.repository.getAiPerformanceStats(filter);
  }

  async recordAiPerformance(
    dto: RecordAiPerformanceDto,
  ): Promise<AiPerformanceStatDto> {
    if (dto.modelVersionId) {
      const version = await this.repository.findAiModelVersionById(
        dto.modelVersionId,
      );
      if (!version) {
        throw new AppError(
          "AI Model Version not found",
          404,
          ERROR_CODE.AI_MODEL_VERSION_NOT_FOUND,
        );
      }
    }
    return this.repository.recordAiPerformanceMetric(dto);
  }

  // ── 3. Daily Rollup Aggregation ────────────────────────────────────────────

  async aggregateDailyStats(
    dto: AggregateDailyDto,
    context?: {
      actorId?: string;
      actorRole?: string;
      actorSiteIds?: string[];
      ipAddress?: string;
      userAgent?: string;
    },
  ) {
    if (context?.actorRole && context.actorRole !== ROLES.ADMIN) {
      const permittedSites = context.actorSiteIds || [];
      if (permittedSites.length > 0 && !permittedSites.includes(dto.siteId)) {
        throw new AppError(
          "Bạn không có quyền thực hiện tổng hợp dữ liệu cho cơ sở này",
          403,
          ERROR_CODE.FORBIDDEN,
        );
      }
    }

    const statDate = new Date(dto.statDate);

    // SEC-07: Đảm bảo không ghi đè dữ liệu bằng số 0 nếu bản ghi đã tồn tại và có số liệu
    const existing = await this.repository.findIncidentStatistic(
      dto.siteId,
      statDate,
    );
    if (existing && existing.totalIncidents > 0) {
      throw new AppError(
        "Dữ liệu thống kê cho ngày này đã được chốt và không thể ghi đè",
        409,
        ERROR_CODE.DUPLICATE_ENTRY,
      );
    }

    // Rollup mẫu tổng hợp
    const incidentStat = await this.repository.upsertIncidentStatistic({
      siteId: dto.siteId,
      statDate,
      totalIncidents: 0,
      openIncidents: 0,
      resolvedIncidents: 0,
      falseAlarms: 0,
      trueViolations: 0,
    });

    // SEC-36: Khởi tạo/tổng hợp bản ghi trong report_statistics cho site và ngày chỉ định
    // Đảm bảo pipeline thống kê được kích hoạt để tránh bảng report_statistics bị rỗng hoàn toàn
    if (typeof (this.repository as any).upsertReportStatistic === "function") {
      await this.repository.upsertReportStatistic({
        siteId: dto.siteId,
        cameraId: null,
        violationType: "TOTAL_AGGREGATED",
        severity: "NORMAL",
        statDate,
        totalCount: 0,
        confirmedCount: 0,
        resolvedCount: 0,
      });
    }

    await this.logAudit({
      actorId: context?.actorId,
      action: AUDIT_ACTION.AGGREGATE_DAILY_STATISTICS,
      targetType: AUDIT_TARGET_TYPE.PPE_REPORT,
      targetId: incidentStat.id,
      details: { siteId: dto.siteId, statDate: dto.statDate },
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return incidentStat;
  }

  // ── 3.1 Violation Event Ingestion Pipeline (SEC-36) ─────────────────────────

  async ingestViolationStatistic(data: {
    siteId: string;
    cameraId?: string | null;
    violationType: string;
    severity?: string;
    statDate?: string | Date;
    totalCount?: number;
    confirmedCount?: number;
    resolvedCount?: number;
  }): Promise<void> {
    const rawDate = data.statDate ? new Date(data.statDate) : new Date();
    const statDate = new Date(
      Date.UTC(rawDate.getUTCFullYear(), rawDate.getUTCMonth(), rawDate.getUTCDate()),
    );
    await this.repository.upsertReportStatistic({
      siteId: data.siteId,
      cameraId: data.cameraId ?? null,
      violationType: data.violationType,
      severity: data.severity || "MEDIUM",
      statDate,
      totalCount: data.totalCount ?? 1,
      confirmedCount: data.confirmedCount ?? 0,
      resolvedCount: data.resolvedCount ?? 0,
      increment: true,
    });
  }

  async handleViolationDetectedEvent(event: any): Promise<void> {
    const payload = event?.payload || event;
    const siteId = payload.site?.id || payload.siteId;
    const cameraId = payload.camera?.id || payload.cameraId;
    const rawDate = payload.timestamp ? new Date(payload.timestamp) : new Date();
    const statDate = new Date(
      Date.UTC(rawDate.getUTCFullYear(), rawDate.getUTCMonth(), rawDate.getUTCDate()),
    );
    const violations = payload.violations || [
      {
        violationType: payload.violationType || "NO_HARD_HAT",
        severity: payload.severity || payload.summary?.highestSeverity || "HIGH",
      },
    ];

    for (const v of violations) {
      await this.repository.upsertReportStatistic({
        siteId,
        cameraId: cameraId ?? null,
        violationType: v.violationType,
        severity: v.severity || payload.summary?.highestSeverity || "MEDIUM",
        statDate,
        totalCount: 1,
        confirmedCount: 0,
        resolvedCount: 0,
        increment: true,
      });
    }
  }

  // ── 4. Report Templates ────────────────────────────────────────────────────

  async listReportTemplates(): Promise<ReportTemplateDto[]> {
    return this.repository.findReportTemplates();
  }

  async getReportTemplateById(id: string): Promise<ReportTemplateDto> {
    const template = await this.repository.findReportTemplateById(id);
    if (!template) {
      throw new AppError(
        "Report template not found",
        404,
        ERROR_CODE.REPORT_TEMPLATE_NOT_FOUND,
      );
    }
    return template;
  }

  async createReportTemplate(
    dto: CreateReportTemplateDto,
    context?: { actorId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<ReportTemplateDto> {
    const existing = await this.repository.findReportTemplateByCode(dto.code);
    if (existing) {
      throw new AppError(
        `Report template code '${dto.code}' already exists`,
        409,
        ERROR_CODE.DUPLICATE_ENTRY,
      );
    }

    const created = await this.repository.createReportTemplate(
      dto,
      context?.actorId,
    );

    await this.logAudit({
      actorId: context?.actorId,
      action: AUDIT_ACTION.CREATE_REPORT_TEMPLATE,
      targetType: AUDIT_TARGET_TYPE.PPE_REPORT,
      targetId: created.id,
      details: { code: created.code, name: created.name },
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return created;
  }

  async deleteReportTemplate(
    id: string,
    context?: { actorId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const template = await this.repository.findReportTemplateById(id);
    if (!template) {
      throw new AppError(
        "Report template not found",
        404,
        ERROR_CODE.REPORT_TEMPLATE_NOT_FOUND,
      );
    }

    // SEC-08: Xóa template sẽ thất bại nếu template đã có bản ghi xuất báo cáo (onDelete: Restrict)
    await this.repository.deleteReportTemplate(id);

    await this.logAudit({
      actorId: context?.actorId,
      action: AUDIT_ACTION.DELETE_REPORT_TEMPLATE,
      targetType: AUDIT_TARGET_TYPE.PPE_REPORT,
      targetId: id,
      details: { code: template.code, name: template.name },
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });
  }

  // ── 5. Report Generation & Export ──────────────────────────────────────────

  async generateReport(
    dto: GenerateReportDto,
    context?: { actorId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<ReportGenerationDto> {
    const template = await this.repository.findReportTemplateById(
      dto.templateId,
    );
    if (!template) {
      throw new AppError(
        "Report template not found",
        404,
        ERROR_CODE.REPORT_TEMPLATE_NOT_FOUND,
      );
    }

    // SEC-23: Chặn xuất báo cáo từ mẫu báo cáo đã bị vô hiệu hóa
    if (template.status !== REPORT_TEMPLATE_STATUS.ACTIVE) {
      throw new AppError(
        "Mẫu báo cáo này đã bị vô hiệu hóa và không thể sử dụng để xuất báo cáo",
        400,
        ERROR_CODE.VALIDATION_ERROR,
      );
    }

    const actorId = context?.actorId || "00000000-0000-0000-0000-000000000000";
    const generated = await this.repository.createReportGeneration(
      dto,
      actorId,
      template.fileType,
    );

    await this.logAudit({
      actorId: context?.actorId,
      action: AUDIT_ACTION.GENERATE_PPE_REPORT,
      targetType: AUDIT_TARGET_TYPE.PPE_REPORT,
      targetId: generated.id,
      details: {
        reportType: dto.reportType,
        siteId: dto.siteId,
        period: `${dto.periodStart} to ${dto.periodEnd}`,
      },
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return generated;
  }

  private getPermittedSites(user?: {
    siteIds?: string[];
    siteId?: string;
  }): string[] {
    if (!user) return [];
    const combined = [
      ...(Array.isArray(user.siteIds) ? user.siteIds : []),
      ...(user.siteId ? [user.siteId] : []),
    ].filter((id): id is string => typeof id === "string" && id.trim().length > 0);
    return Array.from(new Set(combined));
  }

  private assertCanAccessReportGeneration(
    report: ReportGenerationDto,
    userId?: string,
    userRole?: string,
    userSiteIds?: string[],
  ): void {
    if (userRole === ROLES.ADMIN) {
      return;
    }

    const permittedSites = Array.isArray(userSiteIds)
      ? Array.from(
          new Set(
            userSiteIds.filter(
              (id): id is string => typeof id === "string" && id.trim().length > 0,
            ),
          ),
        )
      : [];

    if (permittedSites.length > 0) {
      if (!permittedSites.includes(report.siteId)) {
        throw new AppError(
          "Bạn không có quyền tải xuống báo cáo này",
          403,
          ERROR_CODE.FORBIDDEN,
        );
      }
      return;
    }

    if (userRole !== ROLES.ADMIN && (!userId || report.generatedBy !== userId)) {
      throw new AppError(
        "Bạn không có quyền tải xuống báo cáo này",
        403,
        ERROR_CODE.FORBIDDEN,
      );
    }
  }

  async listReportGenerations(
    query: ReportHistoryQueryDto,
    user?: { role?: string; siteIds?: string[]; siteId?: string },
  ): Promise<PaginatedResultDto<ReportGenerationDto>> {
    const scopedQuery: ReportHistoryQueryDto = { ...query };
    delete scopedQuery.siteIds;

    if (user && user.role !== ROLES.ADMIN) {
      const permittedSites = this.getPermittedSites(user);
      if (permittedSites.length > 0) {
        if (scopedQuery.siteId && !permittedSites.includes(scopedQuery.siteId)) {
          throw new AppError(
            "Bạn không có quyền xem lịch sử báo cáo của cơ sở này",
            403,
            ERROR_CODE.FORBIDDEN,
          );
        }
        if (!scopedQuery.siteId) {
          scopedQuery.siteIds = permittedSites;
        }
      }
    }
    return this.repository.findReportGenerations(scopedQuery);
  }

  async getReportGenerationDownload(
    id: string,
    userId?: string,
    userRole?: string,
    userSiteIds?: string[],
  ) {
    const report = await this.repository.findReportGenerationById(id);
    if (!report) {
      throw new AppError(
        "Report generation not found",
        404,
        ERROR_CODE.REPORT_GENERATION_NOT_FOUND,
      );
    }

    // Site Tenancy BOLA Guard: Cho phép Admin hoặc nhân sự thuộc siteId của báo cáo (fallback tác giả nếu chưa gắn scope)
    this.assertCanAccessReportGeneration(report, userId, userRole, userSiteIds);

    const { contentType, extension } = this.resolveMimeTypeAndExt(
      report.template?.fileType,
      report.fileName,
    );

    return {
      report,
      downloadUrl: `/api/v1/reports/${report.id}/content`,
      contentType,
      fileName: report.fileName || `report_${report.id}.${extension}`,
    };
  }

  async getReportGenerationContent(
    id: string,
    userId?: string,
    userRole?: string,
    callOptions?: ReportingCallOptions,
    userSiteIds?: string[],
  ): Promise<{ content: Buffer; contentType: string; fileName: string }> {
    const report = await this.repository.findReportGenerationById(id);
    if (!report) {
      throw new AppError(
        "Report generation not found",
        404,
        ERROR_CODE.REPORT_GENERATION_NOT_FOUND,
      );
    }

    // Site Tenancy BOLA Guard: Cho phép Admin hoặc nhân sự thuộc siteId của báo cáo (fallback tác giả nếu chưa gắn scope)
    this.assertCanAccessReportGeneration(report, userId, userRole, userSiteIds);

    const { contentType, extension } = this.resolveMimeTypeAndExt(
      report.template?.fileType,
      report.fileName,
    );

    let aggregated: AggregatedReportDataDto | null = null;
    if (typeof this.repository.getAggregatedReportData === "function") {
      try {
        aggregated = await this.repository.getAggregatedReportData(
          report,
          callOptions,
        );
      } catch (err: any) {
        console.warn(
          `[Reporting Service] Could not fetch aggregated report data: ${err?.message}`,
        );
        aggregated = null;
      }
    }

    const data: AggregatedReportDataDto = aggregated || {
      reportId: report.id,
      reportType: report.reportType,
      templateCode: report.template?.code,
      templateName: report.template?.name,
      siteId: report.siteId,
      periodStart: String(report.periodStart).slice(0, 10),
      periodEnd: String(report.periodEnd).slice(0, 10),
      generatedBy: report.generatedBy,
      generatedAt: String(report.generatedAt),
      summary: {
        totalIncidents: 0,
        openIncidents: 0,
        resolvedIncidents: 0,
        trueViolations: 0,
        falseAlarms: 0,
        falseAlarmRate: 0,
        complianceRate: 100,
        meanTimeToResolveHours: 0,
        severityBreakdown: {
          CRITICAL: { count: 0, resolved: 0, targetSlaMinutes: 15, actualMttrMinutes: 0 },
          HIGH: { count: 0, resolved: 0, targetSlaMinutes: 30, actualMttrMinutes: 0 },
          MEDIUM: { count: 0, resolved: 0, targetSlaMinutes: 60, actualMttrMinutes: 0 },
          LOW: { count: 0, resolved: 0, targetSlaMinutes: 120, actualMttrMinutes: 0 },
        },
      },
      violationsBreakdown: [],
      cameraRankings: [],
      trends: [],
    };

    let reportContent: string | Buffer;
    if (extension === "xlsx") {
      reportContent = await ExcelReportEngine.generate(data);
    } else if (extension === "pdf") {
      reportContent = await PdfReportEngine.generate(data);
    } else if (extension === "json") {
      reportContent = JSON.stringify(
        {
          reportId: report.id,
          reportType: report.reportType,
          siteId: report.siteId,
          periodStart: report.periodStart,
          periodEnd: report.periodEnd,
          generatedBy: report.generatedBy,
          generatedAt: report.generatedAt,
          summary: data.summary,
          violationsBreakdown: data.violationsBreakdown,
        },
        null,
        2,
      );
    } else if (extension === "csv") {
      reportContent = CsvReportEngine.generate(data);
    } else {
      reportContent = await PdfReportEngine.generate(data);
    }

    return {
      content: Buffer.isBuffer(reportContent)
        ? reportContent
        : Buffer.from(reportContent, "utf-8"),
      contentType,
      fileName: report.fileName || `report_${report.id}.${extension}`,
    };
  }

  private resolveMimeTypeAndExt(
    fileType?: string | null,
    fileName?: string | null,
  ): { contentType: string; extension: string } {
    const normalized = (fileType || "").toUpperCase();
    if (normalized === "EXCEL" || fileName?.endsWith(".xlsx")) {
      return {
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        extension: "xlsx",
      };
    }
    if (normalized === "CSV" || fileName?.endsWith(".csv")) {
      return {
        contentType: "text/csv",
        extension: "csv",
      };
    }
    if (normalized === "JSON" || fileName?.endsWith(".json")) {
      return {
        contentType: "application/json",
        extension: "json",
      };
    }
    return {
      contentType: "application/pdf",
      extension: "pdf",
    };
  }

  // ── 6. AI Models & Governance ──────────────────────────────────────────────

  async listAiModels(): Promise<AiModelDto[]> {
    return this.repository.findAiModels();
  }

  async getAiModelById(id: string): Promise<AiModelDto> {
    const model = await this.repository.findAiModelById(id);
    if (!model) {
      throw new AppError(
        "AI Model not found",
        404,
        ERROR_CODE.AI_MODEL_NOT_FOUND,
      );
    }
    return model;
  }

  async createAiModel(
    dto: CreateAiModelDto,
    context?: { actorId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<AiModelDto> {
    const existing = await this.repository.findAiModelByCode(dto.code);
    if (existing) {
      throw new AppError(
        `AI Model code '${dto.code}' already exists`,
        409,
        ERROR_CODE.DUPLICATE_ENTRY,
      );
    }

    const created = await this.repository.createAiModel(dto);

    await this.logAudit({
      actorId: context?.actorId,
      action: AUDIT_ACTION.CREATE_AI_MODEL,
      targetType: AUDIT_TARGET_TYPE.PPE_AI_MODEL,
      targetId: created.id,
      details: { code: created.code, name: created.name },
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return created;
  }

  async createAiModelVersion(
    modelId: string,
    dto: CreateAiModelVersionDto,
    context?: { actorId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<AiModelVersionDto> {
    const model = await this.repository.findAiModelById(modelId);
    if (!model) {
      throw new AppError(
        "AI Model not found",
        404,
        ERROR_CODE.AI_MODEL_NOT_FOUND,
      );
    }

    const existingVersion =
      await this.repository.findAiModelVersionByModelAndVersion(
        modelId,
        dto.version,
      );
    if (existingVersion) {
      throw new AppError(
        `AI Model version '${dto.version}' already exists for this model`,
        409,
        ERROR_CODE.DUPLICATE_ENTRY,
      );
    }

    try {
      const version = await this.repository.createAiModelVersion(modelId, dto);

      await this.logAudit({
        actorId: context?.actorId,
        action: AUDIT_ACTION.CREATE_AI_MODEL_VERSION,
        targetType: AUDIT_TARGET_TYPE.PPE_AI_MODEL,
        targetId: version.id,
        details: { modelId, version: version.version },
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });

      return version;
    } catch (error: any) {
      if (
        error?.code === "P2002" ||
        error?.message?.includes("Unique constraint") ||
        error?.message?.includes("ai_model_versions_model_id_version_key")
      ) {
        throw new AppError(
          `AI Model version '${dto.version}' already exists for this model`,
          409,
          ERROR_CODE.DUPLICATE_ENTRY,
        );
      }
      throw error;
    }
  }

  async deployAiModelVersion(
    modelId: string,
    versionId: string,
    context?: {
      actorId?: string;
      ipAddress?: string;
      userAgent?: string;
      requestId?: string;
    },
  ): Promise<DeployedAiModelVersionDto> {
    const model = await this.repository.findAiModelById(modelId);
    if (!model) {
      throw new AppError(
        "AI Model not found",
        404,
        ERROR_CODE.AI_MODEL_NOT_FOUND,
      );
    }

    if (model.status !== AI_MODEL_STATUS.ACTIVE) {
      throw new AppError(
        "Không thể triển khai phiên bản của mô hình AI đã bị vô hiệu hóa hoặc ngừng sử dụng",
        400,
        ERROR_CODE.VALIDATION_ERROR,
      );
    }

    const version = await this.repository.findAiModelVersionById(versionId);
    if (!version || version.modelId !== modelId) {
      throw new AppError(
        "AI Model Version not found for this model",
        404,
        ERROR_CODE.AI_MODEL_VERSION_NOT_FOUND,
      );
    }

    const deployed = await this.repository.deployAiModelVersion(
      modelId,
      versionId,
    );

    let aiRuntimeSync: AiModelDeploySyncResultDto;
    try {
      aiRuntimeSync = await this.aiModelDeployNotifier.notifyModelDeployed({
        eventName: EVENT_NAMES.PPE_AI_MODEL_DEPLOYED,
        modelId: model.id,
        modelCode: model.code,
        modelName: model.name,
        modelType: model.modelType,
        versionId: deployed.id,
        version: deployed.version,
        modelPath: deployed.modelPath ?? null,
        framework: deployed.framework,
        inputSize: deployed.inputSize,
        deployedAt: deployed.deployedAt ?? new Date().toISOString(),
        actorId: context?.actorId,
        requestId: context?.requestId,
      });
    } catch (syncError: any) {
      aiRuntimeSync = {
        status: AI_MODEL_DEPLOY_SYNC_STATUS.FAILED,
        channel: AI_MODEL_DEPLOY_SYNC_CHANNEL.NONE,
        synced: false,
        eventName: EVENT_NAMES.PPE_AI_MODEL_DEPLOYED,
        syncedAt: new Date().toISOString(),
        message:
          syncError?.message ||
          "Unexpected AI runtime sync error; version remains DEPLOYED in database",
      };
    }

    await this.logAudit({
      actorId: context?.actorId,
      action: AUDIT_ACTION.DEPLOY_AI_MODEL_VERSION,
      targetType: AUDIT_TARGET_TYPE.PPE_AI_MODEL,
      targetId: deployed.id,
      details: {
        modelId,
        version: deployed.version,
        modelPath: deployed.modelPath ?? null,
        aiRuntimeSync,
      },
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });

    return {
      ...deployed,
      aiRuntimeSync,
    };
  }

  async getAiModelVersionById(versionId: string): Promise<AiModelVersionDto> {
    const v = await this.repository.findAiModelVersionById(versionId);
    if (!v) {
      throw new AppError("Không tìm thấy phiên bản mô hình AI", 404, ERROR_CODE.NOT_FOUND);
    }
    return v;
  }

  async getActiveModelVersion(filter?: {
    modelId?: string;
    modelType?: string;
  }): Promise<AiModelVersionDto> {
    const v = await this.repository.findActiveDeployedModelVersion(filter);
    if (!v) {
      throw new AppError("Chưa có phiên bản mô hình AI nào được triển khai", 404, ERROR_CODE.NOT_FOUND);
    }
    return v;
  }
}
