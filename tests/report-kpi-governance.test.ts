import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ReportingService } from "../src/modules/reporting/reporting.service";
import { ReportingRepository } from "../src/modules/reporting/reporting.repository";
import { AppError } from "../src/common/errors/app-error";
import { ERROR_CODE } from "../src/common/errors/error-code";
import { REPORT_TEMPLATE_STATUS, REPORT_TYPE } from "../src/common/constants/reporting.constant";
import { ROLES } from "../src/common/constants/role.constant";

describe("Security Patch Verification: SEC-23, SEC-24, SEC-25, SEC-26", () => {
  // ── SEC-23: Inactive Report Template Lifecycle Bypass ───────────────────────
  describe("SEC-23: Inactive Report Template Lifecycle Bypass in Report Generation", () => {
    it("rejects report generation when template status is INACTIVE with 400 VALIDATION_ERROR", async () => {
      const mockRepo = {
        findReportTemplateById: async (id: string) => ({
          id,
          name: "Decommissioned Monthly Template",
          code: "DECOMMISSIONED_MONTHLY",
          status: REPORT_TEMPLATE_STATUS.INACTIVE,
          fileType: "PDF",
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        createReportGeneration: async () => assert.fail("createReportGeneration should not be called"),
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepo);

      await assert.rejects(
        async () => {
          await service.generateReport({
            templateId: "018f0a00-0000-7000-8000-000000000001",
            siteId: "018f0a00-0000-7000-8000-000000000002",
            reportType: REPORT_TYPE.MONTHLY,
            periodStart: "2026-10-01",
            periodEnd: "2026-10-31",
          });
        },
        (err: any) => {
          assert(err instanceof AppError);
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, ERROR_CODE.VALIDATION_ERROR);
          assert.match(err.message, /vô hiệu hóa/);
          return true;
        },
      );
    });

    it("allows report generation when template status is ACTIVE", async () => {
      let createdDto: any = null;
      const mockRepo = {
        findReportTemplateById: async (id: string) => ({
          id,
          name: "Active Monthly Safety Template",
          code: "ACTIVE_MONTHLY",
          status: REPORT_TEMPLATE_STATUS.ACTIVE,
          fileType: "PDF",
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        createReportGeneration: async (dto: any, actorId: string) => {
          createdDto = { dto, actorId };
          return {
            id: "018f0a00-0000-7000-8000-000000000099",
            templateId: dto.templateId,
            siteId: dto.siteId,
            reportType: dto.reportType,
            periodStart: dto.periodStart,
            periodEnd: dto.periodEnd,
            generatedBy: actorId,
            status: "COMPLETED",
            fileName: "report_monthly.pdf",
            generatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };
        },
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepo);

      const result = await service.generateReport(
        {
          templateId: "018f0a00-0000-7000-8000-000000000001",
          siteId: "018f0a00-0000-7000-8000-000000000002",
          reportType: REPORT_TYPE.MONTHLY,
          periodStart: "2026-10-01",
          periodEnd: "2026-10-31",
        },
        { actorId: "018f0a00-0000-7000-8000-000000000777" },
      );

      assert.equal(result.id, "018f0a00-0000-7000-8000-000000000099");
      assert.equal(createdDto.actorId, "018f0a00-0000-7000-8000-000000000777");
    });

    it("rejects report generation when template is not found with 404 REPORT_TEMPLATE_NOT_FOUND", async () => {
      const mockRepo = {
        findReportTemplateById: async () => null,
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepo);

      await assert.rejects(
        async () => {
          await service.generateReport({
            templateId: "018f0a00-0000-7000-8000-000000000001",
            siteId: "018f0a00-0000-7000-8000-000000000002",
            reportType: REPORT_TYPE.MONTHLY,
            periodStart: "2026-10-01",
            periodEnd: "2026-10-31",
          });
        },
        (err: any) => {
          assert(err instanceof AppError);
          assert.equal(err.statusCode, 404);
          assert.equal(err.code, ERROR_CODE.REPORT_TEMPLATE_NOT_FOUND);
          return true;
        },
      );
    });
  });

  // ── SEC-24: Broken Cross-Service Download Contract ──────────────────────────
  describe("SEC-24: Broken Cross-Service Download Contract Leading to 404 on Exported Reports", () => {
    const sampleReport = {
      id: "018f0a00-0000-7000-8000-000000000088",
      templateId: "018f0a00-0000-7000-8000-000000000001",
      siteId: "018f0a00-0000-7000-8000-000000000002",
      reportType: "MONTHLY",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      generatedBy: "018f0a00-0000-7000-8000-000000000123",
      status: "COMPLETED",
      fileName: "monthly_safety_report.pdf",
      generatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    it("returns downloadUrl pointing to local reporting service content endpoint instead of foreign media service", async () => {
      const mockRepo = {
        findReportGenerationById: async (id: string) => (id === sampleReport.id ? sampleReport : null),
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepo);

      const downloadInfo = await service.getReportGenerationDownload(
        sampleReport.id,
        "018f0a00-0000-7000-8000-000000000123",
        ROLES.SITE_MANAGER,
      );

      // Must NOT point to /api/v1/files/download/... which routes to media service
      assert.notEqual(downloadInfo.downloadUrl, `/api/v1/files/download/${sampleReport.id}`);
      assert.equal(downloadInfo.downloadUrl, `/api/v1/reports/${sampleReport.id}/content`);
      assert.equal(downloadInfo.contentType, "application/pdf");
      assert.equal(downloadInfo.fileName, "monthly_safety_report.pdf");
    });

    it("serves actual report file content and binary buffer via getReportGenerationContent", async () => {
      const mockRepo = {
        findReportGenerationById: async (id: string) => (id === sampleReport.id ? sampleReport : null),
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepo);

      const contentResult = await service.getReportGenerationContent(
        sampleReport.id,
        "018f0a00-0000-7000-8000-000000000123",
        ROLES.SITE_MANAGER,
      );

      assert(Buffer.isBuffer(contentResult.content));
      assert(contentResult.content.length > 0);
      assert.equal(contentResult.contentType, "application/pdf");
      assert.equal(contentResult.fileName, "monthly_safety_report.pdf");
      assert(contentResult.content.toString("utf-8").startsWith("%PDF-1.4"));
    });

    it("enforces BOLA protection rejecting unauthorized users attempting to access content", async () => {
      const mockRepo = {
        findReportGenerationById: async (id: string) => (id === sampleReport.id ? sampleReport : null),
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepo);

      await assert.rejects(
        async () => {
          await service.getReportGenerationContent(
            sampleReport.id,
            "018f0a00-0000-7000-8000-000000000999", // Other user
            ROLES.OPERATOR,
          );
        },
        (err: any) => {
          assert(err instanceof AppError);
          assert.equal(err.statusCode, 403);
          assert.equal(err.code, ERROR_CODE.FORBIDDEN);
          return true;
        },
      );
    });
  });

  // ── SEC-25 & SEC-26: KPI Calculation Correctness ───────────────────────────
  describe("SEC-25: Elimination of Hardcoded 2.5-Hour Mean Time to Resolve (MTTR)", () => {
    it("returns 0 hours MTTR when resolvedIncidents is 0", async () => {
      const repo = new ReportingRepository();
      const mockPrisma = {
        incidentStatistic: {
          findMany: async () => [
            {
              siteId: "018f0a00-0000-7000-8000-000000000001",
              statDate: new Date("2026-10-01"),
              totalIncidents: 10,
              openIncidents: 10,
              resolvedIncidents: 0,
              falseAlarms: 2,
              trueViolations: 8,
            },
          ],
        },
      };
      Object.defineProperty(repo, "prisma", { get: () => mockPrisma, configurable: true });

      const summary = await repo.getIncidentSummary({ siteId: "018f0a00-0000-7000-8000-000000000001" });

      assert.equal(summary.resolvedIncidents, 0);
      assert.equal(summary.meanTimeToResolveHours, 0);
    });

    it("does not fabricate static 2.5h constant when incidents are resolved", async () => {
      const repo = new ReportingRepository();
      const mockPrisma = {
        incidentStatistic: {
          findMany: async () => [
            {
              siteId: "018f0a00-0000-7000-8000-000000000001",
              statDate: new Date("2026-10-01"),
              totalIncidents: 15,
              openIncidents: 5,
              resolvedIncidents: 10,
              falseAlarms: 3,
              trueViolations: 12,
            },
          ],
        },
      };
      Object.defineProperty(repo, "prisma", { get: () => mockPrisma, configurable: true });

      const summary = await repo.getIncidentSummary({ siteId: "018f0a00-0000-7000-8000-000000000001" });

      assert.equal(summary.resolvedIncidents, 10);
      // Falsified constant 2.5 must not be returned
      assert.notEqual(summary.meanTimeToResolveHours, 2.5);
    });
  });

  describe("SEC-26: Mathematically Correct Linear Compliance Rate Formula (0% - 100%)", () => {
    it("evaluates complianceRate to 0% when 100% of incidents are true violations", async () => {
      const repo = new ReportingRepository();
      const mockPrisma = {
        incidentStatistic: {
          findMany: async () => [
            {
              siteId: "018f0a00-0000-7000-8000-000000000001",
              statDate: new Date("2026-10-01"),
              totalIncidents: 10,
              openIncidents: 0,
              resolvedIncidents: 10,
              falseAlarms: 0,
              trueViolations: 10,
            },
          ],
        },
      };
      Object.defineProperty(repo, "prisma", { get: () => mockPrisma, configurable: true });

      const summary = await repo.getIncidentSummary({ siteId: "018f0a00-0000-7000-8000-000000000001" });

      // Previously: 100 - (10 / (10 * 1.5)) * 100 = 33.33% (concealing total failure)
      // Correct mathematical formula: 100 - (10 / 10) * 100 = 0%
      assert.equal(summary.complianceRate, 0);
    });

    it("evaluates complianceRate to 100% when there are 0 true violations", async () => {
      const repo = new ReportingRepository();
      const mockPrisma = {
        incidentStatistic: {
          findMany: async () => [
            {
              siteId: "018f0a00-0000-7000-8000-000000000001",
              statDate: new Date("2026-10-01"),
              totalIncidents: 10,
              openIncidents: 0,
              resolvedIncidents: 10,
              falseAlarms: 10,
              trueViolations: 0,
            },
          ],
        },
      };
      Object.defineProperty(repo, "prisma", { get: () => mockPrisma, configurable: true });

      const summary = await repo.getIncidentSummary({ siteId: "018f0a00-0000-7000-8000-000000000001" });

      assert.equal(summary.complianceRate, 100);
    });

    it("evaluates complianceRate to exactly 50% when half of the incidents are true violations", async () => {
      const repo = new ReportingRepository();
      const mockPrisma = {
        incidentStatistic: {
          findMany: async () => [
            {
              siteId: "018f0a00-0000-7000-8000-000000000001",
              statDate: new Date("2026-10-01"),
              totalIncidents: 10,
              openIncidents: 5,
              resolvedIncidents: 5,
              falseAlarms: 5,
              trueViolations: 5,
            },
          ],
        },
      };
      Object.defineProperty(repo, "prisma", { get: () => mockPrisma, configurable: true });

      const summary = await repo.getIncidentSummary({ siteId: "018f0a00-0000-7000-8000-000000000001" });

      // Previously: 100 - (5 / 15) * 100 = 66.67%
      // Correct mathematical formula: 100 - (5 / 10) * 100 = 50%
      assert.equal(summary.complianceRate, 50);
    });

    it("evaluates complianceRate to 100% when totalIncidents is 0", async () => {
      const repo = new ReportingRepository();
      const mockPrisma = {
        incidentStatistic: {
          findMany: async () => [],
        },
      };
      Object.defineProperty(repo, "prisma", { get: () => mockPrisma, configurable: true });

      const summary = await repo.getIncidentSummary({ siteId: "018f0a00-0000-7000-8000-000000000001" });

      assert.equal(summary.complianceRate, 100);
    });
  });
});
