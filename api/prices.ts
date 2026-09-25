import { tinyfishRouter } from "./_shared/tinyfishRouter.js";
import { kiloRouter } from "./_shared/kiloRouter.js";
import { getCache, setCache } from "./_shared/cache.js";
import { SEARCH_CACHE_MS, sanitizeUrl } from "./_shared/http.js";
import {
  GLOBAL_DEFAULTS,
  REGIONAL_DEFAULTS,
  getGlobalAnalytics,
  getRegionalAnalytics,
} from "./_shared/deterministicAnalytics.js";
import { isRegion, type Region } from "./_shared/regions.js";
import type { RegionId } from "./_shared/types.js";
import { safeParseJson } from "./_shared/validation.js";

const COMMODITY_QUERIES = [
  { commodity: "oil", queryTemplate: "Brent crude oil price 2026" },
  { commodity: "electricity", queryTemplate: "electricity wholesale price 2026" },
  { commodity: "water", queryTemplate: "water price per cubic meter 2026" },
];

const PRICE_EXTRACTION_PROMPT = `You are an expert financial data analyst specializing in commodity pricing. Your task is to extract precise price data from search results.

From the provided search results, identify the most recent, reliable price figures for each commodity (oil, electricity, water) with their sources.

Return strict JSON only with this schema:
{
  "prices": [
    {
      "commodity": "oil" | "electricity" | "water",
      "price": number (USD),
      "unit": "string (e.g., 'USD per barrel', 'USD per MWh', 'USD per cubic meter')",
      "source": "string (URL to the source)",
      "confidence": number (0-100)
    }
  ]
}

Search results may contain prices in various formats ($XX.XX, XX.XX USD, etc.). Extract the most plausible price from the most reliable source. Prioritize recent, authoritative sources. If a price cannot be clearly identified, set confidence to 0 and omit that commodity. Do not invent prices.

Do not include any text outside the JSON.`;

function getCommodityUnit(commodity: "oil" | "electricity" | "water"): string {
  switch (commodity) {
    case "oil":
      return "USD per barrel";
    case "electricity":
      return "USD per MWh";
    case "water":
      return "USD per cubic meter";
    default:
      return "USD";
  }
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "true";
    const regionParam = url.searchParams.get("region");
    const isGlobal = regionParam === null || regionParam === "";
    const scope: RegionId = isGlobal ? "global" : (isRegion(regionParam) ? regionParam : "global");
    const cacheKey = `live-prices:${scope}`;

    if (!force) {
      const cached = await getCache<{
        oil: { price: number; unit: string; source: string; isLive: boolean };
        electricity: { price: number; unit: string; source: string; isLive: boolean };
        water: { price: number; unit: string; source: string; isLive: boolean };
        asOf: string;
        dataSource: string;
        isLive: boolean;
      }>(cacheKey, SEARCH_CACHE_MS);
      if (cached) {
        return Response.json(cached, { status: 200 });
      }
    }

    // Initialize abort controller with 15s timeout
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 25000);

    try {
      // Try to get live prices from TinyFish
      const searchResults = await getLivePricesFromTinyFish(scope, abortController.signal);
      
      // If we got usable live prices, use them
      if (searchResults.isLive) {
        await setCache(cacheKey, searchResults, SEARCH_CACHE_MS);
        return Response.json(searchResults, { status: 200 });
      }
    } catch (error) {
      console.warn("TinyFish search failed, falling back to defaults:", error);
    } finally {
      clearTimeout(timeoutId);
    }

    // Fallback to deterministic defaults
    const analytics = scope === "global" ? await getGlobalAnalytics() : await getRegionalAnalytics(scope as Region);
    const fallbackPrices = scope === "global"
      ? {
          oil: GLOBAL_DEFAULTS.currentDieselPrice,
          electricity: GLOBAL_DEFAULTS.currentElectricityTariff,
          water: GLOBAL_DEFAULTS.currentWaterPrice,
        }
      : {
          oil: REGIONAL_DEFAULTS[scope as Region].diesel.current,
          electricity: REGIONAL_DEFAULTS[scope as Region].electricity.current,
          water: REGIONAL_DEFAULTS[scope as Region].water.current,
        };

    const fallbackResult = {
      oil: {
        price: fallbackPrices.oil,
        unit: "USD per barrel",
        source: analytics.dataSource,
        isLive: false,
      },
      electricity: {
        price: fallbackPrices.electricity,
        unit: "USD per MWh",
        source: analytics.dataSource,
        isLive: false,
      },
      water: {
        price: fallbackPrices.water,
        unit: "USD per cubic meter",
        source: analytics.dataSource,
        isLive: false,
      },
      asOf: new Date().toISOString(),
      dataSource: analytics.dataSource,
      isLive: false,
    };

    await setCache(cacheKey, fallbackResult, SEARCH_CACHE_MS);
    return Response.json(fallbackResult, { status: 200 });
  } catch (error) {
    console.error("Prices error:", error);
    return Response.json(
      { 
        error: "Prices temporarily unavailable",
        oil: { price: 0, unit: "USD per barrel", source: "error", isLive: false },
        electricity: { price: 0, unit: "USD per MWh", source: "error", isLive: false },
        water: { price: 0, unit: "USD per cubic meter", source: "error", isLive: false },
        asOf: new Date().toISOString(),
        dataSource: "error",
        isLive: false 
      }, 
      { status: 500 }
    );
  }
}

