/**
 * Helper thay thế an toàn các biến placeholder dạng {{variableName}} trong chuỗi template.
 * @param template Chuỗi mẫu (ví dụ: "Chào {{fullName}}, mã xác thực là {{token}}")
 * @param variables Object chứa các giá trị biến (ví dụ: { fullName: "Nguyễn Văn A", token: "123456" })
 * @returns Chuỗi sau khi đã thay thế các biến
 */
export function renderTemplateString(
  template: string,
  variables: Record<string, unknown> = {},
  options: { escapeHtml?: boolean } = { escapeHtml: true },
): string {
  if (!template) return "";

  const safeVars = variables && typeof variables === "object" ? variables : {};
  const shouldEscape = options.escapeHtml ?? true;

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    // SEC-33: Ngăn chặn rò rỉ phương thức/thuộc tính kế thừa từ Object.prototype (e.g. toString, valueOf, constructor)
    if (!Object.prototype.hasOwnProperty.call(safeVars, key)) {
      return "";
    }
    const value = safeVars[key];
    if (value === undefined || value === null) {
      return "";
    }
    const strVal = String(value);
    return shouldEscape ? escapeHtml(strVal) : strVal;
  });
}

/**
 * Escape các ký tự đặc biệt HTML để chống tấn công XSS / HTML Injection
 * trong nội dung email hoặc bất kỳ đầu ra HTML nào nhận dữ liệu từ người dùng.
 */
export function escapeHtml(str: string | undefined | null): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
