import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequireInternalServiceToken } from "../src/middlewares/internal-auth.middleware";
import { GATEWAY_HEADERS } from "../src/common/constants/gateway.constant";
import { ERROR_CODE } from "../src/common/errors/error-code";
import { aiModelRouter } from "../src/modules/reporting/reporting.route";

describe("Internal M2M AI Model Routes & Middleware", () => {
  it("createRequireInternalServiceToken enforces fail-closed 503/401/403 and accepts valid token", () => {
    const emptyMw = createRequireInternalServiceToken(() => "");
    let capturedErr: any = null;
    emptyMw({ headers: {} } as any, {} as any, (err?: any) => {
      capturedErr = err;
    });
    assert.equal(capturedErr?.statusCode, 503);
    assert.equal(capturedErr?.code, ERROR_CODE.SERVICE_UNAVAILABLE);

    const mw = createRequireInternalServiceToken("super-secret-m2m-token-32-characters!");
    capturedErr = null;
    mw({ headers: {} } as any, {} as any, (err?: any) => {
      capturedErr = err;
    });
    assert.equal(capturedErr?.statusCode, 401);

    capturedErr = null;
    mw(
      { headers: { [GATEWAY_HEADERS.INTERNAL_SERVICE_TOKEN]: "wrong-token" } } as any,
      {} as any,
      (err?: any) => {
        capturedErr = err;
      },
    );
    assert.equal(capturedErr?.statusCode, 403);

    capturedErr = undefined;
    mw(
      {
        headers: {
          [GATEWAY_HEADERS.INTERNAL_SERVICE_TOKEN]: "super-secret-m2m-token-32-characters!",
        },
      } as any,
      {} as any,
      (err?: any) => {
        capturedErr = err;
      },
    );
    assert.equal(capturedErr, undefined);
  });

  it("mounts /internal/active-version and /internal/versions/:versionId BEFORE authMiddleware on aiModelRouter", () => {
    const stack = (aiModelRouter as any).stack as any[];
    const routePaths = stack
      .filter((layer) => layer.route?.path)
      .map((layer) => ({
        path: layer.route.path,
        idx: stack.indexOf(layer),
      }));

    const authIdx = stack.findIndex(
      (layer) => !layer.route && layer.name === "authMiddleware",
    );
    assert.ok(authIdx >= 0, "authMiddleware must be registered on aiModelRouter");

    const internalActive = routePaths.find((r) => r.path === "/internal/active-version");
    const internalVersion = routePaths.find((r) => r.path === "/internal/versions/:versionId");
    const publicActive = routePaths.find((r) => r.path === "/active-version");

    assert.ok(internalActive, "/internal/active-version route must exist");
    assert.ok(internalVersion, "/internal/versions/:versionId route must exist");
    assert.ok(publicActive, "/active-version route must exist");

    assert.ok(
      internalActive.idx < authIdx,
      "/internal/active-version must be mounted before authMiddleware",
    );
    assert.ok(
      internalVersion.idx < authIdx,
      "/internal/versions/:versionId must be mounted before authMiddleware",
    );
    assert.ok(
      publicActive.idx > authIdx,
      "user-facing /active-version must remain behind authMiddleware",
    );
  });
});
