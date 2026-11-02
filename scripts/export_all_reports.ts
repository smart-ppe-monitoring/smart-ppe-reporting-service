import fs from "node:fs";
import path from "node:path";
import { ExcelReportEngine } from "../src/modules/reporting/engines/excel.engine";
import { PdfReportEngine } from "../src/modules/reporting/engines/pdf.engine";
import { AggregatedReportDataDto } from "../src/modules/reporting/reporting.dto";

const OUTPUT_DIR = path.resolve(__dirname, "../../exports");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ────────────────────────────────────────────────────────────────────────────
// 1. DỮ LIỆU FILE MẪU CHUẨN (MẪU KHUNG - ZERO VIOLATIONS / BLANK TEMPLATES)
// ────────────────────────────────────────────────────────────────────────────

const blankDailyTemplate: AggregatedReportDataDto = {
  reportId: "019447e1-8894-7000-8000-000000000001",
  reportType: "DAILY",
  templateCode: "PPE_DAILY_SHIFT",
  templateName: "Báo cáo Ca Làm Việc Hàng Ngày (Mẫu Chuẩn)",
  siteId: "SITE-HN-CONSTRUCTION-01",
  periodStart: "2026-11-02",
  periodEnd: "2026-11-02",
  generatedBy: "HSE_INSPECTOR_ADMIN",
  generatedAt: new Date().toISOString(),
  summary: {
    totalIncidents: 0,
    openIncidents: 0,
    resolvedIncidents: 0,
    trueViolations: 0,
    falseAlarms: 0,
    falseAlarmRate: 0,
    complianceRate: 100,
    meanTimeToResolveHours: 0,
  },
  violationsBreakdown: [],
  cameraRankings: [],
  trends: [],
};

const blankWeeklyTemplate: AggregatedReportDataDto = {
  reportId: "019447e1-8894-7000-8000-000000000002",
  reportType: "WEEKLY",
  templateCode: "HSE_WEEKLY_AUDIT",
  templateName: "Báo cáo Tổng Kết An Toàn Tuần (Mẫu Chuẩn)",
  siteId: "SITE-HN-CONSTRUCTION-01",
  periodStart: "2026-10-26",
  periodEnd: "2026-11-01",
  generatedBy: "HSE_INSPECTOR_ADMIN",
  generatedAt: new Date().toISOString(),
  summary: {
    totalIncidents: 0,
    openIncidents: 0,
    resolvedIncidents: 0,
    trueViolations: 0,
    falseAlarms: 0,
    falseAlarmRate: 0,
    complianceRate: 100,
    meanTimeToResolveHours: 0,
  },
  violationsBreakdown: [],
  cameraRankings: [],
  trends: [],
};

const blankMonthlyExcelTemplate: AggregatedReportDataDto = {
  reportId: "019447e1-8894-7000-8000-000000000003",
  reportType: "MONTHLY",
  templateCode: "COMPLIANCE_MONTHLY",
  templateName: "Báo cáo Kiểm Toán Tuân Thủ Tháng (Mẫu Chuẩn)",
  siteId: "SITE-HN-CONSTRUCTION-01",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
  generatedBy: "HSE_INSPECTOR_ADMIN",
  generatedAt: new Date().toISOString(),
  summary: {
    totalIncidents: 0,
    openIncidents: 0,
    resolvedIncidents: 0,
    trueViolations: 0,
    falseAlarms: 0,
    falseAlarmRate: 0,
    complianceRate: 100,
    meanTimeToResolveHours: 0,
  },
  violationsBreakdown: [],
  cameraRankings: [],
  trends: [],
};

