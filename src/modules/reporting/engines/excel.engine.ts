import ExcelJS from "exceljs";
import { AggregatedReportDataDto } from "../reporting.dto";

/**
 * Excel Report Generation Engine
 * 100% Pure JavaScript (exceljs), không phụ thuộc OS, không native dependencies
 */
export class ExcelReportEngine {
  /**
   * Tạo file Excel .xlsx từ dữ liệu báo cáo tổng hợp
   */
  public static async generate(data: AggregatedReportDataDto): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Smart PPE Monitoring System";
    workbook.lastModifiedBy = data.generatedBy || "HSE Inspector";
    workbook.created = new Date();
    workbook.modified = new Date();

    // ── SHEET 1: Tổng quan & Chỉ số KPI HSE ─────────────────────────────────
    const wsSummary = workbook.addWorksheet("1. Tổng quan & KPI HSE", {
      views: [{ showGridLines: true }],
    });

    // 1. Tiêu đề chính
    wsSummary.mergeCells("A1:G1");
    const titleCell = wsSummary.getCell("A1");
    titleCell.value = data.templateName || "BÁO CÁO KIỂM TOÁN TUÂN THỦ AN TOÀN PPE";
    titleCell.font = { name: "Arial", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    titleCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F4E79" }, // Navy Blue
    };
    titleCell.alignment = { vertical: "middle", horizontal: "center" };
    wsSummary.getRow(1).height = 36;

    // 2. Thông tin chung (Metadata)
    const metaData: [string, string][] = [
      ["Mã báo cáo:", data.reportId],
      ["Mã mẫu chuẩn:", data.templateCode || "COMPLIANCE_MONTHLY"],
      ["Cơ sở / Công trường (Site ID):", data.siteId],
      ["Kỳ báo cáo:", `Từ ngày ${data.periodStart} đến ngày ${data.periodEnd}`],
      ["Người tạo:", data.generatedBy],
      ["Thời điểm kết xuất:", data.generatedAt],
    ];

    let currentRow = 3;
    for (const [label, val] of metaData) {
      const lblCell = wsSummary.getCell(`A${currentRow}`);
      const valCell = wsSummary.getCell(`B${currentRow}`);
      lblCell.value = label;
      lblCell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF333333" } };
      valCell.value = val;
      valCell.font = { name: "Arial", size: 10, color: { argb: "FF000000" } };
      wsSummary.mergeCells(`B${currentRow}:E${currentRow}`);
      currentRow++;
    }

    // 3. Khung Chỉ số KPI Tổng quan
    currentRow += 1;
    wsSummary.mergeCells(`A${currentRow}:G${currentRow}`);
    const kpiHeader = wsSummary.getCell(`A${currentRow}`);
    kpiHeader.value = "CHỈ SỐ AN TOÀN & TUÂN THỦ HSE";
    kpiHeader.font = { name: "Arial", size: 12, bold: true, color: { argb: "FF1F4E79" } };
    wsSummary.getRow(currentRow).height = 24;

    currentRow++;
    const kpiRowStart = currentRow;
    const kpis: [string, string | number, string][] = [
      ["Tổng số sự cố ghi nhận", data.summary.totalIncidents, "vụ"],
      ["Vi phạm an toàn thực tế", data.summary.trueViolations, "trường hợp"],
      ["Cảnh báo sai (False Alarms)", data.summary.falseAlarms, "lần"],
      ["Tỷ lệ cảnh báo sai", `${data.summary.falseAlarmRate}%`, ""],
      ["Tỷ lệ tuân thủ HSE", `${data.summary.complianceRate}%`, ""],
      ["Thời gian khắc phục (MTTR)", `${data.summary.meanTimeToResolveHours} giờ`, ""],
    ];

    for (const [kpiName, kpiVal, unit] of kpis) {
      wsSummary.getCell(`A${currentRow}`).value = kpiName;
      wsSummary.getCell(`A${currentRow}`).font = { name: "Arial", size: 10, bold: true };
      const valC = wsSummary.getCell(`B${currentRow}`);
      valC.value = kpiVal;
      valC.font = {
        name: "Arial",
        size: 11,
        bold: true,
        color: { argb: kpiName.includes("tuân thủ") ? "FF008000" : "FF000000" },
      };
      valC.alignment = { horizontal: "right" };
      wsSummary.getCell(`C${currentRow}`).value = unit;
      currentRow++;
    }

