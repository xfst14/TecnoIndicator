export async function httpJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new KiloHttpError(res.status, res.statusText, res.headers);
  }
  return res.json() as Promise<T>;
}

export function safeJsonParse(str: string, fallback: unknown = null): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function sanitizeRateLimitHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  const ignore = new Set(["authorization", "proxy-authorization", "set-cookie", "cookie"]);
  for (const [k, v] of headers.entries()) {
    if (k.toLowerCase().startsWith("x-") || k.toLowerCase().includes("rate") || k.toLowerCase().includes("quota") || k.toLowerCase().includes("retry") || k.toLowerCase().includes("reset") || k.toLowerCase().includes("limit")) {
      if (v.length < 500) {
        out[k] = v;
      }
    }
  }
  return out;
}

export class KiloHttpError extends Error {
  status: number;
  statusText: string;
  sanitizedHeaders: Record<string, string>;
  constructor(status: number, statusText: string, headers?: Headers) {
    super(`HTTP ${status}: ${statusText}`);
    this.name = "KiloHttpError";
    this.status = status;
    this.statusText = statusText;
    this.sanitizedHeaders = headers ? sanitizeRateLimitHeaders(headers) : {};
  }
}