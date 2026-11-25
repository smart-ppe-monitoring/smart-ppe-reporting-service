import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import reportingApp from "../src/reporting.app";
import { reportingPrisma } from "../src/database/reporting.client";
import { jwtConfig } from "../src/config/jwt.config";
import { envConfig } from "../src/config/env.config";
import { GATEWAY_HEADERS } from "../src/common/constants/gateway.constant";
import { JWT_ALGORITHM, JWT_PURPOSE } from "../src/common/constants/jwt.constant";
import { getIsoWeekString } from "../src/common/helpers/date.helper";
import { CsvReportEngine } from "../src/modules/reporting/engines/csv.engine";
import { ReportingService } from "../src/modules/reporting/reporting.service";
import { ReportingRepository } from "../src/modules/reporting/reporting.repository";
import { ReportingController } from "../src/modules/reporting/reporting.controller";
import { reportRouter } from "../src/modules/reporting/reporting.route";
import { AggregatedReportDataDto } from "../src/modules/reporting/reporting.dto";
import { AppError } from "../src/common/errors/app-error";
import { ERROR_CODE } from "../src/common/errors/error-code";
import { ROLES } from "../src/common/constants/role.constant";
import { PERMISSIONS } from "../src/common/constants/permission.constant";

describe("Issue #4: Full CSV Export, Viewer Site-Tenancy Download & Multi-Site History", () => {
  const siteA = "019447e1-8891-7000-8000-000000000001";
  const siteB = "019447e1-8891-7000-8000-000000000002";
  const siteC = "019447e1-8891-7000-8000-000000000003";
  const authorId = "019447e1-9999-7000-8000-000000000010";
  const otherUserId = "019447e1-9999-7000-8000-000000000020";

  const sampleData: AggregatedReportDataDto = {
    reportId: "019447e1-8894-7000-8000-000000000100",
    reportType: "MONTHLY",
    templateCode: "COMPLIANCE_MONTHLY",
    templateName: "Báo cáo Kiểm toán An toàn PPE Tháng 11",
    siteId: siteA,
    periodStart: "2026-11-01",
    periodEnd: "2026-11-30",
    generatedBy: authorId,
    generatedAt: "2026-11-30T10:00:00.000Z",
    summary: {
      totalIncidents: 25,
      openIncidents: 3,
      resolvedIncidents: 20,
      trueViolations: 19,
      falseAlarms: 6,
      falseAlarmRate: 24.0,
      complianceRate: 88.5,
      meanTimeToResolveHours: 1.75,
      periodStart: "2026-11-01",
      periodEnd: "2026-11-30",
      severityBreakdown: {
        CRITICAL: {
          count: 4,
          resolved: 3,
          targetSlaMinutes: 15,
          actualMttrMinutes: 12,
        },
        HIGH: {
          count: 8,
          resolved: 7,
          targetSlaMinutes: 30,
          actualMttrMinutes: 25,
        },
        MEDIUM: {
          count: 9,
          resolved: 7,
          targetSlaMinutes: 60,
          actualMttrMinutes: 45,
        },
        LOW: {
          count: 4,
          resolved: 3,
          targetSlaMinutes: 120,
          actualMttrMinutes: 80,
        },
      },
    },
    violationsBreakdown: [
      {
        violationType: "NO_HARD_HAT",
        count: 12,
        percentage: 63.16,
        severityBreakdown: {
          LOW: 1,
          NORMAL: 0,
          MEDIUM: 4,
          HIGH: 5,
          CRITICAL: 2,
        },
      },
    ],
    cameraRankings: [
      {
        cameraId: "019447e1-8892-7000-8000-000000000055",
        totalViolations: 14,
        confirmedCount: 11,
        falseAlarmCount: 3,
        resolvedCount: 10,
      },
    ],
    trends: [
      {
        date: "2026-11-15",
        totalIncidents: 10,
        trueViolations: 8,
        falseAlarms: 2,
        resolvedCount: 8,
      },
    ],
    aiPerformance: [
      {
        id: "ai-1",
        cameraId: "019447e1-8892-7000-8000-000000000055",
        modelVersionId: "yolo-v11",
        statDate: "2026-11-15",
        avgFps: 29.4,
        avgLatencyMs: 31.5,
        maxLatencyMs: 52,
        totalFrames: "240000",
      },
    ],
  };

  describe("1. CsvReportEngine Full Content, UTF-8 BOM & Formula Injection Guard", () => {
    it("should generate UTF-8 BOM CSV containing metadata, KPIs, severity SLA, violations, cameras, trends, and AI telemetry", () => {
      const buf = CsvReportEngine.generate(sampleData);

      // UTF-8 BOM bytes: EF BB BF
      assert.strictEqual(buf[0], 0xef);
      assert.strictEqual(buf[1], 0xbb);
      assert.strictEqual(buf[2], 0xbf);

      const text = buf.toString("utf-8").slice(1); // strip BOM
      assert.ok(
        text.includes("reportId,reportType,siteId,periodStart,periodEnd,generatedBy,generatedAt"),
      );
      assert.ok(text.includes("Báo cáo Kiểm toán An toàn PPE Tháng 11"));
      assert.ok(text.includes("I. CHỈ SỐ AN TOÀN & TUÂN THỦ HSE"));
      assert.ok(text.includes("Tỷ lệ tuân thủ HSE,88.5,%"));
      assert.ok(text.includes("Tổng số sự cố ghi nhận,25,vụ"));
      assert.ok(text.includes("Thời gian khắc phục trung bình (MTTR),1.75,giờ"));
      assert.ok(text.includes("PHÂN BỔ MỨC ĐỘ NGHIÊM TRỌNG & SLA"));
      assert.ok(text.includes("CRITICAL,4,3,15,12"));
      assert.ok(text.includes("II. PHÂN BỔ VI PHẠM THEO LOẠI TRANG BỊ BẢO HỘ (PPE)"));
      assert.ok(text.includes("1,NO_HARD_HAT,12,63.16,2,5,5"));
      assert.ok(text.includes("III. BẢNG XẾP HẠNG ĐIỂM NÓNG CAMERA VI PHẠM"));
      assert.ok(
        text.includes("1,019447e1-8892-7000-8000-000000000055,14,11,3,10"),
      );
      assert.ok(text.includes("IV. XU HƯỚNG SỰ CỐ THEO THỜI GIAN"));
      assert.ok(text.includes("2026-11-15,10,8,2,8"));
      assert.ok(text.includes("V. HIỆU NĂNG SUY LUẬN MÔ HÌNH AI (TELEMETRY)"));
      assert.ok(text.includes("29.4,31.5,52,240000"));
    });

    it("should gracefully render empty sections when violations, cameras, and trends are empty", () => {
      const emptyBuf = CsvReportEngine.generate({
        ...sampleData,
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
        aiPerformance: [],
      });

      const text = emptyBuf.toString("utf-8");
      assert.ok(text.includes("Tỷ lệ tuân thủ HSE,100,%"));
      assert.ok(
        text.includes("Không ghi nhận vi phạm an toàn PPE nào trong kỳ kiểm toán."),
      );
      assert.ok(text.includes("Chưa có vi phạm được ghi nhận theo camera."));
      assert.ok(text.includes("Không có số liệu chuỗi thời gian."));
      assert.ok(!text.includes("V. HIỆU NĂNG SUY LUẬN"));
    });

    it("should neutralize CSV formula injection payloads and quote special characters per RFC 4180", () => {
      assert.strictEqual(CsvReportEngine.escapeCell("=CMD('calc')"), "'=CMD('calc')");
      assert.strictEqual(CsvReportEngine.escapeCell("+1+1"), "'+1+1");
      assert.strictEqual(CsvReportEngine.escapeCell("-2+3"), "'-2+3");
      assert.strictEqual(CsvReportEngine.escapeCell("@SUM(A1:A2)"), "'@SUM(A1:A2)");
      assert.strictEqual(
        CsvReportEngine.escapeCell("  =HYPERLINK(\"http://evil\")"),
        "\"'  =HYPERLINK(\"\"http://evil\"\")\"",
      );
      assert.strictEqual(
        CsvReportEngine.escapeCell("\t=1+1"),
        "'\t=1+1",
      );
      assert.strictEqual(
        CsvReportEngine.escapeCell("\r=1+1"),
        "\"'\r=1+1\"",
      );
      assert.strictEqual(
        CsvReportEngine.escapeCell("A, \"B\"\nC"),
        "\"A, \"\"B\"\"\nC\"",
      );

      const injectedBuf = CsvReportEngine.generate({
        ...sampleData,
        templateName: "=1+1, \"danger\"",
      });
      const text = injectedBuf.toString("utf-8");
      assert.ok(text.includes("\"'=1+1, \"\"danger\"\"\""));
    });
  });

  describe("2. Route Permissions for Viewer (PPE_REPORTING_READ) vs Export", () => {
    function runRoutePermissions(
      method: "get" | "post",
      routePath: string,
      req: any,
    ): any {
      const layer = (reportRouter.stack || []).find(
        (l: any) => l.route?.path === routePath && l.route?.methods?.[method],
      );
      assert.ok(layer, `Route ${method.toUpperCase()} ${routePath} must exist`);
      const handles = layer.route.stack.map((s: any) => s.handle);
      // First middleware in route stack is requirePermission / requireAnyPermission
      const permMiddleware = handles[0];
      let capturedErr: any = null;
      permMiddleware(req, {} as any, (err?: any) => {
        capturedErr = err ?? null;
      });
      return capturedErr;
    }

    it("should allow VIEWER with PPE_REPORTING_READ on GET /:id/download and GET /:id/content, while blocking POST /generate", () => {
      const viewerReq = () => ({
        user: {
          id: otherUserId,
          email: "viewer@ppe.local",
          role: ROLES.SAFETY_OFFICER,
          permissions: [PERMISSIONS.PPE_REPORTING_READ],
          siteIds: [siteA],
        },
      });

      assert.strictEqual(
        runRoutePermissions("get", "/:id/download", viewerReq()),
        null,
      );
      assert.strictEqual(
        runRoutePermissions("get", "/:id/content", viewerReq()),
        null,
      );

      const genErr = runRoutePermissions("post", "/generate", viewerReq());
      assert.ok(genErr instanceof AppError);
      assert.strictEqual(genErr.statusCode, 403);
      assert.strictEqual(genErr.code, ERROR_CODE.FORBIDDEN);
    });

    it("should reject user lacking both PPE_REPORTING_READ and PPE_REPORTING_EXPORT on download/content", () => {
      const noPermReq = () => ({
        user: {
          id: otherUserId,
          email: "noperms@ppe.local",
          role: ROLES.USER,
          permissions: [PERMISSIONS.NOTIFICATION_READ],
          siteIds: [siteA],
        },
      });

      const err1 = runRoutePermissions("get", "/:id/download", noPermReq());
      assert.strictEqual(err1?.statusCode, 403);
      const err2 = runRoutePermissions("get", "/:id/content", noPermReq());
      assert.strictEqual(err2?.statusCode, 403);
    });
  });

  describe("3. Site Tenancy BOLA Guard & Controller Forwarding", () => {
    const csvReportRecord = {
      id: sampleData.reportId,
      templateId: "019447e1-8894-7000-8000-000000000001",
      siteId: siteA,
      reportType: "MONTHLY",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-30",
      generatedBy: authorId,
      status: "COMPLETED",
      fileName: "report_monthly.csv",
      generatedAt: "2026-11-30T10:00:00.000Z",
      createdAt: "2026-11-30T10:00:00.000Z",
      template: {
        id: "019447e1-8894-7000-8000-000000000001",
        code: "COMPLIANCE_MONTHLY",
        name: sampleData.templateName,
        fileType: "CSV",
      },
    };

    const mockRepo = {
      findReportGenerationById: async (id: string) =>
        id === csvReportRecord.id ? csvReportRecord : null,
      getAggregatedReportData: async () => sampleData,
    } as unknown as ReportingRepository;

    it("should allow Viewer or Safety Manager in the same siteId to download and stream full CSV even if created by another user", async () => {
      const service = new ReportingService(mockRepo);

      const downloadMeta = await service.getReportGenerationDownload(
        csvReportRecord.id,
        otherUserId,
        ROLES.SAFETY_OFFICER,
        [siteA],
      );
      assert.strictEqual(downloadMeta.contentType, "text/csv");
      assert.strictEqual(
        downloadMeta.downloadUrl,
        `/api/v1/reports/${csvReportRecord.id}/content`,
      );

      const contentRes = await service.getReportGenerationContent(
        csvReportRecord.id,
        otherUserId,
        ROLES.SAFETY_MANAGER,
        undefined,
        [siteA],
      );
      assert.strictEqual(contentRes.contentType, "text/csv");
      const text = contentRes.content.toString("utf-8");
      assert.ok(text.includes("Tỷ lệ tuân thủ HSE,88.5,%"));
      assert.ok(text.includes("NO_HARD_HAT"));
    });

    it("should reject user assigned to a different siteId with 403 FORBIDDEN (even if author)", async () => {
      const service = new ReportingService(mockRepo);

      await assert.rejects(
        () =>
          service.getReportGenerationDownload(
            csvReportRecord.id,
            authorId,
            ROLES.SAFETY_MANAGER,
            [siteB],
          ),
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.statusCode, 403);
          assert.strictEqual(err.code, ERROR_CODE.FORBIDDEN);
          return true;
        },
      );

      await assert.rejects(
        () =>
          service.getReportGenerationContent(
            csvReportRecord.id,
            otherUserId,
            ROLES.SAFETY_OFFICER,
            undefined,
            [siteB],
          ),
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.statusCode, 403);
          assert.strictEqual(err.code, ERROR_CODE.FORBIDDEN);
          return true;
        },
      );
    });

    it("should fall back to author check when non-ADMIN has no site scope, and allow ADMIN across all sites", async () => {
      const service = new ReportingService(mockRepo);

      // Unscoped non-author -> 403
      await assert.rejects(
        () =>
          service.getReportGenerationDownload(
            csvReportRecord.id,
            otherUserId,
            ROLES.USER,
            [],
          ),
        (err: any) => err.statusCode === 403,
      );

      // Unscoped author -> allowed
      const authorRes = await service.getReportGenerationDownload(
        csvReportRecord.id,
        authorId,
        ROLES.USER,
        [],
      );
      assert.strictEqual(authorRes.report.id, csvReportRecord.id);

      // ADMIN -> allowed even with unrelated/empty siteIds
      const adminRes = await service.getReportGenerationContent(
        csvReportRecord.id,
        otherUserId,
        ROLES.ADMIN,
        undefined,
        [],
      );
      assert.strictEqual(adminRes.contentType, "text/csv");
    });

    it("ReportingController should forward user siteIds/siteId to download and content service methods", async () => {
      let capturedDownloadArgs: any = null;
      let capturedContentArgs: any = null;

      const fakeService = {
        getReportGenerationDownload: async (
          id: string,
          userId?: string,
          userRole?: string,
          userSiteIds?: string[],
        ) => {
          capturedDownloadArgs = { id, userId, userRole, userSiteIds };
          return { downloadUrl: "/api/v1/reports/1/content" };
        },
        getReportGenerationContent: async (
          id: string,
          userId?: string,
          userRole?: string,
          callOptions?: any,
          userSiteIds?: string[],
        ) => {
          capturedContentArgs = {
            id,
            userId,
            userRole,
            callOptions,
            userSiteIds,
          };
          return {
            content: Buffer.from("csv"),
            contentType: "text/csv",
            fileName: "r.csv",
          };
        },
      } as unknown as ReportingService;

      const controller = new ReportingController(fakeService);
      const req: any = {
        params: { id: csvReportRecord.id },
        headers: {},
        cookies: {},
        user: {
          id: otherUserId,
          role: ROLES.SAFETY_OFFICER,
          siteId: siteA,
          siteIds: [siteA, siteB],
        },
      };
      const res: any = {
        headersMap: {} as Record<string, string>,
        statusCode: 0,
        body: null as any,
        setHeader(k: string, v: string) {
          this.headersMap[k] = v;
        },
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(payload: any) {
          this.body = payload;
          return this;
        },
        send(payload: any) {
          this.body = payload;
          return this;
        },
      };

      await controller.getReportGenerationDownload(req, res, (err) => {
        if (err) throw err;
      });
      assert.deepStrictEqual(capturedDownloadArgs.userSiteIds, [siteA, siteB]);

      await controller.getReportGenerationContent(req, res, (err) => {
        if (err) throw err;
      });
      assert.deepStrictEqual(capturedContentArgs.userSiteIds, [siteA, siteB]);
    });
  });

  describe("4. Multi-Site History Filtering (listReportGenerations & findReportGenerations)", () => {
    it("should pass all permitted siteIds (not only permittedSites[0]) when non-ADMIN omits siteId filter", async () => {
      let capturedQuery: any = null;
      const mockRepo = {
        findReportGenerations: async (q: any) => {
          capturedQuery = q;
          return {
            data: [],
            meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
          };
        },
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepo);
      await service.listReportGenerations(
        { page: 1, limit: 20, siteIds: [siteC] } as any,
        { role: ROLES.SAFETY_MANAGER, siteIds: [siteA, siteB] },
      );

      assert.strictEqual(capturedQuery.siteId, undefined);
      assert.deepStrictEqual(capturedQuery.siteIds, [siteA, siteB]);
    });

    it("should allow filtering a specific authorized siteId and reject unauthorized siteId with 403", async () => {
      let capturedQuery: any = null;
      const mockRepo = {
        findReportGenerations: async (q: any) => {
          capturedQuery = q;
          return {
            data: [],
            meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
          };
        },
      } as unknown as ReportingRepository;

      const service = new ReportingService(mockRepo);
      await service.listReportGenerations(
        { siteId: siteB },
        { role: ROLES.SAFETY_MANAGER, siteIds: [siteA, siteB] },
      );
      assert.strictEqual(capturedQuery.siteId, siteB);
      assert.strictEqual(capturedQuery.siteIds, undefined);

      await assert.rejects(
        () =>
          service.listReportGenerations(
            { siteId: siteC },
            { role: ROLES.SAFETY_MANAGER, siteIds: [siteA, siteB] },
          ),
        (err: any) => err.statusCode === 403 && err.code === ERROR_CODE.FORBIDDEN,
      );
    });

    it("ReportingRepository.findReportGenerations should query siteId: { in: siteIds } for multi-site scope", async () => {
      let capturedCountWhere: any = null;
      let capturedFindWhere: any = null;
      const mockPrisma = {
        reportGeneration: {
          count: async ({ where }: any) => {
            capturedCountWhere = where;
            return 0;
          },
          findMany: async ({ where }: any) => {
            capturedFindWhere = where;
            return [];
          },
        },
      };

      const repo = new ReportingRepository(mockPrisma);
      await repo.findReportGenerations({ siteIds: [siteA, siteB] });

      assert.deepStrictEqual(capturedCountWhere, {
        siteId: { in: [siteA, siteB] },
      });
      assert.deepStrictEqual(capturedFindWhere, {
        siteId: { in: [siteA, siteB] },
      });
    });
  });

  describe("5. Live HTTP + PostgreSQL (ppe_reporting_db) E2E Integration Tests", () => {
    let server: http.Server | null = null;
    let baseUrl = "";
    let dbAvailable = false;
    let originalPublicKey = "";
    let viewerToken = "";
    let managerToken = "";
    let adminToken = "";

    const liveSiteA = crypto.randomUUID();
    const liveSiteB = crypto.randomUUID();
    const liveSiteC = crypto.randomUUID();
    const liveAuthorId = crypto.randomUUID();
    const liveViewerId = crypto.randomUUID();
    const liveManagerId = crypto.randomUUID();
    const liveCameraId = crypto.randomUUID();

    let templateId = "";
    let reportAId = "";
    let reportBId = "";
    let reportCId = "";
    const createdIncidentStatIds: string[] = [];
    const createdReportStatIds: string[] = [];

    function buildHeaders(
      token: string,
      extra?: Record<string, string>,
    ): Record<string, string> {
      const headers: Record<string, string> = {
        authorization: `Bearer ${token}`,
      };
      if (envConfig.gateway.internalSecret) {
        headers[GATEWAY_HEADERS.INTERNAL_SECRET] =
          envConfig.gateway.internalSecret;
      }
      return extra ? { ...headers, ...extra } : headers;
    }

    async function requestJson(
      path: string,
      token: string,
      init: { method?: string; body?: unknown } = {},
    ) {
      const res = await fetch(`${baseUrl}${path}`, {
        method: init.method || "GET",
        headers: buildHeaders(
          token,
          init.body !== undefined
            ? { "content-type": "application/json" }
            : undefined,
        ),
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      const text = await res.text();
      return {
        status: res.status,
        headers: res.headers,
        body: text ? JSON.parse(text) : null,
      };
    }

    async function requestBuffer(path: string, token: string) {
      const res = await fetch(`${baseUrl}${path}`, {
        method: "GET",
        headers: buildHeaders(token),
      });
      const arrBuf = await res.arrayBuffer();
      return {
        status: res.status,
        headers: res.headers,
        buffer: Buffer.from(arrBuf),
      };
    }

    before(async () => {
      try {
        await reportingPrisma.$queryRaw`SELECT 1`;
        dbAvailable = true;
      } catch {
        dbAvailable = false;
        return;
      }

      const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });

      originalPublicKey = jwtConfig.publicKey;
      (jwtConfig as any).publicKey = publicKey;

      const suffix = crypto.randomBytes(4).toString("hex").toUpperCase();
      const tmpl = await reportingPrisma.reportTemplate.create({
        data: {
          name: "Báo cáo CSV Kiểm thử Live",
          code: `IT_CSV_${suffix}`,
          fileType: "CSV",
          status: "ACTIVE",
        },
      });
      templateId = tmpl.id;

      const periodStart = new Date("2026-11-01T00:00:00.000Z");
      const periodEnd = new Date("2026-11-30T00:00:00.000Z");
      const statDate = new Date("2026-11-15T00:00:00.000Z");

      const repA = await reportingPrisma.reportGeneration.create({
        data: {
          templateId,
          siteId: liveSiteA,
          reportType: "MONTHLY",
          periodStart,
          periodEnd,
          generatedBy: liveAuthorId,
          status: "COMPLETED",
          fileName: "report_live_test_a.csv",
        },
      });
      reportAId = repA.id;

      const repB = await reportingPrisma.reportGeneration.create({
        data: {
          templateId,
          siteId: liveSiteB,
          reportType: "MONTHLY",
          periodStart,
          periodEnd,
          generatedBy: liveAuthorId,
          status: "COMPLETED",
          fileName: "report_live_test_b.csv",
        },
      });
      reportBId = repB.id;

      const repC = await reportingPrisma.reportGeneration.create({
        data: {
          templateId,
          siteId: liveSiteC,
          reportType: "MONTHLY",
          periodStart,
          periodEnd,
          generatedBy: liveAuthorId,
          status: "COMPLETED",
          fileName: "report_live_test_c.csv",
        },
      });
      reportCId = repC.id;

      const incStat = await reportingPrisma.incidentStatistic.create({
        data: {
          siteId: liveSiteA,
          statDate,
          totalIncidents: 20,
          openIncidents: 2,
          resolvedIncidents: 16,
          trueViolations: 15,
          falseAlarms: 5,
        },
      });
      createdIncidentStatIds.push(incStat.id);

      const rs1 = await reportingPrisma.reportStatistic.create({
        data: {
          siteId: liveSiteA,
          cameraId: liveCameraId,
          violationType: "NO_HARD_HAT",
          severity: "HIGH",
          statDate,
          totalCount: 10,
          confirmedCount: 8,
          resolvedCount: 7,
        },
      });
      createdReportStatIds.push(rs1.id);

      const rs2 = await reportingPrisma.reportStatistic.create({
        data: {
          siteId: liveSiteA,
          cameraId: liveCameraId,
          violationType: "NO_SAFETY_VEST",
          severity: "CRITICAL",
          statDate,
          totalCount: 5,
          confirmedCount: 5,
          resolvedCount: 4,
        },
      });
      createdReportStatIds.push(rs2.id);

      viewerToken = jwt.sign(
        {
          id: liveViewerId,
          email: "viewer-live@smartppe.local",
          role: ROLES.SAFETY_OFFICER,
          permissions: [PERMISSIONS.PPE_REPORTING_READ],
          siteId: liveSiteA,
          siteIds: [liveSiteA],
          purpose: JWT_PURPOSE.ACCESS,
        },
        privateKey,
        { algorithm: JWT_ALGORITHM.RS256, expiresIn: "10m" },
      );

      managerToken = jwt.sign(
        {
          id: liveManagerId,
          email: "manager-live@smartppe.local",
          role: ROLES.SAFETY_MANAGER,
          permissions: [
            PERMISSIONS.PPE_REPORTING_READ,
            PERMISSIONS.PPE_REPORTING_EXPORT,
          ],
          siteId: liveSiteA,
          siteIds: [liveSiteA, liveSiteB],
          purpose: JWT_PURPOSE.ACCESS,
        },
        privateKey,
        { algorithm: JWT_ALGORITHM.RS256, expiresIn: "10m" },
      );

      adminToken = jwt.sign(
        {
          id: liveAuthorId,
          email: "admin-live@smartppe.local",
          role: ROLES.ADMIN,
          permissions: [
            PERMISSIONS.PPE_REPORTING_READ,
            PERMISSIONS.PPE_REPORTING_EXPORT,
          ],
          purpose: JWT_PURPOSE.ACCESS,
        },
        privateKey,
        { algorithm: JWT_ALGORITHM.RS256, expiresIn: "10m" },
      );

      server = await new Promise<http.Server>((resolve) => {
        const s = reportingApp.listen(0, "127.0.0.1", () => resolve(s));
      });
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    after(async () => {
      if (dbAvailable) {
        const genIds = [reportAId, reportBId, reportCId].filter(Boolean);
        if (genIds.length > 0) {
          await reportingPrisma.reportGeneration
            .deleteMany({ where: { id: { in: genIds } } })
            .catch(() => {});
        }
        if (templateId) {
          await reportingPrisma.reportTemplate
            .deleteMany({ where: { id: templateId } })
            .catch(() => {});
        }
        if (createdIncidentStatIds.length > 0) {
          await reportingPrisma.incidentStatistic
            .deleteMany({ where: { id: { in: createdIncidentStatIds } } })
            .catch(() => {});
        }
        if (createdReportStatIds.length > 0) {
          await reportingPrisma.reportStatistic
            .deleteMany({ where: { id: { in: createdReportStatIds } } })
            .catch(() => {});
        }
      }
      if (server) {
        await new Promise<void>((resolve) => {
          server!.close(() => resolve());
        });
      }
      if (originalPublicKey !== undefined) {
        (jwtConfig as any).publicKey = originalPublicKey;
      }
      await reportingPrisma.$disconnect().catch(() => {});
    });

    it("VIEWER with PPE_REPORTING_READ in same siteA can fetch download metadata and full UTF-8 BOM CSV content from ppe_reporting_db", async (t) => {
      if (!dbAvailable) {
        t.skip("PostgreSQL ppe_reporting_db is unavailable");
        return;
      }

      const dlRes = await requestJson(
        `/api/v1/reports/${reportAId}/download`,
        viewerToken,
      );
      assert.strictEqual(dlRes.status, 200);
      assert.strictEqual(dlRes.body.data.contentType, "text/csv");
      assert.strictEqual(
        dlRes.body.data.downloadUrl,
        `/api/v1/reports/${reportAId}/content`,
      );

      const contentRes = await requestBuffer(
        `/api/v1/reports/${reportAId}/content`,
        viewerToken,
      );
      assert.strictEqual(contentRes.status, 200);
      assert.ok(
        (contentRes.headers.get("content-type") || "").startsWith("text/csv"),
      );
      assert.strictEqual(contentRes.buffer[0], 0xef);
      assert.strictEqual(contentRes.buffer[1], 0xbb);
      assert.strictEqual(contentRes.buffer[2], 0xbf);

      const csvText = contentRes.buffer.toString("utf-8").slice(1);
      assert.ok(
        csvText.includes(
          "reportId,reportType,siteId,periodStart,periodEnd,generatedBy,generatedAt",
        ),
      );
      assert.ok(csvText.includes("Báo cáo CSV Kiểm thử Live"));
      assert.ok(csvText.includes("Tổng số sự cố ghi nhận,20,vụ"));
      assert.ok(csvText.includes("Tỷ lệ tuân thủ HSE,25,%"));
      assert.ok(csvText.includes("NO_HARD_HAT"));
      assert.ok(csvText.includes("NO_SAFETY_VEST"));
      assert.ok(csvText.includes(liveCameraId));
      const expectedWeekKey = getIsoWeekString(
        new Date("2026-11-15T00:00:00.000Z"),
      );
      assert.ok(csvText.includes(`${expectedWeekKey},20,15,5,16`));
    });

    it("should reject cross-site report download/content and Viewer POST /generate with 403 FORBIDDEN", async (t) => {
      if (!dbAvailable) {
        t.skip("PostgreSQL ppe_reporting_db is unavailable");
        return;
      }

      const crossDl = await requestJson(
        `/api/v1/reports/${reportCId}/download`,
        viewerToken,
      );
      assert.strictEqual(crossDl.status, 403);
      assert.strictEqual(crossDl.body.code, ERROR_CODE.FORBIDDEN);

      const crossContent = await requestJson(
        `/api/v1/reports/${reportCId}/content`,
        viewerToken,
      );
      assert.strictEqual(crossContent.status, 403);
      assert.strictEqual(crossContent.body.code, ERROR_CODE.FORBIDDEN);

      const genRes = await requestJson(
        "/api/v1/reports/generate",
        viewerToken,
        {
          method: "POST",
          body: {
            templateId,
            siteId: liveSiteA,
            reportType: "MONTHLY",
            periodStart: "2026-11-01",
            periodEnd: "2026-11-30",
          },
        },
      );
      assert.strictEqual(genRes.status, 403);
      assert.strictEqual(genRes.body.code, ERROR_CODE.FORBIDDEN);
    });

    it("GET /api/v1/reports/history should return all assigned sites for multi-site non-ADMIN and filter/reject siteId accurately", async (t) => {
      if (!dbAvailable) {
        t.skip("PostgreSQL ppe_reporting_db is unavailable");
        return;
      }

      const allSitesRes = await requestJson(
        "/api/v1/reports/history",
        managerToken,
      );
      assert.strictEqual(allSitesRes.status, 200);
      const allIds = (allSitesRes.body.data as any[]).map((r) => r.id).sort();
      assert.deepStrictEqual(allIds, [reportAId, reportBId].sort());
      assert.strictEqual(allSitesRes.body.meta?.total, 2);
      assert.ok(!allIds.includes(reportCId));

      const siteBRes = await requestJson(
        `/api/v1/reports/history?siteId=${liveSiteB}`,
        managerToken,
      );
      assert.strictEqual(siteBRes.status, 200);
      assert.strictEqual(siteBRes.body.meta?.total, 1);
      assert.deepStrictEqual(
        (siteBRes.body.data as any[]).map((r) => r.id),
        [reportBId],
      );

      const siteCRes = await requestJson(
        `/api/v1/reports/history?siteId=${liveSiteC}`,
        managerToken,
      );
      assert.strictEqual(siteCRes.status, 403);
      assert.strictEqual(siteCRes.body.code, ERROR_CODE.FORBIDDEN);

      // Admin can query siteC directly
      const adminSiteCRes = await requestJson(
        `/api/v1/reports/history?siteId=${liveSiteC}`,
        adminToken,
      );
      assert.strictEqual(adminSiteCRes.status, 200);
      assert.deepStrictEqual(
        (adminSiteCRes.body.data as any[]).map((r) => r.id),
        [reportCId],
      );
    });
  });
});
