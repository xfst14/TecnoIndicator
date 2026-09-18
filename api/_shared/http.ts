export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public retryAfter?: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const controller = new AbortController();
  const timeout = options.timeout ?? 30000;
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function sanitizeForLog(value: unknown): string {
  if (typeof value !== "string") return String(value);
  if (value.includes("key") && value.length > 8) {
    return value.substring(0, 4) + "***";
  }
  return value;
}
