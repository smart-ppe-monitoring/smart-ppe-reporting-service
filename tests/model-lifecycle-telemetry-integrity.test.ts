import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { recordAiPerformanceSchema } from "../src/modules/reporting/reporting.validation";
import { ReportingRepository } from "../src/modules/reporting/reporting.repository";
import { ReportingService } from "../src/modules/reporting/reporting.service";
import { AppError } from "../src/common/errors/app-error";
import { ERROR_CODE } from "../src/common/errors/error-code";
import {
  AI_MODEL_STATUS,
  AI_MODEL_TYPE,
} from "../src/common/constants/reporting.constant";
import fs from "node:fs";
import path from "node:path";

describe("Security Patch Verification: SEC-21, SEC-22, SEC-34", () => {
  describe("SEC-21: Telemetry Floating-Point Overflow to NaN Prevention", () => {
    test("rejects excessive frameCount exceeding 1,000,000 upper bound", () => {
      const maliciousCases = [
        1_000_001,
        1e6 + 1,
        1e308, // Classic IEEE 754 overflow vector
        Number.MAX_SAFE_INTEGER,
      ];

      for (const frameCount of maliciousCases) {
        const result = recordAiPerformanceSchema.safeParse({
          cameraId: "0192e21b-8321-789a-bcde-000000000001",
          fps: 30,
          latencyMs: 33.3,
          frameCount,
        });

        assert.equal(
          result.success,
          false,
          `Expected frameCount '${frameCount}' to be rejected due to upper bound limit`,
        );
      }
    });

    test("accepts realistic positive integer frameCount up to 1,000,000", () => {
      const validCases = [1, 100, 50000, 1_000_000];

      for (const frameCount of validCases) {
        const result = recordAiPerformanceSchema.safeParse({
          cameraId: "0192e21b-8321-789a-bcde-000000000001",
          fps: 30,
          latencyMs: 33.3,
          frameCount,
        });

        assert.equal(
          result.success,
          true,
          `Expected frameCount '${frameCount}' to pass validation`,
        );
      }
    });

    test("repository rejects non-finite FPS or Latency (NaN/Infinity) with AppError", async () => {
      const repo = new ReportingRepository();

      await assert.rejects(
        async () => {
          await repo.recordAiPerformanceMetric({
            cameraId: "0192e21b-8321-789a-bcde-000000000001",
            fps: NaN as any,
            latencyMs: 30,
            frameCount: 10,
          });
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, ERROR_CODE.VALIDATION_ERROR);
          return true;
        },
      );

      await assert.rejects(
        async () => {
          await repo.recordAiPerformanceMetric({
            cameraId: "0192e21b-8321-789a-bcde-000000000001",
            fps: 30,
            latencyMs: Infinity as any,
            frameCount: 10,
          });
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, ERROR_CODE.VALIDATION_ERROR);
          return true;
        },
      );
    });
  });

  describe("SEC-22: AI Model Lifecycle State Machine Defense", () => {
    test("rejects deployment of version under an INACTIVE or DEPRECATED model", async () => {
      for (const invalidStatus of [
        AI_MODEL_STATUS.INACTIVE,
        AI_MODEL_STATUS.DEPRECATED,
      ]) {
        const mockRepo: any = {
          findAiModelById: async () => ({
            id: "0192e21b-8321-789a-bcde-000000000001",
            name: "Decommissioned Model",
            status: invalidStatus,
          }),
        };

        const service = new ReportingService(mockRepo);

        await assert.rejects(
          async () => {
            await service.deployAiModelVersion(
              "0192e21b-8321-789a-bcde-000000000001",
              "0192e21b-8321-789a-bcde-000000000002",
            );
          },
          (err: any) => {
            assert.ok(err instanceof AppError);
            assert.equal(err.statusCode, 400);
            assert.equal(err.code, ERROR_CODE.VALIDATION_ERROR);
            assert.ok(
              err.message.includes("vô hiệu hóa hoặc ngừng sử dụng"),
            );
            return true;
          },
        );
      }
    });

    test("allows deployment of version under an ACTIVE model", async () => {
      let deployedCalled = false;
      const mockRepo: any = {
        findAiModelById: async () => ({
          id: "0192e21b-8321-789a-bcde-000000000001",
          name: "Active PPE Model",
          status: AI_MODEL_STATUS.ACTIVE,
        }),
        findAiModelVersionById: async () => ({
          id: "0192e21b-8321-789a-bcde-000000000002",
          modelId: "0192e21b-8321-789a-bcde-000000000001",
          version: "2.0.0",
        }),
        deployAiModelVersion: async () => {
          deployedCalled = true;
          return {
            id: "0192e21b-8321-789a-bcde-000000000002",
            modelId: "0192e21b-8321-789a-bcde-000000000001",
            version: "2.0.0",
            status: "DEPLOYED",
            deployedAt: new Date().toISOString(),
          };
        },
      };

      const service = new ReportingService(mockRepo);
      const res = await service.deployAiModelVersion(
        "0192e21b-8321-789a-bcde-000000000001",
        "0192e21b-8321-789a-bcde-000000000002",
      );

      assert.equal(deployedCalled, true);
      assert.equal(res.version, "2.0.0");
    });

    test("findActiveDeployedModelVersion automatically enforces model: { status: 'ACTIVE' }", async () => {
      let capturedWhere: any = null;
      const mockPrisma: any = {
        aiModelVersion: {
          findFirst: async ({ where }: any) => {
            capturedWhere = where;
            return {
              id: "0192e21b-8321-789a-bcde-000000000002",
              modelId: "0192e21b-8321-789a-bcde-000000000001",
              version: "1.0.0",
              modelPath: "models/yolo.pt",
              framework: "PyTorch",
              inputSize: "640x640",
              status: "DEPLOYED",
              metrics: null,
              deployedAt: new Date(),
              createdAt: new Date(),
            };
          },
        },
      };

      const repo = new ReportingRepository();
      Object.defineProperty(repo, "prisma", {
        get: () => mockPrisma,
        configurable: true,
      });

      await repo.findActiveDeployedModelVersion();

      assert.equal(capturedWhere.status, "DEPLOYED");
      assert.deepEqual(capturedWhere.model, {
        status: AI_MODEL_STATUS.ACTIVE,
      });
    });
  });

  describe("SEC-34: Foreign Key Relational Integrity on AI Telemetry", () => {
    test("prisma/schema.prisma and migration enforce relation with onDelete: SetNull", () => {
      const schemaPath = path.resolve(__dirname, "../prisma/schema.prisma");
      const schemaContent = fs.readFileSync(schemaPath, "utf-8");

      assert.ok(
        schemaContent.includes(
          "modelVersion   AiModelVersion? @relation(fields: [modelVersionId], references: [id], onDelete: SetNull)",
        ),
        "AiPerformanceStatistic must define relation to AiModelVersion with onDelete: SetNull",
      );

      const migrationPath = path.resolve(
        __dirname,
        "../prisma/migrations/20261101183000_add_foreign_key_ai_telemetry_model_version/migration.sql",
      );
      assert.ok(fs.existsSync(migrationPath), "Migration SQL file must exist");
      const migrationSql = fs.readFileSync(migrationPath, "utf-8");
      assert.ok(
        migrationSql.includes(
          'FOREIGN KEY ("model_version_id") REFERENCES "ai_model_versions"("id") ON DELETE SET NULL',
        ),
        "Migration SQL must alter table to add foreign key constraint with ON DELETE SET NULL",
      );
    });

    test("recordAiPerformance rejects non-existent modelVersionId with 404 AI_MODEL_VERSION_NOT_FOUND", async () => {
      const mockRepo: any = {
        findAiModelVersionById: async () => null, // Non-existent
      };

      const service = new ReportingService(mockRepo);

      await assert.rejects(
        async () => {
          await service.recordAiPerformance({
            cameraId: "0192e21b-8321-789a-bcde-000000000001",
            modelVersionId: "0192e21b-8321-789a-bcde-999999999999",
            fps: 25,
            latencyMs: 40,
            frameCount: 10,
          });
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.statusCode, 404);
          assert.equal(err.code, ERROR_CODE.AI_MODEL_VERSION_NOT_FOUND);
          return true;
        },
      );
    });

    test("recordAiPerformance accepts valid existing modelVersionId or null", async () => {
      let repoMetricCalled = false;
      const mockRepo: any = {
        findAiModelVersionById: async (id: string) => ({
          id,
          version: "1.0.0",
        }),
        recordAiPerformanceMetric: async (dto: any) => {
          repoMetricCalled = true;
          return {
            id: "0192e21b-8321-789a-bcde-000000000010",
            ...dto,
            avgFps: dto.fps,
            avgLatencyMs: dto.latencyMs,
            totalFrames: "10",
          };
        },
      };

      const service = new ReportingService(mockRepo);
      const res = await service.recordAiPerformance({
        cameraId: "0192e21b-8321-789a-bcde-000000000001",
        modelVersionId: "0192e21b-8321-789a-bcde-000000000002",
        fps: 25,
        latencyMs: 40,
        frameCount: 10,
      });

      assert.equal(repoMetricCalled, true);
      assert.equal(res.modelVersionId, "0192e21b-8321-789a-bcde-000000000002");
    });
  });
});
