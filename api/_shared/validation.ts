export function parseNumericPrice(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed.toLowerCase() === "free" || trimmed.toLowerCase() === "free-tier") {
      return 0;
    }
    const num = parseFloat(trimmed);
    if (!Number.isFinite(num)) return null;
    return num;
  }
  return null;
}

export function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sanitizeNumber(value: number | null | undefined, fallback: number): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return value;
}

export function validateFactorSchema(factor: Record<string, unknown>): factor is Required<Pick<Record<string, unknown>, "id" | "name" | "category" | "commodities" | "explanation" | "direction" | "magnitude" | "source" | "bias" | "drift" | "regions" | "importanceScore" | "createdAt" | "updatedAt" | "aiCurated"> > {
  const required = ["id", "name", "category", "commodities", "explanation", "direction", "magnitude", "source", "bias", "drift", "regions", "importanceScore", "createdAt", "updatedAt", "aiCurated"];
  for (const key of required) {
    if (!(key in factor)) return false;
  }
  if (typeof factor.id !== "string") return false;
  if (typeof factor.name !== "string") return false;
  if (typeof factor.category !== "string") return false;
  if (!Array.isArray(factor.commodities)) return false;
  if (typeof factor.explanation !== "string") return false;
  if (typeof factor.direction !== "string") return false;
  if (typeof factor.magnitude !== "string") return false;
  if (typeof factor.source !== "string") return false;
  if (typeof factor.bias !== "string") return false;
  if (typeof factor.drift !== "object") return false;
  if (!Array.isArray(factor.regions)) return false;
  if (typeof factor.importanceScore !== "number") return false;
  if (typeof factor.createdAt !== "string") return false;
  if (typeof factor.updatedAt !== "string") return false;
  if (typeof factor.aiCurated !== "boolean") return false;
  return true;
}

export function isReputableSource(url: string): boolean {
  try {
    const u = new URL(url);
    const hostname = u.hostname.toLowerCase();
    const reputablePatterns = [
      "iea.org", "eia.gov", "opec.org", "opec+", "fao.org", "un.org",
      "worldbank.org", "irena.org", "globalpetrolprices.com", "bloomberg.com",
      "reuters.com", "ft.com", "economist.com", "nature.com", "sciencedirect.com",
      "gov.", "mil.", "int", "org", "edu",
    ];
    return reputablePatterns.some((p) => hostname.includes(p));
  } catch {
    return false;
  }
}

export function extractDateFromText(text: string): Date | null {
  const patterns = [
    /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    /\b(\d{1,2})\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/gi,
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/gi,
  ];
  const now = Date.now();
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      let date: Date | null = null;
      if (match[1] && match[2] && match[3]) {
        date = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
      } else if (match[2] && match[3]) {
        const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const monthName = match[1];
        const mi = months.indexOf(monthName);
        if (mi >= 0) {
          date = new Date(parseInt(match[3]), mi, parseInt(match[2]));
        }
      }
      if (date && Math.abs(now - date.getTime()) < 365 * 24 * 60 * 60 * 1000) {
        return date;
      }
    }
  }
  return null;
}

export function parseModelPrice(obj: Record<string, unknown>, field: string): number | null {
  const raw = obj[field];
  return parseNumericPrice(raw);
}