const blankAiSummaryTemplate: AggregatedReportDataDto = {
  reportId: "019447e1-8894-7000-8000-000000000004",
  reportType: "VIOLATION_SUMMARY",
  templateCode: "VIOLATION_SUMMARY_REPORT",
  templateName: "Báo cáo Tổng Hợp Vi Phạm & AI (Mẫu Chuẩn)",
  siteId: "SITE-HN-CONSTRUCTION-01",
  periodStart: "2026-10-01",
  periodEnd: "2026-11-01",
  generatedBy: "HSE_INSPECTOR_ADMIN",
  generatedAt: new Date().toISOString(),
  summary: {
    totalIncidents: 0,
    openIncidents: 0,
    resolvedIncidents: 0,
    trueViolations: 0,
    falseAlarms: 0,
    falseAlarmRate: 0,
    complianceRate: 100,
    meanTimeToResolveHours: 0,
  },
  violationsBreakdown: [],
  cameraRankings: [],
  trends: [],
};

// ────────────────────────────────────────────────────────────────────────────
// 2. DỮ LIỆU FILE THẬT (FULL PRODUCTION DATA VỚI SỐ LIỆU GIÁM SÁT THỰC TẾ)
// ────────────────────────────────────────────────────────────────────────────

// 2.1 Báo cáo ca ngày thực tế
const realDailyReport: AggregatedReportDataDto = {
  reportId: "019447e1-8894-7100-8000-000000000101",
  reportType: "DAILY",
  templateCode: "PPE_DAILY_SHIFT",
  templateName: "BÁO CÁO CA LÀM VIỆC HÀNG NGÀY - CA SÁNG",
  siteId: "CÔNG TRƯỜNG LANDMARK TOWER - ZONE B",
  periodStart: "2026-11-02",
  periodEnd: "2026-11-02",
  generatedBy: "Kỹ sư HSE Trưởng: Trần Văn Hùng (ID: 019447e1-9999-7000)",
  generatedAt: "2026-11-02T16:30:00.000Z",
  summary: {
    totalIncidents: 18,
    openIncidents: 2,
    resolvedIncidents: 16,
    trueViolations: 15,
    falseAlarms: 3,
    falseAlarmRate: 16.67,
    complianceRate: 91.67,
    meanTimeToResolveHours: 0.85,
    periodStart: "2026-11-02",
    periodEnd: "2026-11-02",
  },
  violationsBreakdown: [
    {
      violationType: "Không đội mũ bảo hộ (NO_HARD_HAT)",
      count: 9,
      percentage: 60.0,
      severityBreakdown: {
        LOW: 0,
        NORMAL: 1,
        MEDIUM: 3,
        HIGH: 4,
        CRITICAL: 1,
      },
    },
    {
      violationType: "Không mặc áo phản quang (NO_SAFETY_VEST)",
      count: 4,
      percentage: 26.67,
      severityBreakdown: {
        LOW: 1,
        NORMAL: 0,
        MEDIUM: 2,
        HIGH: 1,
        CRITICAL: 0,
      },
    },
    {
      violationType: "Xâm nhập vùng nguy hiểm (DANGEROUS_ZONE)",
      count: 2,
      percentage: 13.33,
      severityBreakdown: {
        LOW: 0,
        NORMAL: 0,
        MEDIUM: 0,
        HIGH: 1,
        CRITICAL: 1,
      },
    },
  ],
  cameraRankings: [
    {
      cameraId: "CAM-GATE-01 (Cổng chính công trường)",
      totalViolations: 8,
      confirmedCount: 7,
      falseAlarmCount: 1,
      resolvedCount: 7,
    },
    {
      cameraId: "CAM-SCAFFOLD-04 (Khu vực giàn giáo tầng 5)",
      totalViolations: 5,
      confirmedCount: 5,
      falseAlarmCount: 0,
      resolvedCount: 5,
    },
    {
      cameraId: "CAM-CRANE-02 (Khu vực vận hành cẩu tháp)",
      totalViolations: 3,
      confirmedCount: 2,
      falseAlarmCount: 1,
      resolvedCount: 2,
    },
    {
      cameraId: "CAM-BASEMENT-03 (Tầng hầm đỗ xe B2)",
      totalViolations: 2,
      confirmedCount: 1,
      falseAlarmCount: 1,
      resolvedCount: 2,
    },
  ],
  trends: [
    {
      date: "08:00 - 10:00",
      totalIncidents: 7,
      trueViolations: 6,
      falseAlarms: 1,
      resolvedCount: 6,
    },
    {
      date: "10:00 - 12:00",
      totalIncidents: 4,
      trueViolations: 3,
      falseAlarms: 1,
      resolvedCount: 4,
    },
    {
      date: "13:00 - 15:00",
      totalIncidents: 5,
      trueViolations: 4,
      falseAlarms: 1,
      resolvedCount: 4,
    },
    {
      date: "15:00 - 17:00",
      totalIncidents: 2,
      trueViolations: 2,
      falseAlarms: 0,
      resolvedCount: 2,
    },
  ],
  aiPerformance: [
    {
      id: "ai-telemetry-01",
      cameraId: "CAM-GATE-01",
      modelVersionId: "YOLOv11-PPE-V1.0.0",
      statDate: "2026-11-02",
      avgFps: 31.5,
      avgLatencyMs: 28.4,
      maxLatencyMs: 42,
      totalFrames: "345000",
    },
    {
      id: "ai-telemetry-02",
      cameraId: "CAM-SCAFFOLD-04",
      modelVersionId: "YOLOv11-PPE-V1.0.0",
      statDate: "2026-11-02",
      avgFps: 29.8,
      avgLatencyMs: 32.1,
      maxLatencyMs: 51,
      totalFrames: "320000",
    },
  ],
};

