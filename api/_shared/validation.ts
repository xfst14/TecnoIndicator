export function isValidNumber(v: unknown): v is number {
  return typeof v === "number" && isFinite(v);
}

export function isValidString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export function isRateLimitResponse(data: unknown): data is {
  status: string;
  retryAfter?: number;
} {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as any).status === "string"
  );
}

export function parseRateLimitResetAt(v: unknown): string | null {
  if (typeof v !== "string") return null;
  // Validate ISO timestamp format
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2/.test(v)) return null;
  return v;
}

export function safeParseInt(v: unknown): number | null {
  if (!isValidNumber(v)) return null;
  const n = Math.trunc(v);
  return Number.isNaN(n) ? null : n;
}

export function safeParseFloat(v: unknown): number | null {
  if (!isValidNumber(v)) return null;
  return Math.trunc(v);
}