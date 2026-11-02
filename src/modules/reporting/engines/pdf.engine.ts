import pdfmake from "pdfmake";
import type { TDocumentDefinitions, TableCell } from "pdfmake/interfaces";
import path from "node:path";
import fs from "node:fs";
import { AggregatedReportDataDto } from "../reporting.dto";

/**
 * Trợ lý tìm kiếm đường dẫn Font Roboto Unicode
 */
function resolveRobotoFonts(): Record<string, { normal: string; bold: string; italics: string; bolditalics: string }> {
  const candidateDirs = [
    path.join(__dirname, "../../../assets/fonts"),
    path.join(__dirname, "../../assets/fonts"),
    path.join(process.cwd(), "src/assets/fonts"),
    path.join(process.cwd(), "dist/assets/fonts"),
    path.join(process.cwd(), "node_modules/pdfmake/fonts/Roboto"),
    path.join(process.cwd(), "node_modules/pdfmake/build/fonts/Roboto"),
  ];

  for (const dir of candidateDirs) {
    const regular = path.join(dir, "Roboto-Regular.ttf");
    const medium = path.join(dir, "Roboto-Medium.ttf");
    const italic = path.join(dir, "Roboto-Italic.ttf");
    const mediumItalic = path.join(dir, "Roboto-MediumItalic.ttf");

    if (fs.existsSync(regular)) {
      return {
        Roboto: {
          normal: regular,
          bold: fs.existsSync(medium) ? medium : regular,
          italics: fs.existsSync(italic) ? italic : regular,
          bolditalics: fs.existsSync(mediumItalic) ? mediumItalic : regular,
        },
      };
    }
  }

  // Fallback chuẩn nếu không tìm thấy đĩa
  return {
    Roboto: {
      normal: "Helvetica",
      bold: "Helvetica-Bold",
      italics: "Helvetica-Oblique",
      bolditalics: "Helvetica-BoldOblique",
    },
  };
}

export class PdfReportEngine {
  private static isInitialized = false;

  private static ensureInitialized(): void {
    if (this.isInitialized) return;
    const fonts = resolveRobotoFonts();
    pdfmake.setFonts(fonts);

    // SEC: Chặn mọi kết nối tải URL từ xa để triệt tiêu nguy cơ SSRF trong engine PDF
    if (typeof (pdfmake as any).setUrlAccessPolicy === "function") {
      (pdfmake as any).setUrlAccessPolicy(() => false);
    }
    // Cho phép đọc file hệ thống nội bộ để nạp fonts
    if (typeof (pdfmake as any).setLocalAccessPolicy === "function") {
      (pdfmake as any).setLocalAccessPolicy(() => true);
    }

    this.isInitialized = true;
  }