// 2.2 Báo cáo tuần thực tế
const realWeeklyReport: AggregatedReportDataDto = {
  reportId: "019447e1-8894-7100-8000-000000000102",
  reportType: "WEEKLY",
  templateCode: "HSE_WEEKLY_AUDIT",
  templateName: "BÁO CÁO TỔNG KẾT AN TOÀN LAO ĐỘNG TUẦN 44",
  siteId: "DỰ ÁN TỔ HỢP CÔNG NGHIỆP CÔNG NGHỆ CAO HOÀ LẠC",
  periodStart: "2026-10-26",
  periodEnd: "2026-11-01",
  generatedBy: "Trưởng ban An toàn: KS. Lê Hoàng Nam",
  generatedAt: "2026-11-02T08:00:00.000Z",
  summary: {
    totalIncidents: 94,
    openIncidents: 6,
    resolvedIncidents: 88,
    trueViolations: 82,
    falseAlarms: 12,
    falseAlarmRate: 12.77,
    complianceRate: 93.85,
    meanTimeToResolveHours: 1.15,
    periodStart: "2026-10-26",
    periodEnd: "2026-11-01",
  },
  violationsBreakdown: [
    {
      violationType: "Không đội mũ bảo hộ (NO_HARD_HAT)",
      count: 46,
      percentage: 56.1,
      severityBreakdown: {
        LOW: 2,
        NORMAL: 6,
        MEDIUM: 18,
        HIGH: 16,
        CRITICAL: 4,
      },
    },
    {
      violationType: "Không mặc áo phản quang (NO_SAFETY_VEST)",
      count: 24,
      percentage: 29.27,
      severityBreakdown: {
        LOW: 3,
        NORMAL: 5,
        MEDIUM: 10,
        HIGH: 6,
        CRITICAL: 0,
      },
    },
    {
      violationType: "Không đeo dây đai an toàn trên cao (NO_SAFETY_HARNESS)",
      count: 8,
      percentage: 9.76,
      severityBreakdown: {
        LOW: 0,
        NORMAL: 0,
        MEDIUM: 1,
        HIGH: 4,
        CRITICAL: 3,
      },
    },
    {
      violationType: "Xâm nhập vùng cấm nguy hiểm (DANGEROUS_ZONE)",
      count: 4,
      percentage: 4.88,
      severityBreakdown: {
        LOW: 0,
        NORMAL: 0,
        MEDIUM: 0,
        HIGH: 2,
        CRITICAL: 2,
      },
    },
  ],
  cameraRankings: [
    {
      cameraId: "CAM-01 (Khu vực Đổ bê tông móng)",
      totalViolations: 32,
      confirmedCount: 29,
      falseAlarmCount: 3,
      resolvedCount: 29,
    },
    {
      cameraId: "CAM-05 (Lối vào kho vật liệu nặng)",
      totalViolations: 25,
      confirmedCount: 22,
      falseAlarmCount: 3,
      resolvedCount: 22,
    },
    {
      cameraId: "CAM-03 (Khu vực lắp dựng kết cấu thép)",
      totalViolations: 18,
      confirmedCount: 16,
      falseAlarmCount: 2,
      resolvedCount: 16,
    },
    {
      cameraId: "CAM-07 (Cầu thang bộ thoát hiểm số 2)",
      totalViolations: 12,
      confirmedCount: 10,
      falseAlarmCount: 2,
      resolvedCount: 11,
    },
    {
      cameraId: "CAM-09 (Khu vực gia công cốt thép)",
      totalViolations: 7,
      confirmedCount: 5,
      falseAlarmCount: 2,
      resolvedCount: 6,
    },
  ],
  trends: [
    {
      date: "2026-10-26 (Thứ 2)",
      totalIncidents: 18,
      trueViolations: 16,
      falseAlarms: 2,
      resolvedCount: 16,
    },
    {
      date: "2026-10-27 (Thứ 3)",
      totalIncidents: 15,
      trueViolations: 13,
      falseAlarms: 2,
      resolvedCount: 14,
    },
    {
      date: "2026-10-28 (Thứ 4)",
      totalIncidents: 14,
      trueViolations: 12,
      falseAlarms: 2,
      resolvedCount: 13,
    },
    {
      date: "2026-10-29 (Thứ 5)",
      totalIncidents: 12,
      trueViolations: 11,
      falseAlarms: 1,
      resolvedCount: 12,
    },
    {
      date: "2026-10-30 (Thứ 6)",
      totalIncidents: 16,
      trueViolations: 14,
      falseAlarms: 2,
      resolvedCount: 15,
    },
    {
      date: "2026-10-31 (Thứ 7)",
      totalIncidents: 11,
      trueViolations: 9,
      falseAlarms: 2,
      resolvedCount: 11,
    },
    {
      date: "2026-11-01 (Chủ Nhật)",
      totalIncidents: 8,
      trueViolations: 7,
      falseAlarms: 1,
      resolvedCount: 7,
    },
  ],
  aiPerformance: [
    {
      id: "ai-week-01",
      cameraId: "CAM-01",
      modelVersionId: "YOLOv11-PPE-V1.0.0",
      statDate: "2026-10-28",
      avgFps: 32.2,
      avgLatencyMs: 27.8,
      maxLatencyMs: 44,
      totalFrames: "2450000",
    },
    {
      id: "ai-week-02",
      cameraId: "CAM-05",
      modelVersionId: "YOLOv11-PPE-V1.0.0",
      statDate: "2026-10-28",
      avgFps: 30.5,
      avgLatencyMs: 31.0,
      maxLatencyMs: 50,
      totalFrames: "2310000",
    },
  ],
};

