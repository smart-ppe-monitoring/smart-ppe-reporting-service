import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  checkDatabaseHealth,
  resetDatabaseHealthCache,
  setCustomHealthChecker,
  healthHandler,
} from "../src/reporting.app";

describe("Security Patch Verification: SEC-09 & SEC-10", () => {
  describe("SEC-09: Satellite Service Private Key Exclusion & Public Key Validation", () => {
    test("src/config/env.config.ts does not require JWT_PRIVATE_KEY for satellite reporting service", () => {
      const envConfigPath = path.resolve(__dirname, "../src/config/env.config.ts");
      const envConfigContent = fs.readFileSync(envConfigPath, "utf-8");

      assert.ok(
        !envConfigContent.includes(
          "JWT_PRIVATE_KEY bắt buộc phải được cấu hình khi JWT_ALGORITHM=RS256 trong môi trường production",
        ),
        "Must not mandate JWT_PRIVATE_KEY in production refinement check for satellite reporting service",
      );
      assert.ok(
        envConfigContent.includes(
          "Satellite microservice yêu cầu JWT_PUBLIC_KEY, keys/public.key.pem hoặc AUTH_JWKS_URL",
        ),
        "Must validate public key (JWT_PUBLIC_KEY / keys/public.key.pem / AUTH_JWKS_URL) instead",
      );
    });

    test("satellite repository only stores public key and never exposes private key in keys directory", () => {
      const keysDir = path.resolve(__dirname, "../keys");
      assert.ok(fs.existsSync(keysDir), "keys directory must exist");

      const files = fs.readdirSync(keysDir);
      assert.ok(
        files.includes("public.key.pem"),
        "keys directory must contain public.key.pem for offline RS256 verification",
      );
      assert.ok(
        !files.includes("private.key.pem"),
        "keys directory must NEVER contain private.key.pem in a satellite microservice",
      );
    });
  });

  describe("SEC-10: Database Connection Pool Exhaustion DoS Defense on Health Endpoints", () => {
    beforeEach(() => {
      resetDatabaseHealthCache();
    });

    test("checkDatabaseHealth executes raw query on first call and caches result for 5 seconds", async () => {
      let queryRawCalls = 0;
      setCustomHealthChecker(async () => {
        queryRawCalls++;
        return true;
      });

      // First call: Should query database
      const firstResult = await checkDatabaseHealth();
      assert.strictEqual(firstResult, true);
      assert.strictEqual(queryRawCalls, 1, "First health check must execute database query");

      // Immediate subsequent calls: Must hit cache, zero database queries
      for (let i = 0; i < 50; i++) {
        const cachedResult = await checkDatabaseHealth();
        assert.strictEqual(cachedResult, true);
      }
      assert.strictEqual(
        queryRawCalls,
        1,
        "Subsequent 50 health checks within 5s TTL must not execute database queries",
      );
    });

    test("resetDatabaseHealthCache clears cache and triggers a fresh database query", async () => {
      let queryRawCalls = 0;
      setCustomHealthChecker(async () => {
        queryRawCalls++;
        return true;
      });

      await checkDatabaseHealth();
      assert.strictEqual(queryRawCalls, 1);

      // Reset cache and re-set checker
      resetDatabaseHealthCache();
      setCustomHealthChecker(async () => {
        queryRawCalls++;
        return true;
      });

      // Should trigger another query
      await checkDatabaseHealth();
      assert.strictEqual(queryRawCalls, 2, "After cache reset, a fresh query must be executed");
    });

    test("healthHandler responds with HTTP 200 and healthy checks payload when database is up", async () => {
      setCustomHealthChecker(async () => true);

      let statusCode = 0;
      let responseBody: any = null;

      const req: any = {};
      const res: any = {
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (data: any) => {
          responseBody = data;
          return res;
        },
      };

      await healthHandler(req, res);

      assert.strictEqual(statusCode, 200);
      assert.strictEqual(responseBody?.status, "ok");
      assert.strictEqual(responseBody?.checks?.database, "up");
      assert.strictEqual(responseBody?.service, "reporting-service");
      assert.ok(typeof responseBody?.uptime === "number");
    });

    test("healthHandler responds with HTTP 503 and degraded payload when database is down", async () => {
      setCustomHealthChecker(async () => {
        throw new Error("Connection pool timeout / Database connection refused");
      });

      let statusCode = 0;
      let responseBody: any = null;

      const req: any = {};
      const res: any = {
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (data: any) => {
          responseBody = data;
          return res;
        },
      };

      await healthHandler(req, res);

      assert.strictEqual(statusCode, 503);
      assert.strictEqual(responseBody?.status, "degraded");
      assert.strictEqual(responseBody?.checks?.database, "down");
      assert.strictEqual(responseBody?.service, "reporting-service");
    });
  });
});