function extractPriceFromText(text: string): number | null {
  const pricePatterns = [
    /\$(\d+(?:\.\d+)?)/g,
    /(\d+(?:\.\d+)?)\s*USD/g,
    /(\d+(?:\.\d+)?)\s*dollars?/gi,
    /(\d+(?:\.\d+)?)\s*€/g,
    /(\d+(?:\.\d+)?)\s*EUR/g,
    /(\d+(?:\.\d+)?)\s*¥/g,
    /(\d+(?:\.\d+)?)\s*元/g,
  ];

  for (const pattern of pricePatterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length > 0) {
      for (const match of matches) {
        const price = parseFloat(match[1]);
        if (price >= 0.01 && price <= 10000) {
          return price;
        }
      }
    }
  }
  return null;
}

async function getLivePricesFromTinyFish(scope: RegionId, abortSignal: AbortSignal): Promise<{
  oil: { price: number; unit: string; source: string; isLive: boolean };
  electricity: { price: number; unit: string; source: string; isLive: boolean };
  water: { price: number; unit: string; source: string; isLive: boolean };
  asOf: string;
  dataSource: string;
  isLive: boolean;
}> {
  const searchPromises = COMMODITY_QUERIES.map(async ({ commodity, queryTemplate }) => {
    const query = queryTemplate;
    try {
      return await tinyfishRouter.tinyfishSearch(query, { limit: 10, region: scope === "global" ? undefined : scope }, abortSignal);
    } catch (error) {
      console.warn(`Failed to search for ${commodity}:`, error);
      return { results: [], total: 0, keyIndex: -1 };
    }
  });

  const searchResults = await Promise.all(searchPromises);

  // Extract raw text from TinyFish search results (titles and snippets)
  const searchResultsText = searchResults.map((result, index) => {
    const commodity = COMMODITY_QUERIES[index].commodity;
    const resultLines = (result.results ?? []).map((r: any) => 
      `- ${r.title}\n  Snippet: ${r.snippet}\n  URL: ${r.url}\n  Published: ${r.publishedAt}\n`
    ).join('\n');
    
    return `Commodity: ${commodity}\n${resultLines}`;
  }).join('\n\n');

  // Use Kilo AI to analyze the raw text and extract precise prices
  const payload = {
    messages: [
      { role: "system", content: PRICE_EXTRACTION_PROMPT },
      {
        role: "user",
        content: `Scope: ${scope}\n\n${searchResultsText}`,
      },
    ],
    max_tokens: 2048,
    temperature: 0.1,
  };

  try {
    const response = await kiloRouter.kiloInfer(payload, abortSignal);
    const content = response.choices?.[0]?.message?.content ?? "";
    const parsed = safeParseJson<{ prices?: unknown[] }>(content);
    if (parsed?.prices && Array.isArray(parsed.prices)) {
      const extractedPrices = parsed.prices
        .map((p: any) => ({
          commodity: p.commodity,
          price: typeof p.price === "number" ? p.price : null,
          unit: typeof p.unit === "string" ? p.unit : getCommodityUnit(p.commodity),
          source: typeof p.source === "string" ? sanitizeUrl(p.source) ?? p.source : "",
          confidence: typeof p.confidence === "number" ? p.confidence : 0,
        }))
        .filter((p: any) => p.commodity && p.price !== null && p.price > 0 && p.confidence >= 50);

      const prices: Record<string, { price: number; unit: string; source: string }> = {};
      for (const item of extractedPrices) {
        if (item.commodity === "oil" || item.commodity === "electricity" || item.commodity === "water") {
          prices[item.commodity] = {
            price: item.price,
            unit: item.unit,
            source: item.source,
          };
        }
      }

      if (prices.oil && prices.electricity && prices.water) {
        return {
          oil: { ...prices.oil, isLive: true },
          electricity: { ...prices.electricity, isLive: true },
          water: { ...prices.water, isLive: true },
          asOf: new Date().toISOString(),
          dataSource: "Kilo AI analysis of TinyFish search results",
          isLive: true,
        };
      }
    }
  } catch (error) {
    console.warn("Kilo AI price analysis failed, falling back to deterministic extraction:", error);
  }

  // Fallback: deterministic extraction from search results (legacy path)
  const prices: Record<string, { price: number | null; source: string }> = {
    oil: { price: null, source: "" },
    electricity: { price: null, source: "" },
    water: { price: null, source: "" },
  };

  searchResults.forEach((result, index) => {
    const commodity = COMMODITY_QUERIES[index].commodity;
    for (const res of result.results ?? []) {
      const textToSearch = `${res.title} ${res.snippet}`;
      const price = extractPriceFromText(textToSearch);
      if (price !== null) {
        prices[commodity] = {
          price,
          source: sanitizeUrl(res.url) || res.url,
        };
        break;
      }
    }
  });

  const allPricesFound = Object.values(prices).every(p => p.price !== null);

  if (allPricesFound) {
    return {
      oil: { price: prices.oil.price!, unit: getCommodityUnit("oil"), source: prices.oil.source, isLive: true },
      electricity: { price: prices.electricity.price!, unit: getCommodityUnit("electricity"), source: prices.electricity.source, isLive: true },
      water: { price: prices.water.price!, unit: getCommodityUnit("water"), source: prices.water.source, isLive: true },
      asOf: new Date().toISOString(),
      dataSource: "TinyFish search (deterministic fallback)",
      isLive: true,
    };
  } else {
    return {
      oil: { price: 0, unit: "USD per barrel", source: "insufficient data", isLive: false },
      electricity: { price: 0, unit: "USD per MWh", source: "insufficient data", isLive: false },
      water: { price: 0, unit: "USD per cubic meter", source: "insufficient data", isLive: false },
      asOf: new Date().toISOString(),
      dataSource: "TinyFish search (insufficient data)",
      isLive: false,
    };
  }
}