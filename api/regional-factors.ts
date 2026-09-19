import { kiloRouter } from "./_shared/kiloRouter.js";
import { tinyfishRouter } from "./_shared/tinyfishRouter.js";
import { REGION_NAMES, isRegion, type Region } from "./_shared/regions.js";
import { getRegionalAnalytics } from "./_shared/deterministicAnalytics.js";
import { FACTORS_CACHE_MS, sanitizeUrl } from "./_shared/http.js";
import { getCache, setCache } from "./_shared/cache.js";
import { safeParseJson, sanitizeError } from "./_shared/validation.js";
import type { Factor } from "./_shared/types.js";

const MAX_FACTORS = 8;
const SYSTEM_PROMPT_REGIONAL = (regionName: string) =>
  `You are a Senior Commodity Risk Analyst specializing in ${regionName} energy and water markets. You are provided with current ${regionName}-specific market analytics, an existing list of ${regionName} price factors, and fresh validated news excerpts collected through TinyFish that are relevant to ${regionName}.\n\nValidate each candidate trend against the supplied current ${regionName} market conditions and source evidence.\n\nDetermine whether each candidate is a legitimate market-moving trend or noise within ${regionName}. Reject stale, duplicate, promotional, speculative, unsupported, irrelevant, or weakly evidenced claims. Reject any trend that is purely global with no demonstrated ${regionName}-specific price impact.\n\nFor each legitimate trend, evaluate its expected effect on ${regionName} oil, electricity, or water prices specifically. Assign an integer importance score from 0 to 100 based on evidence quality, ${regionName} geographic scope, affected commodities, expected regional price impact, duration, and immediacy within ${regionName}.\n\nExplain why each approved trend is legitimate and relevant to ${regionName} right now. Use only the supplied analytics, factors, excerpts, and source URLs. Do not invent sources or facts.\n\nReturn strict JSON only. Do not return markdown or commentary outside JSON.\n\nThe response must contain exactly eight validated ${regionName} factors matching the required schema. If a new legitimate trend is identified for ${regionName}, include its new factor details. The deterministic server-side application logic will handle duplicate detection, importance thresholds, timestamps, and removal of the oldest factor.`;

const REGION_QUERIES: Record<Region, string[]> = {
  asia: [
    "Asia oil market prices China India demand OPEC 2026",
    "Asia electricity power prices renewables grid China India 2026",
    "Asia water prices scarcity drought urbanization 2026",
  ],
  europe: [
    "Europe oil market prices Brent Russian supply sanctions 2026",
    "Europe electricity power prices carbon ETS renewables gas 2026",
    "Europe water prices drought scarcity Alpine hydropower 2026",
  ],
  africa: [
    "Africa oil market prices Nigeria Angola production exports 2026",
    "Africa electricity power prices diesel gensets grid reliability 2026",
    "Africa water prices drought scarcity Sahel utilities 2026",
  ],
  americas: [
    "Americas oil market prices WTI shale LNG exports 2026",
    "Americas electricity power prices hydro drought Henry Hub 2026",
    "Americas water prices drought California Southwest utilities 2026",
  ],
  oceania: [
    "Oceania oil market prices LNG import parity Australia 2026",
    "Oceania electricity power prices NEM NZ wholesale drought 2026",
    "Oceania water prices drought Sydney Melbourne utilities 2026",
  ],
};

const REPUTABLE_HOSTS = [
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
];

const RECENT_MONTH = () =>
  new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });

function isReputableSource(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return REPUTABLE_HOSTS.some((prefix) => host === prefix || host.endsWith(`.${prefix}`));
  } catch {
    return false;
  }
}

function isRecentPublishedAt(value: string | undefined): boolean {
  if (!value) return true;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return true;
  const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;
  return date >= cutoff;
}

