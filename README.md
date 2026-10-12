# Smart PPE Reporting & Analytics Microservice

Phân hệ Microservice báo cáo, thống kê và giám sát hiệu năng mô hình AI trong Hệ thống Giám sát Trang thiết bị Bảo hộ Lao động Thông minh (Smart PPE Monitoring System).

## 1. Thông tin tổng quan
- **Cổng dịch vụ (Port)**: `:8894`
- **Công nghệ**: Node.js, Express, TypeScript, Prisma ORM, PostgreSQL, Redis, Zod
- **Tài liệu tham khảo**: `D08.pdf` (Mục 3.5 & Phân công nhiệm vụ đồ án)
- **Kiến trúc**: Clean Architecture (`route -> validation -> controller -> service -> repository`)

## 2. Trách nhiệm nghiệp vụ
- **Thống kê & KPI Dashboard** (`/api/v1/statistics/*`):
  - Tổng số vi phạm, tỷ lệ tuân thủ theo công trường, khu vực, ca làm việc.
  - Phân bố vi phạm theo loại PPE (mũ bảo hộ, áo phản quang, xâm nhập vùng cấm).
  - Phân tích xu hướng theo thời gian (giờ, ngày, tuần, tháng).
- **Mẫu báo cáo & Xuất báo cáo** (`/api/v1/reports/*`):
  - Quản lý mẫu báo cáo an toàn lao động định kỳ.
  - Sinh và xuất file báo cáo theo định dạng PDF, Excel cho Ban An toàn & Quản lý dự án.
- **Giám sát mô hình AI & Telemetry** (`/api/v1/ai-models/*`):
  - Theo dõi phiên bản mô hình phát hiện PPE (YOLOv8, ByteTrack).
  - Giám sát độ chính xác (mAP, Precision, Recall), độ trễ suy luận (latency FPS) và phát hiện hiện tượng trôi dữ liệu (Data Drift).

## 3. Chạy dịch vụ cục bộ
```bash
# Cài đặt thư viện
pnpm install

# Sinh Prisma Client
pnpm run prisma:generate

# Chạy migration
pnpm run db:migrate

# Khởi chạy chế độ phát triển
pnpm run dev
```
