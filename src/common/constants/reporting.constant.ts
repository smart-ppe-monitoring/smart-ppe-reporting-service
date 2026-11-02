/**
 * Constants for Reporting & Analytics Service (Task BE-09)
 */

export const REPORT_TYPE = {
  DAILY: "DAILY",
  WEEKLY: "WEEKLY",
  MONTHLY: "MONTHLY",
  VIOLATION_SUMMARY: "VIOLATION_SUMMARY",
  AI_PERFORMANCE: "AI_PERFORMANCE",
} as const;

export type ReportType = (typeof REPORT_TYPE)[keyof typeof REPORT_TYPE];

export const REPORT_STATUS = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

export type ReportStatus = (typeof REPORT_STATUS)[keyof typeof REPORT_STATUS];

export const REPORT_FILE_TYPE = {
  PDF: "PDF",
  EXCEL: "EXCEL",
  CSV: "CSV",
  JSON: "JSON",
} as const;

export type ReportFileType =
  (typeof REPORT_FILE_TYPE)[keyof typeof REPORT_FILE_TYPE];

export const REPORT_TEMPLATE_STATUS = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
} as const;

export type ReportTemplateStatus =
  (typeof REPORT_TEMPLATE_STATUS)[keyof typeof REPORT_TEMPLATE_STATUS];

export const AI_MODEL_TYPE = {
  OBJECT_DETECTION: "OBJECT_DETECTION",
  TRACKING: "TRACKING",
  CLASSIFICATION: "CLASSIFICATION",
} as const;

export type AiModelType = (typeof AI_MODEL_TYPE)[keyof typeof AI_MODEL_TYPE];

export const AI_MODEL_STATUS = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  DEPRECATED: "DEPRECATED",
} as const;

export type AiModelStatus =
  (typeof AI_MODEL_STATUS)[keyof typeof AI_MODEL_STATUS];

export const AI_MODEL_VERSION_STATUS = {
  DEVELOPMENT: "DEVELOPMENT",
  STAGING: "STAGING",
  DEPLOYED: "DEPLOYED",
  ARCHIVED: "ARCHIVED",
} as const;

export type AiModelVersionStatus =
  (typeof AI_MODEL_VERSION_STATUS)[keyof typeof AI_MODEL_VERSION_STATUS];

export const STATISTIC_GROUP_BY = {
  DAY: "DAY",
  WEEK: "WEEK",
  MONTH: "MONTH",
} as const;

export type StatisticGroupBy =
  (typeof STATISTIC_GROUP_BY)[keyof typeof STATISTIC_GROUP_BY];

export const REPORT_TEMPLATE_CODE = {
  PPE_DAILY_SHIFT: "PPE_DAILY_SHIFT",
  HSE_WEEKLY_AUDIT: "HSE_WEEKLY_AUDIT",
  COMPLIANCE_MONTHLY: "COMPLIANCE_MONTHLY",
  VIOLATION_SUMMARY_REPORT: "VIOLATION_SUMMARY_REPORT",
} as const;

export type ReportTemplateCode =
  (typeof REPORT_TEMPLATE_CODE)[keyof typeof REPORT_TEMPLATE_CODE];

export const DEFAULT_REPORT_TEMPLATES = [
  {
    code: REPORT_TEMPLATE_CODE.PPE_DAILY_SHIFT,
    name: "Báo cáo Ca Làm Việc Hàng Ngày",
    description: "Tổng hợp thống kê vi phạm an toàn PPE và nhật ký giám sát theo ca làm việc.",
    fileType: REPORT_FILE_TYPE.PDF,
    version: "1.0.0",
    status: REPORT_TEMPLATE_STATUS.ACTIVE,
  },
  {
    code: REPORT_TEMPLATE_CODE.HSE_WEEKLY_AUDIT,
    name: "Báo cáo Tổng Kết An Toàn Tuần",
    description: "Phân tích xu hướng vi phạm theo tuần, tỷ lệ tuân thủ HSE và xếp hạng điểm nóng camera.",
    fileType: REPORT_FILE_TYPE.PDF,
    version: "1.0.0",
    status: REPORT_TEMPLATE_STATUS.ACTIVE,
  },
  {
    code: REPORT_TEMPLATE_CODE.COMPLIANCE_MONTHLY,
    name: "Báo cáo Kiểm Toán Tuân Thủ Tháng",
    description: "Hồ sơ kiểm định an toàn lao động phục vụ thanh tra nội bộ và đối tác xây dựng.",
    fileType: REPORT_FILE_TYPE.EXCEL,
    version: "1.0.0",
    status: REPORT_TEMPLATE_STATUS.ACTIVE,
  },
  {
    code: REPORT_TEMPLATE_CODE.VIOLATION_SUMMARY_REPORT,
    name: "Báo cáo Tổng Hợp Vi Phạm & AI",
    description: "Thống kê chi tiết phân bổ lỗi bảo hộ và hiệu năng nhận diện của mô hình AI.",
    fileType: REPORT_FILE_TYPE.PDF,
    version: "1.0.0",
    status: REPORT_TEMPLATE_STATUS.ACTIVE,
  },
] as const;
