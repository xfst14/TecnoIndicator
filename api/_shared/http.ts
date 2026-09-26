export { REGIONS, REGION_LABELS, REGION_NAMES, isRegion, isCommodity } from "./regions.js";
export type { Region } from "./regions.js";

export const KILO_GATEWAY_BASE_URL = "https://api.kilo.ai/api/gateway";
export const KILO_GATEWAY_MODELS_URL = `${KILO_GATEWAY_BASE_URL}/models`;
export const KILO_GATEWAY_CHAT_URL = `${KILO_GATEWAY_BASE_URL}/chat/completions`;
export const DEFAULT_KILO_MODEL_ID = "kilo-auto/free";

export const KILO_KEY_ENV_NAMES = [
  "KILO_GATEWAY_KEY_1",
  "KILO_GATEWAY_KEY_2",
  "KILO_GATEWAY_KEY_3",
  "KILO_GATEWAY_KEY_4",
  "KILO_GATEWAY_KEY_5",
] as const;

export const TINYFISH_KEY_ENV_NAMES = [
  "TINYFISH_KEY_1",
  "TINYFISH_KEY_2",
  "TINYFISH_KEY_3",
  "TINYFISH_KEY_4",
  "TINYFISH_KEY_5",
] as const;

export const FACTOR_COUNT = 8;
export const ANALYTICS_CACHE_MS = 60_000;
export const FACTORS_CACHE_MS = 60_000;
export const SEARCH_CACHE_MS = 60_000;
export const MODEL_CACHE_MS = 60_000;
export const ACCESS_PROBE_CACHE_MS = 5 * 60_000;
export const FORECAST_CACHE_MS = 5 * 60_000;
export const SOLUTIONS_CACHE_MS = 60_000;
export const MAX_SOLUTIONS = 3;
export const GLOBAL_RATE_LIMIT_BACKOFF_MS = [1000, 2000, 4000];

export interface ConfiguredKey {
  envName: string;
  value: string;
}

export function readConfiguredKeys(envNames: readonly string[]): ConfiguredKey[] {
  const keys: ConfiguredKey[] = [];
  for (const envName of envNames) {
    const raw = process.env[envName];
    if (typeof raw === "string" && raw.trim().length > 0) {
      keys.push({ envName, value: raw.trim() });
    }
  }
  return keys;
}

export function parsePositiveNumber(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

export function parseBooleanFlag(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function sanitizeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function isGlobalRateLimitStatus(status: number): boolean {
  return status === 429 || status === 503 || status === 504;
}

export function isAccessDeniedStatus(status: number): boolean {
  return status === 401 || status === 403;
}

export const REPUTABLE_HOSTS = [
  "opec.org",
  "iea.org",
  "eia.gov",
  "worldbank.org",
  "un.org",
  "unep.org",
  "wri.org",
  "wrm.org",
  "oecd.org",
  "imf.org",
  "reuters.com",
  "apnews.com",
  "ft.com",
  "bloomberg.com",
  "energy.gov",
  "eurostat.europa.eu",
  "afdb.org",
  "adb.org",
  "asean.org",
  "europa.eu",
  "gov.au",
  "govt.nz",
  "gov.za",
  "gov.ng",
  "gov.in",
  "gov.cn",
  "gov.br",
  "gov.mx",
  "gov.ar",
  "gov.eg",
  "gov.ae",
  "gov.sa",
  "gov.qa",
  "gov.tr",
  "gov.id",
  "gov.my",
  "gov.ph",
  "gov.vn",
  "ieeewrc.org",
  "irena.org",
  "cdn.irena.org",
  "globalpetrolprices.com",
  "waterplaza.nl",
  "waterworld.com",
  "wateronline.com",
  "energyinst.org",
  "enerdata.net",
  "platts.com",
  "gulfnews.com",
  "thenationalnews.com",
  "thegazette.co.jm",
  "businessday.ng",
  "allafrica.com",
  "africanews.com",
  "screendaily.com",
];

export function isReputableSource(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return REPUTABLE_HOSTS.some((prefix) => host === prefix || host.endsWith(`.${prefix}`));
  } catch {
    return false;
  }
}

export function isRecentPublishedAt(value: string | undefined): boolean {
  if (!value) return true;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return true;
  const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;
  return date >= cutoff;
}