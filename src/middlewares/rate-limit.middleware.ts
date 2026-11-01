import { Request, Response, NextFunction } from "express";
import IORedis from "ioredis";
import { ERROR_CODE } from "../common/errors/error-code";
import { envConfig } from "../config/env.config";

export interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
  redisClient?: IORedis;
}

let sharedRedisClient: IORedis | null = null;
let isRedisConnected = false;

export function getSharedRateLimitRedisClient(): IORedis | null {
  // Tuyệt đối không mở kết nối Redis trong test hoặc khi Redis bị tắt
  if (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.argv.some((arg) => arg.includes("test")) ||
    !envConfig.redis.enabled
  ) {
    return null;
  }
  if (!sharedRedisClient) {
    sharedRedisClient = new IORedis({
      host: envConfig.redis.host,
      port: envConfig.redis.port,
      password: envConfig.redis.password,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null, // Không thử lại vô hạn để tránh treo event loop
    });

    sharedRedisClient.on("connect", () => {
      isRedisConnected = true;
    });
    sharedRedisClient.on("error", () => {
      isRedisConnected = false;
    });
    sharedRedisClient.connect().catch(() => {
      isRedisConnected = false;
    });
  }
  return isRedisConnected ? sharedRedisClient : null;
}

/**
 * Factory tạo Rate Limiter Middleware hỗ trợ Redis phân tán (cho cluster/multi-pod)
 * và tự động fallback về in-memory sliding-window nếu Redis chưa sẵn sàng.
 * Trả về HTTP headers chuẩn RFC 6585 (Retry-After, X-RateLimit-*).
 */
