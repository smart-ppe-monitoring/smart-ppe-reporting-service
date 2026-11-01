import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { jwtConfig } from "../config/jwt.config";
import { AppError } from "../common/errors/app-error";
import { ERROR_CODE } from "../common/errors/error-code";
import { JWT_PURPOSE, JWT_ALGORITHM } from "../common/constants/jwt.constant";
import { isUuid } from "../common/helpers/uuid.helper";

export function extractTokenFromRequest(req: Request): string | undefined {
  // SEC-28: Ưu tiên header Authorization: Bearer tường minh trước cookie ambient
  const authHeader = req.headers?.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.split(" ")[1];
  }

  if (req.cookies?.accessToken) {
    return req.cookies.accessToken;
  }

  // SEC-31: Không cho phép trích xuất token qua query parameter trên các REST API của reporting service
  // nhằm chống rò rỉ JWT qua server access logs, browser history và referer header (CWE-598)
  return undefined;
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // SEC-31: Chặn triệt để việc truyền token hoặc ticket xác thực qua URL query string trên API
  if (req.query?.token || req.query?.ticket) {
    next(
      new AppError(
        "Không được phép truyền token xác thực qua query string trên API thông thường để tránh rò rỉ qua log và browser history",
        400,
        ERROR_CODE.VALIDATION_ERROR,
      ),
    );
    return;
  }

  const token = extractTokenFromRequest(req);

  if (!token) {
    next(new AppError("Unauthorized", 401, ERROR_CODE.UNAUTHORIZED));
    return;
  }

  try {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded !== "object" || !decoded.header) {
      next(new AppError("Token không hợp lệ", 401, ERROR_CODE.UNAUTHORIZED));
      return;
    }

    const { alg } = decoded.header;
    let payload: any;

    if (alg !== JWT_ALGORITHM.RS256) {
      next(
        new AppError(
          `Thuật toán '${alg}' không được chấp nhận. Hệ thống chỉ hỗ trợ RS256.`,
          401,
          ERROR_CODE.UNAUTHORIZED,
        ),
      );
      return;
    }

    if (!jwtConfig.publicKey) {
      next(
        new AppError(
          "Cấu hình khóa công khai RS256 chưa sẵn sàng",
          500,
          ERROR_CODE.INTERNAL_SERVER_ERROR,
        ),
      );
      return;
    }

    payload = jwt.verify(token, jwtConfig.publicKey, {
      algorithms: [JWT_ALGORITHM.RS256],
    });

    if (!payload || typeof payload !== "object") {
      next(new AppError("Token không hợp lệ", 401, ERROR_CODE.UNAUTHORIZED));
      return;
    }

    // SEC-02: Xác thực mục đích sử dụng (purpose) phải là ACCESS token
    if (payload.purpose && payload.purpose !== JWT_PURPOSE.ACCESS) {
      next(
        new AppError(
          "Token không đúng mục đích sử dụng (yêu cầu Access Token)",
          401,
          ERROR_CODE.UNAUTHORIZED,
        ),
      );
      return;
    }

    // SEC-20: Kiểm tra định dạng UUID hợp lệ cho user id để phòng ngừa PostgreSQL syntax error crash
    const rawUserId = payload.id || payload.sub;
    if (!rawUserId || typeof rawUserId !== "string" || !isUuid(rawUserId)) {
      next(
        new AppError(
          "Token không hợp lệ: định danh người dùng phải là UUID chuẩn",
          401,
          ERROR_CODE.UNAUTHORIZED,
        ),
      );
      return;
    }

    req.user = {
      id: rawUserId,
      email: payload.email,
      role: payload.role,
      roleId: payload.roleId,
      permissions: Array.isArray(payload.permissions)
        ? payload.permissions
        : undefined,
      siteIds: Array.isArray(payload.siteIds)
        ? payload.siteIds
        : payload.siteId
        ? [payload.siteId]
        : undefined,
      siteId: payload.siteId,
    };

    next();
  } catch (error) {
    next(new AppError("Token xác thực không hợp lệ hoặc đã hết hạn", 401, ERROR_CODE.UNAUTHORIZED));
  }
}
