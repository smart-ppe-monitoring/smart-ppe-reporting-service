import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { authMiddleware } from "../src/middlewares/auth.middleware";
import {
  requirePermission,
  requireAnyPermission,
  resolveSatellitePermissions,
} from "../src/middlewares/permission.middleware";
import { jwtConfig } from "../src/config/jwt.config";
import { JWT_PURPOSE, JWT_ALGORITHM } from "../src/common/constants/jwt.constant";
import { ROLES } from "../src/common/constants/role.constant";
import { PERMISSIONS } from "../src/common/constants/permission.constant";
import { ERROR_CODE } from "../src/common/errors/error-code";

describe("Security Patch Verification: SEC-01 to SEC-04", () => {
  let rsaKeyPair: crypto.KeyPairSyncResult<string, string>;

  before(() => {
    // Generate valid RS256 key pair for test verification
    rsaKeyPair = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    jwtConfig.publicKey = rsaKeyPair.publicKey;
  });

  describe("SEC-01: Gateway Secret Authentication Bypass Prevention", () => {
    test("rejects request with x-gateway-secret when token is absent (no admin takeover)", async () => {
      let nextCalled = false;
      let caughtError: any = null;

      const req: any = {
        headers: {
          "x-gateway-secret": "test-gateway-secret-32-chars-long!",
        },
        query: {},
        cookies: {},
      };
      const res: any = {};
      const next = (err?: any) => {
        nextCalled = true;
        caughtError = err;
      };

      await authMiddleware(req, res, next);

      assert.equal(nextCalled, true);
      assert.ok(caughtError);
      assert.equal(caughtError.statusCode, 401);
      assert.equal(caughtError.code, ERROR_CODE.UNAUTHORIZED);
      assert.equal(req.user, undefined, "req.user must not be instantiated as admin");
    });
  });

  describe("SEC-02: Two-Factor Authentication Purpose Validation", () => {
    test("rejects 2FA intermediate token with purpose 2FA_VERIFICATION", async () => {
      const twoFactorToken = jwt.sign(
        {
          id: "0192e21b-8321-789a-bcde-000000000001",
          email: "user@example.com",
          role: ROLES.ADMIN,
          purpose: JWT_PURPOSE.TWO_FACTOR, // '2FA_VERIFICATION'
        },
        rsaKeyPair.privateKey,
        { algorithm: JWT_ALGORITHM.RS256, expiresIn: "5m" },
      );

      let caughtError: any = null;
      const req: any = {
        headers: { authorization: `Bearer ${twoFactorToken}` },
        query: {},
        cookies: {},
      };
      const res: any = {};
      const next = (err?: any) => {
        caughtError = err;
      };

      await authMiddleware(req, res, next);

      assert.ok(caughtError, "Must reject 2FA token on standard endpoints");
      assert.equal(caughtError.statusCode, 401);
      assert.equal(caughtError.code, ERROR_CODE.UNAUTHORIZED);
      assert.match(caughtError.message, /Access Token/);
      assert.equal(req.user, undefined);
    });

    test("accepts genuine Access Token with purpose ACCESS", async () => {
      const accessToken = jwt.sign(
        {
          id: "0192e21b-8321-789a-bcde-000000000001",
          email: "admin@example.com",
          role: ROLES.ADMIN,
          permissions: [PERMISSIONS.PPE_REPORTING_READ],
          purpose: JWT_PURPOSE.ACCESS,
        },
        rsaKeyPair.privateKey,
        { algorithm: JWT_ALGORITHM.RS256, expiresIn: "15m" },
      );

      let caughtError: any = null;
      const req: any = {
        headers: { authorization: `Bearer ${accessToken}` },
        query: {},
        cookies: {},
      };
      const res: any = {};
      const next = (err?: any) => {
        caughtError = err;
      };

      await authMiddleware(req, res, next);

      assert.equal(caughtError, undefined, "Access token must be accepted");
      assert.ok(req.user);
      assert.equal(req.user.email, "admin@example.com");
      assert.equal(req.user.role, ROLES.ADMIN);
    });
  });

  describe("SEC-03: Administrator API Key Permission Scoping", () => {
    test("rejects Admin API key from accessing endpoints beyond its scoped permissions", () => {
      const req: any = {
        user: {
          id: "0192e21b-8321-789a-bcde-000000000001",
          role: ROLES.ADMIN,
          permissions: Object.values(PERMISSIONS),
        },
        apiKey: {
          id: "key-01",
          name: "Read-Only Key",
          prefix: "ppe_key",
          permissions: [PERMISSIONS.PPE_REPORTING_READ], // Scoped ONLY to READ
        },
      };

      let caughtError: any = null;
      const middleware = requirePermission(PERMISSIONS.PPE_MODEL_MANAGE);
      middleware(req, {} as any, (err?: any) => {
        caughtError = err;
      });

      assert.ok(caughtError, "Admin API key must NOT bypass scoped permissions");
      assert.equal(caughtError.statusCode, 403);
      assert.equal(caughtError.code, ERROR_CODE.FORBIDDEN);
    });

    test("allows Admin API key to access endpoints within its scoped permissions", () => {
      const req: any = {
        user: {
          id: "0192e21b-8321-789a-bcde-000000000001",
          role: ROLES.ADMIN,
          permissions: Object.values(PERMISSIONS),
        },
        apiKey: {
          id: "key-02",
          name: "Read Key",
          prefix: "ppe_key",
          permissions: [PERMISSIONS.PPE_REPORTING_READ],
        },
      };

      let caughtError: any = null;
      let nextCalled = false;
      const middleware = requirePermission(PERMISSIONS.PPE_REPORTING_READ);
      middleware(req, {} as any, (err?: any) => {
        nextCalled = true;
        caughtError = err;
      });

      assert.equal(nextCalled, true);
      assert.equal(caughtError, undefined);
    });

    test("allows standard Admin user (without API key) full uninhibited access", () => {
      const req: any = {
        user: {
          id: "0192e21b-8321-789a-bcde-000000000001",
          role: ROLES.ADMIN,
          permissions: Object.values(PERMISSIONS),
        },
      };

      let nextCalled = false;
      let caughtError: any = null;
      const middleware = requirePermission(PERMISSIONS.PPE_MODEL_MANAGE);
      middleware(req, {} as any, (err?: any) => {
        nextCalled = true;
        caughtError = err;
      });

      assert.equal(nextCalled, true);
      assert.equal(caughtError, undefined);
    });
  });

  describe("SEC-04: Revocation Honor via Empty Permissions Array", () => {
    test("does not restore role defaults when permissions array is empty (revoked user)", () => {
      const req: any = {
        user: {
          id: "0192e21b-8321-789a-bcde-000000000002",
          email: "suspended@example.com",
          role: ROLES.SAFETY_MANAGER,
          permissions: [], // Explicitly revoked
        },
      };

      const perms = resolveSatellitePermissions(req);
      assert.equal(perms.size, 0, "Revoked user must hold 0 permissions");

      let caughtError: any = null;
      const middleware = requirePermission(PERMISSIONS.PPE_REPORTING_EXPORT);
      middleware(req, {} as any, (err?: any) => {
        caughtError = err;
      });

      assert.ok(caughtError, "Revoked user must be denied access");
      assert.equal(caughtError.statusCode, 403);
      assert.equal(caughtError.code, ERROR_CODE.FORBIDDEN);
    });

    test("falls back to role defaults only when permissions is undefined (legacy tokens)", () => {
      const req: any = {
        user: {
          id: "0192e21b-8321-789a-bcde-000000000003",
          email: "legacy@example.com",
          role: ROLES.SAFETY_OFFICER,
          permissions: undefined, // Legacy token
        },
      };

      const perms = resolveSatellitePermissions(req);
      assert.ok(perms.size > 0, "Legacy token with undefined permissions falls back to role defaults");
      assert.ok(perms.has(PERMISSIONS.PPE_INCIDENT_READ));
    });
  });
});
