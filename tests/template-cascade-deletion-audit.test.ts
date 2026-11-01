import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ReportingRepository } from "../src/modules/reporting/reporting.repository";
import { ReportingService } from "../src/modules/reporting/reporting.service";
import { ReportingController } from "../src/modules/reporting/reporting.controller";
import { AppError } from "../src/common/errors/app-error";
import { ERROR_CODE } from "../src/common/errors/error-code";
import { AUDIT_ACTION, AUDIT_TARGET_TYPE } from "../src/common/constants/audit-log.constant";
import { createRateLimiter } from "../src/middlewares/rate-limit.middleware";

describe("Security Patch Verification: SEC-08, SEC-14, SEC-15, SEC-16", () => {
  describe("SEC-08: Report Template Cascade Deletion Destroying Legal Compliance Audit Records", () => {
    test("prisma/schema.prisma specifies onDelete: Restrict for ReportGeneration.template", () => {
      const schemaPath = path.resolve(__dirname, "../prisma/schema.prisma");
      const schemaContent = fs.readFileSync(schemaPath, "utf-8");

      assert.ok(
        schemaContent.includes(
          "template ReportTemplate @relation(fields: [templateId], references: [id], onDelete: Restrict)",
        ),
        "ReportGeneration.template must enforce onDelete: Restrict to protect legal audit records",
      );
      assert.ok(
        !schemaContent.includes(
          "template ReportTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)",
        ),
        "Cascade deletion on report template must be removed",
      );
    });

    test("migration SQL contains ALTER TABLE dropping CASCADE and applying RESTRICT constraint", () => {
      const migrationDir = path.resolve(
        __dirname,
        "../prisma/migrations/20261101185000_report_template_restrict_delete",
      );
      assert.ok(fs.existsSync(migrationDir), "Migration directory must exist");
      const migrationSql = fs.readFileSync(
        path.join(migrationDir, "migration.sql"),
        "utf-8",
      );

      assert.ok(
        migrationSql.includes(
          'DROP CONSTRAINT IF EXISTS "report_generations_template_id_fkey"',
        ),
        "Migration must drop old CASCADE constraint",
      );
      assert.ok(
        migrationSql.includes(
          'FOREIGN KEY ("template_id") REFERENCES "report_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
        ),
        "Migration must re-create constraint with ON DELETE RESTRICT",
      );
    });

    test("repository deleteReportTemplate catches P2003 constraint error and throws friendly AppError", async () => {
      const mockPrisma: any = {
        reportTemplate: {
          delete: async () => {
            const error: any = new Error("Foreign key constraint failed on the field: `template_id`");
            error.code = "P2003";
            throw error;
          },
        },
      };

      const repo = new ReportingRepository(mockPrisma);

      await assert.rejects(
        async () => {
          await repo.deleteReportTemplate("template-123");
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(err.code, ERROR_CODE.VALIDATION_ERROR);
          assert.ok(
            err.message.includes(
              "Không thể xóa mẫu báo cáo đã có lịch sử xuất báo cáo pháp lý",
            ),
          );
          return true;
        },
      );
    });

    test("repository deleteReportTemplate successfully deletes template when no child generations exist", async () => {
      let deletedId = "";
      const mockPrisma: any = {
        reportTemplate: {
          delete: async (args: any) => {
            deletedId = args.where.id;
            return { id: deletedId };
          },
        },
      };

      const repo = new ReportingRepository(mockPrisma);
      await repo.deleteReportTemplate("template-clean-456");
      assert.strictEqual(deletedId, "template-clean-456");
    });

    test("service deleteReportTemplate throws 404 when template does not exist", async () => {
      const mockRepo: any = {
        findReportTemplateById: async () => null,
      };
      const service = new ReportingService(mockRepo);

      await assert.rejects(
        async () => {
          await service.deleteReportTemplate("non-existent-template");
        },
        (err: any) => {
          assert.ok(err instanceof AppError);
          assert.strictEqual(err.statusCode, 404);
          assert.strictEqual(err.code, ERROR_CODE.REPORT_TEMPLATE_NOT_FOUND);
          return true;
        },
      );
    });

    test("service deleteReportTemplate calls repository and logs audit entry on success", async () => {
      let repoDeletedId = "";
      const loggedAudits: any[] = [];

      const mockRepo: any = {
        findReportTemplateById: async (id: string) => ({
          id,
          code: "PPE_DAILY_TEMPLATE",
          name: "Daily Template",
        }),
        deleteReportTemplate: async (id: string) => {
          repoDeletedId = id;
        },
      };

      const mockLogger: any = {
        createAuditLog: async (payload: any) => {
          loggedAudits.push(payload);
        },
      };

      const service = new ReportingService(mockRepo, mockLogger);
      await service.deleteReportTemplate("template-target-789", {
        actorId: "admin-user-001",
        ipAddress: "127.0.0.1",
        userAgent: "JestTest/1.0",
      });

      assert.strictEqual(repoDeletedId, "template-target-789");
      assert.strictEqual(loggedAudits.length, 1);
      assert.strictEqual(loggedAudits[0].action, AUDIT_ACTION.DELETE_REPORT_TEMPLATE);
      assert.strictEqual(loggedAudits[0].targetId, "template-target-789");
      assert.strictEqual(loggedAudits[0].actorId, "admin-user-001");
    });

    test("controller deleteReportTemplate delegates to service and returns 200 response", async () => {
      let serviceDeletedId = "";
      const mockService: any = {
        deleteReportTemplate: async (id: string) => {
          serviceDeletedId = id;
        },
      };

      const controller = new ReportingController(mockService);

      const req: any = {
        params: { id: "template-ctrl-111" },
        user: { id: "admin-actor" },
        ip: "10.0.0.1",
        get: () => "TestAgent",
      };

      let responseStatus = 0;
      let responseBody: any = null;
      const res: any = {
        status: (code: number) => {
          responseStatus = code;
          return res;
        },
        json: (data: any) => {
          responseBody = data;
          return res;
        },
      };

      let nextCalled = false;
      await controller.deleteReportTemplate(req, res, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(serviceDeletedId, "template-ctrl-111");
      assert.strictEqual(responseStatus, 200);
      assert.strictEqual(responseBody?.success, true);
    });
  });

  describe("Regression: SEC-14 AI Performance Telemetry Concurrency Verification", () => {
    test("prisma schema enforces @@unique([cameraId, statDate])", () => {
      const schemaPath = path.resolve(__dirname, "../prisma/schema.prisma");
      const schema = fs.readFileSync(schemaPath, "utf-8");
      assert.ok(schema.includes("@@unique([cameraId, statDate])"));
    });
  });

  describe("Regression: SEC-15 AI Model Version Uniqueness Verification", () => {
    test("prisma schema enforces @@unique([modelId, version])", () => {
      const schemaPath = path.resolve(__dirname, "../prisma/schema.prisma");
      const schema = fs.readFileSync(schemaPath, "utf-8");
      assert.ok(schema.includes("@@unique([modelId, version])"));
    });
  });

  describe("Regression: SEC-16 Atomic Lua Rate Limiting Verification", () => {
    test("rate limiter middleware uses atomic Redis Lua script with PEXPIRE", async () => {
      let evalCalled = false;
      let executedScript = "";

      const mockRedis: any = {
        eval: async (script: string) => {
          evalCalled = true;
          executedScript = script;
          return [1, 60000];
        },
      };

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 10,
        redisClient: mockRedis,
      });

      const req: any = { ip: "1.2.3.4", baseUrl: "/api/v1/statistics" };
      const res: any = { setHeader: () => {}, status: () => res, json: () => {} };

      await (limiter as any)(req, res, () => {});

      assert.strictEqual(evalCalled, true);
      assert.ok(executedScript.includes("redis.call('INCR', KEYS[1])"));
      assert.ok(executedScript.includes("redis.call('PEXPIRE', KEYS[1], ARGV[1])"));
    });
  });
});
