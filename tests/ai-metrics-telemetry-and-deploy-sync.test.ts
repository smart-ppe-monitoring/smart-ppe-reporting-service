import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import reportingApp from "../src/reporting.app";
import { reportingPrisma } from "../src/database/reporting.client";
import { jwtConfig } from "../src/config/jwt.config";
import { envConfig } from "../src/config/env.config";
import { GATEWAY_HEADERS } from "../src/common/constants/gateway.constant";
import { EVENT_NAMES } from "../src/common/constants/event.constant";
import { JWT_ALGORITHM, JWT_PURPOSE } from "../src/common/constants/jwt.constant";
import { PERMISSIONS } from "../src/common/constants/permission.constant";
import { ROLES } from "../src/common/constants/role.constant";
import {
  AI_MODEL_DEPLOY_SYNC_CHANNEL,
  AI_MODEL_DEPLOY_SYNC_STATUS,
  AI_MODEL_STATUS,
} from "../src/common/constants/reporting.constant";
import { ERROR_CODE } from "../src/common/errors/error-code";
import { AppError } from "../src/common/errors/app-error";
import { recordAiPerformanceSchema } from "../src/modules/reporting/reporting.validation";
import { ReportingRepository } from "../src/modules/reporting/reporting.repository";
import {
  DefaultAiModelDeployNotifier,
  ReportingService,
} from "../src/modules/reporting/reporting.service";
import { statisticRouter } from "../src/modules/reporting/reporting.route";
import { CsvReportEngine } from "../src/modules/reporting/engines/csv.engine";
import { AggregatedReportDataDto } from "../src/modules/reporting/reporting.dto";

