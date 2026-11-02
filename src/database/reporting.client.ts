import { PrismaClient as ReportingPrismaClient } from "@prisma/client-reporting";
import { envConfig } from "../config/env.config";
import { DEFAULT_REPORT_TEMPLATES } from "../common/constants/reporting.constant";

/**
 * Cấu hình timeout mặc định cho interactive transactions của Reporting Service
 */
export const DEFAULT_REPORTING_TRANSACTION_OPTIONS = {
  maxWait: 10000,
  timeout: 15000,
} as const;

let _reportingPrisma: ReportingPrismaClient | null = null;

export function getReportingPrisma(): ReportingPrismaClient {
  if (!_reportingPrisma) {
    _reportingPrisma = new ReportingPrismaClient({
      log:
        envConfig.nodeEnv === "development"
          ? ["query", "error", "warn"]
          : ["error", "warn"],
    });
  }
  return _reportingPrisma;
}

export const reportingPrisma = new Proxy({} as ReportingPrismaClient, {
  get(_target, prop) {
    return (getReportingPrisma() as any)[prop];
  },
});

/**
 * Tự động đảm bảo 4 mẫu báo cáo chuẩn luôn tồn tại trong cơ sở dữ liệu
 */
export async function ensureDefaultReportTemplates(
  client?: ReportingPrismaClient,
): Promise<void> {
  const prisma = client || getReportingPrisma();
  try {
    for (const tmpl of DEFAULT_REPORT_TEMPLATES) {
      await prisma.reportTemplate.upsert({
        where: { code: tmpl.code },
        // SEC: Không ghi đè cập nhật nếu mẫu báo cáo đã tồn tại trong CSDL.
        // Điều này bảo vệ trạng thái quản trị (ví dụ quản trị viên đã vô hiệu hóa INACTIVE mẫu cũ)
        // không bị tự động kích hoạt lại mỗi khi server restart.
        update: {},
        create: {
          code: tmpl.code,
          name: tmpl.name,
          description: tmpl.description,
          fileType: tmpl.fileType,
          version: tmpl.version,
          status: tmpl.status,
        },
      });
    }
  } catch (err: any) {
    // Không làm sập ứng dụng nếu trong lúc chạy test với mock database
    if (envConfig.nodeEnv !== "test") {
      console.warn(
        `[Reporting Service] Could not ensure default templates: ${err?.message}`,
      );
    }
  }
}
