import {
  VIETNAM_TIMEZONE,
  VIETNAM_OFFSET_HOURS,
  VIETNAM_OFFSET_MS,
  VIETNAM_DATE_REGEX,
  ISO_DATE_REGEX,
} from "../constants/date.constant";

/**
 * Returns UTC Date boundaries for a given date in DD/MM/YYYY (Vietnamese standard)
 * or YYYY-MM-DD (ISO standard) format based on Vietnam time (UTC+7).
 *
 * Examples:
 *   '22/08/2026' (DD/MM/YYYY) ->
 *     startOfDay: 2026-08-21T17:00:00.000Z (which is 2026-08-22 00:00:00 UTC+7)
 *     endOfDay:   2026-08-22T16:59:59.999Z (which is 2026-08-22 23:59:59.999 UTC+7)
 *   '2026-08-22' (YYYY-MM-DD) ->
 *     startOfDay: 2026-08-21T17:00:00.000Z
 *     endOfDay:   2026-08-22T16:59:59.999Z
 */
export function getVietnamDayRange(dateString: string): {
  startOfDay: Date;
  endOfDay: Date;
} {
  let year: number;
  let month: number;
  let day: number;

  const vnMatch = dateString.match(VIETNAM_DATE_REGEX);
  const isoMatch = dateString.match(ISO_DATE_REGEX);

  if (vnMatch) {
    day = Number(vnMatch[1]);
    month = Number(vnMatch[2]);
    year = Number(vnMatch[3]);
  } else if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else {
    throw new Error(
      `Invalid date format for Vietnam day range: ${dateString}. Expected DD/MM/YYYY or YYYY-MM-DD.`,
    );
  }

  // Validate maximum days in month (including leap years)
  const maxDaysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > maxDaysInMonth) {
    throw new Error(
      `Invalid calendar day: ${day} exceeds maximum days (${maxDaysInMonth}) for month ${month}/${year}.`,
    );
  }

  // Create UTC date representing the local 00:00:00 in UTC+7
  const startOfDay = new Date(
    Date.UTC(year, month - 1, day, 0 - VIETNAM_OFFSET_HOURS, 0, 0, 0),
  );
  const endOfDay = new Date(
    Date.UTC(year, month - 1, day, 23 - VIETNAM_OFFSET_HOURS, 59, 59, 999),
  );

  return { startOfDay, endOfDay };
}

/**
 * Formats a Date to DD/MM/YYYY (default, Vietnamese standard) or YYYY-MM-DD in Vietnam timezone (UTC+7).
 */
export function formatVietnamDate(
  date: Date,
  format: "DD/MM/YYYY" | "YYYY-MM-DD" = "DD/MM/YYYY",
): string {
  const localDate = new Date(date.getTime() + VIETNAM_OFFSET_MS);
  const year = localDate.getUTCFullYear();
  const month = String(localDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(localDate.getUTCDate()).padStart(2, "0");

  if (format === "YYYY-MM-DD") {
    return `${year}-${month}-${day}`;
  }
  return `${day}/${month}/${year}`;
}

/**
 * Parses a date string in DD/MM/YYYY or YYYY-MM-DD format to a Date object in Vietnam time (00:00:00 UTC+7).
 */
export function parseVietnamDate(dateString: string): Date | null {
  try {
    return getVietnamDayRange(dateString).startOfDay;
  } catch {
    return null;
  }
}

/**
 * Formats a Date to readable Vietnamese datetime string (Asia/Ho_Chi_Minh).
 */
export function formatVietnamDateTime(date: Date): string {
  return date.toLocaleString("vi-VN", { timeZone: VIETNAM_TIMEZONE });
}

/**
 * Chuyển đổi chuỗi thời lượng (ví dụ: "15m", "1h", "7d", "30s") thành số milliseconds.
 * Nếu không khớp định dạng, trả về fallbackMs.
 */
export function parseDurationToMs(
  duration: string | undefined | null,
  fallbackMs: number,
): number {
  if (!duration || typeof duration !== "string") return fallbackMs;
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) return fallbackMs;
  const val = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "s":
      return val * 1000;
    case "m":
      return val * 60 * 1000;
    case "h":
      return val * 60 * 60 * 1000;
    case "d":
      return val * 24 * 60 * 60 * 1000;
    default:
      return fallbackMs;
  }
}

/**
 * SEC-37: Trả về chuỗi năm và số tuần chuẩn ISO 8601 (ví dụ: '2026-W44', '2022-W52').
 * Tuần 1 theo ISO 8601 là tuần chứa ngày Thứ Năm đầu tiên của năm (hoặc chứa ngày 4 tháng 1).
 * Một năm theo ISO 8601 chỉ có tối đa 52 hoặc 53 tuần.
 */
export function getIsoWeekString(date: Date): string {
  const d = date instanceof Date ? date : new Date(date);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7; // Thứ 2 = 0, Chủ nhật = 6
  target.setUTCDate(target.getUTCDate() - dayNr + 3); // Thứ 5 của tuần
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + (((4 - target.getUTCDay()) + 7) % 7));
  }
  const weekNum = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  const weekYear = new Date(firstThursday).getUTCFullYear();
  return `${weekYear}-W${String(weekNum).padStart(2, "0")}`;
}
