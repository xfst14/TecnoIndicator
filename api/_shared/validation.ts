import { isRegion, type Region } from "./regions.js";
import { FACTOR_COUNT, MAX_SOLUTIONS } from "./http.js";
import type { Factor, Solution } from "./types.js";

export function validateRegionParam(
  searchParams: { get: (key: string) => string | null },
): { ok: true; region: Region } | { ok: false; error: string } {
  const region = searchParams.get("region");
  if (region === null || region === undefined || region === "") {
    return { ok: false, error: "Missing 'region' query parameter" };
  }
  if (!isRegion(region)) {
    return { ok: false, error: `Invalid region: ${region}. Must be one of: asia, europe, africa, americas, oceania` };
  }
  return { ok: true, region };
}

export function validateRegionList(
  searchParams: { getAll: (key: string) => string[] },
  key = "region",
): { ok: true; regions: Region[] } | { ok: false; error: string } {
  const raw = searchParams.getAll(key);
  const regions: Region[] = [];
  for (const r of raw) {
    if (!r) continue;
    if (!isRegion(r)) {
      return { ok: false, error: `Invalid region: ${r}. Must be one of: asia, europe, africa, americas, oceania` };
    }
    regions.push(r);
  }
  return { ok: true, regions };
}

export function safeParseInt(value: string | null, fallback = 0): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function safeParseJson<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function validateFactors(
  arr: unknown[],
  expectedCount = FACTOR_COUNT
): asserts arr is Factor[] {
  if (arr.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} factors, got ${arr.length}. All factors must be validated.`
    );
  }
}

export function validateSolutions(
  arr: unknown[],
  expectedCount = MAX_SOLUTIONS
): asserts arr is Solution[] {
  if (arr.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} solutions, got ${arr.length}. All solutions must be validated.`
    );
  }
}

export function validateRange(value: number, min: number, max: number): asserts value is number {
  if (value < min || value > max) {
    throw new Error(
      `Value ${value} is outside the range [${min}, ${max}].`
    );
  }
}

export function validateCategory(value: string, validCategories: readonly string[]): asserts value is string {
  if (!validCategories.includes(value)) {
    throw new Error(
      `Invalid category "${value}". Must be one of: ${validCategories.join(", ")}`
    );
  }
}

export function sanitizeError(message: string): string {
  return message.replace(/\n\s*\n/g, " ").slice(0, 500);
}

export function getClientIp(req: { headers: Record<string, string | string[] | undefined> }): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string") {
    return xff.split(",")[0].trim();
  }
  if (Array.isArray(xff) && xff.length > 0) {
    return xff[0].split(",")[0].trim();
  }
  const raw = req.headers["x-real-ip"];
  return typeof raw === "string" ? raw : "unknown";
}