function normalizeFactor(raw: unknown, scope: Region, region: Region): Factor | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const name = typeof f.name === "string" ? f.name.trim() : "";
  const explanation = typeof f.explanation === "string" ? f.explanation.trim() : "";
  const source = typeof f.source === "string" ? f.source.trim() : "";
  const id = typeof f.id === "string" && f.id.trim() ? f.id.trim() : `dynamic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const category = typeof f.category === "string" && f.category.trim() ? f.category.trim() : "Market";
  const direction = f.direction === "up" || f.direction === "down" || f.direction === "mixed" ? f.direction : "mixed";
  const magnitude = f.magnitude === "High" || f.magnitude === "Medium" || f.magnitude === "Low" ? f.magnitude : "Medium";
  const bias = f.bias === "short" || f.bias === "mid" || f.bias === "long" || f.bias === "flat" ? f.bias : "flat";
  const sourceUrl = sanitizeUrl(source);
  const importanceScore =
    typeof f.importanceScore === "number" && Number.isFinite(f.importanceScore)
      ? Math.max(0, Math.min(100, Math.round(f.importanceScore)))
      : 0;
  const commodities = Array.isArray(f.commodities)
    ? (f.commodities as string[]).filter((c) => c === "oil" || c === "electricity" || c === "water")
    : [];
  const regions =
    f.regions && Array.isArray(f.regions)
      ? ((f.regions as string[]).filter((r) => r === "global" || (REGION_NAMES as Record<string, string>)[r]))
      : [region];

  if (!name || !explanation || !sourceUrl || importanceScore < 20 || commodities.length === 0) return null;

  return {
    id: id.slice(0, 80),
    name: name.slice(0, 160),
    category: category.slice(0, 80),
    commodities: Array.from(new Set(commodities)) as Factor["commodities"],
    explanation: explanation.slice(0, 1200),
    direction,
    magnitude,
    source: sourceUrl,
    bias,
drift:
      f.drift && typeof f.drift === "object"
        ? {
            ...(typeof (f.drift as Record<string, unknown>).oil === "number" && Number.isFinite((f.drift as Record<string, unknown>).oil) ? { oil: (f.drift as Record<string, unknown>).oil as number } : {}),
            ...(typeof (f.drift as Record<string, unknown>).electricity === "number" && Number.isFinite((f.drift as Record<string, unknown>).electricity) ? { electricity: (f.drift as Record<string, unknown>).electricity as number } : {}),
            ...(typeof (f.drift as Record<string, unknown>).water === "number" && Number.isFinite((f.drift as Record<string, unknown>).water) ? { water: (f.drift as Record<string, unknown>).water as number } : {}),
          }
        : {},
    regions: Array.from(new Set(regions)) as Factor["regions"],
    scope,
    importanceScore,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function dedupeFactors(factors: Factor[]): Factor[] {
  const seen = new Set<string>();
  const out: Factor[] = [];
  for (const f of factors) {
    const key = f.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function replaceOldest(factors: Factor[], incoming: Factor[]): Factor[] {
  let next = [...factors, ...incoming];
  next = dedupeFactors(next);
  next = next.filter((f) => f.scope === incoming[0]?.scope);
  if (next.length > MAX_FACTORS) {
    const oldest = next
      .map((f) => ({ f, ts: Date.parse(f.createdAt) || 0 }))
      .sort((a, b) => a.ts - b.ts)
      .slice(0, next.length - MAX_FACTORS);
    const oldestIds = new Set(oldest.map((o) => o.f.id));
    next = next.filter((f) => !oldestIds.has(f.id));
  }
  return next.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, MAX_FACTORS);
}

function buildFallbackFactors(scope: Region, region: Region): Factor[] {
  const now = new Date().toISOString();
  const names: Record<Region, string[]> = {
    asia: ["China & India Energy Demand Growth", "ASEAN Grid Interconnection", "Coal-to-Gas Switching", "Strait of Hormuz Risk", "Urbanization & Desalination", "Renewable Energy Buildout", "Monsoon & Hydropower Variability", "EV Adoption & Battery Storage"],
    europe: ["EU ETS Carbon Price", "Russian Supply Displacement", "Renewables Curtailment Risk", "Drought & Alpine Hydro", "Nuclear & Gas Generation Mix", "Energy Efficiency Mandates", "Offshore Wind Expansion", "Heat Pump Electrification"],
    africa: ["Nigeria & Angola Production", "Diesel Genset Dependence", "Drought & Sahel Scarcity", "Subsidy Reform Pressure", "Hydroelectric Reliance", "Solar Mini-Grid Deployment", "Copper & Critical Minerals Demand", "Diesel Import Parity Pricing"],
    americas: ["US Shale Productivity", "Henry Hub Gas to Power", "LatAm Hydrology & Drought", "Pipeline & Export Capacity", "California Water Stress", "Grid Resilience Investment", "EV Adoption & Battery Storage", "LNG Export Growth"],
    oceania: ["LNG Export Linkage", "NEM & NZ Wholesale Spikes", "Millennium Drought Legacy", "Remote Island Fuel Premiums", "Desalination & Reuse", "Renewable Energy Zones", "Coal Plant Retirements", "Urban Water Tariff Reform"],
  };
  const commodities: Factor["commodities"] = ["oil", "electricity", "water"];
  return names[scope].slice(0, MAX_FACTORS).map((name, i) => ({
    id: `fallback-${scope}-${i + 1}`,
    name,
    category: i % 3 === 0 ? "Policy" : i % 3 === 1 ? "Market" : "Structural",
    commodities,
    explanation: `Static ${REGION_NAMES[region]} regional fallback factor maintained when live AI curation is unavailable.`,
    direction: i % 3 === 2 ? "mixed" : i % 2 === 0 ? "up" : "down",
    magnitude: (["High", "Medium", "Low"] as const)[i % 3],
    source: `${REGION_NAMES[region]} regional energy authorities and public benchmarks`,
    bias: (["short", "mid", "long", "flat"] as const)[i % 4],
    drift: {},
    regions: [region],
    scope,
    importanceScore: 70 - i * 2,
    createdAt: now,
    updatedAt: now,
  }));
}

function timeoutPromise(ms: number): Promise<never> {
  return new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Analysis timed out after ${ms}ms`)), ms),
  );
}

