import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ReportingRepository } from "../src/modules/reporting/reporting.repository";
import { ReportingService } from "../src/modules/reporting/reporting.service";
import { ReportingController } from "../src/modules/reporting/reporting.controller";
import { hourlyRiskFilterSchema } from "../src/modules/reporting/reporting.validation";
import { buildOpenApiSpec, openapiRegistry } from "../src/config/openapi/openapi.registry";
import { registerReportingOpenApi } from "../src/modules/reporting/reporting.openapi";

describe("Hourly Risk & Severity SLA Suite", () => {
  describe("1. Severity Breakdown & SLA in Incident Summary", () => {
    it("should include severityBreakdown with target SLA and MTTR in computeSummaryFromIncidentList", () => {
      const repo = new ReportingRepository();
      const now = new Date("2026-11-10T10:00:00.000Z");
      const resolvedAtCritical = new Date(now.getTime() + 9 * 60 * 1000); // 9 minutes later

      const mockIncidents = [
        {
          id: "1",
          status: "RESOLVED",
          violationType: "NO_HELMET",
          severity: "CRITICAL",
          detectedAt: now,
          resolvedAt: resolvedAtCritical,
        },
        {
          id: "2",
          status: "RESOLVED",
          violationType: "RESTRICTED_AREA",
          severity: "CRITICAL",
          detectedAt: now,
          resolvedAt: resolvedAtCritical,
        },
        {
          id: "3",
          status: "RESOLVED",
          violationType: "NO_VEST",
          severity: "HIGH",
          detectedAt: now,
          resolvedAt: new Date(now.getTime() + 20 * 60 * 1000), // 20 minutes later
        },
        {
          id: "4",
          status: "CONFIRMED",
          violationType: "NO_VEST",
          severity: "HIGH",
          detectedAt: now,
        },
        {
          id: "5",
          status: "CONFIRMED",
          violationType: "NO_HELMET",
          severity: "HIGH",
          detectedAt: now,
        },
        {
          id: "6",
          status: "CONFIRMED",
          violationType: "NO_HELMET",
          severity: "HIGH",
          detectedAt: now,
        },
        {
          id: "7",
          status: "CONFIRMED",
          violationType: "NO_HELMET",
          severity: "HIGH",
          detectedAt: now,
        },
      ];

      const summary = repo.computeSummaryFromIncidentList(mockIncidents, {
        startDate: "2026-11-10",
        endDate: "2026-11-10",
      });

      assert.ok(summary.severityBreakdown, "severityBreakdown must be defined");
      assert.equal(summary.severityBreakdown.CRITICAL.count, 2);
      assert.equal(summary.severityBreakdown.CRITICAL.resolved, 2);
      assert.equal(summary.severityBreakdown.CRITICAL.targetSlaMinutes, 15);
      assert.equal(summary.severityBreakdown.CRITICAL.actualMttrMinutes, 9);

      assert.equal(summary.severityBreakdown.HIGH.count, 5);
      assert.equal(summary.severityBreakdown.HIGH.resolved, 1);
      assert.equal(summary.severityBreakdown.HIGH.targetSlaMinutes, 30);
      assert.equal(summary.severityBreakdown.HIGH.actualMttrMinutes, 20);

      assert.equal(summary.severityBreakdown.MEDIUM.count, 0);
      assert.equal(summary.severityBreakdown.MEDIUM.resolved, 0);
      assert.equal(summary.severityBreakdown.MEDIUM.targetSlaMinutes, 60);
      assert.equal(summary.severityBreakdown.MEDIUM.actualMttrMinutes, 0);

      assert.equal(summary.severityBreakdown.LOW.count, 0);
      assert.equal(summary.severityBreakdown.LOW.resolved, 0);
      assert.equal(summary.severityBreakdown.LOW.targetSlaMinutes, 120);
      assert.equal(summary.severityBreakdown.LOW.actualMttrMinutes, 0);
    });
  });

  describe("2. Hourly Risk & Shifts Statistics Endpoint", () => {
    it("should partition 24 hours into 3 shifts correctly", async () => {
      const repo = new ReportingRepository();

      // Mock fetchRealtimeIncidentsFromIncidentService to return incidents at different Vietnam hours
      // In Vietnam (UTC+7):
      // UTC 01:00 = VN 08:00 (Morning shift 06:00-14:00)
      // UTC 09:00 = VN 16:00 (Afternoon shift 14:00-22:00)
      // UTC 18:00 = VN 01:00 (Night shift 22:00-06:00)
      const mockIncidents = [
        {
          id: "m1",
          detectedAt: "2026-11-10T01:00:00.000Z", // 08:00 VN
          severity: "HIGH",
        },
        {
          id: "m2",
          detectedAt: "2026-11-10T01:30:00.000Z", // 08:30 VN
          severity: "CRITICAL",
        },
        {
          id: "a1",
          detectedAt: "2026-11-10T09:15:00.000Z", // 16:15 VN
          severity: "MEDIUM",
        },
        {
          id: "n1",
          detectedAt: "2026-11-10T18:00:00.000Z", // 01:00 VN
          severity: "LOW",
        },
      ];

      let capturedFilter: any;
      (repo as any).fetchRealtimeIncidentsFromIncidentService = async (filter: any) => {
        capturedFilter = filter;
        return mockIncidents;
      };

      const result = await repo.getHourlyRisk({
        date: "2026-11-10",
      });

      assert.ok(capturedFilter, "must have called fetchRealtimeIncidentsFromIncidentService");
      // Must cover the full Vietnam day boundaries in UTC (startOfDay 17:00 UTC previous day, endOfDay 16:59:59 UTC)
      assert.ok(capturedFilter.startDate.includes("2026-11-09T17:00:00"));
      assert.ok(capturedFilter.endDate.includes("2026-11-10T16:59:59"));

      assert.equal(result.date, "2026-11-10");
      assert.equal(result.hourly.length, 24);

      // Check hour 8 (08:00 VN)
      const hour8 = result.hourly[8];
      assert.equal(hour8.hour, 8);
      assert.equal(hour8.label, "08:00");
      assert.equal(hour8.shift, "MORNING");
      assert.equal(hour8.count, 2);
      assert.equal(hour8.riskLevel, "CRITICAL");
      assert.equal(hour8.severityBreakdown.CRITICAL, 1);
      assert.equal(hour8.severityBreakdown.HIGH, 1);

      // Check hour 16 (16:00 VN)
      const hour16 = result.hourly[16];
      assert.equal(hour16.hour, 16);
      assert.equal(hour16.shift, "AFTERNOON");
      assert.equal(hour16.count, 1);
      assert.equal(hour16.severityBreakdown.MEDIUM, 1);

      // Check hour 1 (01:00 VN)
      const hour1 = result.hourly[1];
      assert.equal(hour1.hour, 1);
      assert.equal(hour1.shift, "NIGHT");
      assert.equal(hour1.count, 1);
      assert.equal(hour1.severityBreakdown.LOW, 1);

      // Check shifts aggregation
      assert.equal(result.shifts.morning.name, "Ca Sáng");
      assert.equal(result.shifts.morning.timeRange, "06:00 - 14:00");
      assert.equal(result.shifts.morning.totalIncidents, 2);
      assert.equal(result.shifts.morning.criticalCount, 1);
      assert.equal(result.shifts.morning.riskLevel, "CRITICAL");

      assert.equal(result.shifts.afternoon.name, "Ca Chiều");
      assert.equal(result.shifts.afternoon.timeRange, "14:00 - 22:00");
      assert.equal(result.shifts.afternoon.totalIncidents, 1);
      assert.equal(result.shifts.afternoon.mediumCount, 1);

      assert.equal(result.shifts.night.name, "Ca Đêm");
      assert.equal(result.shifts.night.timeRange, "22:00 - 06:00");
      assert.equal(result.shifts.night.totalIncidents, 1);
      assert.equal(result.shifts.night.lowCount, 1);

      // Check summary
      assert.equal(result.summary.totalIncidents, 4);
      assert.equal(result.summary.peakHour, 8);
      assert.equal(result.summary.peakShift, "MORNING");
      assert.equal(result.summary.riskLevel, "CRITICAL");
    });

    it("should handle empty incidents gracefully with 24 hours of 0 count and low risk", async () => {
      const repo = new ReportingRepository();
      (repo as any).fetchRealtimeIncidentsFromIncidentService = async () => [];

      const result = await repo.getHourlyRisk({
        date: "2026-11-10",
      });

      assert.equal(result.hourly.length, 24);
      assert.equal(result.summary.totalIncidents, 0);
      assert.equal(result.shifts.morning.totalIncidents, 0);
      assert.equal(result.shifts.afternoon.totalIncidents, 0);
      assert.equal(result.shifts.night.totalIncidents, 0);
    });
  });

  describe("3. Validation Schema", () => {
    it("should accept valid date and siteId UUID in hourlyRiskFilterSchema", () => {
      const valid = hourlyRiskFilterSchema.safeParse({
        date: "2026-11-10",
        siteId: "019313a4-23b4-7890-8123-456789abcdef",
      });
      assert.ok(valid.success);
    });

    it("should accept matching startDate and endDate for 1 day in hourlyRiskFilterSchema", () => {
      const valid = hourlyRiskFilterSchema.safeParse({
        startDate: "2026-11-10",
        endDate: "2026-11-10",
      });
      assert.ok(valid.success);
    });

    it("should reject mismatching startDate and endDate (multi-day) in hourlyRiskFilterSchema", () => {
      const invalid = hourlyRiskFilterSchema.safeParse({
        startDate: "2026-11-10",
        endDate: "2026-11-15",
      });
      assert.ok(!invalid.success);
    });

    it("should reject invalid date format in hourlyRiskFilterSchema", () => {
      const invalid = hourlyRiskFilterSchema.safeParse({
        date: "10-11-2026",
      });
      assert.ok(!invalid.success);
    });
  });

  describe("4. Controller Delegation", () => {
    it("should delegate getHourlyRisk to service and return 200 JSON response", async () => {
      const mockResult = {
        date: "2026-11-10",
        hourly: [],
        shifts: {
          morning: { name: "Ca Sáng", timeRange: "06:00 - 14:00", totalIncidents: 0, criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, riskLevel: "LOW" as const },
          afternoon: { name: "Ca Chiều", timeRange: "14:00 - 22:00", totalIncidents: 0, criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, riskLevel: "LOW" as const },
          night: { name: "Ca Đêm", timeRange: "22:00 - 06:00", totalIncidents: 0, criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, riskLevel: "LOW" as const },
        },
        summary: { totalIncidents: 0, peakHour: 0, peakShift: "MORNING" as const, riskLevel: "LOW" as const },
      };

      const mockService = {
        getHourlyRisk: async () => mockResult,
      } as unknown as ReportingService;

      const controller = new ReportingController(mockService);

      const req: any = {
        headers: {},
        cookies: {},
        query: { date: "2026-11-10" },
        user: { role: "ADMIN" },
      };

      let statusResult = 0;
      let jsonResult: any;

      const res: any = {
        status: (code: number) => {
          statusResult = code;
          return {
            json: (data: any) => {
              jsonResult = data;
            },
          };
        },
      };

      const next = (err: any) => {
        if (err) throw err;
      };

      await controller.getHourlyRisk(req, res, next);

      assert.equal(statusResult, 200);
      assert.equal(jsonResult.success, true);
      assert.deepEqual(jsonResult.data, mockResult);
    });
  });

  describe("5. OpenAPI Spec Registration Verification", () => {
    it("should have registered /statistics/hourly-risk and /statistics/health and updated /statistics/summary in OpenAPI spec", () => {
      registerReportingOpenApi();
      const spec = buildOpenApiSpec();

      assert.ok(spec.paths["/statistics/hourly-risk"], "spec must contain /statistics/hourly-risk");
      assert.ok(spec.paths["/statistics/hourly-risk"].get, "/statistics/hourly-risk must have GET operation");

      assert.ok(spec.paths["/statistics/summary"], "spec must contain /statistics/summary");
      assert.ok(spec.paths["/statistics/summary"].get, "/statistics/summary must have GET operation");

      assert.ok(spec.paths["/statistics/health"], "spec must contain /statistics/health");
      assert.ok(spec.paths["/statistics/health"].get, "/statistics/health must have GET operation");
    });
  });
});

