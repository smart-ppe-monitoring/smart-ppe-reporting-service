import { AggregatedReportDataDto } from "../reporting.dto";

/**
 * CSV Report Generation Engine
 * Xuất đầy đủ số liệu báo cáo an toàn PPE theo chuẩn RFC 4180,
 * hỗ trợ UTF-8 BOM cho Excel tiếng Việt và chống CSV Formula Injection.
 */
export class CsvReportEngine {
  private static readonly UTF8_BOM = "\uFEFF";
  private static readonly FORMULA_TRIGGER_REGEX = /^[\s\t\r\n]*[=+\-@]|^[\t\r]/;

  /**
   * Làm sạch giá trị ô CSV chống Formula Injection (=, +, -, @, \t, \r)
   * và bọc dấu ngoặc kép theo chuẩn RFC 4180 khi chứa ký tự đặc biệt.
   */
  public static escapeCell(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? String(value) : "";
    }

    let str = String(value);
    if (this.FORMULA_TRIGGER_REGEX.test(str)) {
      str = `'${str}`;
    }

    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }

    return str;
  }

  public static sanitizeCell(value: unknown): string {
    return this.escapeCell(value);
  }

  private static row(cells: unknown[]): string {
    return cells.map((c) => this.escapeCell(c)).join(",");
  }

  /**
   * Tạo Buffer nội dung CSV hoàn chỉnh từ dữ liệu báo cáo tổng hợp
   */
  public static generate(data: AggregatedReportDataDto): Buffer {
    const lines: string[] = [];

    // 1. Metadata báo cáo
    lines.push(
      this.row([
        "reportId",
        "reportType",
        "siteId",
        "periodStart",
        "periodEnd",
        "generatedBy",
        "generatedAt",
        "templateCode",
        "templateName",
      ]),
    );
    lines.push(
      this.row([
        data.reportId,
        data.reportType,
        data.siteId,
        data.periodStart,
        data.periodEnd,
        data.generatedBy,
        data.generatedAt,
        data.templateCode || "",
        data.templateName || "",
      ]),
    );
    lines.push("");

    // 2. Tổng hợp KPI HSE
    lines.push(this.row(["I. CHỈ SỐ AN TOÀN & TUÂN THỦ HSE"]));
    lines.push(this.row(["Chỉ số KPI", "Giá trị", "Đơn vị"]));
    lines.push(
      this.row(["Tổng số sự cố ghi nhận", data.summary.totalIncidents, "vụ"]),
    );
    lines.push(
      this.row([
        "Sự cố đang mở (Chờ xử lý)",
        data.summary.openIncidents,
        "vụ",
      ]),
    );
    lines.push(
      this.row(["Sự cố đã giải quyết", data.summary.resolvedIncidents, "vụ"]),
    );
    lines.push(
      this.row([
        "Vi phạm an toàn thực tế",
        data.summary.trueViolations,
        "trường hợp",
      ]),
    );
    lines.push(
      this.row(["Cảnh báo sai (False Alarms)", data.summary.falseAlarms, "lần"]),
    );
    lines.push(
      this.row(["Tỷ lệ cảnh báo sai", data.summary.falseAlarmRate, "%"]),
    );
    lines.push(
      this.row(["Tỷ lệ tuân thủ HSE", data.summary.complianceRate, "%"]),
    );
    lines.push(
      this.row([
        "Thời gian khắc phục trung bình (MTTR)",
        data.summary.meanTimeToResolveHours,
        "giờ",
      ]),
    );
    lines.push("");

    // 2.1 Phân bổ mức độ nghiêm trọng & SLA (nếu có)
    if (data.summary.severityBreakdown) {
      lines.push(this.row(["PHÂN BỔ MỨC ĐỘ NGHIÊM TRỌNG & SLA"]));
      lines.push(
        this.row([
          "Mức độ nghiêm trọng",
          "Số lượng",
          "Đã giải quyết",
          "Mục tiêu SLA (phút)",
          "MTTR thực tế (phút)",
        ]),
      );
      for (const level of ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const) {
        const item = data.summary.severityBreakdown[level];
        if (!item) continue;
        lines.push(
          this.row([
            level,
            item.count,
            item.resolved,
            item.targetSlaMinutes,
            item.actualMttrMinutes,
          ]),
        );
      }
      lines.push("");
    }

    // 3. Phân bổ vi phạm theo loại bảo hộ (PPE)
    lines.push(
      this.row(["II. PHÂN BỔ VI PHẠM THEO LOẠI TRANG BỊ BẢO HỘ (PPE)"]),
    );
    lines.push(
      this.row([
        "STT",
        "Loại vi phạm",
        "Số lượng",
        "Tỷ lệ (%)",
        "CRITICAL",
        "HIGH",
        "MEDIUM / LOW",
      ]),
    );
    if (data.violationsBreakdown.length === 0) {
      lines.push(
        this.row([
          "Không ghi nhận vi phạm an toàn PPE nào trong kỳ kiểm toán.",
        ]),
      );
    } else {
      data.violationsBreakdown.forEach((item, index) => {
        const mediumLowCount =
          item.severityBreakdown.MEDIUM +
          item.severityBreakdown.LOW +
          (item.severityBreakdown.NORMAL || 0);
        lines.push(
          this.row([
            index + 1,
            item.violationType,
            item.count,
            item.percentage,
            item.severityBreakdown.CRITICAL,
            item.severityBreakdown.HIGH,
            mediumLowCount,
          ]),
        );
      });
    }
    lines.push("");

    // 4. Bảng xếp hạng điểm nóng Camera
    lines.push(this.row(["III. BẢNG XẾP HẠNG ĐIỂM NÓNG CAMERA VI PHẠM"]));
    lines.push(
      this.row([
        "STT",
        "Mã Camera (Camera ID)",
        "Tổng số vi phạm",
        "Đã xác nhận",
        "Cảnh báo sai",
        "Đã khắc phục",
      ]),
    );
    if (data.cameraRankings.length === 0) {
      lines.push(this.row(["Chưa có vi phạm được ghi nhận theo camera."]));
    } else {
      data.cameraRankings.forEach((cam, idx) => {
        lines.push(
          this.row([
            idx + 1,
            cam.cameraId,
            cam.totalViolations,
            cam.confirmedCount,
            cam.falseAlarmCount,
            cam.resolvedCount,
          ]),
        );
      });
    }
    lines.push("");

    // 5. Xu hướng sự cố theo thời gian
    lines.push(this.row(["IV. XU HƯỚNG SỰ CỐ THEO THỜI GIAN"]));
    lines.push(
      this.row([
        "Mốc thời gian",
        "Tổng sự cố",
        "Vi phạm thật",
        "Báo động sai",
        "Đã giải quyết",
      ]),
    );
    if (data.trends.length === 0) {
      lines.push(this.row(["Không có số liệu chuỗi thời gian."]));
    } else {
      data.trends.forEach((t) => {
        lines.push(
          this.row([
            t.date,
            t.totalIncidents,
            t.trueViolations,
            t.falseAlarms,
            t.resolvedCount,
          ]),
        );
      });
    }

    // 6. Hiệu năng suy luận AI Telemetry (nếu có)
    if (data.aiPerformance && data.aiPerformance.length > 0) {
      lines.push("");
      lines.push(this.row(["V. HIỆU NĂNG SUY LUẬN MÔ HÌNH AI (TELEMETRY)"]));
      lines.push(
        this.row([
          "STT",
          "Ngày thống kê",
          "Camera ID",
          "FPS trung bình",
          "Độ trễ TB (ms)",
          "Độ trễ tối đa (ms)",
          "Tổng frames suy luận",
        ]),
      );
      data.aiPerformance.forEach((ai, idx) => {
        lines.push(
          this.row([
            idx + 1,
            ai.statDate,
            ai.cameraId,
            ai.avgFps,
            ai.avgLatencyMs,
            ai.maxLatencyMs,
            ai.totalFrames,
          ]),
        );
      });
    }

    return Buffer.from(`${this.UTF8_BOM}${lines.join("\r\n")}\r\n`, "utf-8");
  }
}
