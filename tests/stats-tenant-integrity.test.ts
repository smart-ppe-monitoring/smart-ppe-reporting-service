import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  dashboardFilterSchema,
  trendsFilterSchema,
  cameraStatsFilterSchema,
  aiPerformanceFilterSchema,
  isDateRangeWithinDays,
} from "../src/modules/reporting/reporting.validation";
import { ReportingRepository } from "../src/modules/reporting/reporting.repository";
import { ReportingService } from "../src/modules/reporting/reporting.service";
import { AppError } from "../src/common/errors/app-error";
import { ERROR_CODE } from "../src/common/errors/error-code";
import { ROLES } from "../src/common/constants/role.constant";

describe("Security Patch Verification: SEC-07, SEC-11, SEC-12, SEC-13", () => {
  describe("SEC-07: Destructive Historical Metric Zeroing Prevention", () => {
    test("rejects overwriting historical incident statistics when totalIncidents > 0", async () => {
      const mockRepo: any = {
        findIncidentStatistic: async (siteId: string, statDate: Date) => ({
          id: "0192e21b-8321-789a-bcde-000000000010",
          siteId,
          statDate,
          totalIncidents: 15,
          openIncidents: 2,
          resolvedIncidents: 10,
          falseAlarms: 3,
          trueViolations: 12,
        }),
      };

      const service = new ReportingService(mockRepo);

      await assert.rejects(
        async () => {
          await service.aggregateDailyStats({
            siteId: "0192e21b-8321-789a-bcde-000000000001",
            statDate: "2026-10-15",
          });
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 409);
          assert.equal(err.code, ERROR_CODE.DUPLICATE_ENTRY);
          assert.ok(err.message.includes("không thể ghi đè"));
          return true;
        },
      );
    });

    test("allows daily aggregation when no prior record exists or totalIncidents is 0", async () => {
      let upsertCalled = false;
      const mockRepo: any = {
        findIncidentStatistic: async () => null,
        upsertIncidentStatistic: async (data: any) => {
          upsertCalled = true;
          return { id: "stat-1", ...data };
        },
      };

      const service = new ReportingService(mockRepo);
      const res = await service.aggregateDailyStats({
        siteId: "0192e21b-8321-789a-bcde-000000000001",
        statDate: "2026-10-15",
      });

      assert.equal(upsertCalled, true);
      assert.equal(res.id, "stat-1");
    });
  });

  describe("SEC-11: Cross-Site Broken Object Level Authorization (BOLA)", () => {
    const siteA = "0192e21b-8321-789a-bcde-000000000001";
    const siteB = "0192e21b-8321-789a-bcde-000000000002";

    test("rejects non-admin user querying statistics for unauthorized site with 403 FORBIDDEN", async () => {
      const mockRepo: any = {
        getIncidentSummary: async () => ({}),
      };
      const service = new ReportingService(mockRepo);

      const userSiteA = {
        role: ROLES.MANAGER,
        siteIds: [siteA],
      };

      await assert.rejects(
        async () => {
          await service.getDashboardSummary({ siteId: siteB }, userSiteA);
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 403);
          assert.equal(err.code, ERROR_CODE.FORBIDDEN);
          assert.ok(err.message.includes("không có quyền truy cập dữ liệu"));
          return true;
        },
      );
    });

    test("allows non-admin user querying statistics for their authorized site", async () => {
      let queriedSiteId: string | undefined = undefined;
      const mockRepo: any = {
        getIncidentSummary: async (filter: any) => {
          queriedSiteId = filter.siteId;
          return { totalIncidents: 5 };
        },
      };
      const service = new ReportingService(mockRepo);

      const userSiteA = {
        role: ROLES.MANAGER,
        siteIds: [siteA],
      };

      const res = await service.getDashboardSummary({ siteId: siteA }, userSiteA);
      assert.equal(queriedSiteId, siteA);
      assert.equal(res.totalIncidents, 5);
    });

    test("automatically scopes non-admin user query to their assigned site when siteId is omitted", async () => {
      let queriedSiteId: string | undefined = undefined;
      const mockRepo: any = {
        getIncidentSummary: async (filter: any) => {
          queriedSiteId = filter.siteId;
          return { totalIncidents: 3 };
        },
      };
      const service = new ReportingService(mockRepo);

      const userSiteA = {
        role: ROLES.MANAGER,
        siteIds: [siteA],
      };

      await service.getDashboardSummary({}, userSiteA);
      assert.equal(queriedSiteId, siteA);
    });

    test("allows administrator unrestricted access to query any site", async () => {
      let queriedSiteId: string | undefined = undefined;
      const mockRepo: any = {
        getIncidentSummary: async (filter: any) => {
          queriedSiteId = filter.siteId;
          return { totalIncidents: 10 };
        },
      };
      const service = new ReportingService(mockRepo);

      const adminUser = {
        role: ROLES.ADMIN,
      };

      const res = await service.getDashboardSummary({ siteId: siteB }, adminUser);
      assert.equal(queriedSiteId, siteB);
      assert.equal(res.totalIncidents, 10);
    });
  });

  describe("SEC-12: Multi-Tenant Report History Exposure & Path Leakage", () => {
    const siteA = "0192e21b-8321-789a-bcde-000000000001";
    const siteB = "0192e21b-8321-789a-bcde-000000000002";

    test("rejects non-admin user querying report history of another site with 403", async () => {
      const mockRepo: any = {
        findReportGenerations: async () => ({ data: [], meta: {} }),
      };
      const service = new ReportingService(mockRepo);

      const userSiteA = {
        role: ROLES.USER,
        siteIds: [siteA],
      };

      await assert.rejects(
        async () => {
          await service.listReportGenerations({ siteId: siteB }, userSiteA);
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 403);
          assert.equal(err.code, ERROR_CODE.FORBIDDEN);
          return true;
        },
      );
    });

    test("repository findReportGenerations omits internal filePath from serialized DTO", async () => {
      const mockPrisma: any = {
        reportGeneration: {
          count: async () => 1,
          findMany: async () => [
            {
              id: "0192e21b-8321-789a-bcde-000000000010",
              templateId: "0192e21b-8321-789a-bcde-000000000020",
              siteId: siteA,
              reportType: "DAILY",
              periodStart: new Date("2026-10-01"),
              periodEnd: new Date("2026-10-02"),
              generatedBy: "0192e21b-8321-789a-bcde-000000000030",
              status: "COMPLETED",
              filePath: "reports/siteA/internal-sensitive-path/report.pdf",
              fileName: "report.pdf",
              errorMessage: null,
              generatedAt: new Date(),
              createdAt: new Date(),
              template: null,
            },
          ],
        },
      };

      const repo = new ReportingRepository();
      Object.defineProperty(repo, "prisma", {
        get: () => mockPrisma,
        configurable: true,
      });

      const res = await repo.findReportGenerations({ siteId: siteA });
      assert.equal(res.data.length, 1);
      assert.equal(
        res.data[0].filePath,
        undefined,
        "Internal filePath must be omitted/undefined in client DTO",
      );
    });
  });

  describe("SEC-13: Unbounded Database Queries & Heap Memory DoS Prevention", () => {
    test("isDateRangeWithinDays helper correctly validates 90-day window", () => {
      assert.equal(
        isDateRangeWithinDays("2026-01-01", "2026-03-31", 90),
        true,
        "90-day range is valid",
      );
      assert.equal(
        isDateRangeWithinDays("2026-01-01", "2026-04-05", 90),
        false,
        "94-day range exceeds 90-day limit",
      );
      assert.equal(
        isDateRangeWithinDays("2026-01-01", "2027-01-01", 90),
        false,
        "1-year range exceeds 90-day limit",
      );
    });

    test("all statistics filter schemas reject ranges exceeding 90 days", () => {
      const wideDateRange = {
        startDate: "2026-01-01",
        endDate: "2026-06-01", // ~150 days
      };

      const validDateRange = {
        startDate: "2026-01-01",
        endDate: "2026-03-15", // ~73 days
      };

      // 1. Dashboard summary schema
      assert.equal(dashboardFilterSchema.safeParse(wideDateRange).success, false);
      assert.equal(dashboardFilterSchema.safeParse(validDateRange).success, true);

      // 2. Trends schema
      assert.equal(trendsFilterSchema.safeParse(wideDateRange).success, false);
      assert.equal(trendsFilterSchema.safeParse(validDateRange).success, true);

      // 3. Camera rankings schema
      assert.equal(cameraStatsFilterSchema.safeParse(wideDateRange).success, false);
      assert.equal(cameraStatsFilterSchema.safeParse(validDateRange).success, true);

      // 4. AI Performance schema
      assert.equal(aiPerformanceFilterSchema.safeParse(wideDateRange).success, false);
      assert.equal(aiPerformanceFilterSchema.safeParse(validDateRange).success, true);
    });

    test("repository queries include defensive take limit (5000) on findMany", async () => {
      let capturedIncidentTake: number | undefined;
      let capturedReportTake: number | undefined;

      const mockPrisma: any = {
        incidentStatistic: {
          findMany: async ({ take }: any) => {
            capturedIncidentTake = take;
            return [];
          },
        },
        reportStatistic: {
          findMany: async ({ take }: any) => {
            capturedReportTake = take;
            return [];
          },
        },
      };

      const repo = new ReportingRepository();
      Object.defineProperty(repo, "prisma", {
        get: () => mockPrisma,
        configurable: true,
      });

      await repo.getIncidentSummary({});
      assert.equal(capturedIncidentTake, 5000);

      await repo.getCameraRankings({});
      assert.equal(capturedReportTake, 5000);
    });
  });
});
