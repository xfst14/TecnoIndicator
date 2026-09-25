import { kiloRouter } from "./_shared/kiloRouter.js";
import { tinyfishRouter } from "./_shared/tinyfishRouter.js";
import { REGION_NAMES, isRegion, type Region } from "./_shared/regions.js";
import { getRegionalAnalytics } from "./_shared/deterministicAnalytics.js";
import { FORECAST_CACHE_MS, sanitizeUrl } from "./_shared/http.js";
import { getCache, setCache } from "./_shared/cache.js";
import { safeParseJson } from "./_shared/validation.js";
import type { RegionalForecastPoint } from "./_shared/types.js";

const START_YEAR = new Date().getFullYear();

const SYSTEM_PROMPT_REGIONAL = (regionName: string) =>
  `You are a quantitative commodities forecasting system specializing in ${regionName} energy and water markets. Use the supplied ${regionName} analytics snapshot, ${regionName} dynamic factors, and any available ${regionName}-specific historical price series to produce 1–10 year regional forecasts for oil, electricity, and water within ${regionName}.\n\nEmulate LSTM-style sequence continuation, Temporal Fusion Transformer-style multi-horizon attention, XGBoost-style feature-importance reasoning, and Bayesian Neural Network-style uncertainty bands.\n\nRespect the current ${regionName}-specific analytics values as the year-zero anchors. Do not use global averages as year-zero anchors. Avoid unrealistic discontinuities unless they are supported by supplied high-importance ${regionName} factors.\n\nReturn strict JSON only matching the required RegionalForecastPoint[] schema. Do not include markdown or commentary outside JSON.`;

function buildRegionalForecastFallback(region: Region): RegionalForecastPoint[] {
  const points: RegionalForecastPoint[] = [];
  for (let t = 0; t <= 10; t++) {
    const year = START_YEAR + t;
    points.push({
      region,
      year,
      label: String(year),
      oil: { avg: 104.86 * Math.pow(1.038, t), min: 90, max: 130 },
      electricity: { avg: 166 * Math.pow(1.046, t), min: 120, max: 220 },
      water: { avg: 2.5 * Math.pow(1.05, t), min: 2.0, max: 4.0 },
    });
  }
  return points;
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const regionParam = url.searchParams.get("region");
  if (!regionParam || !isRegion(regionParam)) {
    return Response.json({ error: "Missing or invalid 'region' query parameter" }, { status: 400 });
  }
  const region = regionParam as Region;
  try {
    const forceRefresh = url.searchParams.get("force") === "true";
    const cacheKey = `regional-forecast:${region}`;
    const cached = forceRefresh ? null : await getCache<RegionalForecastPoint[]>(cacheKey, FORECAST_CACHE_MS);
    if (cached) {
      return Response.json(cached, { status: 200 });
    }

    const kiloStatus = await kiloRouter.getKiloStatus();

    if (!kiloStatus.available || kiloStatus.zeroCostModels.length === 0) {
      const fallback = buildRegionalForecastFallback(region);
      await setCache(cacheKey, fallback, FORECAST_CACHE_MS);
      return Response.json(fallback, { status: 200 });
    }

    const analytics = await getRegionalAnalytics(region);
    const search = await tinyfishRouter.tinyfishSearch(`${REGION_NAMES[region]} oil electricity water prices 2026`, { region });
    const factorsCache = await getCache<unknown[]>("dynamic-factors:global", FORECAST_CACHE_MS);
    const regionalFactorsCache = await getCache<unknown[]>(`dynamic-factors:${region}`, FORECAST_CACHE_MS);
    const factors = regionalFactorsCache ?? factorsCache ?? [];

    const payload = {
      model: kiloStatus.activeModel ?? kiloStatus.zeroCostModels[0] ?? "kilo-auto/free",
      messages: [
        { role: "system", content: SYSTEM_PROMPT_REGIONAL(REGION_NAMES[region]) },
        {
          role: "user",
          content: JSON.stringify({
            analytics,
            factors,
            region,
            search: search.results?.map((r) => ({ title: r.title, url: sanitizeUrl(r.url) ?? "", snippet: r.snippet?.slice(0, 500) })),
            request: `Generate 11-year ${region} forecast for oil, electricity, and water with avg/min/max bands anchored to current regional price levels.`,
          }),
        },
      ],
      max_tokens: 4096,
      temperature: 0.3,
    };

    let response;
    try {
      response = await kiloRouter.kiloInfer(payload);
    } catch {
      const fallback = buildRegionalForecastFallback(region);
      await setCache(cacheKey, fallback, FORECAST_CACHE_MS);
      return Response.json(fallback, { status: 200 });
    }

    const content = response.choices?.[0]?.message?.content ?? "";
    const parsed = safeParseJson<Array<RegionalForecastPoint>>(content);

    if (!parsed) {
      const fallback = buildRegionalForecastFallback(region);
      await setCache(cacheKey, fallback, FORECAST_CACHE_MS);
      return Response.json(fallback, { status: 200 });
    }

    const validated = parsed
      .filter((p) => p && typeof p === "object")
      .map((p) => {
        const oil = (p as any).oil;
        const electricity = (p as any).electricity;
        const water = (p as any).water;
        return {
          region,
          year: Number((p as any).year ?? 0),
          label: String((p as any).label ?? ""),
          oil: { avg: Number(oil?.avg ?? 0), min: Number(oil?.min ?? 0), max: Number(oil?.max ?? 0) },
          electricity: { avg: Number(electricity?.avg ?? 0), min: Number(electricity?.min ?? 0), max: Number(electricity?.max ?? 0) },
          water: { avg: Number(water?.avg ?? 0), min: Number(water?.min ?? 0), max: Number(water?.max ?? 0) },
        } as RegionalForecastPoint;
      })
      .filter((p) => p.year >= START_YEAR && p.year <= START_YEAR + 10);

    if (validated.length === 0) {
      const fallback = buildRegionalForecastFallback(region);
      await setCache(cacheKey, fallback, FORECAST_CACHE_MS);
      return Response.json(fallback, { status: 200 });
    }

    await setCache(cacheKey, validated, FORECAST_CACHE_MS);
    return Response.json(validated, { status: 200 });
  } catch (error) {
    console.error("Regional forecast error:", error);
    const fallbackRegion = isRegion(regionParam) ? (regionParam as Region) : "asia";
    const fallback = buildRegionalForecastFallback(fallbackRegion);
    return Response.json(fallback, { status: 503 });
  }
}