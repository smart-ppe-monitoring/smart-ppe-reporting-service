import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getIsoWeekString } from "../src/common/helpers/date.helper";
import { ReportingRepository } from "../src/modules/reporting/reporting.repository";
import { ReportingService } from "../src/modules/reporting/reporting.service";
import { STATISTIC_GROUP_BY } from "../src/common/constants/reporting.constant";

describe("Security Patch Verification: SEC-36, SEC-37, SEC-38", () => {
  // ── SEC-36: Violation Statistics Pipeline ──────────────────────────────────
  describe("SEC-36: Violation Statistics Ingestion Pipeline Populating Dashboards", () => {
    it("ingestViolationStatistic calls upsertReportStatistic with proper normalized date and increment flag", async () => {
      let upsertPayload: any = null;
      const mockRepo = {
        upsertReportStatistic: async (data: any) => {
          upsertPayload = data;
          return { id: "stat-1", ...data };
        },
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepo);

      await service.ingestViolationStatistic({
        siteId: "018f0a00-0000-7000-8000-000000000001",
        cameraId: "018f0a00-0000-7000-8000-000000000002",
        violationType: "NO_HARD_HAT",
        severity: "HIGH",
        statDate: "2026-10-15",
        totalCount: 5,
        confirmedCount: 3,
        resolvedCount: 2,
      });

      assert(upsertPayload);
      assert.equal(upsertPayload.siteId, "018f0a00-0000-7000-8000-000000000001");
      assert.equal(upsertPayload.cameraId, "018f0a00-0000-7000-8000-000000000002");
      assert.equal(upsertPayload.violationType, "NO_HARD_HAT");
      assert.equal(upsertPayload.severity, "HIGH");
      assert.equal(upsertPayload.totalCount, 5);
      assert.equal(upsertPayload.confirmedCount, 3);
      assert.equal(upsertPayload.resolvedCount, 2);
      assert.equal(upsertPayload.increment, true);
    });

    it("handleViolationDetectedEvent parses event payload and updates report statistics per violation", async () => {
      const recorded: any[] = [];
      const mockRepo = {
        upsertReportStatistic: async (data: any) => {
          recorded.push(data);
          return { id: `stat-${recorded.length}`, ...data };
        },
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepo);

      const fakeKafkaEvent = {
        eventId: "018f0a00-0000-7000-8000-000000000099",
        topic: "ppe.violation.detected",
        traceId: "req-trace-123",
        timestamp: Date.now(),
        payload: {
          violationId: "018f0a00-0000-7000-8000-000000000088",
          timestamp: new Date().toISOString(),
          site: { id: "site-alpha", code: "SA", name: "Site Alpha" },
          camera: { id: "cam-gate-1", code: "CG1", name: "Gate 1", zone: "Zone A" },
          violations: [
            { violationType: "NO_HARD_HAT", severity: "HIGH" },
            { violationType: "NO_SAFETY_VEST", severity: "MEDIUM" },
          ],
          summary: { totalPersons: 1, totalViolations: 2, highestSeverity: "HIGH" },
        },
      };

      await service.handleViolationDetectedEvent(fakeKafkaEvent);

      assert.equal(recorded.length, 2);
      assert.equal(recorded[0].violationType, "NO_HARD_HAT");
      assert.equal(recorded[0].siteId, "site-alpha");
      assert.equal(recorded[0].cameraId, "cam-gate-1");
      assert.equal(recorded[1].violationType, "NO_SAFETY_VEST");
    });

    it("repository upsertReportStatistic correctly handles increment updates when existing record exists", async () => {
      const repo = new ReportingRepository();
      let updateData: any = null;
      const mockPrisma = {
        reportStatistic: {
          findFirst: async () => ({
            id: "existing-rep-stat",
            siteId: "site-1",
            cameraId: "cam-1",
            violationType: "NO_HARD_HAT",
            severity: "HIGH",
            statDate: new Date("2026-10-15"),
            totalCount: 10,
            confirmedCount: 6,
            resolvedCount: 4,
          }),
          update: async (args: any) => {
            updateData = args.data;
            return { id: args.where.id, ...args.data };
          },
        },
      };
      Object.defineProperty(repo, "prisma", { get: () => mockPrisma, configurable: true });

      await repo.upsertReportStatistic({
        siteId: "site-1",
        cameraId: "cam-1",
        violationType: "NO_HARD_HAT",
        severity: "HIGH",
        statDate: new Date("2026-10-15"),
        totalCount: 2,
        confirmedCount: 1,
        resolvedCount: 1,
        increment: true,
      });

      assert.deepEqual(updateData.totalCount, { increment: 2 });
      assert.deepEqual(updateData.confirmedCount, { increment: 1 });
      assert.deepEqual(updateData.resolvedCount, { increment: 1 });
    });
  });

  // ── SEC-37: ISO 8601 Week Calculation ──────────────────────────────────────
  describe("SEC-37: Standard ISO 8601 Week Calculation Preventing Invalid Week Numbers", () => {
    it("maps 2022-12-31 to 2022-W52 and never produces invalid weeks like 2022-W54", () => {
      const dec31 = new Date("2022-12-31T12:00:00Z");
      const weekStr = getIsoWeekString(dec31);

      assert.notEqual(weekStr, "2022-W54");
      assert.equal(weekStr, "2022-W52");
    });

    it("correctly maps 2023-01-01 (Sunday) to 2022-W52 according to ISO 8601 rules", () => {
      const jan1 = new Date("2023-01-01T12:00:00Z");
      const weekStr = getIsoWeekString(jan1);

      assert.equal(weekStr, "2022-W52");
    });

    it("correctly maps 2024-01-01 (Monday) to 2024-W01", () => {
      const jan1 = new Date("2024-01-01T12:00:00Z");
      const weekStr = getIsoWeekString(jan1);

      assert.equal(weekStr, "2024-W01");
    });

    it("getIncidentTrends groups weekly data by ISO 8601 standard week string", async () => {
      const repo = new ReportingRepository();
      const mockPrisma = {
        incidentStatistic: {
          findMany: async () => [
            {
              siteId: "site-1",
              statDate: new Date("2022-12-31"),
              totalIncidents: 5,
              openIncidents: 1,
              resolvedIncidents: 4,
              falseAlarms: 1,
              trueViolations: 4,
            },
          ],
        },
      };
      Object.defineProperty(repo, "prisma", { get: () => mockPrisma, configurable: true });

      const trends = await repo.getIncidentTrends({
        siteId: "site-1",
        groupBy: STATISTIC_GROUP_BY.WEEK,
      });

      assert.equal(trends.length, 1);
      assert.equal(trends[0].date, "2022-W52");
      assert.notEqual(trends[0].date, "2022-W54");
    });
  });

  // ── SEC-38: Camera Rankings False Alarm Metric Classification ──────────────
  describe("SEC-38: Camera Rankings Formula Accurately Classifying False Alarms", () => {
    it("does not classify unreviewed incidents as false alarms when confirmedCount is 0", async () => {
      const repo = new ReportingRepository();
      const mockPrisma = {
        reportStatistic: {
          findMany: async () => [
            {
              id: "stat-cam-1",
              siteId: "site-1",
              cameraId: "cam-unreviewed-123",
              violationType: "NO_HARD_HAT",
              severity: "HIGH",
              statDate: new Date("2026-10-01"),
              totalCount: 10,
              confirmedCount: 0, // Unreviewed
              resolvedCount: 0,
            },
          ],
        },
      };
      Object.defineProperty(repo, "prisma", { get: () => mockPrisma, configurable: true });

      const rankings = await repo.getCameraRankings({ siteId: "site-1" });

      assert.equal(rankings.length, 1);
      assert.equal(rankings[0].cameraId, "cam-unreviewed-123");
      assert.equal(rankings[0].totalViolations, 10);
      assert.equal(rankings[0].confirmedCount, 0);
      // Under previous buggy formula: Math.max(0, 10 - 0) = 10 false alarms!
      // Under corrected formula: unreviewed violations are NOT classified as false alarms
      assert.equal(rankings[0].falseAlarmCount, 0);
    });

    it("respects explicit falseAlarmCount when present on the report statistic record", async () => {
      const repo = new ReportingRepository();
      const mockPrisma = {
        reportStatistic: {
          findMany: async () => [
            {
              id: "stat-cam-2",
              siteId: "site-1",
              cameraId: "cam-verified-456",
              violationType: "NO_SAFETY_VEST",
              severity: "MEDIUM",
              statDate: new Date("2026-10-01"),
              totalCount: 10,
              confirmedCount: 7,
              resolvedCount: 7,
              falseAlarmCount: 3, // Explicit false alarm count
            },
          ],
        },
      };
      Object.defineProperty(repo, "prisma", { get: () => mockPrisma, configurable: true });

      const rankings = await repo.getCameraRankings({ siteId: "site-1" });

      assert.equal(rankings.length, 1);
      assert.equal(rankings[0].totalViolations, 10);
      assert.equal(rankings[0].confirmedCount, 7);
      assert.equal(rankings[0].falseAlarmCount, 3);
    });

    it("correctly sorts camera rankings in descending order by totalViolations", async () => {
      const repo = new ReportingRepository();
      const mockPrisma = {
        reportStatistic: {
          findMany: async () => [
            {
              id: "stat-1",
              siteId: "site-1",
              cameraId: "cam-low-traffic",
              violationType: "NO_HARD_HAT",
              severity: "HIGH",
              statDate: new Date("2026-10-01"),
              totalCount: 3,
              confirmedCount: 3,
              resolvedCount: 3,
            },
            {
              id: "stat-2",
              siteId: "site-1",
              cameraId: "cam-high-risk",
              violationType: "NO_HARD_HAT",
              severity: "HIGH",
              statDate: new Date("2026-10-01"),
              totalCount: 25,
              confirmedCount: 20,
              resolvedCount: 18,
            },
          ],
        },
      };
      Object.defineProperty(repo, "prisma", { get: () => mockPrisma, configurable: true });

      const rankings = await repo.getCameraRankings({ siteId: "site-1" });

      assert.equal(rankings.length, 2);
      assert.equal(rankings[0].cameraId, "cam-high-risk");
      assert.equal(rankings[0].totalViolations, 25);
      assert.equal(rankings[1].cameraId, "cam-low-traffic");
      assert.equal(rankings[1].totalViolations, 3);
    });
  });
});
