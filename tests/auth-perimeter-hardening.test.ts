import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import {
  authMiddleware,
  extractTokenFromRequest,
} from "../src/middlewares/auth.middleware";
import {
  requireGatewayOrigin,
  createRequireGatewayOrigin,
} from "../src/middlewares/request-id.middleware";
import { jwtConfig } from "../src/config/jwt.config";
import { JWT_PURPOSE, JWT_ALGORITHM } from "../src/common/constants/jwt.constant";
import { ROLES } from "../src/common/constants/role.constant";
import { ERROR_CODE } from "../src/common/errors/error-code";

describe("Security Patch Verification: SEC-19, SEC-20, SEC-28, SEC-31", () => {
  let rsaKeyPair: crypto.KeyPairSyncResult<string, string>;

  before(() => {
    rsaKeyPair = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    jwtConfig.publicKey = rsaKeyPair.publicKey;
  });

  describe("SEC-19: Gateway Origin Guard Protecting Internal Port 8894", () => {
    test("rejects direct requests omitting x-gateway-secret when secret is configured", () => {
      const guard = createRequireGatewayOrigin("super-secret-gateway-token-32-chars!");
      const req: any = {
        headers: {},
      };
      let caughtError: any = null;
      guard(req, {} as any, (err?: any) => {
        caughtError = err;
      });

      assert.ok(caughtError, "Must block direct requests bypassing API Gateway");
      assert.equal(caughtError.statusCode, 403);
      assert.equal(caughtError.code, ERROR_CODE.GATEWAY_REQUIRED);
    });

    test("accepts requests possessing valid x-gateway-secret from Traefik", () => {
      const secret = "super-secret-gateway-token-32-chars!";
      const guard = createRequireGatewayOrigin(secret);
      const req: any = {
        headers: {
          "x-gateway-secret": secret,
        },
      };
      let nextCalled = false;
      let caughtError: any = null;
      guard(req, {} as any, (err?: any) => {
        nextCalled = true;
        caughtError = err;
      });

      assert.equal(nextCalled, true);
      assert.equal(caughtError, undefined);
    });
  });

  describe("SEC-20: PostgreSQL UUID Syntax Error Crash Prevention", () => {
    test("rejects token with non-UUID identity to prevent database syntax crash", async () => {
      const nonUuidToken = jwt.sign(
        {
          id: "system-internal-service", // non-UUID string that crashes PostgreSQL @db.Uuid columns
          email: "system@internal.local",
          role: ROLES.ADMIN,
          purpose: JWT_PURPOSE.ACCESS,
        },
        rsaKeyPair.privateKey,
        { algorithm: JWT_ALGORITHM.RS256, expiresIn: "15m" },
      );

      const req: any = {
        headers: { authorization: `Bearer ${nonUuidToken}` },
        query: {},
        cookies: {},
      };
      let caughtError: any = null;
      await authMiddleware(req, {} as any, (err?: any) => {
        caughtError = err;
      });

      assert.ok(caughtError, "Must reject token with non-UUID id at auth boundary");
      assert.equal(caughtError.statusCode, 401);
      assert.equal(caughtError.code, ERROR_CODE.UNAUTHORIZED);
      assert.match(caughtError.message, /UUID chuẩn/);
    });

    test("accepts token with valid RFC 9562 UUID identity", async () => {
      const validUuid = "0192e21b-8321-789a-bcde-000000000099";
      const validToken = jwt.sign(
        {
          id: validUuid,
          email: "user@example.com",
          role: ROLES.SAFETY_MANAGER,
          purpose: JWT_PURPOSE.ACCESS,
        },
        rsaKeyPair.privateKey,
        { algorithm: JWT_ALGORITHM.RS256, expiresIn: "15m" },
      );

      const req: any = {
        headers: { authorization: `Bearer ${validToken}` },
        query: {},
        cookies: {},
      };
      let nextCalled = false;
      let caughtError: any = null;
      await authMiddleware(req, {} as any, (err?: any) => {
        nextCalled = true;
        caughtError = err;
      });

      assert.equal(nextCalled, true);
      assert.equal(caughtError, undefined);
      assert.equal(req.user.id, validUuid);
    });
  });

  describe("SEC-28: Authorization Header Precedence Over Stale Cookie", () => {
    test("prioritizes fresh Authorization header over stale ambient cookie", () => {
      const req: any = {
        headers: {
          authorization: "Bearer fresh-token-from-auth-header",
        },
        cookies: {
          accessToken: "stale-cookie-token",
        },
      };

      const extracted = extractTokenFromRequest(req);
      assert.equal(
        extracted,
        "fresh-token-from-auth-header",
        "Explicit Authorization header MUST take precedence over stale cookie",
      );
    });

    test("falls back to cookie only when Authorization header is absent", () => {
      const req: any = {
        headers: {},
        cookies: {
          accessToken: "cookie-token",
        },
      };

      const extracted = extractTokenFromRequest(req);
      assert.equal(extracted, "cookie-token");
    });
  });

  describe("SEC-31: JWT Token Exposure Prevention on Download & Query Parameters", () => {
    test("rejects request when token is passed in query string on download endpoint", async () => {
      const req: any = {
        headers: {},
        query: { token: "leaked-token-in-query-string" },
        cookies: {},
        baseUrl: "/api/v1/reports",
        path: "/0192e21b-8321-789a-bcde-000000000001/download",
      };

      let caughtError: any = null;
      await authMiddleware(req, {} as any, (err?: any) => {
        caughtError = err;
      });

      assert.ok(caughtError, "Must block token passed in URL query parameter");
      assert.equal(caughtError.statusCode, 400);
      assert.equal(caughtError.code, ERROR_CODE.VALIDATION_ERROR);
      assert.match(caughtError.message, /query string/);
    });

    test("does not extract token from query parameters", () => {
      const req: any = {
        headers: {},
        cookies: {},
        query: { ticket: "some-ticket", token: "some-token" },
        baseUrl: "/api/v1/reports",
        path: "/123/download",
      };

      const extracted = extractTokenFromRequest(req);
      assert.equal(extracted, undefined, "extractTokenFromRequest must never read query tokens");
    });
  });
});
