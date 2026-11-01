import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  encryptSecret,
  decryptSecret,
  getMasterKeyBuffer,
} from "../src/common/helpers/crypto.helper";
import { ReportingRepository } from "../src/modules/reporting/reporting.repository";
import { AppError } from "../src/common/errors/app-error";
import { ERROR_CODE } from "../src/common/errors/error-code";
import { envConfig } from "../src/config/env.config";

describe("Security Patch Verification: SEC-27 & SEC-34", () => {
  describe("SEC-27: Insecure Fallback to Static Hardcoded Master Encryption Key Prevention", () => {
    test("crypto.helper does not contain hardcoded default master encryption key string", () => {
      const helperPath = path.resolve(__dirname, "../src/common/helpers/crypto.helper.ts");
      const helperContent = fs.readFileSync(helperPath, "utf-8");

      assert.ok(
        !helperContent.includes("default-smart-ppe-master-encryption-key-32b"),
        "crypto.helper.ts must not contain insecure fallback key string 'default-smart-ppe-master-encryption-key-32b'",
      );
      assert.ok(
        !helperContent.includes("process.env.ENCRYPTION_KEY"),
        "crypto.helper.ts must not read process.env.ENCRYPTION_KEY directly bypassing envConfig validation",
      );
    });

    test("getMasterKeyBuffer derives key from envConfig.encryption.key or customKey", () => {
      // 1. Using envConfig.encryption.key
      const keyBuffer = getMasterKeyBuffer();
      assert.ok(Buffer.isBuffer(keyBuffer));
      assert.strictEqual(keyBuffer.length, 32);

      // 2. Using custom key
      const customKey = "my-custom-strong-encryption-key-32-chars!";
      const customBuffer = getMasterKeyBuffer(customKey);
      assert.ok(Buffer.isBuffer(customBuffer));
      assert.strictEqual(customBuffer.length, 32);
      assert.notDeepStrictEqual(keyBuffer, customBuffer);
    });

    test("encryptSecret and decryptSecret perform authenticated AES-256-GCM round-trip successfully", () => {
      const secretMessage = "Confidential-Safety-Report-API-Key-2026";
      const cipherText = encryptSecret(secretMessage);

      assert.ok(typeof cipherText === "string");
      const parts = cipherText.split(":");
      assert.strictEqual(parts.length, 3, "Format must be iv:authTag:encryptedHex");

      const decrypted = decryptSecret(cipherText);
      assert.strictEqual(decrypted, secretMessage);
    });

    test("decryptSecret rejects tampered ciphertext or altered auth tag", () => {
      const secretMessage = "Uncompromised Data";
      const cipherText = encryptSecret(secretMessage);
      const [iv, authTag, encryptedHex] = cipherText.split(":");

      // Tamper ciphertext preserving even hex length
      const lastTwo = encryptedHex.slice(-2);
      const replacedTwo = lastTwo === "00" ? "ff" : "00";
      const tamperedHex = encryptedHex.slice(0, -2) + replacedTwo;
      const tamperedPayload = `${iv}:${authTag}:${tamperedHex}`;

      assert.throws(
        () => {
          decryptSecret(tamperedPayload);
        },
        /Unsupported state|unable to authenticate data|bad decrypt|Invalid/i,
      );
    });
  });

  describe("SEC-34: Foreign Key Integrity on AI Telemetry Model Version Association", () => {
    test("prisma/schema.prisma enforces modelVersion foreign key with onDelete: SetNull", () => {
      const schemaPath = path.resolve(__dirname, "../prisma/schema.prisma");
      const schemaContent = fs.readFileSync(schemaPath, "utf-8");

      assert.ok(
        schemaContent.includes(
          "modelVersion   AiModelVersion? @relation(fields: [modelVersionId], references: [id], onDelete: SetNull)",
        ),
        "AiPerformanceStatistic must define relation to AiModelVersion with onDelete: SetNull",
      );
      assert.ok(
        schemaContent.includes("performanceStatistics AiPerformanceStatistic[]"),
        "AiModelVersion must declare reverse relation performanceStatistics",
      );
    });

    test("migration SQL contains ALTER TABLE adding foreign key constraint with ON DELETE SET NULL", () => {
      const migrationDir = path.resolve(
        __dirname,
        "../prisma/migrations/20261101183000_add_foreign_key_ai_telemetry_model_version",
      );
      assert.ok(fs.existsSync(migrationDir), "Migration directory must exist");
      const migrationSql = fs.readFileSync(
        path.join(migrationDir, "migration.sql"),
        "utf-8",
      );

      assert.ok(
        migrationSql.includes('FOREIGN KEY ("model_version_id") REFERENCES "ai_model_versions"("id") ON DELETE SET NULL'),
        "Migration must enforce foreign key constraint with ON DELETE SET NULL",
      );
    });

    test("repository recordAiPerformanceMetric rejects non-existent modelVersionId with 404", async () => {
      const mockPrisma: any = {
        aiModelVersion: {
          findUnique: async () => null, // Model version does not exist
        },
      };

      const repo = new ReportingRepository(mockPrisma);

      await assert.rejects(
        async () => {
          await repo.recordAiPerformanceMetric({
            cameraId: "0192e21b-8321-789a-bcde-000000000001",
            modelVersionId: "0192e21b-8321-789a-bcde-999999999999",
            fps: 30,
            latencyMs: 33.3,
            frameCount: 10,
          });
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.statusCode, 404);
          assert.strictEqual(err.code, ERROR_CODE.AI_MODEL_VERSION_NOT_FOUND);
          return true;
        },
      );
    });

    test("repository recordAiPerformanceMetric catches P2003 foreign key violation and throws 404", async () => {
      const mockPrisma: any = {
        aiModelVersion: {
          findUnique: async () => ({ id: "0192e21b-8321-789a-bcde-000000000002" }),
        },
        aiPerformanceStatistic: {
          findUnique: async () => null,
          create: async () => {
            const error: any = new Error("Foreign key constraint failed on the field: `model_version_id`");
            error.code = "P2003";
            throw error;
          },
        },
      };

      const repo = new ReportingRepository(mockPrisma);

      await assert.rejects(
        async () => {
          await repo.recordAiPerformanceMetric({
            cameraId: "0192e21b-8321-789a-bcde-000000000001",
            modelVersionId: "0192e21b-8321-789a-bcde-000000000002",
            fps: 30,
            latencyMs: 33.3,
            frameCount: 10,
          });
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.statusCode, 404);
          assert.strictEqual(err.code, ERROR_CODE.AI_MODEL_VERSION_NOT_FOUND);
          return true;
        },
      );
    });
  });
});