export function createRateLimiter(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs ?? envConfig.rateLimit.windowMs;
  const maxRequests = options.maxRequests ?? envConfig.rateLimit.maxRequests;
  const message =
    options.message ?? "Too many requests, please try again later";
  const requestCounts = new Map<string, { count: number; resetAt: number }>();

  // Dọn dẹp định kỳ các record in-memory đã hết hạn để ngăn ngừa rò rỉ bộ nhớ
  const cleanupTimer = setInterval(
    () => {
      const now = Date.now();
      for (const [key, record] of requestCounts.entries()) {
        if (now > record.resetAt) {
          requestCounts.delete(key);
        }
      }
    },
    5 * 60 * 1000,
  );
  cleanupTimer.unref();

  return (
    req: Request,
    res: Response,
    next: NextFunction,
  ): void | Promise<void> => {
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";
    const rawRoute = req.baseUrl || req.path || "";
    // SEC-17: Chuẩn hóa route prefix bằng cách loại bỏ prefix '/api/v1' (ví dụ '/api/v1/statistics' -> '/statistics')
    // nhằm ngăn chặn phân mảnh rate limit key và gian lận nhân đôi hạn mức trên các route dual-mounted.
    const normalizedRoute = rawRoute.replace(/^\/api\/v1/, "") || "/";
    const key = options.keyGenerator
      ? options.keyGenerator(req)
      : `${clientIp}:${normalizedRoute}`;
    const now = Date.now();

    // 1. Nếu không có Redis (môi trường test hoặc Redis tắt), thực thi hoàn toàn đồng bộ
    const redis = options.redisClient ?? getSharedRateLimitRedisClient();
    if (!redis) {
      const record = requestCounts.get(key);

      if (!record || now > record.resetAt) {
        const resetAt = now + windowMs;
        requestCounts.set(key, { count: 1, resetAt });

        res.setHeader("X-RateLimit-Limit", maxRequests);
        res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - 1));
        res.setHeader("X-RateLimit-Reset", Math.ceil(resetAt / 1000));

        next();
        return;
      }

      record.count += 1;
      const remaining = Math.max(0, maxRequests - record.count);
      const resetTimeSeconds = Math.ceil(record.resetAt / 1000);

      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", remaining);
      res.setHeader("X-RateLimit-Reset", resetTimeSeconds);

      if (record.count > maxRequests) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((record.resetAt - now) / 1000),
        );
        res.setHeader("Retry-After", retryAfterSeconds);
        res.status(429).json({
          success: false,
          message,
          code: ERROR_CODE.RATE_LIMIT_EXCEEDED,
        });
        return;
      }

      next();
      return;
    }

    // 2. Thử nghiệm rate limit phân tán qua Redis bất đồng bộ
    return (async () => {
      try {
        const redisKey = `ratelimit:${key}`;
        // SEC-16: Thực thi nguyên tử bằng Redis Lua script để đảm bảo luôn gán TTL ngay khi tạo key,
        // ngăn chặn triệt để tình trạng key bất tử (TTL = -1) gây khóa vĩnh viễn client khi có sự cố mạng.
        const luaScript = `
          local current = redis.call('INCR', KEYS[1])
          local ttl = redis.call('PTTL', KEYS[1])
          if current == 1 or ttl < 0 then
            redis.call('PEXPIRE', KEYS[1], ARGV[1])
            ttl = tonumber(ARGV[1])
          end
          return {current, ttl}
        `;
        const evalResult = (await redis.eval(
          luaScript,
          1,
          redisKey,
          windowMs,
        )) as [number, number];

        if (Array.isArray(evalResult) && evalResult.length >= 2) {
          const count = Number(evalResult[0]);
          const pttl = Math.max(0, Number(evalResult[1]));

          const resetAt = now + pttl;
          const remaining = Math.max(0, maxRequests - count);

          res.setHeader("X-RateLimit-Limit", maxRequests);
          res.setHeader("X-RateLimit-Remaining", remaining);
          res.setHeader("X-RateLimit-Reset", Math.ceil(resetAt / 1000));

          if (count > maxRequests) {
            const retryAfterSeconds = Math.max(1, Math.ceil(pttl / 1000));
            res.setHeader("Retry-After", retryAfterSeconds);
            res.status(429).json({
              success: false,
              message,
              code: ERROR_CODE.RATE_LIMIT_EXCEEDED,
            });
            return;
          }

          next();
          return;
        }
      } catch (err: any) {
        // SEC (F-02): Cảnh báo khi Redis gặp lỗi và phải fallback sang in-memory rate limiting.
        // Trong môi trường multi-process/cluster (K8s/PM2), in-memory counters không được chia sẻ giữa các worker.
        if (envConfig.nodeEnv === "production") {
          console.warn(
            `[SECURITY-WARN][RateLimit] Redis error (${err?.message || "unknown"}). Falling back to in-memory rate limiter. Multi-process rate limits may be diluted.`,
          );
        }
      }

      const record = requestCounts.get(key);
      if (!record || now > record.resetAt) {
        const resetAt = now + windowMs;
        requestCounts.set(key, { count: 1, resetAt });
        res.setHeader("X-RateLimit-Limit", maxRequests);
        res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - 1));
        res.setHeader("X-RateLimit-Reset", Math.ceil(resetAt / 1000));
        next();
        return;
      }

      record.count += 1;
      const remaining = Math.max(0, maxRequests - record.count);
      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", remaining);
      res.setHeader("X-RateLimit-Reset", Math.ceil(record.resetAt / 1000));

      if (record.count > maxRequests) {
        res.setHeader(
          "Retry-After",
          Math.max(1, Math.ceil((record.resetAt - now) / 1000)),
        );
        res.status(429).json({
          success: false,
          message,
          code: ERROR_CODE.RATE_LIMIT_EXCEEDED,
        });
        return;
      }
      next();
    })();
  };
}

/**
 * Rate Limiter chung cho toàn bộ API routes (/api/v1): cấu hình động từ RATE_LIMIT_MAX_REQUESTS & RATE_LIMIT_WINDOW_MS
 */
export const rateLimitMiddleware = createRateLimiter({
  windowMs: envConfig.rateLimit.windowMs,
  maxRequests: envConfig.rateLimit.maxRequests,
  message: "Too many requests, please try again later",
});

/**
 * Rate Limiter nghiêm ngặt dành riêng cho các auth endpoints nhạy cảm
 * (login, register, forgot-password, resend-verification, reset-password): cấu hình động từ AUTH_RATE_LIMIT_MAX_REQUESTS & AUTH_RATE_LIMIT_WINDOW_MS
 */
export const authRateLimitMiddleware = createRateLimiter({
  windowMs: envConfig.rateLimit.authWindowMs,
  maxRequests: envConfig.rateLimit.authMaxRequests,
  message: "Too many authentication attempts, please try again later",
});
