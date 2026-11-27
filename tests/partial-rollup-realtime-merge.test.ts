import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { ReportingRepository } from "../src/modules/reporting/reporting.repository";
import { ReportingService } from "../src/modules/reporting/reporting.service";
import { ReportingController } from "../src/modules/reporting/reporting.controller";
import { reportContentQuerySchema } from "../src/modules/reporting/reporting.validation";
import { STATISTIC_GROUP_BY } from "../src/common/constants/reporting.constant";
import { ROLES } from "../src/common/constants/role.constant";

describe("Issue #6: Partial Rollup + Real-time Merge for Multi-Day Statistics & Report Exports", () => {
  const siteA = "019447e1-8891-7000-8000-000000000001";
  const siteB = "019447e1-8891-7000-8000-000000000002";
  const cam1 = "019447e1-8892-7000-8000-000000000010";
  const cam2 = "019447e1-8892-7000-8000-000000000011";
  const cam3 = "019447e1-8892-7000-8000-000000000012";
  const userId = "019447e1-9999-7000-8000-000000000003";

  function createPartialRollupMockPrisma() {
    // 2026-11-25: 4 incidents (1 open, 1 resolved, 1 falseAlarm, 1 trueViolation)
    // 2026-11-26: 2 incidents (0 open, 1 resolved, 0 falseAlarm, 1 trueViolation)
    // 2026-11-27: NOT rolled up yet
    const incidentRows = [
      {
        siteId: siteA,
        statDate: new Date("2026-11-25T00:00:00.000Z"),
        totalIncidents: 4,
        openIncidents: 1,
        resolvedIncidents: 1,
        falseAlarms: 1,
        trueViolations: 1,
      },
      {
        siteId: siteA,
        statDate: new Date("2026-11-26T00:00:00.000Z"),
        totalIncidents: 2,
        openIncidents: 0,
        resolvedIncidents: 1,
        falseAlarms: 0,
        trueViolations: 1,
      },
    ];

    const reportRows = [
      {
        siteId: siteA,
        cameraId: cam1,
        violationType: "NO_HELMET",
        severity: "HIGH",
        statDate: new Date("2026-11-25T00:00:00.000Z"),
        totalCount: 3,
        confirmedCount: 1,
        resolvedCount: 1,
      },
      {
        siteId: siteA,
        cameraId: cam2,
        violationType: "NO_VEST",
        severity: "MEDIUM",
        statDate: new Date("2026-11-25T00:00:00.000Z"),
        totalCount: 1,
        confirmedCount: 0,
        resolvedCount: 0,
      },
      {
        siteId: siteA,
        cameraId: cam1,
        violationType: "NO_HELMET",
        severity: "CRITICAL",
        statDate: new Date("2026-11-26T00:00:00.000Z"),
        totalCount: 2,
        confirmedCount: 1,
        resolvedCount: 1,
      },
    ];

    return {
      incidentStatistic: {
        findMany: async () => incidentRows,
      },
      reportStatistic: {
        findMany: async ({ where }: any = {}) => {
          if (where?.cameraId?.not === null) {
            return reportRows.filter((r) => r.cameraId !== null);
          }
          return reportRows;
        },
      },
      aiPerformanceStatistic: {
        findMany: async () => [
          {
            id: "ai-stat-1",
            cameraId: cam1,
            modelVersionId: "019447e1-8894-7000-8000-000000000900",
            statDate: new Date("2026-11-26T00:00:00.000Z"),
            avgFps: 29.5,
            avgLatencyMs: 22.0,
            maxLatencyMs: 40,
            p95LatencyMs: 31.2,
            e2eAlertLatencyMs: 350.0,
            totalFrames: BigInt(120000),
          },
        ],
      },
    };
  }

  function createSampleRealtimeIncidents() {
    return [
      // Rolled-up days (2026-11-25 & 2026-11-26) -> MUST NOT be double-counted in totals
      {
        id: "inc-rolled-25-1",
        siteId: siteA,
        cameraId: cam1,
        status: "RESOLVED",
        violationType: "NO_HELMET",
        severity: "HIGH",
        detectedAt: "2026-11-25T02:00:00.000Z", // 2026-11-25 09:00 VN
        resolvedAt: "2026-11-25T02:30:00.000Z", // 30m
      },
      {
        id: "inc-rolled-26-1",
        siteId: siteA,
        cameraId: cam1,
        status: "RESOLVED",
        violationType: "NO_HELMET",
        severity: "CRITICAL",
        detectedAt: "2026-11-26T03:00:00.000Z", // 2026-11-26 10:00 VN
        resolvedAt: "2026-11-26T04:00:00.000Z", // 60m
      },
      // Unrolled day 2026-11-27 (including 01:00 VN = 18:00 UTC previous day) -> MUST be merged
      {
        id: "inc-unrolled-27-1",
        siteId: siteA,
        cameraId: cam1,
        status: "CONFIRMED",
        violationType: "NO_HELMET",
        severity: "CRITICAL",
        detectedAt: "2026-11-26T18:00:00.000Z", // 2026-11-27 01:00 VN
      },
      {
        id: "inc-unrolled-27-2",
        siteId: siteA,
        cameraId: cam3,
        status: "RESOLVED",
        violationType: "RESTRICTED_AREA",
        severity: "HIGH",
        detectedAt: "2026-11-27T02:00:00.000Z", // 2026-11-27 09:00 VN
        resolvedAt: "2026-11-27T02:30:00.000Z", // 30m
      },
      {
        id: "inc-unrolled-27-3",
        siteId: siteA,
        cameraId: cam2,
        status: "DISMISSED",
        violationType: "NO_VEST",
        severity: "LOW",
        detectedAt: "2026-11-27T04:00:00.000Z", // 2026-11-27 11:00 VN
      },
    ];
  }

  describe("1. Repository Partial Rollup Merge (No Double Counting)", () => {
    it("merges rolled-up past days + unrolled today across summary, trends (DAY/WEEK/MONTH), violation breakdown, and camera rankings", async () => {
      const repo = new ReportingRepository(createPartialRollupMockPrisma());
      const filter = {
        siteId: siteA,
        startDate: "2026-11-25",
        endDate: "2026-11-27",
      };
      const callOptions = {
        getRealtimeIncidents: async () => createSampleRealtimeIncidents(),
      };

      const [summary, trendsDay, trendsWeek, trendsMonth, breakdown, rankings] =
        await Promise.all([
          repo.getIncidentSummary(filter, callOptions),
          repo.getIncidentTrends(
            { ...filter, groupBy: STATISTIC_GROUP_BY.DAY },
            callOptions,
          ),
          repo.getIncidentTrends(
            { ...filter, groupBy: STATISTIC_GROUP_BY.WEEK },
            callOptions,
          ),
          repo.getIncidentTrends(
            { ...filter, groupBy: STATISTIC_GROUP_BY.MONTH },
            callOptions,
          ),
          repo.getViolationBreakdown(filter, callOptions),
          repo.getCameraRankings({ ...filter, limit: 10 }, callOptions),
        ]);

      // Summary: 6 rolled up + 3 unrolled = 9 total
      assert.equal(summary.totalIncidents, 9);
      assert.equal(summary.openIncidents, 1);
      assert.equal(summary.resolvedIncidents, 3);
      assert.equal(summary.trueViolations, 3);
      assert.equal(summary.falseAlarms, 2);
      // 2 / (3 + 2) * 100 = 40%
      assert.equal(summary.falseAlarmRate, 40);
      // 100 - (3 / 9) * 100 = 66.67%
      assert.equal(summary.complianceRate, 66.67);
      // Resolved MTTR: (30 + 60 + 30) / 3 = 40 mins = 0.67 hours
      assert.equal(summary.meanTimeToResolveHours, 0.67);

      // Severity breakdown: rolled (HIGH:3, MEDIUM:1, CRITICAL:2) + unrolled (CRITICAL:1, HIGH:1, LOW:1)
      assert.equal(summary.severityBreakdown.CRITICAL.count, 3);
      assert.equal(summary.severityBreakdown.CRITICAL.resolved, 1);
      assert.equal(summary.severityBreakdown.CRITICAL.actualMttrMinutes, 60);
      assert.equal(summary.severityBreakdown.HIGH.count, 4);
      assert.equal(summary.severityBreakdown.HIGH.resolved, 2);
      assert.equal(summary.severityBreakdown.HIGH.actualMttrMinutes, 30);
      assert.equal(summary.severityBreakdown.MEDIUM.count, 1);
      assert.equal(summary.severityBreakdown.LOW.count, 1);

      // Trends DAY: chronological 25, 26, 27
      assert.deepEqual(trendsDay, [
        {
          date: "2026-11-25",
          totalIncidents: 4,
          trueViolations: 1,
          falseAlarms: 1,
          resolvedCount: 1,
        },
        {
          date: "2026-11-26",
          totalIncidents: 2,
          trueViolations: 1,
          falseAlarms: 0,
          resolvedCount: 1,
        },
        {
          date: "2026-11-27",
          totalIncidents: 3,
          trueViolations: 1,
          falseAlarms: 1,
          resolvedCount: 1,
        },
      ]);

      // Trends WEEK: 2026-11-25..27 are all in ISO week 2026-W48
      assert.deepEqual(trendsWeek, [
        {
          date: "2026-W48",
          totalIncidents: 9,
          trueViolations: 3,
          falseAlarms: 2,
          resolvedCount: 3,
        },
      ]);

      // Trends MONTH: single 2026-11 bucket
      assert.deepEqual(trendsMonth, [
        {
          date: "2026-11",
          totalIncidents: 9,
          trueViolations: 3,
          falseAlarms: 2,
          resolvedCount: 3,
        },
      ]);

      // Violation breakdown: NO_HELMET (5+1=6), NO_VEST (1+1=2), RESTRICTED_AREA (1)
      const byType = new Map(breakdown.map((b) => [b.violationType, b]));
      assert.equal(byType.get("NO_HELMET")?.count, 6);
      assert.equal(byType.get("NO_HELMET")?.percentage, 66.67);
      assert.equal(byType.get("NO_HELMET")?.severityBreakdown.CRITICAL, 3);
      assert.equal(byType.get("NO_HELMET")?.severityBreakdown.HIGH, 3);

      assert.equal(byType.get("NO_VEST")?.count, 2);
      assert.equal(byType.get("NO_VEST")?.percentage, 22.22);
      assert.equal(byType.get("NO_VEST")?.severityBreakdown.MEDIUM, 1);
      assert.equal(byType.get("NO_VEST")?.severityBreakdown.LOW, 1);

      assert.equal(byType.get("RESTRICTED_AREA")?.count, 1);
      assert.equal(byType.get("RESTRICTED_AREA")?.percentage, 11.11);
      assert.equal(byType.get("RESTRICTED_AREA")?.severityBreakdown.HIGH, 1);

      // Camera rankings: cam1 (5+1=6), cam2 (1+1=2), cam3 (1)
      assert.deepEqual(rankings, [
        {
          cameraId: cam1,
          totalViolations: 6,
          confirmedCount: 3,
          falseAlarmCount: 0,
          resolvedCount: 2,
        },
        {
          cameraId: cam2,
          totalViolations: 2,
          confirmedCount: 0,
          falseAlarmCount: 1,
          resolvedCount: 0,
        },
        {
          cameraId: cam3,
          totalViolations: 1,
          confirmedCount: 0,
          falseAlarmCount: 0,
          resolvedCount: 1,
        },
      ]);
    });
  });

  describe("2. Narrowed HTTP Date Window, Mid-Range Gaps & Full-Rollup Skip", () => {
    it("narrows realtime fetch window to missing dates and inserts mid-range unrolled days chronologically", async () => {
      const mockPrisma = {
        incidentStatistic: {
          findMany: async () => [
            {
              siteId: siteA,
              statDate: new Date("2026-11-21T00:00:00.000Z"),
              totalIncidents: 2,
              openIncidents: 0,
              resolvedIncidents: 0,
              falseAlarms: 0,
              trueViolations: 2,
            },
            {
              siteId: siteA,
              statDate: new Date("2026-11-23T00:00:00.000Z"),
              totalIncidents: 3,
              openIncidents: 0,
              resolvedIncidents: 0,
              falseAlarms: 0,
              trueViolations: 3,
            },
          ],
        },
        reportStatistic: { findMany: async () => [] },
      };

      const capturedUrls: string[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: any) => {
        capturedUrls.push(String(input));
        return new Response(
          JSON.stringify({
            success: true,
            data: [
              // Already rolled up day 23 (must be ignored even if incident-service returned it)
              {
                id: "dup-23",
                siteId: siteA,
                status: "CONFIRMED",
                detectedAt: "2026-11-23T05:00:00.000Z",
              },
              // Mid-range unrolled gap day 22
              {
                id: "gap-22",
                siteId: siteA,
                status: "CONFIRMED",
                detectedAt: "2026-11-22T05:00:00.000Z",
              },
              // Tail unrolled day 24
              {
                id: "tail-24",
                siteId: siteA,
                status: "DISMISSED",
                detectedAt: "2026-11-24T05:00:00.000Z",
              },
            ],
            meta: { page: 1, limit: 100, total: 3, totalPages: 1 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      try {
        const repo = new ReportingRepository(mockPrisma);
        const trends = await repo.getIncidentTrends(
          {
            siteId: siteA,
            startDate: "2026-11-21",
            endDate: "2026-11-24",
            groupBy: STATISTIC_GROUP_BY.DAY,
          },
          { authHeader: "Bearer test-jwt" },
        );

        assert.equal(capturedUrls.length, 1);
        const reqUrl = new URL(capturedUrls[0]);
        // Narrowed from [21..24] to missing span [22..24]
        assert.equal(reqUrl.searchParams.get("fromDate"), "2026-11-21T17:00:00.000Z"); // 2026-11-22 00:00 VN
        assert.equal(reqUrl.searchParams.get("toDate"), "2026-11-24T16:59:59.999Z"); // 2026-11-24 23:59:59 VN

        assert.deepEqual(
          trends.map((t) => ({ date: t.date, total: t.totalIncidents })),
          [
            { date: "2026-11-21", total: 2 },
            { date: "2026-11-22", total: 1 },
            { date: "2026-11-23", total: 3 },
            { date: "2026-11-24", total: 1 },
          ],
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("skips realtime fetch completely when all days in range are rolled up and resolvedIncidents is 0", async () => {
      const mockPrisma = {
        incidentStatistic: {
          findMany: async () => [
            {
              siteId: siteA,
              statDate: new Date("2026-11-21T00:00:00.000Z"),
              totalIncidents: 2,
              openIncidents: 2,
              resolvedIncidents: 0,
              falseAlarms: 0,
              trueViolations: 0,
            },
            {
              siteId: siteA,
              statDate: new Date("2026-11-22T00:00:00.000Z"),
              totalIncidents: 1,
              openIncidents: 1,
              resolvedIncidents: 0,
              falseAlarms: 0,
              trueViolations: 0,
            },
          ],
        },
        reportStatistic: {
          findMany: async () => [
            {
              siteId: siteA,
              cameraId: cam1,
              violationType: "NO_HELMET",
              severity: "HIGH",
              statDate: new Date("2026-11-21T00:00:00.000Z"),
              totalCount: 2,
              confirmedCount: 0,
              resolvedCount: 0,
            },
            {
              siteId: siteA,
              cameraId: cam1,
              violationType: "NO_HELMET",
              severity: "HIGH",
              statDate: new Date("2026-11-22T00:00:00.000Z"),
              totalCount: 1,
              confirmedCount: 0,
              resolvedCount: 0,
            },
          ],
        },
      };

      let fetchCalls = 0;
      const repo = new ReportingRepository(mockPrisma);
      const callOptions = {
        getRealtimeIncidents: async () => {
          fetchCalls++;
          return [];
        },
      };

      const filter = {
        siteId: siteA,
        startDate: "2026-11-21",
        endDate: "2026-11-22",
      };

      const [summary, trends, breakdown, rankings] = await Promise.all([
        repo.getIncidentSummary(filter, callOptions),
        repo.getIncidentTrends(filter, callOptions),
        repo.getViolationBreakdown(filter, callOptions),
        repo.getCameraRankings(filter, callOptions),
      ]);

      assert.equal(fetchCalls, 0);
      assert.equal(summary.totalIncidents, 3);
      assert.equal(trends.length, 2);
      assert.equal(breakdown[0].count, 3);
      assert.equal(rankings[0].totalViolations, 3);
    });
  });

  describe("3. Zero-Count Placeholder Rows, Multi-Site Isolation & Incident-Service Outage", () => {
    it("treats zero-count placeholder rows as unrolled so realtime incidents for that day still merge", async () => {
      const mockPrisma = {
        incidentStatistic: {
          findMany: async () => [
            {
              siteId: siteA,
              statDate: new Date("2026-11-25T00:00:00.000Z"),
              totalIncidents: 3,
              openIncidents: 1,
              resolvedIncidents: 0,
              falseAlarms: 0,
              trueViolations: 2,
            },
            // Zero-count placeholder row created by aggregateDailyStats
            {
              siteId: siteA,
              statDate: new Date("2026-11-26T00:00:00.000Z"),
              totalIncidents: 0,
              openIncidents: 0,
              resolvedIncidents: 0,
              falseAlarms: 0,
              trueViolations: 0,
            },
          ],
        },
        reportStatistic: {
          findMany: async () => [
            {
              siteId: siteA,
              cameraId: cam1,
              violationType: "NO_HELMET",
              severity: "HIGH",
              statDate: new Date("2026-11-25T00:00:00.000Z"),
              totalCount: 3,
              confirmedCount: 2,
              resolvedCount: 0,
            },
            {
              siteId: siteA,
              cameraId: null,
              violationType: "TOTAL_AGGREGATED",
              severity: "NORMAL",
              statDate: new Date("2026-11-26T00:00:00.000Z"),
              totalCount: 0,
              confirmedCount: 0,
              resolvedCount: 0,
            },
          ],
        },
      };

      const repo = new ReportingRepository(mockPrisma);
      const summary = await repo.getIncidentSummary(
        { siteId: siteA, startDate: "2026-11-25", endDate: "2026-11-26" },
        {
          getRealtimeIncidents: async () => [
            {
              id: "ph-26-1",
              siteId: siteA,
              cameraId: cam1,
              status: "CONFIRMED",
              violationType: "NO_VEST",
              severity: "HIGH",
              detectedAt: "2026-11-26T04:00:00.000Z",
            },
          ],
        },
      );

      assert.equal(summary.totalIncidents, 4);
      assert.equal(summary.trueViolations, 3);
      assert.equal(summary.severityBreakdown.HIGH.count, 4);
    });

    it("isolates rolled-up coverage per siteId when querying across multiple sites (siteId omitted)", async () => {
      const mockPrisma = {
        incidentStatistic: {
          findMany: async () => [
            {
              siteId: siteA,
              statDate: new Date("2026-11-26T00:00:00.000Z"),
              totalIncidents: 2,
              openIncidents: 0,
              resolvedIncidents: 0,
              falseAlarms: 0,
              trueViolations: 2,
            },
          ],
        },
        reportStatistic: {
          findMany: async () => [
            {
              siteId: siteA,
              cameraId: cam1,
              violationType: "NO_HELMET",
              severity: "HIGH",
              statDate: new Date("2026-11-26T00:00:00.000Z"),
              totalCount: 2,
              confirmedCount: 2,
              resolvedCount: 0,
            },
          ],
        },
      };

      const repo = new ReportingRepository(mockPrisma);
      const summary = await repo.getIncidentSummary(
        { startDate: "2026-11-26", endDate: "2026-11-26" },
        {
          getRealtimeIncidents: async () => [
            // Site A already rolled up for 2026-11-26 -> skip
            {
              id: "siteA-dup",
              siteId: siteA,
              cameraId: cam1,
              status: "CONFIRMED",
              severity: "HIGH",
              detectedAt: "2026-11-26T02:00:00.000Z",
            },
            // Site B NOT rolled up for 2026-11-26 -> include
            {
              id: "siteB-new",
              siteId: siteB,
              cameraId: cam2,
              status: "PENDING_REVIEW",
              severity: "CRITICAL",
              detectedAt: "2026-11-26T02:00:00.000Z",
            },
          ],
        },
      );

      assert.equal(summary.totalIncidents, 3);
      assert.equal(summary.trueViolations, 2);
      assert.equal(summary.openIncidents, 1);
      assert.equal(summary.severityBreakdown.HIGH.count, 2);
      assert.equal(summary.severityBreakdown.CRITICAL.count, 1);
    });

    it("degrades gracefully to rolled-up data if incident-service fails or returns null", async () => {
      const repo = new ReportingRepository(createPartialRollupMockPrisma());
      const filter = {
        siteId: siteA,
        startDate: "2026-11-25",
        endDate: "2026-11-27",
      };
      const failingOptions = {
        getRealtimeIncidents: async () => {
          throw new Error("ECONNREFUSED incident-service");
        },
      };

      const [summary, trends, breakdown, rankings] = await Promise.all([
        repo.getIncidentSummary(filter, failingOptions),
        repo.getIncidentTrends(filter, failingOptions),
        repo.getViolationBreakdown(filter, failingOptions),
        repo.getCameraRankings(filter, failingOptions),
      ]);

      assert.equal(summary.totalIncidents, 6);
      assert.equal(trends.length, 2);
      assert.equal(breakdown.reduce((acc, b) => acc + b.count, 0), 6);
      assert.equal(rankings.reduce((acc, c) => acc + c.totalViolations, 0), 6);
    });
  });

  describe("4. End-to-End Parity: /statistics/* vs /reports/:id/content (Excel, PDF, CSV, JSON) & Optional groupBy", () => {
    it("deduplicates realtime fetch across all 4 widgets and produces identical figures across Excel, PDF, CSV, and JSON", async () => {
      const mockPrisma = createPartialRollupMockPrisma();
      const realtimeIncidents = createSampleRealtimeIncidents();

      const createReportRecord = (fileType: string, ext: string) => ({
        id: `019447e1-8894-7000-8000-00000000010${ext.length}`,
        templateId: "tmpl-1",
        siteId: siteA,
        reportType: "MONTHLY",
        periodStart: new Date("2026-11-25T00:00:00.000Z"),
        periodEnd: new Date("2026-11-27T00:00:00.000Z"),
        generatedBy: userId,
        status: "COMPLETED",
        fileName: `report_partial.${ext}`,
        filePath: `reports/${siteA}/partial.${ext}`,
        errorMessage: null,
        generatedAt: new Date("2026-11-27T12:00:00.000Z"),
        createdAt: new Date("2026-11-27T12:00:00.000Z"),
        template: {
          id: "tmpl-1",
          name: "Báo cáo Đối soát Partial Rollup",
          code: "COMPLIANCE_MONTHLY",
          fileType,
          version: "1.0.0",
          status: "ACTIVE",
          createdAt: new Date("2026-11-01T00:00:00.000Z"),
          updatedAt: new Date("2026-11-01T00:00:00.000Z"),
        },
      });

      let currentReport = createReportRecord("JSON", "json");
      const fullPrisma = {
        ...mockPrisma,
        reportGeneration: {
          findUnique: async () => currentReport,
        },
      };

      let fetchCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        fetchCount++;
        return new Response(
          JSON.stringify({
            success: true,
            data: realtimeIncidents,
            meta: { page: 1, limit: 100, total: realtimeIncidents.length, totalPages: 1 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      try {
        const repo = new ReportingRepository(fullPrisma);
        const service = new ReportingService(repo);
        const controller = new ReportingController(service);

        const statsFilter = {
          siteId: siteA,
          startDate: "2026-11-25",
          endDate: "2026-11-27",
        };
        const statsSummary = await service.getDashboardSummary(
          statsFilter,
          { role: ROLES.ADMIN },
          { authHeader: "Bearer jwt-test" },
        );
        const statsTrendsWeek = await service.getViolationTrends(
          { ...statsFilter, groupBy: STATISTIC_GROUP_BY.WEEK },
          { role: ROLES.ADMIN },
          { authHeader: "Bearer jwt-test" },
        );
        const statsTrendsDay = await service.getViolationTrends(
          { ...statsFilter, groupBy: STATISTIC_GROUP_BY.DAY },
          { role: ROLES.ADMIN },
          { authHeader: "Bearer jwt-test" },
        );
        const statsBreakdown = await service.getViolationDistribution(
          statsFilter,
          { role: ROLES.ADMIN },
          { authHeader: "Bearer jwt-test" },
        );
        const statsCameras = await service.getCameraRankings(
          { ...statsFilter, limit: 10 },
          { role: ROLES.ADMIN },
          { authHeader: "Bearer jwt-test" },
        );

        // Reset counter before testing export deduplication
        fetchCount = 0;

        // 1. JSON export (default MONTHLY -> WEEK)
        currentReport = createReportRecord("JSON", "json");
        const jsonRes = await service.getReportGenerationContent(
          currentReport.id,
          userId,
          ROLES.ADMIN,
          { authHeader: "Bearer jwt-test" },
        );
        assert.equal(
          fetchCount,
          1,
          "getAggregatedReportData must perform at most 1 HTTP realtime fetch across all 4 widgets",
        );

        const parsedJson = JSON.parse(jsonRes.content.toString("utf-8"));
        assert.deepEqual(parsedJson.summary, statsSummary);
        assert.deepEqual(parsedJson.violationsBreakdown, statsBreakdown);
        assert.deepEqual(parsedJson.cameraRankings, statsCameras);
        assert.deepEqual(parsedJson.trends, statsTrendsWeek);
        assert.equal(parsedJson.aiPerformance?.length, 1);

        // 2. CSV export with ?groupBy=DAY override through Controller
        currentReport = createReportRecord("CSV", "csv");
        let csvBuffer: Buffer | null = null;
        const reqCsv: any = {
          params: { id: currentReport.id },
          headers: { authorization: "Bearer jwt-test" },
          cookies: {},
          query: { groupBy: STATISTIC_GROUP_BY.DAY },
          user: { id: userId, role: ROLES.ADMIN },
        };
        await controller.getReportGenerationContent(
          reqCsv,
          {
            setHeader: () => {},
            status: () => ({
              send: (b: Buffer) => {
                csvBuffer = b;
              },
            }),
          } as any,
          (err: any) => {
            if (err) throw err;
          },
        );
        const csvText = csvBuffer!.toString("utf-8");
        assert.ok(csvText.includes(`Tổng số sự cố ghi nhận,${statsSummary.totalIncidents},vụ`));
        assert.ok(csvText.includes("RESTRICTED_AREA"));
        assert.ok(csvText.includes(cam3));
        for (const dayPoint of statsTrendsDay) {
          assert.ok(
            csvText.includes(
              `${dayPoint.date},${dayPoint.totalIncidents},${dayPoint.trueViolations},${dayPoint.falseAlarms},${dayPoint.resolvedCount}`,
            ),
          );
        }

        // 3. EXCEL export parity
        currentReport = createReportRecord("EXCEL", "xlsx");
        const excelRes = await service.getReportGenerationContent(
          currentReport.id,
          userId,
          ROLES.ADMIN,
          { authHeader: "Bearer jwt-test" },
        );
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(excelRes.content as any);
        const ws1 = workbook.getWorksheet("1. Tổng quan & KPI HSE")!;
        const sheet1Rows: any[] = [];
        ws1.eachRow((r) => sheet1Rows.push(r.values));
        assert.ok(
          sheet1Rows.some(
            (vals) =>
              vals.includes("Tổng số sự cố ghi nhận") &&
              vals.includes(statsSummary.totalIncidents),
          ),
        );
        const ws2 = workbook.getWorksheet("2. Điểm nóng Camera & Xu hướng")!;
        const sheet2Text = JSON.stringify(ws2.getSheetValues());
        assert.ok(sheet2Text.includes(cam3));
        assert.ok(sheet2Text.includes("2026-W48"));

        // 4. PDF export parity
        currentReport = createReportRecord("PDF", "pdf");
        const pdfRes = await service.getReportGenerationContent(
          currentReport.id,
          userId,
          ROLES.ADMIN,
          { authHeader: "Bearer jwt-test" },
        );
        assert.ok(pdfRes.content.toString("utf-8").startsWith("%PDF-1.4"));
        assert.ok(pdfRes.content.length > 5000);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("validates optional groupBy query parameter in reportContentQuerySchema", () => {
      assert.equal(reportContentQuerySchema.safeParse({}).success, true);
      assert.equal(reportContentQuerySchema.safeParse({ groupBy: "DAY" }).success, true);
      assert.equal(reportContentQuerySchema.safeParse({ groupBy: "WEEK" }).success, true);
      assert.equal(reportContentQuerySchema.safeParse({ groupBy: "MONTH" }).success, true);
      assert.equal(reportContentQuerySchema.safeParse({ groupBy: "YEAR" }).success, false);
    });
  });
});
