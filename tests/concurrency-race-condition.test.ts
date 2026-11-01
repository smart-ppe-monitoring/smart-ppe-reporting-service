import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ReportingRepository } from "../src/modules/reporting/reporting.repository";
import { ReportingService } from "../src/modules/reporting/reporting.service";
import { AppError } from "../src/common/errors/app-error";
import { ERROR_CODE } from "../src/common/errors/error-code";
import fs from "node:fs";
import path from "node:path";

describe("Security Patch Verification: SEC-14 & SEC-15 Concurrency & Race Condition Defense", () => {
  describe("Database Schema Uniqueness & Migration Verifications", () => {
    test("prisma/schema.prisma enforces @@unique([cameraId, statDate]) on AiPerformanceStatistic", () => {
      const schemaPath = path.resolve(__dirname, "../prisma/schema.prisma");
      const schemaContent = fs.readFileSync(schemaPath, "utf-8");

      assert.ok(
        schemaContent.includes("@@unique([cameraId, statDate])"),
        "AiPerformanceStatistic must define composite unique constraint @@unique([cameraId, statDate])",
      );
    });

    test("prisma/schema.prisma enforces @@unique([modelId, version]) on AiModelVersion", () => {
      const schemaPath = path.resolve(__dirname, "../prisma/schema.prisma");
      const schemaContent = fs.readFileSync(schemaPath, "utf-8");

      assert.ok(
        schemaContent.includes("@@unique([modelId, version])"),
        "AiModelVersion must define composite unique constraint @@unique([modelId, version])",
      );
    });

    test("migration SQL contains unique indices for both models", () => {
      const migrationDir = path.resolve(
        __dirname,
        "../prisma/migrations/20261101180000_add_unique_constraints_for_ai_telemetry_and_model_version",
      );
      assert.ok(fs.existsSync(migrationDir), "Migration directory must exist");
      const migrationSql = fs.readFileSync(
        path.join(migrationDir, "migration.sql"),
        "utf-8",
      );

      assert.ok(
        migrationSql.includes(
          'CREATE UNIQUE INDEX "ai_performance_statistics_camera_id_stat_date_key"',
        ),
        "Migration must create unique index on ai_performance_statistics(camera_id, stat_date)",
      );
      assert.ok(
        migrationSql.includes(
          'CREATE UNIQUE INDEX "ai_model_versions_model_id_version_key"',
        ),
        "Migration must create unique index on ai_model_versions(model_id, version)",
      );
    });
  });

  describe("SEC-14: AI Performance Telemetry Ingestion Concurrency & P2002 Graceful Recovery", () => {
    test("creates new telemetry record when no existing record exists", async () => {
      const repo = new ReportingRepository();
      let createdData: any = null;

      const mockPrisma: any = {
        aiPerformanceStatistic: {
          findUnique: async () => null,
          create: async ({ data }: any) => {
            createdData = data;
            return {
              id: "0192e21b-8321-789a-bcde-000000000010",
              ...data,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          },
        },
      };

      Object.defineProperty(repo, "prisma", {
        get: () => mockPrisma,
        configurable: true,
      });

      const res = await repo.recordAiPerformanceMetric({
        cameraId: "0192e21b-8321-789a-bcde-000000000001",
        statDate: "2026-11-01",
        fps: 28.5,
        latencyMs: 34.2,
        frameCount: 100,
      });

      assert.equal(res.cameraId, "0192e21b-8321-789a-bcde-000000000001");
      assert.equal(res.avgFps, 28.5);
      assert.equal(res.avgLatencyMs, 34.2);
      assert.equal(res.totalFrames, "100");
      assert.equal(createdData.totalFrames, 100n);
    });

    test("performs weighted average update when record already exists", async () => {
      const repo = new ReportingRepository();
      let updatedData: any = null;

      const mockPrisma: any = {
        aiPerformanceStatistic: {
          findUnique: async () => ({
            id: "0192e21b-8321-789a-bcde-000000000010",
            cameraId: "0192e21b-8321-789a-bcde-000000000001",
            statDate: new Date("2026-11-01T00:00:00.000Z"),
            avgFps: 30.0,
            avgLatencyMs: 30.0,
            maxLatencyMs: 40,
            totalFrames: 100n,
            modelVersionId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
          update: async ({ data }: any) => {
            updatedData = data;
            return {
              id: "0192e21b-8321-789a-bcde-000000000010",
              cameraId: "0192e21b-8321-789a-bcde-000000000001",
              statDate: new Date("2026-11-01T00:00:00.000Z"),
              ...data,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          },
        },
      };

      Object.defineProperty(repo, "prisma", {
        get: () => mockPrisma,
        configurable: true,
      });

      const res = await repo.recordAiPerformanceMetric({
        cameraId: "0192e21b-8321-789a-bcde-000000000001",
        statDate: "2026-11-01",
        fps: 20.0,
        latencyMs: 50.0,
        frameCount: 100,
      });

      // (30*100 + 20*100)/200 = 25.0 FPS
      // (30*100 + 50*100)/200 = 40.0 ms Latency
      assert.equal(res.avgFps, 25.0);
      assert.equal(res.avgLatencyMs, 40.0);
      assert.equal(res.totalFrames, "200");
      assert.equal(updatedData.maxLatencyMs, 50);
    });

    test("recovers gracefully from P2002 race condition on concurrent creation without dropping data", async () => {
      const repo = new ReportingRepository();
      let findUniqueCount = 0;
      let updatedData: any = null;

      const concurrentExistingRecord = {
        id: "0192e21b-8321-789a-bcde-000000000010",
        cameraId: "0192e21b-8321-789a-bcde-000000000001",
        statDate: new Date("2026-11-01T00:00:00.000Z"),
        avgFps: 30.0,
        avgLatencyMs: 30.0,
        maxLatencyMs: 35,
        totalFrames: 50n,
        modelVersionId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockPrisma: any = {
        aiPerformanceStatistic: {
          findUnique: async () => {
            findUniqueCount++;
            // On first lookup: simulate cache/find miss (race condition check)
            if (findUniqueCount === 1) return null;
            // On second lookup inside catch block: competing concurrent request has created it
            return concurrentExistingRecord;
          },
          create: async () => {
            // Simulate PostgreSQL unique constraint collision P2002
            const error: any = new Error(
              "Unique constraint failed on the fields: (`camera_id`,`stat_date`)",
            );
            error.code = "P2002";
            throw error;
          },
          update: async ({ data }: any) => {
            updatedData = data;
            return {
              ...concurrentExistingRecord,
              ...data,
            };
          },
        },
      };

      Object.defineProperty(repo, "prisma", {
        get: () => mockPrisma,
        configurable: true,
      });

      // Issue request that experiences collision
      const res = await repo.recordAiPerformanceMetric({
        cameraId: "0192e21b-8321-789a-bcde-000000000001",
        statDate: "2026-11-01",
        fps: 20.0,
        latencyMs: 50.0,
        frameCount: 50,
      });

      // Verify that instead of throwing 500 error, it caught P2002 and merged stats
      assert.equal(findUniqueCount, 2);
      // (30*50 + 20*50)/100 = 25.0 FPS
      assert.equal(res.avgFps, 25.0);
      assert.equal(res.avgLatencyMs, 40.0);
      assert.equal(res.totalFrames, "100");
      assert.equal(updatedData.maxLatencyMs, 50);
    });
  });

  describe("SEC-15: AI Model Version Creation Race Condition Defense", () => {
    test("rejects duplicate version in application check with 409 DUPLICATE_ENTRY", async () => {
      const mockRepo: any = {
        findAiModelById: async () => ({
          id: "0192e21b-8321-789a-bcde-000000000001",
          name: "PPE Detector",
        }),
        findAiModelVersionByModelAndVersion: async () => ({
          id: "0192e21b-8321-789a-bcde-000000000002",
          version: "1.0.0",
        }),
      };

      const service = new ReportingService(mockRepo);

      await assert.rejects(
        async () => {
          await service.createAiModelVersion(
            "0192e21b-8321-789a-bcde-000000000001",
            { version: "1.0.0" },
          );
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 409);
          assert.equal(err.code, ERROR_CODE.DUPLICATE_ENTRY);
          assert.ok(err.message.includes("already exists"));
          return true;
        },
      );
    });

    test("intercepts database P2002 unique constraint violation on concurrent race condition and returns 409", async () => {
      const mockRepo: any = {
        findAiModelById: async () => ({
          id: "0192e21b-8321-789a-bcde-000000000001",
          name: "PPE Detector",
        }),
        findAiModelVersionByModelAndVersion: async () => null, // Both concurrent requests pass find step
        createAiModelVersion: async () => {
          // Database throws P2002 because competing transaction committed first
          const error: any = new Error(
            'Unique constraint failed on the constraint: "ai_model_versions_model_id_version_key"',
          );
          error.code = "P2002";
          throw error;
        },
      };

      const service = new ReportingService(mockRepo);

      await assert.rejects(
        async () => {
          await service.createAiModelVersion(
            "0192e21b-8321-789a-bcde-000000000001",
            { version: "1.0.0" },
          );
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 409);
          assert.equal(err.code, ERROR_CODE.DUPLICATE_ENTRY);
          assert.ok(err.message.includes("already exists"));
          return true;
        },
      );
    });
  });
});
