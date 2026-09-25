import { kiloRouter } from "./_shared/kiloRouter.js";
import { getGlobalAnalytics } from "./_shared/deterministicAnalytics.js";
import { FORECAST_CACHE_MS } from "./_shared/http.js";
import { getCache, setCache } from "./_shared/cache.js";
import { safeParseJson } from "./_shared/validation.js";
import type { ForecastPoint } from "./_shared/types.js";

const SYSTEM_PROMPT_GLOBAL =
  "You are a quantitative commodities forecasting system. Use the supplied global analytics snapshot, global dynamic factors, and historical series to produce 1–10 year global forecasts for oil, electricity, and water.\n\nEmulate LSTM-style sequence continuation, Temporal Fusion Transformer-style multi-horizon attention, XGBoost-style feature-importance reasoning, and Bayesian Neural Network-style uncertainty bands.\n\nRespect the current global analytics values as the year-zero anchors. Avoid unrealistic discontinuities unless they are supported by supplied high-importance global factors.\n\nReturn strict JSON only matching the required ForecastPoint[] schema. Do not include markdown or commentary outside JSON.";

const START_YEAR = new Date().getFullYear();

function buildGlobalForecastFallback(): ForecastPoint[] {
  const points = [];
  for (let t = 0; t <= 10; t++) {
    points.push({
      year: START_YEAR + t,
      label: String(START_YEAR + t),
      oil: { avg: 104.86 * Math.pow(1.038, t), min: 90, max: 130 },
      electricity: { avg: 166 * Math.pow(1.046, t), min: 120, max: 220 },
      water: { avg: 2.5 * Math.pow(1.05, t), min: 2.0, max: 4.0 },
    });
  }
  return points;
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const forceRefresh = url.searchParams.get("force") === "true";
    const cacheKey = "ai-forecast:global";
    const cached = forceRefresh ? null : await getCache(cacheKey, FORECAST_CACHE_MS);
    if (cached) return Response.json(cached, { status: 200 });

    const kiloStatus = await kiloRouter.getKiloStatus();

    if (!kiloStatus.available || kiloStatus.zeroCostModels.length === 0) {
      const fallback = buildGlobalForecastFallback();
      await setCache(cacheKey, fallback, FORECAST_CACHE_MS);
      return Response.json(fallback, { status: 200 });
    }

    const analytics = await getGlobalAnalytics();
    const factorsCache = await getCache("dynamic-factors:global", FORECAST_CACHE_MS);
    const factors = factorsCache ?? [];

    const payload = {
      model: kiloStatus.activeModel ?? kiloStatus.zeroCostModels[0] ?? "kilo-auto/free",
      messages: [
        { role: "system", content: SYSTEM_PROMPT_GLOBAL },
        {
          role: "user",
          content: JSON.stringify({
            analytics,
            factors,
            request: "Generate 11-year global forecast for oil, electricity, and water with avg/min/max bands.",
          }),
        },
      ],
      max_tokens: 4096,
      temperature: 0.3,
    };

    let kiloResponse: Awaited<ReturnType<typeof kiloRouter.kiloInfer>>;
    try {
      kiloResponse = await kiloRouter.kiloInfer(payload);
    } catch {
      const fallback = buildGlobalForecastFallback();
      await setCache(cacheKey, fallback, FORECAST_CACHE_MS);
      return Response.json(fallback, { status: 200 });
    }

    const content = kiloResponse.choices?.[0]?.message?.content ?? "";
    const parsed = safeParseJson<Array<ForecastPoint>>(content);

    if (!parsed) {
      const fallback = buildGlobalForecastFallback();
      await setCache(cacheKey, fallback, FORECAST_CACHE_MS);
      return Response.json(fallback, { status: 200 });
    }

    const validated = parsed
      .filter((p) => p && typeof p.year === "number" && typeof p.label === "string")
      .map((p) => ({
        year: p.year,
        label: p.label,
        oil: { avg: Number(p.oil?.avg ?? 0), min: Number(p.oil?.min ?? 0), max: Number(p.oil?.max ?? 0) },
        electricity: { avg: Number(p.electricity?.avg ?? 0), min: Number(p.electricity?.min ?? 0), max: Number(p.electricity?.max ?? 0) },
        water: { avg: Number(p.water?.avg ?? 0), min: Number(p.water?.min ?? 0), max: Number(p.water?.max ?? 0) },
      }));

    await setCache(cacheKey, validated, FORECAST_CACHE_MS);
    return Response.json(validated, { status: 200 });
  } catch (error) {
    console.error("AI forecast error:", error);
    const fallback = buildGlobalForecastFallback();
    return Response.json(fallback, { status: 503 });
  }
}