import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { fetchInternalService } from "../src/common/helpers/http-client.helper";
import { ReportingRepository } from "../src/modules/reporting/reporting.repository";
import { ReportingService } from "../src/modules/reporting/reporting.service";
import { ReportingController } from "../src/modules/reporting/reporting.controller";
import { STATISTIC_GROUP_BY } from "../src/common/constants/reporting.constant";
import { ROLES } from "../src/common/constants/role.constant";

describe("Reporting Realtime Fallback, Pagination, MTTR & Export Fixes", () => {
  it("1. fetchInternalService preserves meta alongside unwrapped json.data", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: [{ id: "inc-1" }, { id: "inc-2" }],
          meta: { page: 1, limit: 2, total: 5, totalPages: 3 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    try {
      const res = await fetchInternalService<any[]>("http://localhost:8893/api/v1/incidents");
      assert.equal(res.ok, true);
      assert.equal(res.data?.length, 2);
      assert.equal(res.meta?.totalPages, 3);
      assert.equal(res.meta?.total, 5);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("2. fetchRealtimeIncidentsFromIncidentService paginates > 100 incidents, forwards headers, and expands YYYY-MM-DD endDate to VN end-of-day", async () => {
    const requestedUrls: string[] = [];
    const requestedAuthHeaders: Array<string | undefined> = [];
    const requestedIds: Array<string | undefined> = [];

    const makePageItems = (page: number, count: number) =>
      Array.from({ length: count }, (_, idx) => ({
        id: `inc-${page}-${idx + 1}`,
        status: "CONFIRMED",
        violationType: "NO_HELMET",
        severity: "HIGH",
      }));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const urlStr = String(input);
      requestedUrls.push(urlStr);
      requestedAuthHeaders.push(init?.headers?.Authorization);
      requestedIds.push(init?.headers?.["x-request-id"]);

      const parsed = new URL(urlStr);
      const page = Number(parsed.searchParams.get("page") || "1");
      const count = page < 3 ? 100 : 50;
      return new Response(
        JSON.stringify({
          success: true,
          data: makePageItems(page, count),
          meta: { page, limit: 100, total: 250, totalPages: 3 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const repo = new ReportingRepository({} as any);
      const incidents = await repo.fetchRealtimeIncidentsFromIncidentService(
        {
          siteId: "019447e1-8891-7000-8000-000000000002",
          startDate: "2026-11-01",
          endDate: "2026-11-24",
        },
        {
          authHeader: "Bearer jwt-test-token",
          requestId: "req-pagination-1",
        },
      );

      assert.ok(incidents);
      assert.equal(incidents.length, 250);
      assert.equal(requestedUrls.length, 3);
      assert.ok(requestedAuthHeaders.every((h) => h === "Bearer jwt-test-token"));
      assert.ok(requestedIds.every((id) => id === "req-pagination-1"));

      const firstUrl = new URL(requestedUrls[0]);
      // 2026-11-01 00:00:00 UTC+7 = 2026-10-31T17:00:00.000Z
      assert.equal(firstUrl.searchParams.get("fromDate"), "2026-10-31T17:00:00.000Z");
      // 2026-11-24 23:59:59.999 UTC+7 = 2026-11-24T16:59:59.999Z
      assert.equal(firstUrl.searchParams.get("toDate"), "2026-11-24T16:59:59.999Z");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("3. computeSummaryFromIncidentList calculates actual meanTimeToResolveHours instead of hardcoding 0", () => {
    const repo = new ReportingRepository({} as any);
    const base = new Date("2026-11-20T08:00:00.000Z");

    const incidents = [
      {
        id: "inc-1",
        status: "RESOLVED",
        severity: "CRITICAL",
        detectedAt: base,
        resolvedAt: new Date(base.getTime() + 30 * 60 * 1000), // 30m
      },
      {
        id: "inc-2",
        status: "CLOSED",
        severity: "HIGH",
        detectedAt: base,
        resolvedAt: new Date(base.getTime() + 90 * 60 * 1000), // 90m
      },
      {
        id: "inc-3",
        status: "CONFIRMED",
        severity: "MEDIUM",
        detectedAt: base,
      },
    ];

    const summary = repo.computeSummaryFromIncidentList(incidents, {
      startDate: "2026-11-20",
      endDate: "2026-11-20",
    });

    // Avg resolution time = (30 + 90) / 2 = 60 mins = 1 hour
    assert.equal(summary.meanTimeToResolveHours, 1);
    assert.equal(summary.severityBreakdown?.CRITICAL.actualMttrMinutes, 30);
    assert.equal(summary.severityBreakdown?.HIGH.actualMttrMinutes, 90);
  });

  it("4. getIncidentTrends & getCameraRankings use realtime fallback when rollup tables are empty and forward authHeader from controller", async () => {
    const siteId = "019447e1-8891-7000-8000-000000000002";
    const cam1 = "019447e1-8892-7000-8000-000000000010";
    const cam2 = "019447e1-8892-7000-8000-000000000011";

    const mockPrisma = {
      incidentStatistic: {
        findMany: async () => [],
      },
      reportStatistic: {
        findMany: async () => [],
      },
    };

    const sampleIncidents = [
      {
        id: "1",
        siteId,
        cameraId: cam1,
        status: "CONFIRMED",
        violationType: "NO_HELMET",
        severity: "HIGH",
        detectedAt: "2026-11-23T18:00:00.000Z", // 2026-11-24 01:00 VN
      },
      {
        id: "2",
        siteId,
        cameraId: cam1,
        status: "RESOLVED",
        violationType: "NO_VEST",
        severity: "MEDIUM",
        detectedAt: "2026-11-24T02:00:00.000Z", // 2026-11-24 09:00 VN
        resolvedAt: "2026-11-24T02:30:00.000Z",
      },
      {
        id: "3",
        siteId,
        cameraId: cam2,
        status: "DISMISSED",
        violationType: "NO_HELMET",
        severity: "LOW",
        detectedAt: "2026-11-22T05:00:00.000Z", // 2026-11-22 12:00 VN
      },
    ];

    const capturedAuthHeaders: Array<string | undefined> = [];
    const repo = new ReportingRepository(mockPrisma);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: any, init?: any) => {
      capturedAuthHeaders.push(init?.headers?.Authorization);
      return new Response(
        JSON.stringify({
          success: true,
          data: sampleIncidents,
          meta: { page: 1, limit: 100, total: 3, totalPages: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const service = new ReportingService(repo);
      const controller = new ReportingController(service);

      const reqTrends: any = {
        headers: { "x-request-id": "req-trends-1" },
        cookies: { accessToken: "cookie-jwt-abc" },
        query: { siteId, groupBy: STATISTIC_GROUP_BY.DAY },
        user: { role: ROLES.ADMIN },
      };
      let trendsPayload: any;
      await controller.getViolationTrends(
        reqTrends,
        { status: () => ({ json: (p: any) => { trendsPayload = p; } }) } as any,
        (err: any) => { if (err) throw err; },
      );

      assert.equal(trendsPayload.success, true);
      assert.equal(trendsPayload.data.length, 2);
      assert.deepEqual(trendsPayload.data[0], {
        date: "2026-11-22",
        totalIncidents: 1,
        trueViolations: 0,
        falseAlarms: 1,
        resolvedCount: 0,
      });
      assert.deepEqual(trendsPayload.data[1], {
        date: "2026-11-24",
        totalIncidents: 2,
        trueViolations: 1,
        falseAlarms: 0,
        resolvedCount: 1,
      });

      const reqCameras: any = {
        headers: { authorization: "Bearer header-jwt-xyz" },
        cookies: {},
        query: { siteId, limit: 5 },
        user: { role: ROLES.ADMIN },
      };
      let camerasPayload: any;
      await controller.getCameraRankings(
        reqCameras,
        { status: () => ({ json: (p: any) => { camerasPayload = p; } }) } as any,
        (err: any) => { if (err) throw err; },
      );

      assert.equal(camerasPayload.success, true);
      assert.equal(camerasPayload.data.length, 2);
      assert.deepEqual(camerasPayload.data[0], {
        cameraId: cam1,
        totalViolations: 2,
        confirmedCount: 1,
        falseAlarmCount: 0,
        resolvedCount: 1,
      });
      assert.deepEqual(camerasPayload.data[1], {
        cameraId: cam2,
        totalViolations: 1,
        confirmedCount: 0,
        falseAlarmCount: 1,
        resolvedCount: 0,
      });

      assert.deepEqual(capturedAuthHeaders, [
        "Bearer cookie-jwt-abc",
        "Bearer header-jwt-xyz",
      ]);

      // Verify WEEK & MONTH grouping directly
      const weekly = repo.computeTrendsFromIncidentList(sampleIncidents, STATISTIC_GROUP_BY.WEEK);
      assert.equal(weekly.length, 2);
      assert.equal(weekly[0].date, "2026-W47");
      assert.equal(weekly[1].date, "2026-W48");

      const monthly = repo.computeTrendsFromIncidentList(sampleIncidents, STATISTIC_GROUP_BY.MONTH);
      assert.equal(monthly.length, 1);
      assert.equal(monthly[0].date, "2026-11");
      assert.equal(monthly[0].totalIncidents, 3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("5. getReportGenerationContent forwards authHeader end-to-end, deduplicates realtime HTTP fetch across 4 widgets, and exports non-zero Excel", async () => {
    const siteId = "019447e1-8891-7000-8000-000000000002";
    const userId = "019447e1-9999-7000-8000-000000000003";
    const cam1 = "019447e1-8892-7000-8000-000000000010";
    const reportId = "019447e1-8894-7000-8000-000000000088";

    const mockPrisma = {
      reportGeneration: {
        findUnique: async () => ({
          id: reportId,
          templateId: "tmpl-1",
          siteId,
          reportType: "DAILY",
          periodStart: new Date("2026-11-24T00:00:00.000Z"),
          periodEnd: new Date("2026-11-24T00:00:00.000Z"),
          generatedBy: userId,
          status: "COMPLETED",
          fileName: "report_daily_realtime.xlsx",
          filePath: `reports/${siteId}/realtime.xlsx`,
          errorMessage: null,
          generatedAt: new Date("2026-11-24T12:00:00.000Z"),
          createdAt: new Date("2026-11-24T12:00:00.000Z"),
          template: {
            id: "tmpl-1",
            name: "Báo cáo An toàn Ngày",
            code: "DAILY_SAFETY",
            fileType: "EXCEL",
            version: "1.0.0",
            status: "ACTIVE",
            createdAt: new Date("2026-11-01T00:00:00.000Z"),
            updatedAt: new Date("2026-11-01T00:00:00.000Z"),
          },
        }),
      },
      incidentStatistic: {
        findMany: async () => [],
      },
      reportStatistic: {
        findMany: async () => [],
      },
      aiPerformanceStatistic: {
        findMany: async () => [],
      },
    };

    let fetchCount = 0;
    let forwardedAuth = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: any, init?: any) => {
      fetchCount++;
      forwardedAuth = init?.headers?.Authorization || "";
      return new Response(
        JSON.stringify({
          success: true,
          data: [
            {
              id: "inc-r1",
              siteId,
              cameraId: cam1,
              status: "RESOLVED",
              violationType: "NO_HELMET",
              severity: "HIGH",
              detectedAt: "2026-11-24T01:00:00.000Z",
              resolvedAt: "2026-11-24T02:00:00.000Z",
            },
            {
              id: "inc-r2",
              siteId,
              cameraId: cam1,
              status: "CONFIRMED",
              violationType: "NO_VEST",
              severity: "CRITICAL",
              detectedAt: "2026-11-24T03:00:00.000Z",
            },
          ],
          meta: { page: 1, limit: 100, total: 2, totalPages: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const repo = new ReportingRepository(mockPrisma);
      const service = new ReportingService(repo);
      const controller = new ReportingController(service);

      let sentBuffer: Buffer | null = null;
      const req: any = {
        params: { id: reportId },
        headers: {
          authorization: "Bearer export-jwt-token",
          "x-request-id": "req-export-1",
        },
        cookies: {},
        user: { id: userId, role: ROLES.SAFETY_MANAGER },
      };
      const res: any = {
        setHeader: () => {},
        status: (code: number) => {
          assert.equal(code, 200);
          return {
            send: (body: Buffer) => {
              sentBuffer = body;
            },
          };
        },
      };

      await controller.getReportGenerationContent(req, res, (err: any) => {
        if (err) throw err;
      });

      assert.equal(fetchCount, 1, "Must fetch realtime incidents only once per report export");
      assert.equal(forwardedAuth, "Bearer export-jwt-token");
      assert.ok(sentBuffer && Buffer.isBuffer(sentBuffer));

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(sentBuffer as any);
      const ws1 = workbook.getWorksheet("1. Tổng quan & KPI HSE");
      const ws2 = workbook.getWorksheet("2. Điểm nóng Camera & Xu hướng");
      assert.ok(ws1 && ws2);

      // Total incidents row in Sheet 1 should be 2 (not 0) and MTTR = 1 giờ
      const sheet1Values: any[] = [];
      ws1.eachRow((row) => sheet1Values.push(row.values));
      assert.ok(
        sheet1Values.some((vals) => vals.includes("Tổng số sự cố ghi nhận") && vals.includes(2)),
        "Excel KPI summary must contain totalIncidents = 2",
      );
      assert.ok(
        sheet1Values.some((vals) => vals.includes("Thời gian khắc phục (MTTR)") && vals.includes("1 giờ")),
        "Excel KPI summary must contain MTTR = 1 giờ",
      );

      // Camera cam1 in Sheet 2 must appear (not empty)
      assert.equal(ws2.getCell("B4").value, cam1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
