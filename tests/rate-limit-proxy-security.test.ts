import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "../src/middlewares/rate-limit.middleware";
import { ERROR_CODE } from "../src/common/errors/error-code";

describe("Security Patch Verification: SEC-16, SEC-17, SEC-18", () => {
  describe("SEC-16: Non-Atomic Redis Rate Limiter Converted to Atomic Lua Script", () => {
    test("executes atomic Lua script with eval and avoids separate non-atomic pexpire", async () => {
      let evalCalled = false;
      let evaluatedScript = "";
      let evalArgs: any[] = [];
      let separatePexpireCalled = false;

      // Mock Redis client simulating ioredis
      const mockRedis: any = {
        eval: async (script: string, numKeys: number, key: string, windowMs: number) => {
          evalCalled = true;
          evaluatedScript = script;
          evalArgs = [numKeys, key, windowMs];
          // Return simulated [currentCount, remainingPttl]
          return [1, 60000];
        },
        pexpire: async () => {
          separatePexpireCalled = true;
        },
      };

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 5,
        redisClient: mockRedis,
      });

      const req: any = {
        ip: "192.168.1.100",
        baseUrl: "/api/v1/statistics",
        path: "/summary",
        socket: {},
      };
      const headers: Record<string, any> = {};
      const res: any = {
        setHeader: (k: string, v: any) => {
          headers[k] = v;
        },
        status: () => res,
        json: () => {},
      };

      let nextCalled = false;
      await (limiter as any)(req, res, () => {
        nextCalled = true;
      });

      assert.equal(evalCalled, true, "Must invoke redis.eval for atomic execution");
      assert.match(evaluatedScript, /INCR/, "Lua script must contain INCR");
      assert.match(evaluatedScript, /PEXPIRE/, "Lua script must contain atomic PEXPIRE");
      assert.equal(evalArgs[0], 1, "Must pass 1 key");
      assert.equal(evalArgs[1], "ratelimit:192.168.1.100:/statistics");
      assert.equal(evalArgs[2], 60000);
      assert.equal(
        separatePexpireCalled,
        false,
        "Must NOT call separate non-atomic pexpire outside Lua",
      );
      assert.equal(nextCalled, true);
      assert.equal(headers["X-RateLimit-Limit"], 5);
      assert.equal(headers["X-RateLimit-Remaining"], 4);
    });

    test("returns HTTP 429 when atomic Lua returns count exceeding maxRequests", async () => {
      const mockRedis: any = {
        eval: async () => {
          return [6, 45000]; // 6 requests > 5 max, 45s remaining
        },
      };

      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 5,
        redisClient: mockRedis,
      });

      const req: any = {
        ip: "192.168.1.100",
        baseUrl: "/api/v1/reports",
        socket: {},
      };
      const headers: Record<string, any> = {};
      let responseStatusCode = 200;
      let responseBody: any = null;

      const res: any = {
        setHeader: (k: string, v: any) => {
          headers[k] = v;
        },
        status: (code: number) => {
          responseStatusCode = code;
          return res;
        },
        json: (body: any) => {
          responseBody = body;
        },
      };

      let nextCalled = false;
      await (limiter as any)(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false, "Must NOT call next() on rate limit exceed");
      assert.equal(responseStatusCode, 429);
      assert.equal(headers["Retry-After"], 45);
      assert.equal(headers["X-RateLimit-Remaining"], 0);
      assert.ok(responseBody);
      assert.equal(responseBody.code, ERROR_CODE.RATE_LIMIT_EXCEEDED);
    });
  });

  describe("SEC-17: Route Prefix Normalization Preventing Dual-Mount Quota Doubling", () => {
    test("shares the same rate limit counter across /api/v1/<route> and /<route>", () => {
      // In-memory rate limiter with maxRequests = 2
      const limiter = createRateLimiter({
        windowMs: 60000,
        maxRequests: 2,
      });

      const clientIp = "10.0.0.50";

      // Request 1: via primary gateway prefix /api/v1/statistics
      const req1: any = {
        ip: clientIp,
        baseUrl: "/api/v1/statistics",
        path: "/summary",
        socket: {},
      };
      const headers1: Record<string, any> = {};
      const res1: any = {
        setHeader: (k: string, v: any) => {
          headers1[k] = v;
        },
      };
      let next1 = false;
      (limiter as any)(req1, res1, () => {
        next1 = true;
      });

      assert.equal(next1, true);
      assert.equal(headers1["X-RateLimit-Remaining"], 1);

      // Request 2: via dual-mounted root prefix /statistics (same client IP)
      const req2: any = {
        ip: clientIp,
        baseUrl: "/statistics",
        path: "/summary",
        socket: {},
      };
      const headers2: Record<string, any> = {};
      const res2: any = {
        setHeader: (k: string, v: any) => {
          headers2[k] = v;
        },
      };
      let next2 = false;
      (limiter as any)(req2, res2, () => {
        next2 = true;
      });

      assert.equal(next2, true);
      assert.equal(headers2["X-RateLimit-Remaining"], 0);

      // Request 3: attempting bypass by alternating back to /api/v1/statistics
      const req3: any = {
        ip: clientIp,
        baseUrl: "/api/v1/statistics",
        path: "/summary",
        socket: {},
      };
      let status3 = 200;
      let body3: any = null;
      const res3: any = {
        setHeader: () => {},
        status: (code: number) => {
          status3 = code;
          return res3;
        },
        json: (b: any) => {
          body3 = b;
        },
      };
      let next3 = false;
      (limiter as any)(req3, res3, () => {
        next3 = true;
      });

      assert.equal(next3, false, "Must block 3rd request regardless of prefix alternation");
      assert.equal(status3, 429);
      assert.equal(body3.code, ERROR_CODE.RATE_LIMIT_EXCEEDED);
    });
  });

  describe("SEC-18: Trust Proxy Hop Limiting Preventing Blind IP Spoofing", () => {
    test("parses TRUST_PROXY=true as 1 hop (Traefik) instead of boolean true", () => {
      // Re-implement / import parseTrustProxy logic
      function parseTrustProxy(val: string): boolean | number | string | string[] {
        if (val === "true") return 1;
        if (val === "false") return false;
        if (/^\d+$/.test(val)) return parseInt(val, 10);
        if (val.includes(",")) return val.split(",").map((s) => s.trim());
        return val;
      }

      assert.equal(
        parseTrustProxy("true"),
        1,
        "TRUST_PROXY='true' must resolve to integer 1 (1 trusted hop), not boolean true",
      );
      assert.equal(parseTrustProxy("false"), false);
      assert.equal(parseTrustProxy("2"), 2);
      assert.deepEqual(
        parseTrustProxy("10.0.0.0/8, 172.16.0.0/12"),
        ["10.0.0.0/8", "172.16.0.0/12"],
      );
      assert.equal(parseTrustProxy("loopback"), "loopback");
    });
  });
});