async function runFactorAnalysisWithTimeout(scope: Region, region: Region): Promise<Factor[]> {
  return Promise.race([
    runFactorAnalysis(scope, region),
    timeoutPromise(50000),
  ]);
}

async function runFactorAnalysis(scope: Region, region: Region): Promise<Factor[]> {
  const current = getCache<Factor[]>(`dynamic-factors:${scope}`, FACTORS_CACHE_MS);
  if (current) return current;
  const analytics = getRegionalAnalytics(region);
  const existing = current ?? buildFallbackFactors(scope, region);
  const searchQuery = REGION_QUERIES[region][0];
  const search = await tinyfishRouter.tinyfishSearch(`${searchQuery} ${RECENT_MONTH()}`, { limit: 10, region });
  const candidates = search.results
    .map((r) => ({ ...r, snippet: typeof r.snippet === "string" ? r.snippet : "" }))
    .filter((r) => isReputableSource(r.url) && isRecentPublishedAt(r.publishedAt))
    .slice(0, 5);
  if (candidates.length === 0) return buildFallbackFactors(scope, region);
  const excerpts = await Promise.all(
    candidates.map(async (r) => {
      try {
        const scraped = await tinyfishRouter.tinyfishScrape(r.url);
        return scraped ? { ...r, text: scraped.text, title: scraped.title || r.title } : r;
      } catch {
        return r;
      }
    }),
  );
  const payload = {
    messages: [
      { role: "system", content: SYSTEM_PROMPT_REGIONAL(REGION_NAMES[region]) },
      {
        role: "user",
        content: JSON.stringify({
          analytics,
          existingFactors: existing,
          candidates: excerpts.map((c) => ({ title: c.title, source: c.url, snippet: c.snippet?.slice(0, 2500), text: (c as any).text?.slice(0, 8000) })),
          region,
          month: RECENT_MONTH(),
        }),
      },
    ],
    max_tokens: 4096,
    temperature: 0.2,
  };
  const response = await kiloRouter.kiloInfer(payload);
  const content = response.choices?.[0]?.message?.content ?? "";
  const parsed = safeParseJson<{ factors?: unknown[] }>(content);
  if (!parsed?.factors) return buildFallbackFactors(scope, region);
  const normalized = parsed.factors
    .map((f) => normalizeFactor(f, scope, region))
    .filter((f): f is Factor => f !== null)
    .filter((f) => f.scope === scope)
    .slice(0, MAX_FACTORS);
  return replaceOldest(existing, normalized);
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "true";
    const regionParam = url.searchParams.get("region");
    if (!regionParam || !isRegion(regionParam)) {
      return Response.json({ error: "Missing or invalid 'region' query parameter. Must be one of: asia, europe, africa, americas, oceania" }, { status: 400 });
    }
    const region = regionParam as Region;
    const cacheKey = `dynamic-factors:${region}`;
    if (!force) {
      const cached = getCache<Factor[]>(cacheKey, FACTORS_CACHE_MS);
      if (cached) {
        return Response.json({ factors: cached, scope: region, count: cached.length, aiCurated: true, cacheKey, updatedAt: new Date().toISOString() }, { status: 200 });
      }
    }
    const factors = await runFactorAnalysisWithTimeout(region, region);
    setCache(cacheKey, factors, FACTORS_CACHE_MS);
    return Response.json({ factors, scope: region, count: factors.length, aiCurated: true, cacheKey, updatedAt: new Date().toISOString() }, { status: 200 });
  } catch (error) {
    console.error("Regional factors error:", sanitizeError(String(error)));
    const regionParam = new URL(req.url).searchParams.get("region");
    const region = isRegion(regionParam) ? (regionParam as Region) : "asia";
    const fallback = buildFallbackFactors(region, region);
    return Response.json({ factors: fallback, scope: region, count: fallback.length, aiCurated: false, cacheKey: `dynamic-factors:${region}`, updatedAt: new Date().toISOString(), error: "Regional factors temporarily unavailable; static fallbacks returned" }, { status: 200 });
  }
}
