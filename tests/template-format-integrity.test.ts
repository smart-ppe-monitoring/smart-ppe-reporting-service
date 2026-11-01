import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderTemplateString, escapeHtml } from "../src/common/helpers/template.helper";
import { ReportingRepository } from "../src/modules/reporting/reporting.repository";
import { ReportingService } from "../src/modules/reporting/reporting.service";
import { REPORT_TYPE } from "../src/common/constants/reporting.constant";
import { ROLES } from "../src/common/constants/role.constant";

describe("Security Patch Verification: SEC-33 & SEC-35", () => {
  // ── SEC-33: Prototype Property Leakage in Template Helper ───────────────────
  describe("SEC-33: Prototype Property Leakage in Template Placeholder Replacement Engine", () => {
    it("does not leak [native code] for Object.prototype properties (toString, valueOf, constructor)", () => {
      const template = "Report {{toString}} and {{valueOf}} and {{constructor}}";
      const variables = { title: "Safety Weekly" };

      const rendered = renderTemplateString(template, variables);

      // Must not contain any function representations or prototype properties
      assert.doesNotMatch(rendered, /function/);
      assert.doesNotMatch(rendered, /\[native code\]/);
      assert.doesNotMatch(rendered, /Object/);
      assert.equal(rendered, "Report  and  and ");
    });

    it("correctly renders owned variables and leaves non-owned prototype placeholders blank", () => {
      const template = "Site: {{siteName}}, Code: {{code}}, Prototype: {{hasOwnProperty}}";
      const variables = {
        siteName: "Factory A",
        code: "FA-01",
      };

      const rendered = renderTemplateString(template, variables);

      assert.equal(rendered, "Site: Factory A, Code: FA-01, Prototype: ");
    });

    it("supports explicitly assigned custom properties even if their key matches a prototype name", () => {
      const template = "Custom: {{toString}}";
      const variables = Object.create(null);
      variables.toString = "Custom String Value";

      const rendered = renderTemplateString(template, variables);

      assert.equal(rendered, "Custom: Custom String Value");
    });

    it("handles null, undefined, or empty variables safely without throwing", () => {
      assert.equal(renderTemplateString("Template {{key}}", undefined as any), "Template ");
      assert.equal(renderTemplateString("Template {{key}}", null as any), "Template ");
      assert.equal(renderTemplateString("", { key: "val" }), "");
    });

    it("escapes special HTML characters by default to prevent XSS injection", () => {
      const template = "Alert: {{message}}";
      const variables = { message: "<script>alert('xss')</script> & 'quotes'" };

      const rendered = renderTemplateString(template, variables);

      assert.equal(
        rendered,
        "Alert: &lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt; &amp; &#039;quotes&#039;",
      );
    });
  });

  // ── SEC-35: Dynamic File Extension & MIME Type for Non-PDF Templates ─────────
  describe("SEC-35: Hardcoded PDF Extension and MIME Type Overriding Non-PDF Report Templates", () => {
    it("dynamically assigns .xlsx extension for EXCEL template in createReportGeneration", async () => {
      const repo = new ReportingRepository();
      let createdData: any = null;
      const mockPrisma = {
        reportTemplate: {
          findUnique: async () => ({
            id: "018f0a00-0000-7000-8000-000000000010",
            name: "Excel Safety Matrix",
            code: "EXCEL_MATRIX",
            fileType: "EXCEL",
          }),
        },
        reportGeneration: {
          create: async (args: any) => {
            createdData = args.data;
            return {
              id: "018f0a00-0000-7000-8000-000000000099",
              ...args.data,
              generatedAt: new Date(),
              createdAt: new Date(),
              template: {
                id: args.data.templateId,
                name: "Excel Safety Matrix",
                code: "EXCEL_MATRIX",
                fileType: "EXCEL",
                version: 1,
                status: "ACTIVE",
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            };
          },
        },
      };
      Object.defineProperty(repo, "prisma", { get: () => mockPrisma, configurable: true });

      const gen = await repo.createReportGeneration(
        {
          templateId: "018f0a00-0000-7000-8000-000000000010",
          siteId: "018f0a00-0000-7000-8000-000000000002",
          reportType: REPORT_TYPE.MONTHLY,
          periodStart: "2026-10-01",
          periodEnd: "2026-10-31",
        },
        "018f0a00-0000-7000-8000-000000000123",
        "EXCEL",
      );

      assert(createdData.fileName.endsWith(".xlsx"));
      assert(createdData.filePath.endsWith(".xlsx"));
      assert(gen.fileName?.endsWith(".xlsx"));
    });

    it("dynamically assigns .csv extension for CSV template in createReportGeneration", async () => {
      const repo = new ReportingRepository();
      let createdData: any = null;
      const mockPrisma = {
        reportTemplate: {
          findUnique: async () => ({
            id: "018f0a00-0000-7000-8000-000000000020",
            name: "CSV Incident Raw Log",
            code: "CSV_RAW",
            fileType: "CSV",
          }),
        },
        reportGeneration: {
          create: async (args: any) => {
            createdData = args.data;
            return {
              id: "018f0a00-0000-7000-8000-000000000088",
              ...args.data,
              generatedAt: new Date(),
              createdAt: new Date(),
              template: {
                id: args.data.templateId,
                name: "CSV Incident Raw Log",
                code: "CSV_RAW",
                fileType: "CSV",
                version: 1,
                status: "ACTIVE",
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            };
          },
        },
      };
      Object.defineProperty(repo, "prisma", { get: () => mockPrisma, configurable: true });

      const gen = await repo.createReportGeneration(
        {
          templateId: "018f0a00-0000-7000-8000-000000000020",
          siteId: "018f0a00-0000-7000-8000-000000000002",
          reportType: REPORT_TYPE.DAILY,
          periodStart: "2026-10-01",
          periodEnd: "2026-10-01",
        },
        "018f0a00-0000-7000-8000-000000000123",
        "CSV",
      );

      assert(createdData.fileName.endsWith(".csv"));
      assert(createdData.filePath.endsWith(".csv"));
      assert(gen.fileName?.endsWith(".csv"));
    });

    it("returns correct MIME type and extension for CSV, EXCEL, and JSON downloads", async () => {
      const mockRepo = {
        findReportGenerationById: async (id: string) => {
          if (id === "csv-report") {
            return {
              id: "csv-report",
              templateId: "tmpl-csv",
              siteId: "site-1",
              reportType: "DAILY",
              periodStart: "2026-10-01",
              periodEnd: "2026-10-01",
              generatedBy: "user-1",
              status: "COMPLETED",
              fileName: "report_daily.csv",
              template: { id: "tmpl-csv", fileType: "CSV" },
            };
          }
          if (id === "excel-report") {
            return {
              id: "excel-report",
              templateId: "tmpl-excel",
              siteId: "site-1",
              reportType: "MONTHLY",
              periodStart: "2026-10-01",
              periodEnd: "2026-10-31",
              generatedBy: "user-1",
              status: "COMPLETED",
              fileName: "report_monthly.xlsx",
              template: { id: "tmpl-excel", fileType: "EXCEL" },
            };
          }
          if (id === "json-report") {
            return {
              id: "json-report",
              templateId: "tmpl-json",
              siteId: "site-1",
              reportType: "VIOLATION_SUMMARY",
              periodStart: "2026-10-01",
              periodEnd: "2026-10-31",
              generatedBy: "user-1",
              status: "COMPLETED",
              fileName: "report_violations.json",
              template: { id: "tmpl-json", fileType: "JSON" },
            };
          }
          return null;
        },
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepo);

      // CSV download check
      const csvDownload = await service.getReportGenerationDownload("csv-report", "user-1", ROLES.ADMIN);
      assert.equal(csvDownload.contentType, "text/csv");
      assert(csvDownload.fileName.endsWith(".csv"));

      // Excel download check
      const excelDownload = await service.getReportGenerationDownload("excel-report", "user-1", ROLES.ADMIN);
      assert.equal(
        excelDownload.contentType,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      assert(excelDownload.fileName.endsWith(".xlsx"));

      // JSON download check
      const jsonDownload = await service.getReportGenerationDownload("json-report", "user-1", ROLES.ADMIN);
      assert.equal(jsonDownload.contentType, "application/json");
      assert(jsonDownload.fileName.endsWith(".json"));

      // Content streaming checks
      const csvContent = await service.getReportGenerationContent("csv-report", "user-1", ROLES.ADMIN);
      assert.equal(csvContent.contentType, "text/csv");
      assert(csvContent.content.toString("utf-8").includes("reportId,reportType,siteId"));

      const jsonContent = await service.getReportGenerationContent("json-report", "user-1", ROLES.ADMIN);
      assert.equal(jsonContent.contentType, "application/json");
      const parsedJson = JSON.parse(jsonContent.content.toString("utf-8"));
      assert.equal(parsedJson.reportId, "json-report");

      const excelContent = await service.getReportGenerationContent("excel-report", "user-1", ROLES.ADMIN);
      assert.equal(
        excelContent.contentType,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      assert(excelContent.content.toString("utf-8").startsWith("PK"));
    });
  });
});