// 2.3 Báo cáo tháng thực tế (Excel)
const realMonthlyExcelReport: AggregatedReportDataDto = {
  reportId: "019447e1-8894-7100-8000-000000000103",
  reportType: "MONTHLY",
  templateCode: "COMPLIANCE_MONTHLY",
  templateName: "HỒ SƠ KIỂM TOÁN TUÂN THỦ AN TOÀN LAO ĐỘNG THÁNG 10/2026",
  siteId: "TỔ HỢP KHU ĐÔ THỊ THÔNG MINH SMART CITY - GIAI ĐOẠN 2",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
  generatedBy: "Ban Kiểm soát An toàn Vinaconex - Đoàn Thanh tra Liên ngành",
  generatedAt: "2026-11-01T09:00:00.000Z",
  summary: {
    totalIncidents: 428,
    openIncidents: 12,
    resolvedIncidents: 416,
    trueViolations: 382,
    falseAlarms: 46,
    falseAlarmRate: 10.75,
    complianceRate: 95.24,
    meanTimeToResolveHours: 1.35,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
  },
  violationsBreakdown: [
    {
      violationType: "Không đội mũ bảo hộ lao động (NO_HARD_HAT)",
      count: 215,
      percentage: 56.28,
      severityBreakdown: {
        LOW: 15,
        NORMAL: 35,
        MEDIUM: 95,
        HIGH: 62,
        CRITICAL: 8,
      },
    },
    {
      violationType: "Không mặc áo phản quang tiêu chuẩn (NO_SAFETY_VEST)",
      count: 112,
      percentage: 29.32,
      severityBreakdown: {
        LOW: 22,
        NORMAL: 30,
        MEDIUM: 45,
        HIGH: 15,
        CRITICAL: 0,
      },
    },
    {
      violationType: "Không cài quai mũ an toàn (UNFASTENED_HELMET_STRAP)",
      count: 32,
      percentage: 8.38,
      severityBreakdown: {
        LOW: 10,
        NORMAL: 12,
        MEDIUM: 8,
        HIGH: 2,
        CRITICAL: 0,
      },
    },
    {
      violationType: "Không đeo dây đai an toàn chống rơi ngã (NO_HARNESS)",
      count: 14,
      percentage: 3.66,
      severityBreakdown: {
        LOW: 0,
        NORMAL: 0,
        MEDIUM: 2,
        HIGH: 6,
        CRITICAL: 6,
      },
    },
    {
      violationType: "Xâm nhập khu vực cấm cẩu tải trọng nặng (DANGER_ZONE)",
      count: 9,
      percentage: 2.36,
      severityBreakdown: {
        LOW: 0,
        NORMAL: 0,
        MEDIUM: 0,
        HIGH: 4,
        CRITICAL: 5,
      },
    },
  ],
  cameraRankings: [
    {
      cameraId: "CAM-01 (Cổng Kiểm soát Ra Vào Số 1)",
      totalViolations: 124,
      confirmedCount: 112,
      falseAlarmCount: 12,
      resolvedCount: 120,
    },
    {
      cameraId: "CAM-04 (Hố móng & Ép cọc móng Block A)",
      totalViolations: 98,
      confirmedCount: 90,
      falseAlarmCount: 8,
      resolvedCount: 94,
    },
    {
      cameraId: "CAM-08 (Khu vực Cẩu tháp tháp chính)",
      totalViolations: 76,
      confirmedCount: 68,
      falseAlarmCount: 8,
      resolvedCount: 72,
    },
    {
      cameraId: "CAM-12 (Sàn công tác thi công tầng 18)",
      totalViolations: 58,
      confirmedCount: 52,
      falseAlarmCount: 6,
      resolvedCount: 55,
    },
    {
      cameraId: "CAM-02 (Khu vực Tập kết Giàn giáo & Cốp pha)",
      totalViolations: 42,
      confirmedCount: 38,
      falseAlarmCount: 4,
      resolvedCount: 40,
    },
    {
      cameraId: "CAM-15 (Trạm biến áp tạm & Máy phát điện)",
      totalViolations: 30,
      confirmedCount: 22,
      falseAlarmCount: 8,
      resolvedCount: 25,
    },
  ],
  trends: [
    {
      date: "Tuần 40 (01/10 - 07/10)",
      totalIncidents: 128,
      trueViolations: 115,
      falseAlarms: 13,
      resolvedCount: 124,
    },
    {
      date: "Tuần 41 (08/10 - 14/10)",
      totalIncidents: 112,
      trueViolations: 99,
      falseAlarms: 13,
      resolvedCount: 108,
    },
    {
      date: "Tuần 42 (15/10 - 21/10)",
      totalIncidents: 98,
      trueViolations: 88,
      falseAlarms: 10,
      resolvedCount: 96,
    },
    {
      date: "Tuần 43 (22/10 - 28/10)",
      totalIncidents: 64,
      trueViolations: 58,
      falseAlarms: 6,
      resolvedCount: 62,
    },
    {
      date: "Tuần 44 (29/10 - 31/10)",
      totalIncidents: 26,
      trueViolations: 22,
      falseAlarms: 4,
      resolvedCount: 26,
    },
  ],
  aiPerformance: [
    {
      id: "ai-month-01",
      cameraId: "CAM-01",
      modelVersionId: "YOLOv11-PPE-V1.0.0",
      statDate: "2026-10-31",
      avgFps: 33.1,
      avgLatencyMs: 26.5,
      maxLatencyMs: 41,
      totalFrames: "10500000",
    },
    {
      id: "ai-month-02",
      cameraId: "CAM-04",
      modelVersionId: "YOLOv11-PPE-V1.0.0",
      statDate: "2026-10-31",
      avgFps: 31.8,
      avgLatencyMs: 29.2,
      maxLatencyMs: 46,
      totalFrames: "9800000",
    },
    {
      id: "ai-month-03",
      cameraId: "CAM-08",
      modelVersionId: "YOLOv11-PPE-V1.0.0",
      statDate: "2026-10-31",
      avgFps: 30.2,
      avgLatencyMs: 31.5,
      maxLatencyMs: 53,
      totalFrames: "9200000",
    },
  ],
};