    for (let r = kpiRowStart; r < currentRow; r++) {
      for (const col of ["A", "B", "C"]) {
        wsSummary.getCell(`${col}${r}`).border = {
          top: { style: "thin", color: { argb: "FFDDDDDD" } },
          bottom: { style: "thin", color: { argb: "FFDDDDDD" } },
          left: { style: "thin", color: { argb: "FFDDDDDD" } },
          right: { style: "thin", color: { argb: "FFDDDDDD" } },
        };
      }
    }

    // 4. Bảng phân bổ vi phạm theo loại
    currentRow += 2;
    wsSummary.mergeCells(`A${currentRow}:G${currentRow}`);
    const vHeader = wsSummary.getCell(`A${currentRow}`);
    vHeader.value = "CHI TIẾT PHÂN BỔ VI PHẠM THEO LOẠI BẢO HỘ (PPE)";
    vHeader.font = { name: "Arial", size: 12, bold: true, color: { argb: "FF1F4E79" } };
    wsSummary.getRow(currentRow).height = 24;

    currentRow++;
    const vTableCols = [
      "STT",
      "Loại vi phạm",
      "Số lượng",
      "Tỷ lệ (%)",
      "CRITICAL",
      "HIGH",
      "MEDIUM / LOW",
    ];

    const vHeaderRow = wsSummary.getRow(currentRow);
    vHeaderRow.height = 22;
    vTableCols.forEach((colTitle, idx) => {
      const cell = vHeaderRow.getCell(idx + 1);
      cell.value = colTitle;
      cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF2E75B6" },
      };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });

    currentRow++;
    if (data.violationsBreakdown.length === 0) {
      wsSummary.mergeCells(`A${currentRow}:G${currentRow}`);
      const emptyCell = wsSummary.getCell(`A${currentRow}`);
      emptyCell.value = "Không ghi nhận vi phạm an toàn PPE nào trong kỳ kiểm toán.";
      emptyCell.font = { name: "Arial", size: 10, italic: true, color: { argb: "FF666666" } };
      emptyCell.alignment = { horizontal: "center", vertical: "middle" };
      currentRow++;
    } else {
      data.violationsBreakdown.forEach((item, index) => {
        const row = wsSummary.getRow(currentRow);
        row.getCell(1).value = index + 1;
        row.getCell(1).alignment = { horizontal: "center" };
        row.getCell(2).value = item.violationType;
        row.getCell(3).value = item.count;
        row.getCell(3).alignment = { horizontal: "right" };
        row.getCell(4).value = `${item.percentage}%`;
        row.getCell(4).alignment = { horizontal: "right" };
        row.getCell(5).value = item.severityBreakdown.CRITICAL;
        row.getCell(5).alignment = { horizontal: "right" };
        if (item.severityBreakdown.CRITICAL > 0) {
          row.getCell(5).font = { bold: true, color: { argb: "FFFF0000" } };
        }
        row.getCell(6).value = item.severityBreakdown.HIGH;
        row.getCell(6).alignment = { horizontal: "right" };
        row.getCell(7).value =
          item.severityBreakdown.MEDIUM +
          item.severityBreakdown.LOW +
          (item.severityBreakdown.NORMAL || 0);
        row.getCell(7).alignment = { horizontal: "right" };

        for (let c = 1; c <= 7; c++) {
          row.getCell(c).border = {
            top: { style: "thin", color: { argb: "FFE0E0E0" } },
            bottom: { style: "thin", color: { argb: "FFE0E0E0" } },
            left: { style: "thin", color: { argb: "FFE0E0E0" } },
            right: { style: "thin", color: { argb: "FFE0E0E0" } },
          };
        }
        currentRow++;
      });
    }

    // ── SHEET 2: Điểm nóng Camera & Xu hướng ────────────────────────────────
    const wsCamera = workbook.addWorksheet("2. Điểm nóng Camera & Xu hướng", {
      views: [{ showGridLines: true }],
    });

    wsCamera.mergeCells("A1:E1");
    const camTitle = wsCamera.getCell("A1");
    camTitle.value = "BẢNG XẾP HẠNG ĐIỂM NÓNG CAMERA VI PHẠM";
    camTitle.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
    camTitle.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F4E79" },
    };
    camTitle.alignment = { vertical: "middle", horizontal: "center" };
    wsCamera.getRow(1).height = 30;

    const camHeaders = [
      "STT",
      "Mã Camera (Camera ID)",
      "Tổng số vi phạm",
      "Đã xác nhận",
      "Cảnh báo sai",
      "Đã khắc phục",
    ];

    const camHeaderRow = wsCamera.getRow(3);
    camHeaderRow.height = 22;
    camHeaders.forEach((h, idx) => {
      const cell = camHeaderRow.getCell(idx + 1);
      cell.value = h;
      cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF2E75B6" },
      };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });

    let camCurrentRow = 4;
    if (data.cameraRankings.length === 0) {
      wsCamera.mergeCells(`A${camCurrentRow}:F${camCurrentRow}`);
      wsCamera.getCell(`A${camCurrentRow}`).value = "Chưa có vi phạm được ghi nhận theo camera.";
      wsCamera.getCell(`A${camCurrentRow}`).alignment = { horizontal: "center" };
      camCurrentRow++;
    } else {
      data.cameraRankings.forEach((cam, idx) => {
        const row = wsCamera.getRow(camCurrentRow);
        row.getCell(1).value = idx + 1;
        row.getCell(1).alignment = { horizontal: "center" };
        row.getCell(2).value = cam.cameraId;
        row.getCell(3).value = cam.totalViolations;
        row.getCell(3).alignment = { horizontal: "right" };
        row.getCell(4).value = cam.confirmedCount;
        row.getCell(4).alignment = { horizontal: "right" };
        row.getCell(5).value = cam.falseAlarmCount;
        row.getCell(5).alignment = { horizontal: "right" };
        row.getCell(6).value = cam.resolvedCount;
        row.getCell(6).alignment = { horizontal: "right" };

        for (let c = 1; c <= 6; c++) {
          row.getCell(c).border = {
            top: { style: "thin", color: { argb: "FFE0E0E0" } },
            bottom: { style: "thin", color: { argb: "FFE0E0E0" } },
            left: { style: "thin", color: { argb: "FFE0E0E0" } },
            right: { style: "thin", color: { argb: "FFE0E0E0" } },
          };
        }
        camCurrentRow++;
      });
    }

    // Xu hướng theo thời gian
    camCurrentRow += 2;
    wsCamera.mergeCells(`A${camCurrentRow}:E${camCurrentRow}`);
    const trendTitle = wsCamera.getCell(`A${camCurrentRow}`);
    trendTitle.value = "XU HƯỚNG SỰ CỐ THEO THỜI GIAN";
    trendTitle.font = { name: "Arial", size: 12, bold: true, color: { argb: "FF1F4E79" } };

    camCurrentRow++;
    const trendHeaders = ["Mốc thời gian", "Tổng sự cố", "Vi phạm thật", "Báo động sai", "Đã giải quyết"];
    const trendHeaderRow = wsCamera.getRow(camCurrentRow);
    trendHeaders.forEach((h, idx) => {
      const cell = trendHeaderRow.getCell(idx + 1);
      cell.value = h;
      cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF595959" },
      };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });

    camCurrentRow++;
    if (data.trends.length === 0) {
      wsCamera.mergeCells(`A${camCurrentRow}:E${camCurrentRow}`);
      wsCamera.getCell(`A${camCurrentRow}`).value = "Không có số liệu chuỗi thời gian.";
      wsCamera.getCell(`A${camCurrentRow}`).alignment = { horizontal: "center" };
    } else {
      data.trends.forEach((t) => {
        const row = wsCamera.getRow(camCurrentRow);
        row.getCell(1).value = t.date;
        row.getCell(1).alignment = { horizontal: "center" };
        row.getCell(2).value = t.totalIncidents;
        row.getCell(2).alignment = { horizontal: "right" };
        row.getCell(3).value = t.trueViolations;
        row.getCell(3).alignment = { horizontal: "right" };
        row.getCell(4).value = t.falseAlarms;
        row.getCell(4).alignment = { horizontal: "right" };
        row.getCell(5).value = t.resolvedCount;
        row.getCell(5).alignment = { horizontal: "right" };

        for (let c = 1; c <= 5; c++) {
          row.getCell(c).border = {
            top: { style: "thin", color: { argb: "FFE0E0E0" } },
            bottom: { style: "thin", color: { argb: "FFE0E0E0" } },
            left: { style: "thin", color: { argb: "FFE0E0E0" } },
            right: { style: "thin", color: { argb: "FFE0E0E0" } },
          };
        }
        camCurrentRow++;
      });
    }

    // ── SHEET 3: Hiệu năng Mô hình AI ───────────────────────────────────────
    if (data.aiPerformance && data.aiPerformance.length > 0) {
      const wsAi = workbook.addWorksheet("3. Hiệu năng AI Telemetry", {
        views: [{ showGridLines: true }],
      });

      wsAi.mergeCells("A1:G1");
      const aiTitle = wsAi.getCell("A1");
      aiTitle.value = "THỐNG KÊ HIỆU NĂNG SUY LUẬN MÔ HÌNH AI (YOLO)";
      aiTitle.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
      aiTitle.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1F4E79" },
      };
      aiTitle.alignment = { vertical: "middle", horizontal: "center" };
      wsAi.getRow(1).height = 30;

      const aiHeaders = [
        "STT",
        "Ngày thống kê",
        "Camera ID",
        "FPS trung bình",
        "Độ trễ TB (ms)",
        "Độ trễ tối đa (ms)",
        "Tổng frames suy luận",
      ];

      const aiHeaderRow = wsAi.getRow(3);
      aiHeaderRow.height = 22;
      aiHeaders.forEach((h, idx) => {
        const cell = aiHeaderRow.getCell(idx + 1);
        cell.value = h;
        cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF385723" },
        };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      });

      data.aiPerformance.forEach((ai, idx) => {
        const row = wsAi.getRow(4 + idx);
        row.getCell(1).value = idx + 1;
        row.getCell(1).alignment = { horizontal: "center" };
        row.getCell(2).value = ai.statDate;
        row.getCell(2).alignment = { horizontal: "center" };
        row.getCell(3).value = ai.cameraId;
        row.getCell(4).value = ai.avgFps;
        row.getCell(4).alignment = { horizontal: "right" };
        row.getCell(5).value = ai.avgLatencyMs;
        row.getCell(5).alignment = { horizontal: "right" };
        row.getCell(6).value = ai.maxLatencyMs;
        row.getCell(6).alignment = { horizontal: "right" };
        row.getCell(7).value = ai.totalFrames;
        row.getCell(7).alignment = { horizontal: "right" };

        for (let c = 1; c <= 7; c++) {
          row.getCell(c).border = {
            top: { style: "thin", color: { argb: "FFE0E0E0" } },
            bottom: { style: "thin", color: { argb: "FFE0E0E0" } },
            left: { style: "thin", color: { argb: "FFE0E0E0" } },
            right: { style: "thin", color: { argb: "FFE0E0E0" } },
          };
        }
      });

      // Tự động căn chỉnh độ rộng cột Sheet AI
      wsAi.columns.forEach((col) => {
        let maxLen = 12;
        col.eachCell?.({ includeEmpty: false }, (cell) => {
          const val = cell.value ? String(cell.value) : "";
          if (val.length > maxLen && val.length < 50) {
            maxLen = val.length;
          }
        });
        col.width = maxLen + 3;
      });
    }

    // Tự động căn chỉnh độ rộng các cột của Sheet 1 & 2
    [wsSummary, wsCamera].forEach((ws) => {
      ws.columns.forEach((col) => {
        let maxLen = 12;
        col.eachCell?.({ includeEmpty: false }, (cell) => {
          const val = cell.value ? String(cell.value) : "";
          if (val.length > maxLen && val.length < 50) {
            maxLen = val.length;
          }
        });
        col.width = maxLen + 3;
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}

