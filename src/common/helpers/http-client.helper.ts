/**
 * Internal Microservices HTTP Client Helper
 * Hỗ trợ giao tiếp liên dịch vụ đồng bộ qua HTTP Internal Endpoint
 * Tuân thủ architecture rule: timeout 3-5s, fallback an toàn, forward correlation headers
 */

export interface InternalHttpRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: any;
  timeoutMs?: number;
}

export interface InternalHttpResponse<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

export async function fetchInternalService<T = any>(
  url: string,
  options: InternalHttpRequestOptions = {},
): Promise<InternalHttpResponse<T>> {
  const timeoutMs = options.timeoutMs ?? 3000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(options.headers || {}),
    };

    let bodyStr: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyStr = JSON.stringify(options.body);
    }

    const response = await fetch(url, {
      method: options.method || "GET",
      headers,
      body: bodyStr,
      signal: controller.signal,
    });

    clearTimeout(timer);

    const contentType = response.headers.get("content-type") || "";
    let parsedData: any = null;

    if (contentType.includes("application/json")) {
      const json = await response.json();
      parsedData = json && json.data !== undefined ? json.data : json;
    } else {
      parsedData = await response.text();
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `HTTP ${response.status}: ${response.statusText}`,
        data: parsedData,
      };
    }

    return {
      ok: true,
      status: response.status,
      data: parsedData as T,
    };
  } catch (err: any) {
    clearTimeout(timer);
    const isTimeout = err.name === "AbortError";
    return {
      ok: false,
      status: isTimeout ? 504 : 500,
      error: isTimeout
        ? `Request timed out after ${timeoutMs}ms`
        : err.message || "Network request failed",
    };
  }
}

