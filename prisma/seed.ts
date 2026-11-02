import { PrismaClient as ReportingPrismaClient } from "@prisma/client-reporting";

const prisma = new ReportingPrismaClient();

export const DEFAULT_REPORT_TEMPLATES = [
  {
    code: "PPE_DAILY_SHIFT",
    name: "Báo cáo Ca Làm Việc Hàng Ngày",
    description: "Tổng hợp thống kê vi phạm an toàn PPE và nhật ký giám sát theo ca làm việc.",
    fileType: "PDF",
    version: "1.0.0",
    status: "ACTIVE",
  },
  {
    code: "HSE_WEEKLY_AUDIT",
    name: "Báo cáo Tổng Kết An Toàn Tuần",
    description: "Phân tích xu hướng vi phạm theo tuần, tỷ lệ tuân thủ HSE và xếp hạng điểm nóng camera.",
    fileType: "PDF",
    version: "1.0.0",
    status: "ACTIVE",
  },
  {
    code: "COMPLIANCE_MONTHLY",
    name: "Báo cáo Kiểm Toán Tuân Thủ Tháng",
    description: "Hồ sơ kiểm định an toàn lao động phục vụ thanh tra nội bộ và đối tác xây dựng.",
    fileType: "EXCEL",
    version: "1.0.0",
    status: "ACTIVE",
  },
  {
    code: "VIOLATION_SUMMARY_REPORT",
    name: "Báo cáo Tổng Hợp Vi Phạm & AI",
    description: "Thống kê chi tiết phân bổ lỗi bảo hộ và hiệu năng nhận diện của mô hình AI.",
    fileType: "PDF",
    version: "1.0.0",
    status: "ACTIVE",
  },
];

async function main() {
  console.log("[Seed] Khởi tạo các mẫu báo cáo chuẩn cho smart-ppe-reporting-service...");

  for (const tmpl of DEFAULT_REPORT_TEMPLATES) {
    const upserted = await prisma.reportTemplate.upsert({
      where: { code: tmpl.code },
      update: {
        name: tmpl.name,
        description: tmpl.description,
        fileType: tmpl.fileType,
        status: tmpl.status,
      },
      create: {
        code: tmpl.code,
        name: tmpl.name,
        description: tmpl.description,
        fileType: tmpl.fileType,
        version: tmpl.version,
        status: tmpl.status,
      },
    });
    console.log(`[Seed] ✅ Đã lưu mẫu báo cáo: ${upserted.code} - ${upserted.name} (${upserted.fileType})`);
  }

  // Khởi tạo Model AI chuẩn nếu chưa có
  const defaultModel = await prisma.aiModel.upsert({
    where: { code: "YOLO_PPE_V11" },
    update: {},
    create: {
      code: "YOLO_PPE_V11",
      name: "YOLOv11 Real-time PPE Detector",
      modelType: "OBJECT_DETECTION",
      description: "Mô hình nhận diện nón bảo hộ, áo phản quang và người trong công trường xây dựng",
      status: "ACTIVE",
    },
  });

  await prisma.aiModelVersion.upsert({
    where: {
      modelId_version: {
        modelId: defaultModel.id,
        version: "1.0.0",
      },
    },
    update: {},
    create: {
      modelId: defaultModel.id,
      version: "1.0.0",
      framework: "PyTorch",
      inputSize: "640x640",
      status: "DEPLOYED",
      modelPath: "models/yolo_ppe_v11.pt",
      deployedAt: new Date(),
    },
  });
  console.log(`[Seed] ✅ Đã cấu hình mô hình AI mặc định: YOLO_PPE_V11 v1.0.0 (DEPLOYED)`);

  console.log("[Seed] Hoàn tất quá trình seed dữ liệu!");
}

main()
  .catch((e) => {
    console.error("[Seed] Thất bại:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