// 2.4 Báo cáo tổng hợp vi phạm & AI
const realViolationAiReport: AggregatedReportDataDto = {
  reportId: "019447e1-8894-7100-8000-000000000104",
  reportType: "VIOLATION_SUMMARY",
  templateCode: "VIOLATION_SUMMARY_REPORT",
  templateName: "BÁO CÁO TỔNG HỢP VI PHẠM AN TOÀN & HIỆU NĂNG MÔ HÌNH AI",
  siteId: "TRUNG TÂM GIÁM SÁT AN TOÀN TẬP TRUNG (SOC HSE)",
  periodStart: "2026-10-01",
  periodEnd: "2026-11-01",
  generatedBy: "Giám sát viên Trưởng: KS. Đặng Minh Tuấn",
  generatedAt: "2026-11-02T11:00:00.000Z",
  summary: {
    totalIncidents: 512,
    openIncidents: 14,
    resolvedIncidents: 498,
    trueViolations: 462,
    falseAlarms: 50,
    falseAlarmRate: 9.77,
    complianceRate: 96.12,
    meanTimeToResolveHours: 1.05,
    periodStart: "2026-10-01",
    periodEnd: "2026-11-01",
  },
  violationsBreakdown: [
    {
      violationType: "Thiếu mũ bảo hộ lao động (NO_HARD_HAT)",
      count: 260,
      percentage: 56.28,
      severityBreakdown: {
        LOW: 20,
        NORMAL: 40,
        MEDIUM: 110,
        HIGH: 80,
        CRITICAL: 10,
      },
    },
    {
      violationType: "Thiếu áo phản quang bảo hộ (NO_SAFETY_VEST)",
      count: 140,
      percentage: 30.3,
      severityBreakdown: {
        LOW: 25,
        NORMAL: 35,
        MEDIUM: 60,
        HIGH: 20,
        CRITICAL: 0,
      },
    },
    {
      violationType: "Xâm nhập vùng nguy hiểm giàn giáo / hố sâu",
      count: 38,
      percentage: 8.23,
      severityBreakdown: {
        LOW: 0,
        NORMAL: 0,
        MEDIUM: 8,
        HIGH: 18,
        CRITICAL: 12,
      },
    },
    {
      violationType: "Vi phạm khoảng cách an toàn xe cơ giới",
      count: 24,
      percentage: 5.19,
      severityBreakdown: {
        LOW: 2,
        NORMAL: 4,
        MEDIUM: 10,
        HIGH: 6,
        CRITICAL: 2,
      },
    },
  ],
  cameraRankings: [
    {
      cameraId: "CAM-ZONE-NORTH-01",
      totalViolations: 156,
      confirmedCount: 142,
      falseAlarmCount: 14,
      resolvedCount: 150,
    },
    {
      cameraId: "CAM-ZONE-SOUTH-02",
      totalViolations: 120,
      confirmedCount: 110,
      falseAlarmCount: 10,
      resolvedCount: 118,
    },
    {
      cameraId: "CAM-GATE-MAIN",
      totalViolations: 95,
      confirmedCount: 88,
      falseAlarmCount: 7,
      resolvedCount: 92,
    },
    {
      cameraId: "CAM-CRANE-TOWER",
      totalViolations: 55,
      confirmedCount: 48,
      falseAlarmCount: 7,
      resolvedCount: 52,
    },
    {
      cameraId: "CAM-STORAGE-YARD",
      totalViolations: 36,
      confirmedCount: 30,
      falseAlarmCount: 6,
      resolvedCount: 34,
    },
  ],
  trends: [
    {
      date: "Tuần 1",
      totalIncidents: 145,
      trueViolations: 130,
      falseAlarms: 15,
      resolvedCount: 140,
    },
    {
      date: "Tuần 2",
      totalIncidents: 132,
      trueViolations: 120,
      falseAlarms: 12,
      resolvedCount: 128,
    },
    {
      date: "Tuần 3",
      totalIncidents: 115,
      trueViolations: 105,
      falseAlarms: 10,
      resolvedCount: 112,
    },
    {
      date: "Tuần 4",
      totalIncidents: 85,
      trueViolations: 78,
      falseAlarms: 7,
      resolvedCount: 84,
    },
    {
      date: "Tuần 5",
      totalIncidents: 35,
      trueViolations: 29,
      falseAlarms: 6,
      resolvedCount: 34,
    },
  ],
  aiPerformance: [
    {
      id: "ai-perf-soc-01",
      cameraId: "CAM-ZONE-NORTH-01",
      modelVersionId: "YOLOv11-PPE-V1.0.0",
      statDate: "2026-11-01",
      avgFps: 33.8,
      avgLatencyMs: 25.4,
      maxLatencyMs: 38,
      totalFrames: "12800000",
    },
  ],
};