describe("Issue #5: AI p95LatencyMs, e2eAlertLatencyMs, Internal M2M Telemetry & Deploy Sync", () => {
  describe("1. Validation Schema & Repository Aggregation (p95LatencyMs, e2eAlertLatencyMs)", () => {
    it("recordAiPerformanceSchema accepts optional p95LatencyMs and e2eAlertLatencyMs and stays backwards-compatible", () => {
      const legacyPayload = recordAiPerformanceSchema.safeParse({
        cameraId: "0192e21b-8321-789a-bcde-000000000001",
        fps: 28.5,
        latencyMs: 32.1,
        frameCount: 150,
      });
      assert.equal(legacyPayload.success, true);
      if (legacyPayload.success) {
        assert.equal(legacyPayload.data.p95LatencyMs, undefined);
        assert.equal(legacyPayload.data.e2eAlertLatencyMs, undefined);
      }

      const extendedPayload = recordAiPerformanceSchema.safeParse({
        cameraId: "0192e21b-8321-789a-bcde-000000000001",
        fps: 28.5,
        latencyMs: 32.1,
        p95LatencyMs: 54.8,
        e2eAlertLatencyMs: 0,
        frameCount: 150,
      });
      assert.equal(extendedPayload.success, true);
      if (extendedPayload.success) {
        assert.equal(extendedPayload.data.p95LatencyMs, 54.8);
        assert.equal(extendedPayload.data.e2eAlertLatencyMs, 0);
      }

      for (const bad of [
        { p95LatencyMs: -1 },
        { e2eAlertLatencyMs: -0.5 },
        { p95LatencyMs: 60_001 },
        { e2eAlertLatencyMs: 60_001 },
        { p95LatencyMs: NaN },
        { e2eAlertLatencyMs: Infinity },
      ]) {
        const res = recordAiPerformanceSchema.safeParse({
          cameraId: "0192e21b-8321-789a-bcde-000000000001",
          fps: 25,
          latencyMs: 30,
          frameCount: 10,
          ...bad,
        });
        assert.equal(
          res.success,
          false,
          `Expected payload ${JSON.stringify(bad)} to be rejected`,
        );
      }
    });

    it("mounts /internal/record-ai-performance BEFORE authMiddleware and keeps /record-ai-performance AFTER authMiddleware", () => {
      const stack = (statisticRouter as any).stack as any[];
      const authIdx = stack.findIndex(
        (layer) => !layer.route && layer.name === "authMiddleware",
      );
      assert.ok(authIdx >= 0, "authMiddleware must exist on statisticRouter");

      const routePositions = stack
        .filter((layer) => layer.route?.path)
        .map((layer) => ({
          path: layer.route.path,
          idx: stack.indexOf(layer),
        }));

      const internalRoute = routePositions.find(
        (r) => r.path === "/internal/record-ai-performance",
      );
      const userRoute = routePositions.find(
        (r) => r.path === "/record-ai-performance",
      );

      assert.ok(internalRoute, "/internal/record-ai-performance must exist");
      assert.ok(userRoute, "/record-ai-performance must exist");
      assert.ok(
        internalRoute.idx < authIdx,
        "/internal/record-ai-performance must be mounted BEFORE authMiddleware",
      );
      assert.ok(
        userRoute.idx > authIdx,
        "/record-ai-performance must stay behind authMiddleware",
      );
    });

    it("repository aggregates weighted p95LatencyMs & e2eAlertLatencyMs, preserves omitted fields, and guards NaN/negative values", async () => {
      let storedRow: any = null;
      const mockPrisma: any = {
        aiPerformanceStatistic: {
          findUnique: async () => storedRow,
          create: async ({ data }: any) => {
            storedRow = {
              id: "0192e21b-8321-789a-bcde-000000000099",
              ...data,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            return storedRow;
          },
          update: async ({ data }: any) => {
            storedRow = {
              ...storedRow,
              ...data,
              updatedAt: new Date(),
            };
            return storedRow;
          },
        },
      };

      const repo = new ReportingRepository(mockPrisma);

      // 1. Initial batch with null optional fields
      const first = await repo.recordAiPerformanceMetric({
        cameraId: "0192e21b-8321-789a-bcde-000000000001",
        statDate: "2026-11-25",
        fps: 30,
        latencyMs: 25,
        frameCount: 100,
      });
      assert.equal(first.p95LatencyMs, null);
      assert.equal(first.e2eAlertLatencyMs, null);

      // 2. Second batch supplies p95LatencyMs & e2eAlertLatencyMs on previously null row
      const second = await repo.recordAiPerformanceMetric({
        cameraId: "0192e21b-8321-789a-bcde-000000000001",
        statDate: "2026-11-25",
        fps: 20,
        latencyMs: 45,
        p95LatencyMs: 60,
        e2eAlertLatencyMs: 400,
        frameCount: 100,
      });
      assert.equal(second.avgFps, 25);
      assert.equal(second.avgLatencyMs, 35);
      assert.equal(second.maxLatencyMs, 60);
      assert.equal(second.p95LatencyMs, 60);
      assert.equal(second.e2eAlertLatencyMs, 400);
      assert.equal(second.totalFrames, "200");

      // 3. Third batch merges weighted average accurately:
      // p95 = (60*200 + 90*100)/300 = 70
      // e2e = (400*200 + 250*100)/300 = 350
      const third = await repo.recordAiPerformanceMetric({
        cameraId: "0192e21b-8321-789a-bcde-000000000001",
        statDate: "2026-11-25",
        fps: 25,
        latencyMs: 35,
        p95LatencyMs: 90,
        e2eAlertLatencyMs: 250,
        frameCount: 100,
      });
      assert.equal(third.p95LatencyMs, 70);
      assert.equal(third.e2eAlertLatencyMs, 350);
      assert.equal(third.maxLatencyMs, 90);
      assert.equal(third.totalFrames, "300");

      // 4. Fourth batch omits p95LatencyMs & e2eAlertLatencyMs -> preserves existing values
      const fourth = await repo.recordAiPerformanceMetric({
        cameraId: "0192e21b-8321-789a-bcde-000000000001",
        statDate: "2026-11-25",
        fps: 25,
        latencyMs: 35,
        frameCount: 100,
      });
      assert.equal(fourth.p95LatencyMs, 70);
      assert.equal(fourth.e2eAlertLatencyMs, 350);

      // 5. Repository rejects non-finite / negative p95LatencyMs or e2eAlertLatencyMs
      await assert.rejects(
        () =>
          repo.recordAiPerformanceMetric({
            cameraId: "0192e21b-8321-789a-bcde-000000000001",
            fps: 25,
            latencyMs: 30,
            p95LatencyMs: -5,
            frameCount: 10,
          }),
        (err: any) =>
          err instanceof AppError &&
          err.statusCode === 400 &&
          err.code === ERROR_CODE.VALIDATION_ERROR,
      );
    });

    it("CsvReportEngine includes p95LatencyMs and e2eAlertLatencyMs columns in AI telemetry section", () => {
      const data: AggregatedReportDataDto = {
        reportId: "rep-ai-cols",
        reportType: "AI_PERFORMANCE",
        siteId: "0192e21b-8321-789a-bcde-000000000011",
        periodStart: "2026-11-25",
        periodEnd: "2026-11-25",
        generatedBy: "0192e21b-8321-789a-bcde-000000000012",
        generatedAt: "2026-11-25T10:00:00.000Z",
        summary: {
          totalIncidents: 0,
          openIncidents: 0,
          resolvedIncidents: 0,
          trueViolations: 0,
          falseAlarms: 0,
          falseAlarmRate: 0,
          complianceRate: 100,
          meanTimeToResolveHours: 0,
          severityBreakdown: {
            CRITICAL: { count: 0, resolved: 0, targetSlaMinutes: 15, actualMttrMinutes: 0 },
            HIGH: { count: 0, resolved: 0, targetSlaMinutes: 30, actualMttrMinutes: 0 },
            MEDIUM: { count: 0, resolved: 0, targetSlaMinutes: 60, actualMttrMinutes: 0 },
            LOW: { count: 0, resolved: 0, targetSlaMinutes: 120, actualMttrMinutes: 0 },
          },
        },
        violationsBreakdown: [],
        cameraRankings: [],
        trends: [],
        aiPerformance: [
          {
            id: "ai-metric-1",
            cameraId: "0192e21b-8321-789a-bcde-000000000055",
            modelVersionId: null,
            statDate: "2026-11-25",
            avgFps: 29.2,
            avgLatencyMs: 31.5,
            maxLatencyMs: 74,
            p95LatencyMs: 56.4,
            e2eAlertLatencyMs: 380.2,
            totalFrames: "15000",
          },
        ],
      };

      const csvText = CsvReportEngine.generate(data).toString("utf-8");
      assert.ok(
        csvText.includes("Tổng frames suy luận,Độ trễ P95 (ms),Độ trễ cảnh báo E2E (ms)"),
      );
      assert.ok(csvText.includes("29.2,31.5,74,15000,56.4,380.2"));
    });
  });

  describe("2. Deploy Model Version AI Runtime Sync", () => {
    const modelId = "0192e21b-8321-789a-bcde-000000000201";
    const versionId = "0192e21b-8321-789a-bcde-000000000202";

    const createMockRepo = () => ({
      findAiModelById: async () => ({
        id: modelId,
        code: "YOLO_PPE_V11",
        name: "YOLOv11 PPE Detector",
        modelType: "OBJECT_DETECTION",
        status: AI_MODEL_STATUS.ACTIVE,
      }),
      findAiModelVersionById: async () => ({
        id: versionId,
        modelId,
        version: "2.1.0",
        modelPath: "models/yolo11m-ppe.pt",
        framework: "PyTorch",
        inputSize: "640x640",
        status: "DEVELOPMENT",
      }),
      deployAiModelVersion: async () => ({
        id: versionId,
        modelId,
        version: "2.1.0",
        modelPath: "models/yolo11m-ppe.pt",
        framework: "PyTorch",
        inputSize: "640x640",
        status: "DEPLOYED",
        metrics: null,
        deployedAt: "2026-11-25T11:00:00.000Z",
        createdAt: "2026-11-25T10:00:00.000Z",
      }),
    });

    it("syncs over HTTP + Redis and includes aiRuntimeSync in deployed DTO and audit log", async () => {
      let capturedHttpCall: any = null;
      let capturedRedisCall: any = null;
      let capturedAudit: any = null;

      const notifier = new DefaultAiModelDeployNotifier({
        serviceUrl: "http://ai-engine.internal:8000",
        syncEnabled: true,
        timeoutMs: 2000,
        internalServiceToken: "m2m-secret-token-32-characters-long!",
        gatewayInternalSecret: "gw-secret-token-32-characters-long!",
        httpClient: async (url, options) => {
          capturedHttpCall = { url, options };
          return { ok: true, status: 200, data: { status: "synced" } };
        },
        redisPublisher: async (channel, message) => {
          capturedRedisCall = { channel, message: JSON.parse(message) };
          return true;
        },
      });

      const auditLogger = {
        createAuditLog: async (data: any) => {
          capturedAudit = data;
          return data;
        },
      };

      const service = new ReportingService(
        createMockRepo() as any,
        auditLogger,
        notifier,
      );

      const res = await service.deployAiModelVersion(modelId, versionId, {
        actorId: "admin-1",
        requestId: "req-sync-001",
      });

      assert.equal(res.status, "DEPLOYED");
      assert.equal(res.aiRuntimeSync.status, AI_MODEL_DEPLOY_SYNC_STATUS.SYNCED);
      assert.equal(
        res.aiRuntimeSync.channel,
        AI_MODEL_DEPLOY_SYNC_CHANNEL.HTTP_AND_REDIS,
      );
      assert.equal(res.aiRuntimeSync.synced, true);
      assert.equal(res.aiRuntimeSync.httpStatus, 200);
      assert.equal(res.aiRuntimeSync.redisPublished, true);
      assert.equal(res.aiRuntimeSync.eventName, EVENT_NAMES.PPE_AI_MODEL_DEPLOYED);

      assert.equal(capturedHttpCall.url, "http://ai-engine.internal:8000/api/live/sync");
      assert.equal(capturedHttpCall.options.method, "POST");
      assert.equal(
        capturedHttpCall.options.headers[GATEWAY_HEADERS.INTERNAL_SERVICE_TOKEN],
        "m2m-secret-token-32-characters-long!",
      );
      assert.equal(
        capturedHttpCall.options.headers[GATEWAY_HEADERS.INTERNAL_SECRET],
        "gw-secret-token-32-characters-long!",
      );
      assert.equal(
        capturedHttpCall.options.headers[GATEWAY_HEADERS.REQUEST_ID],
        "req-sync-001",
      );
      assert.equal(capturedHttpCall.options.body.versionId, versionId);
      assert.equal(capturedHttpCall.options.body.version, "2.1.0");
      assert.equal(capturedHttpCall.options.body.modelCode, "YOLO_PPE_V11");

      assert.equal(capturedRedisCall.channel, EVENT_NAMES.PPE_AI_MODEL_DEPLOYED);
      assert.equal(capturedRedisCall.message.versionId, versionId);
      assert.equal(capturedAudit.details.aiRuntimeSync.status, AI_MODEL_DEPLOY_SYNC_STATUS.SYNCED);
    });

    it("falls back to EVENT_PUBLISHED via Redis when HTTP fails, and degrades to FAILED without throwing when both fail", async () => {
      const redisFallbackNotifier = new DefaultAiModelDeployNotifier({
        serviceUrl: "http://127.0.0.1:59998",
        syncEnabled: true,
        httpClient: async () => ({
          ok: false,
          status: 500,
          error: "ECONNREFUSED",
        }),
        redisPublisher: async () => true,
      });

      const serviceWithRedis = new ReportingService(
        createMockRepo() as any,
        { createAuditLog: async (d: any) => d },
        redisFallbackNotifier,
      );
      const resRedis = await serviceWithRedis.deployAiModelVersion(modelId, versionId);
      assert.equal(
        resRedis.aiRuntimeSync.status,
        AI_MODEL_DEPLOY_SYNC_STATUS.EVENT_PUBLISHED,
      );
      assert.equal(resRedis.aiRuntimeSync.channel, AI_MODEL_DEPLOY_SYNC_CHANNEL.REDIS);
      assert.equal(resRedis.aiRuntimeSync.synced, true);

      const offlineNotifier = new DefaultAiModelDeployNotifier({
        serviceUrl: "http://127.0.0.1:59998",
        syncEnabled: true,
        httpClient: async () => ({
          ok: false,
          status: 504,
          error: "Request timed out",
        }),
        redisPublisher: async () => false,
      });

      const serviceOffline = new ReportingService(
        createMockRepo() as any,
        { createAuditLog: async (d: any) => d },
        offlineNotifier,
      );
      const resOffline = await serviceOffline.deployAiModelVersion(modelId, versionId);
      assert.equal(resOffline.status, "DEPLOYED");
      assert.equal(
        resOffline.aiRuntimeSync.status,
        AI_MODEL_DEPLOY_SYNC_STATUS.FAILED,
      );
      assert.equal(resOffline.aiRuntimeSync.channel, AI_MODEL_DEPLOY_SYNC_CHANNEL.NONE);
      assert.equal(resOffline.aiRuntimeSync.synced, false);
    });

    it("DefaultAiModelDeployNotifier performs real HTTP POST round-trip against mock AI server", async () => {
      let receivedBody: any = null;
      let receivedTokenHeader = "";

      const mockAiServer = http.createServer((req, res) => {
        if (req.method === "POST" && req.url === "/api/live/sync") {
          receivedTokenHeader =
            (req.headers[GATEWAY_HEADERS.INTERNAL_SERVICE_TOKEN] as string) || "";
          const chunks: Buffer[] = [];
          req.on("data", (c) => chunks.push(c));
          req.on("end", () => {
            receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ status: "synced" }));
          });
          return;
        }
        res.writeHead(404);
        res.end();
      });

      await new Promise<void>((resolve) =>
        mockAiServer.listen(0, "127.0.0.1", () => resolve()),
      );
      const addr = mockAiServer.address() as AddressInfo;

      try {
        const notifier = new DefaultAiModelDeployNotifier({
          serviceUrl: `http://127.0.0.1:${addr.port}`,
          syncEnabled: true,
          internalServiceToken: "real-http-roundtrip-token-32chars!",
          redisPublisher: async () => false,
        });

        const result = await notifier.notifyModelDeployed({
          eventName: EVENT_NAMES.PPE_AI_MODEL_DEPLOYED,
          modelId,
          modelCode: "YOLO_PPE_V11",
          modelName: "YOLOv11 PPE Detector",
          modelType: "OBJECT_DETECTION",
          versionId,
          version: "2.1.0",
          modelPath: "models/yolo11m-ppe.pt",
          framework: "PyTorch",
          inputSize: "640x640",
          deployedAt: "2026-11-25T11:00:00.000Z",
        });

        assert.equal(result.status, AI_MODEL_DEPLOY_SYNC_STATUS.SYNCED);
        assert.equal(result.channel, AI_MODEL_DEPLOY_SYNC_CHANNEL.HTTP);
        assert.equal(result.httpStatus, 200);
        assert.equal(receivedTokenHeader, "real-http-roundtrip-token-32chars!");
        assert.equal(receivedBody?.trigger, EVENT_NAMES.PPE_AI_MODEL_DEPLOYED);
        assert.equal(receivedBody?.versionId, versionId);
      } finally {
        await new Promise<void>((resolve) => mockAiServer.close(() => resolve()));
      }
    });
  });

  describe("3. Live PostgreSQL (ppe_reporting_db) & HTTP E2E Integration", () => {
    let dbAvailable = false;
    let server: http.Server | null = null;
    let baseUrl = "";
    let originalPublicKey = "";
    let originalInternalToken = "";
    let metricsReadToken = "";
    let modelManageToken = "";

    const testCameraId = crypto.randomUUID();
    const testStatDate = "2026-11-25";
    let createdModelId = "";
    let createdVersion1Id = "";
    let createdVersion2Id = "";
    const activeInternalToken = "e2e-internal-service-token-32-chars!";

    function buildGatewayHeaders(extra?: Record<string, string>) {
      const headers: Record<string, string> = {};
      if (envConfig.gateway.internalSecret) {
        headers[GATEWAY_HEADERS.INTERNAL_SECRET] =
          envConfig.gateway.internalSecret;
      }
      return extra ? { ...headers, ...extra } : headers;
    }

    async function requestJson(
      path: string,
      init: {
        method?: string;
        headers?: Record<string, string>;
        body?: unknown;
      } = {},
    ) {
      const extraHeaders: Record<string, string> = { ...(init.headers || {}) };
      if (init.body !== undefined) {
        extraHeaders["content-type"] = "application/json";
      }
      const res = await fetch(`${baseUrl}${path}`, {
        method: init.method || "GET",
        headers: buildGatewayHeaders(extraHeaders),
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      const text = await res.text();
      return {
        status: res.status,
        body: text ? JSON.parse(text) : null,
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

      originalInternalToken = envConfig.internalService.token;
      (envConfig.internalService as any).token = activeInternalToken;

      const suffix = crypto.randomBytes(4).toString("hex").toUpperCase();
      const model = await reportingPrisma.aiModel.create({
        data: {
          name: `Test AI Model ${suffix}`,
          code: `IT_AI_${suffix}`,
          modelType: "OBJECT_DETECTION",
          status: "ACTIVE",
        },
      });
      createdModelId = model.id;

      const v1 = await reportingPrisma.aiModelVersion.create({
        data: {
          modelId: createdModelId,
          version: "1.0.0",
          modelPath: "models/yolo-v1.pt",
          framework: "PyTorch",
          inputSize: "640x640",
          status: "DEPLOYED",
          deployedAt: new Date("2026-11-24T08:00:00.000Z"),
        },
      });
      createdVersion1Id = v1.id;

      const v2 = await reportingPrisma.aiModelVersion.create({
        data: {
          modelId: createdModelId,
          version: "2.0.0",
          modelPath: "models/yolo-v2.pt",
          framework: "PyTorch",
          inputSize: "640x640",
          status: "DEVELOPMENT",
        },
      });
      createdVersion2Id = v2.id;

      metricsReadToken = jwt.sign(
        {
          id: crypto.randomUUID(),
          email: "metrics-reader@smartppe.local",
          role: ROLES.SAFETY_OFFICER,
          permissions: [PERMISSIONS.PPE_AI_METRICS_READ],
          purpose: JWT_PURPOSE.ACCESS,
        },
        privateKey,
        { algorithm: JWT_ALGORITHM.RS256, expiresIn: "10m" },
      );

      modelManageToken = jwt.sign(
        {
          id: crypto.randomUUID(),
          email: "model-admin@smartppe.local",
          role: ROLES.ADMIN,
          permissions: [
            PERMISSIONS.PPE_MODEL_MANAGE,
            PERMISSIONS.PPE_AI_METRICS_READ,
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
        await reportingPrisma.aiPerformanceStatistic
          .deleteMany({ where: { cameraId: testCameraId } })
          .catch(() => {});
        if (createdModelId) {
          await reportingPrisma.aiModelVersion
            .deleteMany({ where: { modelId: createdModelId } })
            .catch(() => {});
          await reportingPrisma.aiModel
            .deleteMany({ where: { id: createdModelId } })
            .catch(() => {});
        }
      }
      if (server) {
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      }
      if (originalPublicKey !== undefined) {
        (jwtConfig as any).publicKey = originalPublicKey;
      }
      (envConfig.internalService as any).token = originalInternalToken;
      await reportingPrisma.$disconnect().catch(() => {});
    });

    it("enforces requireInternalServiceToken (401/403) and persists/aggregates p95LatencyMs & e2eAlertLatencyMs via POST /internal/record-ai-performance + GET /ai-performance", async (t) => {
      if (!dbAvailable) {
        t.skip("PostgreSQL ppe_reporting_db is unavailable");
        return;
      }

      // 1. Missing internal token -> 401
      const noTokenRes = await requestJson(
        "/api/v1/statistics/internal/record-ai-performance",
        {
          method: "POST",
          body: {
            cameraId: testCameraId,
            fps: 25,
            latencyMs: 30,
            frameCount: 100,
          },
        },
      );
      assert.equal(noTokenRes.status, 401);

      // 2. Wrong internal token -> 403
      const badTokenRes = await requestJson(
        "/api/v1/statistics/internal/record-ai-performance",
        {
          method: "POST",
          headers: {
            [GATEWAY_HEADERS.INTERNAL_SERVICE_TOKEN]: "wrong-internal-token",
          },
          body: {
            cameraId: testCameraId,
            fps: 25,
            latencyMs: 30,
            frameCount: 100,
          },
        },
      );
      assert.equal(badTokenRes.status, 403);

      // 3. First valid telemetry batch (100 frames)
      const batch1 = await requestJson(
        "/api/v1/statistics/internal/record-ai-performance",
        {
          method: "POST",
          headers: {
            [GATEWAY_HEADERS.INTERNAL_SERVICE_TOKEN]: activeInternalToken,
          },
          body: {
            cameraId: testCameraId,
            modelVersionId: createdVersion1Id,
            statDate: testStatDate,
            fps: 30,
            latencyMs: 28,
            p95LatencyMs: 42,
            e2eAlertLatencyMs: 310,
            frameCount: 100,
          },
        },
      );
      assert.equal(batch1.status, 201);
      assert.equal(batch1.body.data.p95LatencyMs, 42);
      assert.equal(batch1.body.data.e2eAlertLatencyMs, 310);

      // 4. Second valid telemetry batch (100 frames -> exact weighted average)
      const batch2 = await requestJson(
        "/api/v1/statistics/internal/record-ai-performance",
        {
          method: "POST",
          headers: {
            [GATEWAY_HEADERS.INTERNAL_SERVICE_TOKEN]: activeInternalToken,
          },
          body: {
            cameraId: testCameraId,
            modelVersionId: createdVersion1Id,
            statDate: testStatDate,
            fps: 20,
            latencyMs: 44,
            p95LatencyMs: 68,
            e2eAlertLatencyMs: 490,
            frameCount: 100,
          },
        },
      );
      assert.equal(batch2.status, 201);
      assert.equal(batch2.body.data.avgFps, 25);
      assert.equal(batch2.body.data.avgLatencyMs, 36);
      assert.equal(batch2.body.data.p95LatencyMs, 55);
      assert.equal(batch2.body.data.e2eAlertLatencyMs, 400);
      assert.equal(batch2.body.data.maxLatencyMs, 68);
      assert.equal(batch2.body.data.totalFrames, "200");

      // 5. Direct PostgreSQL query verification on ppe_reporting_db
      const dbRow = await reportingPrisma.aiPerformanceStatistic.findUnique({
        where: {
          cameraId_statDate: {
            cameraId: testCameraId,
            statDate: new Date(testStatDate),
          },
        },
      });
      assert.ok(dbRow);
      assert.equal(Number(dbRow.p95LatencyMs), 55);
      assert.equal(Number(dbRow.e2eAlertLatencyMs), 400);
      assert.equal(dbRow.totalFrames, 200n);

      // 6. GET /api/v1/statistics/ai-performance returns new fields for FE charts
      const getRes = await requestJson(
        `/api/v1/statistics/ai-performance?cameraId=${testCameraId}&startDate=${testStatDate}&endDate=${testStatDate}`,
        {
          headers: {
            authorization: `Bearer ${metricsReadToken}`,
          },
        },
      );
      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.data.length, 1);
      assert.equal(getRes.body.data[0].p95LatencyMs, 55);
      assert.equal(getRes.body.data[0].e2eAlertLatencyMs, 400);
      assert.equal(getRes.body.data[0].totalFrames, "200");
    });

    it("PATCH /api/v1/ai-models/:id/versions/:versionId/deploy archives old version, deploys target, and returns aiRuntimeSync", async (t) => {
      if (!dbAvailable) {
        t.skip("PostgreSQL ppe_reporting_db is unavailable");
        return;
      }

      const deployRes = await requestJson(
        `/api/v1/ai-models/${createdModelId}/versions/${createdVersion2Id}/deploy`,
        {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${modelManageToken}`,
          },
        },
      );
      assert.equal(deployRes.status, 200);
      assert.equal(deployRes.body.data.id, createdVersion2Id);
      assert.equal(deployRes.body.data.status, "DEPLOYED");
      assert.ok(deployRes.body.data.aiRuntimeSync);
      assert.equal(
        deployRes.body.data.aiRuntimeSync.eventName,
        EVENT_NAMES.PPE_AI_MODEL_DEPLOYED,
      );
      assert.ok(
        [
          AI_MODEL_DEPLOY_SYNC_STATUS.SYNCED,
          AI_MODEL_DEPLOY_SYNC_STATUS.EVENT_PUBLISHED,
          AI_MODEL_DEPLOY_SYNC_STATUS.FAILED,
          AI_MODEL_DEPLOY_SYNC_STATUS.SKIPPED,
        ].includes(deployRes.body.data.aiRuntimeSync.status),
      );

      const [v1After, v2After] = await Promise.all([
        reportingPrisma.aiModelVersion.findUnique({
          where: { id: createdVersion1Id },
        }),
        reportingPrisma.aiModelVersion.findUnique({
          where: { id: createdVersion2Id },
        }),
      ]);
      assert.equal(v1After?.status, "ARCHIVED");
      assert.equal(v2After?.status, "DEPLOYED");
    });
  });
});
