import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { ExcelReportEngine } from "../src/modules/reporting/engines/excel.engine";
import { PdfReportEngine } from "../src/modules/reporting/engines/pdf.engine";
import { ReportingService } from "../src/modules/reporting/reporting.service";
import { ReportingRepository } from "../src/modules/reporting/reporting.repository";
import { AggregatedReportDataDto } from "../src/modules/reporting/reporting.dto";
import { ROLES } from "../src/common/constants/role.constant";

describe("Production-Grade Report Generation Engines (PDF & Excel)", () => {
  const sampleAggregatedData: AggregatedReportDataDto = {
    reportId: "019447e1-8894-7000-8000-000000000001",
    reportType: "DAILY",
    templateCode: "PPE_DAILY_SHIFT",
    templateName: "Báo cáo Ca Làm Việc Hàng Ngày",
    siteId: "019447e1-8891-7000-8000-000000000002",
    periodStart: "2026-11-01",
    periodEnd: "2026-11-02",
    generatedBy: "019447e1-9999-7000-8000-000000000003",
    generatedAt: "2026-11-02T10:00:00.000Z",
    summary: {
      totalIncidents: 15,
      openIncidents: 2,
      resolvedIncidents: 13,
      trueViolations: 12,
      falseAlarms: 3,
      falseAlarmRate: 20.0,
      complianceRate: 85.5,
      meanTimeToResolveHours: 1.25,
      periodStart: "2026-11-01",
      periodEnd: "2026-11-02",
    },
    violationsBreakdown: [
      {
        violationType: "NO_HARD_HAT",
        count: 7,
        percentage: 58.33,
        severityBreakdown: {
          LOW: 0,
          NORMAL: 1,
          MEDIUM: 2,
          HIGH: 3,
          CRITICAL: 1,
        },
      },
      {
        violationType: "NO_SAFETY_VEST",
        count: 5,
        percentage: 41.67,
        severityBreakdown: {
          LOW: 1,
          NORMAL: 0,
          MEDIUM: 2,
          HIGH: 2,
          CRITICAL: 0,
        },
      },
    ],
    cameraRankings: [
      {
        cameraId: "019447e1-8892-7000-8000-000000000010",
        totalViolations: 8,
        confirmedCount: 7,
        falseAlarmCount: 1,
        resolvedCount: 6,
      },
      {
        cameraId: "019447e1-8892-7000-8000-000000000011",
        totalViolations: 4,
        confirmedCount: 3,
        falseAlarmCount: 1,
        resolvedCount: 3,
      },
    ],
    trends: [
      {
        date: "2026-11-01",
        totalIncidents: 8,
        trueViolations: 6,
        falseAlarms: 2,
        resolvedCount: 6,
      },
      {
        date: "2026-11-02",
        totalIncidents: 7,
        trueViolations: 6,
        falseAlarms: 1,
        resolvedCount: 7,
      },
    ],
    aiPerformance: [
      {
        id: "ai-stat-1",
        cameraId: "019447e1-8892-7000-8000-000000000010",
        modelVersionId: "yolo-v11",
        statDate: "2026-11-01",
        avgFps: 29.5,
        avgLatencyMs: 33.2,
        maxLatencyMs: 48,
        totalFrames: "150000",
      },
    ],
  };

  const emptyAggregatedData: AggregatedReportDataDto = {
    reportId: "019447e1-8894-7000-8000-000000000099",
    reportType: "MONTHLY",
    templateCode: "COMPLIANCE_MONTHLY",
    templateName: "Báo cáo Kiểm Toán Tuân Thủ Tháng",
    siteId: "019447e1-8891-7000-8000-000000000002",
    periodStart: "2026-11-01",
    periodEnd: "2026-11-30",
    generatedBy: "019447e1-9999-7000-8000-000000000003",
    generatedAt: "2026-11-30T10:00:00.000Z",
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

  // ── 1. Excel Engine Tests ──────────────────────────────────────────────────
  describe("ExcelReportEngine (exceljs)", () => {
    it("generates a valid .xlsx buffer starting with PK zip signature", async () => {
      const buffer = await ExcelReportEngine.generate(sampleAggregatedData);

      assert(Buffer.isBuffer(buffer));
      assert(buffer.length > 5000, "Excel file should have substantial binary size");

      // Verify ZIP magic bytes (0x50 0x4B)
      assert.equal(buffer[0], 0x50);
      assert.equal(buffer[1], 0x4b);
    });

    it("creates readable Excel workbook with multiple sheets and correct data", async () => {
      const buffer = await ExcelReportEngine.generate(sampleAggregatedData);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);

      assert.equal(workbook.worksheets.length, 3, "Should contain 3 worksheets");
      const sheet1 = workbook.getWorksheet("1. Tổng quan & KPI HSE");
      const sheet2 = workbook.getWorksheet("2. Điểm nóng Camera & Xu hướng");
      const sheet3 = workbook.getWorksheet("3. Hiệu năng AI Telemetry");

      assert(sheet1, "Sheet 1 must exist");
      assert(sheet2, "Sheet 2 must exist");
      assert(sheet3, "Sheet 3 must exist");

      // Check title cell
      const title = sheet1.getCell("A1").value;
      assert.equal(title, "Báo cáo Ca Làm Việc Hàng Ngày");

      // Check camera rankings
      const camCell = sheet2.getCell("B4").value;
      assert.equal(camCell, "019447e1-8892-7000-8000-000000000010");
    });

    it("gracefully generates Excel for empty audit period with 100% compliance", async () => {
      const buffer = await ExcelReportEngine.generate(emptyAggregatedData);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);

      assert.equal(workbook.worksheets.length, 2, "Should contain 2 worksheets when AI stats are empty");
      const sheet1 = workbook.getWorksheet("1. Tổng quan & KPI HSE");
      assert(sheet1);
    });
  });

  // ── 2. PDF Engine Tests ────────────────────────────────────────────────────
  describe("PdfReportEngine (pdfmake)", () => {
    it("generates a valid .pdf buffer starting with %PDF-1.4 signature", async () => {
      const buffer = await PdfReportEngine.generate(sampleAggregatedData);

      assert(Buffer.isBuffer(buffer));
      assert(buffer.length > 10000, "PDF file should be larger than 10KB");

      const header = buffer.subarray(0, 8).toString("utf-8");
      assert.equal(header, "%PDF-1.4");
    });

    it("gracefully generates PDF document when no violations are recorded", async () => {
      const buffer = await PdfReportEngine.generate(emptyAggregatedData);

      assert(Buffer.isBuffer(buffer));
      assert(buffer.length > 5000);
      assert(buffer.toString("utf-8").startsWith("%PDF-1.4"));
    });
  });

  // ── 3. ReportingService Integration Tests ──────────────────────────────────
  describe("ReportingService Full Content Export Integration", () => {
    it("streams real Excel file when report template fileType is EXCEL", async () => {
      const mockRepo = {
        findReportGenerationById: async () => ({
          id: "019447e1-8894-7000-8000-000000000055",
          siteId: "019447e1-8891-7000-8000-000000000002",
          reportType: "MONTHLY",
          periodStart: "2026-11-01",
          periodEnd: "2026-11-30",
          generatedBy: "019447e1-9999-7000-8000-000000000003",
          status: "COMPLETED",
          fileName: "report_monthly_compliance.xlsx",
          generatedAt: new Date().toISOString(),
          template: {
            code: "COMPLIANCE_MONTHLY",
            name: "Báo cáo Kiểm Toán Tuân Thủ Tháng",
            fileType: "EXCEL",
          },
        }),
        getAggregatedReportData: async () => sampleAggregatedData,
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepo);
      const result = await service.getReportGenerationContent(
        "019447e1-8894-7000-8000-000000000055",
        "019447e1-9999-7000-8000-000000000003",
        ROLES.SITE_MANAGER,
      );

      assert.equal(
        result.contentType,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      assert(result.fileName.endsWith(".xlsx"));
      assert(result.content[0] === 0x50 && result.content[1] === 0x4b, "Must be valid ZIP archive");
    });

    it("streams real PDF file when report template fileType is PDF", async () => {
      const mockRepo = {
        findReportGenerationById: async () => ({
          id: "019447e1-8894-7000-8000-000000000077",
          siteId: "019447e1-8891-7000-8000-000000000002",
          reportType: "DAILY",
          periodStart: "2026-11-01",
          periodEnd: "2026-11-01",
          generatedBy: "019447e1-9999-7000-8000-000000000003",
          status: "COMPLETED",
          fileName: "report_daily_shift.pdf",
          generatedAt: new Date().toISOString(),
          template: {
            code: "PPE_DAILY_SHIFT",
            name: "Báo cáo Ca Làm Việc Hàng Ngày",
            fileType: "PDF",
          },
        }),
        getAggregatedReportData: async () => sampleAggregatedData,
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepo);
      const result = await service.getReportGenerationContent(
        "019447e1-8894-7000-8000-000000000077",
        "019447e1-9999-7000-8000-000000000003",
        ROLES.SITE_MANAGER,
      );

      assert.equal(result.contentType, "application/pdf");
      assert(result.fileName.endsWith(".pdf"));
      assert(result.content.toString("utf-8").startsWith("%PDF-1.4"));
    });
  });

  // ── 4. Wave 5 Security Patches Verification ────────────────────────────────
  describe("Wave 5 Security Audit Patches: Multi-Tenancy & Template Governance", () => {
    it("getAggregatedReportData scopes AI telemetry strictly to site cameras preventing cross-site leakage", async () => {
      const targetSiteId = "019447e1-8891-7000-8000-000000000002";
      const siteCamera1 = "019447e1-8892-7000-8000-000000000010";
      const foreignCamera = "019447e1-8892-7000-8000-999999999999"; // foreign site camera

      const mockRepo = new ReportingRepository({} as any);

      // Stub methods
      mockRepo.getIncidentSummary = async () => sampleAggregatedData.summary;
      mockRepo.getViolationBreakdown = async () => sampleAggregatedData.violationsBreakdown;
      mockRepo.getCameraRankings = async () => [
        {
          cameraId: siteCamera1,
          totalViolations: 5,
          confirmedCount: 4,
          falseAlarmCount: 1,
          resolvedCount: 4,
        },
      ];
      mockRepo.getIncidentTrends = async () => sampleAggregatedData.trends;
      mockRepo.getAiPerformanceStats = async () => [
        {
          id: "stat-site-1",
          cameraId: siteCamera1,
          modelVersionId: "yolo-v11",
          statDate: "2026-11-01",
          avgFps: 30.0,
          avgLatencyMs: 25.0,
          maxLatencyMs: 40,
          totalFrames: "100000",
        },
        {
          id: "stat-foreign-site",
          cameraId: foreignCamera, // Must be filtered out
          modelVersionId: "yolo-v11",
          statDate: "2026-11-01",
          avgFps: 28.0,
          avgLatencyMs: 35.0,
          maxLatencyMs: 55,
          totalFrames: "80000",
        },
      ];

      const reportInput = {
        id: "report-001",
        siteId: targetSiteId,
        reportType: "MONTHLY",
        periodStart: "2026-11-01",
        periodEnd: "2026-11-30",
        generatedBy: "user-001",
        generatedAt: new Date().toISOString(),
      };

      const result = await mockRepo.getAggregatedReportData(reportInput);

      assert.ok(result.aiPerformance);
      assert.strictEqual(
        result.aiPerformance.length,
        1,
        "Must only include telemetry for cameras belonging to target site",
      );
      assert.strictEqual(
        result.aiPerformance[0].cameraId,
        siteCamera1,
        "Retained telemetry must belong to the site camera",
      );
      assert.ok(
        !result.aiPerformance.some((s) => s.cameraId === foreignCamera),
        "Must NOT contain foreign site camera telemetry (cross-site BOLA prevented)",
      );
    });

    it("ensureDefaultReportTemplates uses empty update object to protect administrative customizations", async () => {
      const { ensureDefaultReportTemplates } = await import(
        "../src/database/reporting.client"
      );

      const upsertCalls: any[] = [];
      const mockPrismaClient: any = {
        reportTemplate: {
          upsert: async (args: any) => {
            upsertCalls.push(args);
            return args.create;
          },
        },
      };

      await ensureDefaultReportTemplates(mockPrismaClient);

      assert.ok(upsertCalls.length >= 4, "Must attempt to upsert all default templates");
      for (const call of upsertCalls) {
        assert.deepStrictEqual(
          call.update,
          {},
          "Update clause must be empty to avoid overwriting administrative INACTIVE or customized settings",
        );
        assert.ok(call.create.code, "Must provide full create definition for missing templates");
      }
    });
  });
});

