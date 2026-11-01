import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ReportingService,
  DefaultReportingAuditLogger,
  AuditLogger,
} from "../src/modules/reporting/reporting.service";
import { ReportingController } from "../src/modules/reporting/reporting.controller";
import {
  AUDIT_ACTION,
  AUDIT_TARGET_TYPE,
} from "../src/common/constants/audit-log.constant";
import {
  getMasterKeyBuffer,
  encryptSecret,
  decryptSecret,
} from "../src/common/helpers/crypto.helper";
import { envConfig } from "../src/config/env.config";

describe("Security Patch Verification: SEC-27, SEC-29, SEC-30 & SEC-32", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // 1. SEC-27: Master Encryption Key Hardcoded Fallback Prevention
  // ───────────────────────────────────────────────────────────────────────────
  describe("SEC-27: Master Encryption Key Hardcoded Fallback Elimination", () => {
    test("crypto.helper.ts eliminates hardcoded static encryption key and raw process.env reads", () => {
      const helperPath = path.resolve(
        __dirname,
        "../src/common/helpers/crypto.helper.ts",
      );
      const helperContent = fs.readFileSync(helperPath, "utf-8");

      assert.ok(
        !helperContent.includes("default-smart-ppe-master-encryption-key-32b"),
        "crypto.helper.ts must not contain static fallback key 'default-smart-ppe-master-encryption-key-32b'",
      );
      assert.ok(
        !helperContent.includes("process.env.ENCRYPTION_KEY"),
        "crypto.helper.ts must not bypass envConfig by directly reading process.env.ENCRYPTION_KEY",
      );
    });

    test("getMasterKeyBuffer derives 32-byte key buffer from validated envConfig or customKey", () => {
      const defaultBuffer = getMasterKeyBuffer();
      assert.ok(Buffer.isBuffer(defaultBuffer));
      assert.strictEqual(defaultBuffer.length, 32);

      const customKey = "production-approved-secure-key-32b-length!";
      const customBuffer = getMasterKeyBuffer(customKey);
      assert.ok(Buffer.isBuffer(customBuffer));
      assert.strictEqual(customBuffer.length, 32);
      assert.notDeepStrictEqual(defaultBuffer, customBuffer);
    });

    test("authenticated encryption and decryption round-trip functions securely with AES-256-GCM", () => {
      const payload = "Governance-Audit-Report-Token-2026";
      const cipherText = encryptSecret(payload);

      assert.ok(typeof cipherText === "string");
      const parts = cipherText.split(":");
      assert.strictEqual(parts.length, 3);
      assert.strictEqual(parts[0].length, 24); // 12-byte IV in hex
      assert.strictEqual(parts[1].length, 32); // 16-byte Auth Tag in hex

      const decrypted = decryptSecret(cipherText);
      assert.strictEqual(decrypted, payload);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. SEC-29: Uncaught Exception and Rejection Listener Process Stability
  // ───────────────────────────────────────────────────────────────────────────
  describe("SEC-29: Uncaught Exception and Rejection Listener Absence Resolution", () => {
    test("src/server.ts registers unhandledRejection and uncaughtException process listeners", () => {
      const serverPath = path.resolve(__dirname, "../src/server.ts");
      const content = fs.readFileSync(serverPath, "utf-8");

      assert.ok(
        content.includes('process.on("unhandledRejection"'),
        "src/server.ts must register process.on('unhandledRejection')",
      );
      assert.ok(
        content.includes('process.on("uncaughtException"'),
        "src/server.ts must register process.on('uncaughtException')",
      );
      assert.ok(
        content.includes('handleReportingShutdown("unhandledRejection")'),
        "src/server.ts must trigger handleReportingShutdown on unhandledRejection",
      );
      assert.ok(
        content.includes('handleReportingShutdown("uncaughtException")'),
        "src/server.ts must trigger handleReportingShutdown on uncaughtException",
      );
    });

    test("src/reporting.server.ts registers unhandledRejection and uncaughtException process listeners", () => {
      const reportingServerPath = path.resolve(
        __dirname,
        "../src/reporting.server.ts",
      );
      const content = fs.readFileSync(reportingServerPath, "utf-8");

      assert.ok(
        content.includes('process.on("unhandledRejection"'),
        "src/reporting.server.ts must register process.on('unhandledRejection')",
      );
      assert.ok(
        content.includes('process.on("uncaughtException"'),
        "src/reporting.server.ts must register process.on('uncaughtException')",
      );
      assert.ok(
        content.includes('handleReportingShutdown("unhandledRejection")'),
        "src/reporting.server.ts must trigger handleReportingShutdown on unhandledRejection",
      );
      assert.ok(
        content.includes('handleReportingShutdown("uncaughtException")'),
        "src/reporting.server.ts must trigger handleReportingShutdown on uncaughtException",
      );
    });

    test("handleReportingShutdown sets non-zero exit code 1 for exception signals in production", () => {
      const serverPath = path.resolve(__dirname, "../src/server.ts");
      const content = fs.readFileSync(serverPath, "utf-8");

      assert.ok(
        content.includes('signal === "uncaughtException" || signal === "unhandledRejection"'),
        "handleReportingShutdown must exit with status 1 on uncaughtException or unhandledRejection",
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. SEC-30: Dockerfile Runner Stage Keys and Frozen Lockfile
  // ───────────────────────────────────────────────────────────────────────────
  describe("SEC-30: Dockerfile Supply Chain Determinism and Runner Keys Stage", () => {
    test("Dockerfile stage 1 deps copies pnpm-lock.yaml and enforces --frozen-lockfile", () => {
      const dockerfilePath = path.resolve(__dirname, "../Dockerfile");
      const content = fs.readFileSync(dockerfilePath, "utf-8");

      assert.ok(
        content.includes("COPY package.json pnpm-lock.yaml* ./"),
        "Dockerfile deps stage must copy pnpm-lock.yaml to prevent non-deterministic dependency drift",
      );
      assert.ok(
        content.includes("RUN pnpm install --frozen-lockfile"),
        "Dockerfile deps stage must execute pnpm install with --frozen-lockfile",
      );
    });

    test("Dockerfile stage 3 runner copies keys directory into final container", () => {
      const dockerfilePath = path.resolve(__dirname, "../Dockerfile");
      const content = fs.readFileSync(dockerfilePath, "utf-8");

      assert.ok(
        content.includes("COPY --from=builder /app/keys ./keys"),
        "Dockerfile runner stage must copy /app/keys into ./keys so public.key.pem is present",
      );
      assert.ok(
        content.includes('CMD ["node", "dist/server.js"]'),
        "Dockerfile runner stage must start the service with node dist/server.js",
      );
      assert.ok(
        content.includes("EXPOSE 8894"),
        "Dockerfile must expose port 8894",
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. SEC-32: Administrative Governance Audit Logging
  // ───────────────────────────────────────────────────────────────────────────
  describe("SEC-32: Administrative Governance Audit Logging Reliability", () => {
    test("DefaultReportingAuditLogger formats structured JSON audit entries", async () => {
      const defaultLogger = new DefaultReportingAuditLogger();
      const originalConsoleInfo = console.info;
      let loggedOutput = "";

      try {
        console.info = (message?: any, ...optionalParams: any[]) => {
          loggedOutput = [message, ...optionalParams].join(" ");
        };

        const result = await defaultLogger.createAuditLog({
          actorId: "admin-uuid-001",
          action: AUDIT_ACTION.DEPLOY_AI_MODEL_VERSION,
          targetType: AUDIT_TARGET_TYPE.PPE_AI_MODEL,
          targetId: "model-version-123",
          details: { environment: "production" },
          ipAddress: "192.168.1.50",
          userAgent: "Mozilla/5.0 AuditAgent",
        });

        assert.strictEqual(result.level, "audit");
        assert.strictEqual(result.action, AUDIT_ACTION.DEPLOY_AI_MODEL_VERSION);
        assert.strictEqual(result.targetId, "model-version-123");
        assert.strictEqual(result.actorId, "admin-uuid-001");
        assert.ok(loggedOutput.includes("[AUDIT]"));
        assert.ok(loggedOutput.includes("DEPLOY_AI_MODEL_VERSION"));
      } finally {
        console.info = originalConsoleInfo;
      }
    });

    test("ReportingService defaults to DefaultReportingAuditLogger when initialized without logger", async () => {
      let loggedAudits: any[] = [];
      const originalConsoleInfo = console.info;

      try {
        console.info = (message?: any, ...optionalParams: any[]) => {
          const str = [message, ...optionalParams].join(" ");
          if (str.startsWith("[AUDIT]")) {
            loggedAudits.push(JSON.parse(str.replace("[AUDIT] ", "")));
          }
        };

        const mockRepo: any = {
          findReportTemplateById: async (id: string) => ({
            id,
            code: "TEMPLATE_TEST",
            name: "Test Template",
          }),
          deleteReportTemplate: async () => {},
        };

        // Initialize ReportingService WITHOUT auditLogger parameter
        const service = new ReportingService(mockRepo);

        await service.deleteReportTemplate("template-xyz-999", {
          actorId: "superadmin-01",
          ipAddress: "10.0.0.1",
          userAgent: "AdminPortal/2.0",
        });

        assert.strictEqual(loggedAudits.length, 1);
        assert.strictEqual(
          loggedAudits[0].action,
          AUDIT_ACTION.DELETE_REPORT_TEMPLATE,
        );
        assert.strictEqual(loggedAudits[0].targetId, "template-xyz-999");
        assert.strictEqual(loggedAudits[0].actorId, "superadmin-01");
      } finally {
        console.info = originalConsoleInfo;
      }
    });

    test("ReportingService invokes custom injected AuditLogger and prevents silent drop", async () => {
      const auditEvents: any[] = [];
      const customAuditLogger: AuditLogger = {
        async createAuditLog(data) {
          auditEvents.push(data);
          return { recorded: true };
        },
      };

      const mockRepo: any = {
        findReportTemplateByCode: async () => null,
        createReportTemplate: async (dto: any, actorId?: string) => ({
          id: "new-template-id-555",
          code: dto.code,
          name: dto.name,
          format: dto.format,
        }),
      };

      const service = new ReportingService(mockRepo, customAuditLogger);
      await service.createReportTemplate(
        {
          code: "PPE_DAILY_COMPLIANCE",
          name: "Daily PPE Compliance",
          format: "PDF" as any,
          schema: {},
        },
        {
          actorId: "safety-officer-77",
          ipAddress: "172.16.0.2",
          userAgent: "SafetyBrowser/1.0",
        },
      );

      assert.strictEqual(auditEvents.length, 1);
      assert.strictEqual(
        auditEvents[0].action,
        AUDIT_ACTION.CREATE_REPORT_TEMPLATE,
      );
      assert.strictEqual(auditEvents[0].targetId, "new-template-id-555");
      assert.strictEqual(auditEvents[0].actorId, "safety-officer-77");
    });

    test("ReportingService invokes fallback warning if auditLogger fails without throwing", async () => {
      let fallbackLogged = false;
      const originalConsoleWarn = console.warn;

      try {
        console.warn = (message?: any, ...optionalParams: any[]) => {
          const str = [message, ...optionalParams].join(" ");
          if (str.includes("[AUDIT-FALLBACK]")) {
            fallbackLogged = true;
          }
        };

        const failingAuditLogger: AuditLogger = {
          async createAuditLog() {
            throw new Error("Kafka broker connection timeout");
          },
        };

        const mockRepo: any = {
          findReportTemplateById: async (id: string) => ({
            id,
            code: "TEMPLATE_TEST",
            name: "Test Template",
          }),
          deleteReportTemplate: async () => {},
        };

        const service = new ReportingService(mockRepo, failingAuditLogger);

        // Should complete successfully without crashing while emitting fallback warning
        await service.deleteReportTemplate("template-failover-111", {
          actorId: "admin-recovery",
        });

        assert.strictEqual(fallbackLogged, true);
      } finally {
        console.warn = originalConsoleWarn;
      }
    });

    test("ReportingController supports dependency injection of AuditLogger", () => {
      const customAuditLogger: AuditLogger = {
        async createAuditLog() {
          return true;
        },
      };

      const controller = new ReportingController(undefined, customAuditLogger);
      assert.ok(controller);
      assert.ok((controller as any).service);
      assert.strictEqual(
        (controller as any).service.auditLogger,
        customAuditLogger,
      );
    });
  });
});