async function main() {
  console.log("================================================================================");
  console.log("SMART PPE MONITORING: XUẤT TOÀN BỘ FILE BÁO CÁO MẪU VÀ BÁO CÁO THỰC TẾ");
  console.log("Thư mục đầu ra:", OUTPUT_DIR);
  console.log("================================================================================\n");

  // ── NHÓM 1: XUẤT CÁC FILE MẪU CHUẨN ───────────────────────────────────────────
  console.log(">>> [1/2] Đang kết xuất 4 File Mẫu Chuẩn (Blank / Zero Violations)...");

  // 1. Mẫu Ca Làm Việc (PDF)
  const bufDailySample = await PdfReportEngine.generate(blankDailyTemplate);
  const pathDailySample = path.join(OUTPUT_DIR, "mau_01_ca_hang_ngay_PPE_DAILY_SHIFT.pdf");
  fs.writeFileSync(pathDailySample, bufDailySample);
  console.log(`  [+] Đã xuất: ${path.basename(pathDailySample)} (${bufDailySample.length} bytes)`);

  // 2. Mẫu Tổng Kết Tuần (PDF)
  const bufWeeklySample = await PdfReportEngine.generate(blankWeeklyTemplate);
  const pathWeeklySample = path.join(OUTPUT_DIR, "mau_02_tong_ket_tuan_HSE_WEEKLY_AUDIT.pdf");
  fs.writeFileSync(pathWeeklySample, bufWeeklySample);
  console.log(`  [+] Đã xuất: ${path.basename(pathWeeklySample)} (${bufWeeklySample.length} bytes)`);

  // 3. Mẫu Kiểm Toán Tháng (Excel)
  const bufMonthlyExcelSample = await ExcelReportEngine.generate(blankMonthlyExcelTemplate);
  const pathMonthlyExcelSample = path.join(OUTPUT_DIR, "mau_03_kiem_toan_thang_COMPLIANCE_MONTHLY.xlsx");
  fs.writeFileSync(pathMonthlyExcelSample, bufMonthlyExcelSample);
  console.log(`  [+] Đã xuất: ${path.basename(pathMonthlyExcelSample)} (${bufMonthlyExcelSample.length} bytes)`);

  // 4. Mẫu Báo Cáo Vi Phạm & AI (PDF)
  const bufAiSample = await PdfReportEngine.generate(blankAiSummaryTemplate);
  const pathAiSample = path.join(OUTPUT_DIR, "mau_04_tong_hop_vi_pham_VIOLATION_SUMMARY.pdf");
  fs.writeFileSync(pathAiSample, bufAiSample);
  console.log(`  [+] Đã xuất: ${path.basename(pathAiSample)} (${bufAiSample.length} bytes)`);

  // ── NHÓM 2: XUẤT CÁC FILE THẬT CÓ SỐ LIỆU ĐẦY ĐỦ ──────────────────────────────
  console.log("\n>>> [2/2] Đang kết xuất 4 File Báo Cáo Thực Tế (Full Production Data)...");

  // 1. Báo cáo ca ngày thật (PDF)
  const bufDailyReal = await PdfReportEngine.generate(realDailyReport);
  const pathDailyReal = path.join(OUTPUT_DIR, "bao_cao_that_ca_hang_ngay_PPE_DAILY_SHIFT.pdf");
  fs.writeFileSync(pathDailyReal, bufDailyReal);
  console.log(`  [+] Đã xuất: ${path.basename(pathDailyReal)} (${bufDailyReal.length} bytes)`);

  // 2. Báo cáo tuần thật (PDF)
  const bufWeeklyReal = await PdfReportEngine.generate(realWeeklyReport);
  const pathWeeklyReal = path.join(OUTPUT_DIR, "bao_cao_that_tong_ket_tuan_HSE_WEEKLY_AUDIT.pdf");
  fs.writeFileSync(pathWeeklyReal, bufWeeklyReal);
  console.log(`  [+] Đã xuất: ${path.basename(pathWeeklyReal)} (${bufWeeklyReal.length} bytes)`);

  // 3. Báo cáo tháng thật (Excel)
  const bufMonthlyExcelReal = await ExcelReportEngine.generate(realMonthlyExcelReport);
  const pathMonthlyExcelReal = path.join(OUTPUT_DIR, "bao_cao_that_kiem_toan_thang_COMPLIANCE_MONTHLY.xlsx");
  fs.writeFileSync(pathMonthlyExcelReal, bufMonthlyExcelReal);
  console.log(`  [+] Đã xuất: ${path.basename(pathMonthlyExcelReal)} (${bufMonthlyExcelReal.length} bytes)`);

  // 4. Báo cáo vi phạm & AI thật (PDF)
  const bufAiReal = await PdfReportEngine.generate(realViolationAiReport);
  const pathAiReal = path.join(OUTPUT_DIR, "bao_cao_that_tong_hop_vi_pham_AI_VIOLATION_SUMMARY.pdf");
  fs.writeFileSync(pathAiReal, bufAiReal);
  console.log(`  [+] Đã xuất: ${path.basename(pathAiReal)} (${bufAiReal.length} bytes)`);

  console.log("\n================================================================================");
  console.log("XUẤT THÀNH CÔNG TẤT CẢ 8 TỆP TIN BÁO CÁO! (4 FILE MẪU + 4 FILE THỰC TẾ)");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Lỗi khi kết xuất file:", err);
  process.exit(1);
});

