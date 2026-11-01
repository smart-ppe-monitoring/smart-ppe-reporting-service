import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createAiModelVersionSchema,
  activeModelVersionQuerySchema,
} from "../src/modules/reporting/reporting.validation";
import { ReportingRepository } from "../src/modules/reporting/reporting.repository";
import { AI_MODEL_TYPE } from "../src/common/constants/reporting.constant";

describe("Security Patch Verification: SEC-05 & SEC-06", () => {
  describe("SEC-05: AI Model Weight Path Validation Preventing Remote Code Execution", () => {
    test("accepts valid model paths pointing to trusted storage with allowed extensions", () => {
      const validCases = [
        "models/yolov8n.pt",
        "models/detector/v1.0.0/model.onnx",
        "models/ppe-yolo-v8/best.engine",
        "s3://ppe-models/yolov8-weights.pt",
        "s3://models-bucket/weights/detector.tflite",
        "models/classifier/model.bin",
      ];

      for (const path of validCases) {
        const result = createAiModelVersionSchema.safeParse({
          version: "1.0.0",
          modelPath: path,
        });
        assert.equal(
          result.success,
          true,
          `Expected path '${path}' to pass validation`,
        );
      }
    });

    test("allows omitting modelPath (optional field)", () => {
      const result = createAiModelVersionSchema.safeParse({
        version: "1.0.0",
      });
      assert.equal(result.success, true);
    });

    test("rejects dangerous external URLs, protocols, and path traversal attempts (RCE vectors)", () => {
      const maliciousCases = [
        "https://attacker.com/weights.pt",
        "http://evil.com/model.onnx",
        "ftp://malicious.host/model.pt",
        "smb://192.168.1.50/share/exploit.pt",
        "file:///etc/passwd",
        "models/../../etc/passwd.pt", // Path traversal
        "models/script.py", // Non-model executable script
        "models/payload.sh",
        "models/backdoor.exe",
        "s3://../evil.pt",
      ];

      for (const path of maliciousCases) {
        const result = createAiModelVersionSchema.safeParse({
          version: "1.0.0",
          modelPath: path,
        });
        assert.equal(
          result.success,
          false,
          `Expected malicious path '${path}' to be strictly rejected`,
        );
      }
    });
  });

  describe("SEC-06: Active Version Resolution (NULLS FIRST & Multi-Model Scoping)", () => {
    test("repository findActiveDeployedModelVersion requires deployedAt: not null and modelPath: not null", async () => {
      let capturedWhere: any = null;
      let capturedOrderBy: any = null;

      const mockPrisma: any = {
        aiModelVersion: {
          findFirst: async (args: any) => {
            capturedWhere = args.where;
            capturedOrderBy = args.orderBy;
            return {
              id: "0192e21b-8321-789a-bcde-000000000001",
              modelId: "0192e21b-8321-789a-bcde-000000000002",
              version: "1.0.0",
              modelPath: "models/yolov8.pt",
              framework: "PyTorch",
              inputSize: "640x640",
              status: "DEPLOYED",
              metrics: null,
              deployedAt: new Date("2026-01-01T00:00:00.000Z"),
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
            };
          },
        },
      };

      const repo = new ReportingRepository();
      Object.defineProperty(repo, "prisma", {
        get: () => mockPrisma,
        configurable: true,
      });
      const result = await repo.findActiveDeployedModelVersion();

      assert.ok(result);
      assert.deepEqual(capturedWhere.status, "DEPLOYED");
      assert.deepEqual(
        capturedWhere.deployedAt,
        { not: null },
        "Must filter deployedAt: { not: null } to defeat PostgreSQL NULLS FIRST preemption",
      );
      assert.deepEqual(
        capturedWhere.modelPath,
        { not: null },
        "Must require modelPath: { not: null } so uninitialized weights are never returned",
      );
      assert.deepEqual(capturedOrderBy, { deployedAt: "desc" });
    });

    test("scopes active version resolution by modelType and modelId when filter is supplied", async () => {
      let capturedWhere: any = null;

      const mockPrisma: any = {
        aiModelVersion: {
          findFirst: async (args: any) => {
            capturedWhere = args.where;
            return null;
          },
        },
      };

      const repo = new ReportingRepository();
      Object.defineProperty(repo, "prisma", {
        get: () => mockPrisma,
        configurable: true,
      });
      await repo.findActiveDeployedModelVersion({
        modelId: "0192e21b-8321-789a-bcde-000000000099",
        modelType: AI_MODEL_TYPE.OBJECT_DETECTION,
      });

      assert.equal(capturedWhere.modelId, "0192e21b-8321-789a-bcde-000000000099");
      assert.deepEqual(capturedWhere.model, {
        status: "ACTIVE",
        modelType: AI_MODEL_TYPE.OBJECT_DETECTION,
      });
    });

    test("validates active version query parameters using activeModelVersionQuerySchema", () => {
      // Valid query params
      const validQuery = activeModelVersionQuerySchema.safeParse({
        modelId: "0192e21b-8321-789a-bcde-000000000099",
        modelType: "OBJECT_DETECTION",
      });
      assert.equal(validQuery.success, true);

      // Empty query (returns latest overall deployed version)
      const emptyQuery = activeModelVersionQuerySchema.safeParse({});
      assert.equal(emptyQuery.success, true);

      // Invalid UUID modelId
      const invalidUuid = activeModelVersionQuerySchema.safeParse({
        modelId: "not-a-uuid",
      });
      assert.equal(invalidUuid.success, false);

      // Invalid modelType enum
      const invalidType = activeModelVersionQuerySchema.safeParse({
        modelType: "INVALID_UNKNOWN_TYPE",
      });
      assert.equal(invalidType.success, false);
    });
  });
});
