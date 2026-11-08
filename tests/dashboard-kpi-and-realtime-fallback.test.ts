import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ReportingRepository } from "../src/modules/reporting/reporting.repository";
import { ReportingService } from "../src/modules/reporting/reporting.service";
import { ReportingController } from "../src/modules/reporting/reporting.controller";
import { DashboardFilterDto, DashboardKpiDto } from "../src/modules/reporting/reporting.dto";

describe("Dashboard KPI & Real-time Fallback Suite", () => {
  describe("1. Real-time Fallback khi incident_statistics chưa có dữ liệu", () => {
    it("should compute incident summary from realtime incident list when DB is empty", () => {
      const repo = new ReportingRepository();
      const mockIncidents = [
        { id: "1", status: "PENDING_REVIEW", violationType: "NO_HELMET", severity: "HIGH" },
        { id: "2", status: "PENDING_REVIEW", violationType: "NO_VEST", severity: "MEDIUM" },
        { id: "3", status: "CONFIRMED", violationType: "NO_HELMET", severity: "HIGH" },
        { id: "4", status: "CONFIRMED", violationType: "RESTRICTED_AREA", severity: "CRITICAL" },
        { id: "5", status: "DISMISSED", violationType: "NO_HELMET", severity: "LOW" },
        { id: "6", status: "RESOLVED", violationType: "NO_VEST", severity: "MEDIUM" },
      ];

      const summary = repo.computeSummaryFromIncidentList(mockIncidents, {});

      assert.equal(summary.totalIncidents, 6);
      assert.equal(summary.openIncidents, 2); // 2 PENDING_REVIEW
      assert.equal(summary.resolvedIncidents, 1); // 1 RESOLVED
      assert.equal(summary.trueViolations, 2); // 2 CONFIRMED
      assert.equal(summary.falseAlarms, 1); // 1 DISMISSED
      // trueViolations = 2, totalIncidents = 6 => 100 - (2/6)*100 = 66.67%
      assert.equal(summary.complianceRate, 66.67);
      // falseAlarms = 1, reviewed = 3 => (1/3)*100 = 33.33%
      assert.equal(summary.falseAlarmRate, 33.33);
    });

    it("should compute violation breakdown from realtime incident list for Donut chart", () => {
      const repo = new ReportingRepository();
      const mockIncidents = [
        { id: "1", violationType: "NO_HELMET", severity: "HIGH" },
        { id: "2", violationType: "NO_HELMET", severity: "HIGH" },
        { id: "3", violationType: "NO_HELMET", severity: "CRITICAL" },
        { id: "4", violationType: "NO_VEST", severity: "MEDIUM" },
        { id: "5", violationType: "RESTRICTED_AREA", severity: "LOW" },
      ];

      const breakdown = repo.computeViolationBreakdownFromIncidentList(mockIncidents);

      assert.equal(breakdown.length, 3);

      const noHelmet = breakdown.find((b) => b.violationType === "NO_HELMET");
      assert.ok(noHelmet);
      assert.equal(noHelmet.count, 3);
      assert.equal(noHelmet.percentage, 60.0);
      assert.equal(noHelmet.severityBreakdown.HIGH, 2);
      assert.equal(noHelmet.severityBreakdown.CRITICAL, 1);

      const noVest = breakdown.find((b) => b.violationType === "NO_VEST");
      assert.ok(noVest);
      assert.equal(noVest.count, 1);
      assert.equal(noVest.percentage, 20.0);
      assert.equal(noVest.severityBreakdown.MEDIUM, 1);

      const restricted = breakdown.find((b) => b.violationType === "RESTRICTED_AREA");
      assert.ok(restricted);
      assert.equal(restricted.count, 1);
      assert.equal(restricted.percentage, 20.0);
      assert.equal(restricted.severityBreakdown.LOW, 1);
    });
  });

  describe("2. Active AI Model Resolution & Fallback", () => {
    it("should return default YOLO11m-PPE model when no deployed version in database", async () => {
      const mockDb = {
        aiModelVersion: {
          findFirst: async () => null,
        },
      };

      const repo = new ReportingRepository(mockDb);
      const activeModel = await repo.findActiveModelDetails();

      assert.deepEqual(activeModel, {
        name: "YOLO11m-PPE",
        version: "1.0.0",
        latencyMs: 18,
        fps: 28,
      });
    });

    it("should extract deployed model info and metrics when model exists in DB", async () => {
      const mockDb = {
        aiModelVersion: {
          findFirst: async () => ({
            id: "ver-1",
            version: "2.1.0",
            metrics: { latencyMs: 15, fps: 32 },
            model: { name: "Custom-PPE-YOLO" },
            performanceStatistics: [],
          }),
        },
      };

      const repo = new ReportingRepository(mockDb);
      const activeModel = await repo.findActiveModelDetails();

      assert.deepEqual(activeModel, {
        name: "Custom-PPE-YOLO",
        version: "2.1.0",
        latencyMs: 15,
        fps: 32,
      });
    });
  });

  describe("3. BFF Endpoint: getDashboardKpi", () => {
    it("should aggregate totalIncidents, pendingReview, complianceRate, cameraStatus and activeModel", async () => {
      const mockRepo = {
        getIncidentSummary: async () => ({
          totalIncidents: 12,
          openIncidents: 6,
          resolvedIncidents: 4,
          trueViolations: 1,
          falseAlarms: 1,
          falseAlarmRate: 50.0,
          complianceRate: 92.5,
          meanTimeToResolveHours: 1.2,
        }),
        findActiveModelDetails: async () => ({
          name: "YOLO11m-PPE",
          version: "1.0.0",
          latencyMs: 18,
          fps: 28,
        }),
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepo);

      // Stub fetchCameraStatusCounts private method for testing
      (service as any).fetchCameraStatusCounts = async () => ({
        total: 6,
        online: 0,
        offline: 6,
      });

      const kpi: DashboardKpiDto = await service.getDashboardKpi({});

      assert.deepEqual(kpi, {
        totalIncidents: 12,
        pendingReview: 6,
        complianceRate: 92.5,
        cameraStatus: {
          total: 6,
          online: 0,
          offline: 6,
        },
        activeModel: {
          name: "YOLO11m-PPE",
          version: "1.0.0",
          latencyMs: 18,
          fps: 28,
        },
      });
    });
  });

  describe("4. Security Hardening Verification", () => {
    it("should safely ignore prototype pollution keys and unexpected severities in computeViolationBreakdownFromIncidentList", () => {
      const repo = new ReportingRepository();
      const maliciousIncidents = [
        { id: "1", violationType: "NO_HELMET", severity: "toString" },
        { id: "2", violationType: "NO_HELMET", severity: "valueOf" },
        { id: "3", violationType: "NO_HELMET", severity: "__proto__" },
        { id: "4", violationType: "NO_HELMET", severity: "constructor" },
        { id: "5", violationType: "NO_HELMET", severity: "HIGH" },
      ];

      const breakdown = repo.computeViolationBreakdownFromIncidentList(maliciousIncidents);
      assert.equal(breakdown.length, 1);
      assert.equal(breakdown[0].count, 5);
      assert.equal(breakdown[0].severityBreakdown.HIGH, 1);
      assert.equal(breakdown[0].severityBreakdown.LOW, 0);
      assert.equal(breakdown[0].severityBreakdown.NORMAL, 0);
      assert.equal(breakdown[0].severityBreakdown.MEDIUM, 0);
      assert.equal(breakdown[0].severityBreakdown.CRITICAL, 0);
      // Ensure Object prototype was not polluted
      assert.equal(typeof (Object.prototype as any).HIGH, "undefined");
      assert.equal(typeof (Object.prototype as any).toString, "function");
    });

    it("should extract auth header from cookies if authorization header is absent in controller", async () => {
      let forwardedAuthHeader: string | undefined;

      const mockService = {
        getDashboardKpi: async (
          _filter: any,
          _user: any,
          callOptions?: { authHeader?: string; requestId?: string },
        ) => {
          forwardedAuthHeader = callOptions?.authHeader;
          return {
            totalIncidents: 0,
            pendingReview: 0,
            complianceRate: 100,
            cameraStatus: { total: 0, online: 0, offline: 0 },
            activeModel: { name: "YOLO11m-PPE", version: "1.0.0", latencyMs: 18, fps: 28 },
          };
        },
      } as unknown as ReportingService;

      const controller = new ReportingController(mockService);

      const req: any = {
        headers: {},
        cookies: { accessToken: "test-cookie-jwt-token" },
        query: {},
        user: { role: "ADMIN" },
      };
      let resJsonData: any;
      const res: any = {
        status: (code: number) => {
          assert.equal(code, 200);
          return {
            json: (payload: any) => {
              resJsonData = payload;
            },
          };
        },
      };
      const next = (err: any) => {
        if (err) throw err;
      };

      await controller.getDashboardKpi(req, res, next);
      assert.equal(forwardedAuthHeader, "Bearer test-cookie-jwt-token");
      assert.ok(resJsonData?.success);
    });
  });
});