  /**
   * Tạo tài liệu PDF chuyên nghiệp từ dữ liệu báo cáo tổng hợp
   */
  public static async generate(data: AggregatedReportDataDto): Promise<Buffer> {
    this.ensureInitialized();

    // 1. Phân bổ vi phạm
    const violationRows: TableCell[][] = [
      [
        { text: "STT", style: "tableHeader", alignment: "center" },
        { text: "Loại vi phạm PPE", style: "tableHeader" },
        { text: "Số lượng", style: "tableHeader", alignment: "right" },
        { text: "Tỷ lệ (%)", style: "tableHeader", alignment: "right" },
        { text: "CRITICAL", style: "tableHeader", alignment: "center" },
        { text: "HIGH", style: "tableHeader", alignment: "center" },
      ],
    ];

    if (data.violationsBreakdown.length === 0) {
      violationRows.push([
        {
          text: "Không ghi nhận vi phạm an toàn PPE nào trong kỳ kiểm toán này.",
          colSpan: 6,
          alignment: "center",
          italics: true,
          color: "#666666",
        },
        {},
        {},
        {},
        {},
        {},
      ]);
    } else {
      data.violationsBreakdown.forEach((item, index) => {
        violationRows.push([
          { text: String(index + 1), alignment: "center" },
          { text: item.violationType },
          { text: String(item.count), alignment: "right" },
          { text: `${item.percentage}%`, alignment: "right" },
          {
            text: String(item.severityBreakdown.CRITICAL),
            alignment: "center",
            bold: item.severityBreakdown.CRITICAL > 0,
            color: item.severityBreakdown.CRITICAL > 0 ? "#D9534F" : "#333333",
          },
          {
            text: String(item.severityBreakdown.HIGH),
            alignment: "center",
            bold: item.severityBreakdown.HIGH > 0,
            color: item.severityBreakdown.HIGH > 0 ? "#F0AD4E" : "#333333",
          },
        ]);
      });
    }

    // 2. Điểm nóng Camera
    const cameraRows: TableCell[][] = [
      [
        { text: "STT", style: "tableHeader", alignment: "center" },
        { text: "Mã Camera (Camera ID)", style: "tableHeader" },
        { text: "Tổng vi phạm", style: "tableHeader", alignment: "right" },
        { text: "Đã xác nhận", style: "tableHeader", alignment: "right" },
        { text: "Đã khắc phục", style: "tableHeader", alignment: "right" },
      ],
    ];

    if (data.cameraRankings.length === 0) {
      cameraRows.push([
        {
          text: "Chưa ghi nhận số liệu vi phạm theo điểm nóng camera.",
          colSpan: 5,
          alignment: "center",
          italics: true,
          color: "#666666",
        },
        {},
        {},
        {},
        {},
      ]);
    } else {
      data.cameraRankings.slice(0, 5).forEach((cam, idx) => {
        cameraRows.push([
          { text: String(idx + 1), alignment: "center" },
          { text: cam.cameraId },
          { text: String(cam.totalViolations), alignment: "right", bold: true },
          { text: String(cam.confirmedCount), alignment: "right" },
          { text: String(cam.resolvedCount), alignment: "right" },
        ]);
      });
    }

    const docDefinition: TDocumentDefinitions = {
      pageSize: "A4",
      pageOrientation: "portrait",
      pageMargins: [40, 50, 40, 50],
      defaultStyle: {
        font: "Roboto",
        fontSize: 10,
        color: "#262626",
      },
      header: (_currentPage, _pageCount) => ({
        margin: [40, 20, 40, 0],
        columns: [
          {
            text: "SMART PPE MONITORING SYSTEM",
            fontSize: 8,
            bold: true,
            color: "#1F4E79",
          },
          {
            text: "HỆ THỐNG GIÁM SÁT AN TOÀN LAO ĐỘNG THÔNG MINH",
            fontSize: 8,
            alignment: "right",
            color: "#7F7F7F",
          },
        ],
      }),
      footer: (currentPage, pageCount) => ({
        margin: [40, 0, 40, 20],
        columns: [
          {
            text: `Mã tra cứu: ${data.reportId} | Bảo mật nội bộ`,
            fontSize: 8,
            color: "#7F7F7F",
          },
          {
            text: `Trang ${currentPage} / ${pageCount}`,
            fontSize: 8,
            alignment: "right",
            color: "#7F7F7F",
          },
        ],
      }),
      content: [
        // ── TIÊU ĐỀ BÁO CÁO ─────────────────────────────────────────────────
        {
          text: data.templateName || "BÁO CÁO GIÁM SÁT AN TOÀN LAO ĐỘNG PPE",
          style: "mainTitle",
          alignment: "center",
        },
        {
          text: `Mã mẫu: ${data.templateCode || data.reportType} | Xuất ngày: ${data.generatedAt.slice(0, 10)}`,
          style: "subTitle",
          alignment: "center",
        },
        {
          canvas: [
            {
              type: "line",
              x1: 0,
              y1: 5,
              x2: 515,
              y2: 5,
              lineWidth: 1.5,
              lineColor: "#1F4E79",
            },
          ],
          margin: [0, 5, 0, 15],
        },

        // ── THÔNG TIN CHUNG ──────────────────────────────────────────────────
        {
          style: "metaTable",
          table: {
            widths: [130, "*"],
            body: [
              [
                { text: "Cơ sở / Công trường:", bold: true, fillColor: "#F2F4F8" },
                { text: data.siteId },
              ],
              [
                { text: "Thời gian giám sát:", bold: true, fillColor: "#F2F4F8" },
                {
                  text: `Từ ngày ${data.periodStart} đến hết ngày ${data.periodEnd}`,
                },
              ],
              [
                { text: "Cán bộ khởi tạo:", bold: true, fillColor: "#F2F4F8" },
                { text: data.generatedBy },
              ],
            ],
          },
          layout: {
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => "#D9D9D9",
            vLineColor: () => "#D9D9D9",
          },
          margin: [0, 0, 0, 15],
        },

        // ── CHỈ SỐ KPI TỔNG HỢP ──────────────────────────────────────────────
        { text: "I. CHỈ SỐ AN TOÀN & TUÂN THỦ HSE", style: "sectionTitle" },
        {
          style: "kpiTable",
          table: {
            widths: ["*", "*", "*"],
            body: [
              [
                {
                  stack: [
                    { text: "TỶ LỆ TUÂN THỦ HSE", fontSize: 8, bold: true, color: "#1F4E79" },
                    { text: `${data.summary.complianceRate}%`, fontSize: 18, bold: true, color: "#2E7D32" },
                    { text: "Mục tiêu an toàn >= 95%", fontSize: 7, color: "#777777" },
                  ],
                  alignment: "center",
                  fillColor: "#F1F8E9",
                },
                {
                  stack: [
                    { text: "TỔNG SỐ VI PHẠM THỰC TẾ", fontSize: 8, bold: true, color: "#1F4E79" },
                    { text: String(data.summary.trueViolations), fontSize: 18, bold: true, color: "#C62828" },
                    { text: `Tổng sự cố: ${data.summary.totalIncidents}`, fontSize: 7, color: "#777777" },
                  ],
                  alignment: "center",
                  fillColor: "#FFEBEE",
                },
                {
                  stack: [
                    { text: "CẢNH BÁO SAI (AI)", fontSize: 8, bold: true, color: "#1F4E79" },
                    { text: `${data.summary.falseAlarmRate}%`, fontSize: 18, bold: true, color: "#E65100" },
                    { text: `${data.summary.falseAlarms} lần báo sai`, fontSize: 7, color: "#777777" },
                  ],
                  alignment: "center",
                  fillColor: "#FFF3E0",
                },
              ],
            ],
          },
          layout: {
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            hLineColor: () => "#E0E0E0",
            vLineColor: () => "#E0E0E0",
          },
          margin: [0, 5, 0, 15],
        },

        // ── BẢNG CHI TIẾT VI PHẠM ───────────────────────────────────────────
        { text: "II. PHÂN BỔ VI PHẠM THEO LOẠI TRANG BỊ BẢO HỘ", style: "sectionTitle" },
        {
          table: {
            headerRows: 1,
            widths: [30, "*", 60, 60, 60, 50],
            body: violationRows,
          },
          layout: {
            fillColor: (rowIndex: number) => {
              if (rowIndex === 0) return "#1F4E79";
              return rowIndex % 2 === 0 ? "#F9FBFD" : null;
            },
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => "#D9D9D9",
            vLineColor: () => "#D9D9D9",
          },
          margin: [0, 5, 0, 15],
        },

        // ── ĐIỂM NÓNG CAMERA ────────────────────────────────────────────────
        { text: "III. XẾP HẠNG ĐIỂM NÓNG CAMERA GIÁM SÁT", style: "sectionTitle" },
        {
          table: {
            headerRows: 1,
            widths: [30, "*", 75, 75, 75],
            body: cameraRows,
          },
          layout: {
            fillColor: (rowIndex: number) => {
              if (rowIndex === 0) return "#2E75B6";
              return rowIndex % 2 === 0 ? "#F9FBFD" : null;
            },
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => "#D9D9D9",
            vLineColor: () => "#D9D9D9",
          },
          margin: [0, 5, 0, 25],
        },

        // ── CHỮ KÝ XÁC NHẬN ─────────────────────────────────────────────────
        {
          columns: [
            {
              width: "*",
              alignment: "center",
              stack: [
                { text: "CÁN BỘ AN TOÀN HSE", bold: true, fontSize: 10 },
                { text: "(Ký, ghi rõ họ tên)", italics: true, fontSize: 8, color: "#666666", margin: [0, 2, 0, 45] },
                { text: "...........................................", color: "#999999" },
              ],
            },
            {
              width: "*",
              alignment: "center",
              stack: [
                { text: "CHỈ HUY TRƯỞNG CÔNG TRƯỜNG", bold: true, fontSize: 10 },
                { text: "(Ký và đóng dấu)", italics: true, fontSize: 8, color: "#666666", margin: [0, 2, 0, 45] },
                { text: "...........................................", color: "#999999" },
              ],
            },
          ],
        },
      ],
      styles: {
        mainTitle: {
          fontSize: 15,
          bold: true,
          color: "#1F4E79",
          margin: [0, 0, 0, 3],
        },
        subTitle: {
          fontSize: 9,
          color: "#595959",
          margin: [0, 0, 0, 8],
        },
        sectionTitle: {
          fontSize: 11,
          bold: true,
          color: "#1F4E79",
          margin: [0, 6, 0, 4],
        },
        tableHeader: {
          bold: true,
          fontSize: 9,
          color: "#FFFFFF",
        },
      },
    };

    const doc = pdfmake.createPdf(docDefinition);
    const buffer = await doc.getBuffer();
    // Đảm bảo PDF header tương thích chuẩn PDF-1.4
    if (buffer.subarray(0, 8).toString("utf-8") === "%PDF-1.3") {
      buffer[7] = 0x34; // '4'
    }
    return buffer;
  }
}
