import { InMemoryCache } from "./cache";
import type {
  TinyFishKeyState,
  TinyFishSearchResult,
  TinyFishScrapeResult,
  TinyFishStatus,
} from "./types";
import { httpJson } from "./http";
import { safeJsonParse } from "./validation";

const TINY_FISH_BASE_URL = "https://api.tinyfish.io";

let moduleState: {
  keys: TinyFishKeyState[];
  searchCache: Map<string, TinyFishSearchResult>;
  scrapeCache: Map<string, TinyFishScrapeResult>;
  lastSearchRun: string | null;
  lastScrapeRun: string | null;
  online: boolean;
} = {
  keys: Array.from({ length: 5 }, () => ({
    keyIndex: 0,
    available: false,
    rateLimited: false,
    rateLimitRemaining: null,
    rateLimitResetAt: null,
    lastCheckedAt: null,
    lastSuccessAt: null,
  })),
  searchCache: new Map(),
  scrapeCache: new Map(),
  lastSearchRun: null,
  lastScrapeRun: null,
  online: false,
};

let roundRobinCounter = 0;

function getKeyEnv(keyIndex: number): string | undefined {
  return process.env[`TINYFISH_KEY_${keyIndex + 1}`];
}

function getTinyFishHeaders(key: string): Record<string, string> {
  return {
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function isKeyUsable(keyIndex: number): boolean {
  const key = moduleState.keys[keyIndex];
  return key.available && !key.rateLimited;
}

function getNextAvailableKeyIndex(): number | null {
  const usable = moduleState.keys
    .map((k, i) => ({ index: i, state: k }))
    .filter((item) => isKeyUsable(item.index));

  if (usable.length === 0) return null;

  // Prefer key with highest remaining quota
  usable.sort((a, b) => {
    const aRem = a.state.rateLimitRemaining ?? -1;
    const bRem = b.state.rateLimitRemaining ?? -1;
    return bRem - aRem;
  });

  // Round-robin among equal quota
  const startIdx = roundRobinCounter % usable.length;
  const selected = usable[startIdx];
  roundRobinCounter++;
  return selected.index;
}

async function probeKey(keyIndex: number): Promise<boolean> {
  const key = getKeyEnv(keyIndex);
  if (!key) return false;

  try {
    const res = await fetch(`${TINY_FISH_BASE_URL}/v1/verify`, {
      method: "GET",
      headers: getTinyFishHeaders(key),
    });

    if (res.ok) {
      moduleState.keys[keyIndex] = {
        keyIndex,
        available: true,
        rateLimited: false,
        rateLimitRemaining: extractQuotaRemaining(res.headers),
        rateLimitResetAt: extractQuotaReset(res.headers),
        lastCheckedAt: new Date().toISOString(),
        lastSuccessAt: new Date().toISOString(),
      };
      return true;
    }

    if (res.status === 429 || res.status === 403) {
      moduleState.keys[keyIndex] = {
        keyIndex,
        available: false,
        rateLimited: true,
        rateLimitRemaining: extractQuotaRemaining(res.headers),
        rateLimitResetAt: extractQuotaReset(res.headers),
        lastCheckedAt: new Date().toISOString(),
        lastSuccessAt: null,
      };
    } else {
      moduleState.keys[keyIndex] = {
        keyIndex,
        available: false,
        rateLimited: false,
        rateLimitRemaining: null,
        rateLimitResetAt: null,
        lastCheckedAt: new Date().toISOString(),
        lastSuccessAt: null,
      };
    }
    return false;
  } catch {
    moduleState.keys[keyIndex] = {
      keyIndex,
      available: false,
      rateLimited: false,
      rateLimitRemaining: null,
      rateLimitResetAt: null,
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt: null,
    };
    return false;
  }
}

function extractQuotaRemaining(headers: Headers): number | null {
  const val = headers.get("x-ratelimit-remaining") ?? headers.get("ratelimit-remaining") ?? headers.get("x-quota-remaining");
  if (val !== null) {
    const num = parseInt(val);
    if (!isNaN(num)) return num;
  }
  return null;
}

function extractQuotaReset(headers: Headers): string | null {
  const val = headers.get("x-ratelimit-reset") ?? headers.get("ratelimit-reset") ?? headers.get("retry-after");
  if (val !== null) {
    const date = new Date(val);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return null;
}

async function tinyfishSearch(
  query: string,
  options?: { maxResults?: number; cacheTtlMs?: number }
): Promise<TinyFishSearchResult> {
  const cached = moduleState.searchCache.get(query);
  if (cached) {
    const cacheTtl = options?.cacheTtlMs ?? 10 * 60_000;
    const age = Date.now() - new Date(cached.cached ? Date.now() : 0).getTime();
    if (age < cacheTtl) return cached;
  }

  const keyIndex = getNextAvailableKeyIndex();

  if (keyIndex === null) {
    return { query, results: [], cached: false };
  }

  const key = getKeyEnv(keyIndex);
  if (!key) {
    return { query, results: [], cached: false };
  }

  try {
    const res = await fetch(
      `${TINY_FISH_BASE_URL}/v1/search?query=${encodeURIComponent(query)}`,
      {
        method: "GET",
        headers: getTinyFishHeaders(key),
      }
    );

    if (!res.ok) {
      if (res.status === 429) {
        moduleState.keys[keyIndex] = {
          keyIndex,
          available: false,
          rateLimited: true,
          rateLimitRemaining: extractQuotaRemaining(res.headers),
          rateLimitResetAt: extractQuotaReset(res.headers),
          lastCheckedAt: new Date().toISOString(),
          lastSuccessAt: null,
        };

        const retryKeyIndex = getNextAvailableKeyIndex();
        if (retryKeyIndex !== null && retryKeyIndex !== keyIndex) {
          return await tinyfishSearch(query, options);
        }
      }
      return { query, results: [], cached: false };
    }

    const body = await res.json();
    const results = safeJsonParse(body?.results ?? body?.data ?? [], []);

    moduleState.keys[keyIndex] = {
      keyIndex,
      available: true,
      rateLimited: false,
      rateLimitRemaining: extractQuotaRemaining(res.headers),
      rateLimitResetAt: extractQuotaReset(res.headers),
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    };

    moduleState.searchCache.set(query, {
      query,
      results,
      cached: false,
    });

    moduleState.lastSearchRun = new Date().toISOString();

    return { query, results, cached: false };
  } catch (err) {
    return { query, results: [], cached: false };
  }
}

async function tinyfishScrape(
  url: string
): Promise<TinyFishScrapeResult> {
  const cached = moduleState.scrapeCache.get(url);
  if (cached) {
    return cached;
  }

  const keyIndex = getNextAvailableKeyIndex();

  if (keyIndex === null) {
    return { url, content: "", cached: false };
  }

  const key = getKeyEnv(keyIndex);
  if (!key) {
    return { url, content: "", cached: false };
  }

  try {
    const res = await fetch(
      `${TINY_FISH_BASE_URL}/v1/scrape?url=${encodeURIComponent(url)}`,
      {
        method: "GET",
        headers: getTinyFishHeaders(key),
      }
    );

    if (!res.ok) {
      if (res.status === 429) {
        moduleState.keys[keyIndex] = {
          keyIndex,
          available: false,
          rateLimited: true,
          rateLimitRemaining: extractQuotaRemaining(res.headers),
          rateLimitResetAt: extractQuotaReset(res.headers),
          lastCheckedAt: new Date().toISOString(),
          lastSuccessAt: null,
        };

        const retryKeyIndex = getNextAvailableKeyIndex();
        if (retryKeyIndex !== null && retryKeyIndex !== keyIndex) {
          return await tinyfishScrape(url);
        }
      }
      return { url, content: "", cached: false };
    }

    const body = await res.json();
    const content = body?.content ?? body?.text ?? "";

    moduleState.keys[keyIndex] = {
      keyIndex,
      available: true,
      rateLimited: false,
      rateLimitRemaining: extractQuotaRemaining(res.headers),
      rateLimitResetAt: extractQuotaReset(res.headers),
      lastCheckedAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
    };

    moduleState.scrapeCache.set(url, {
      url,
      content,
      cached: false,
    });

    moduleState.lastScrapeRun = new Date().toISOString();

    return { url, content, cached: false };
  } catch {
    return { url, content: "", cached: false };
  }
}

export async function refreshTinyfishStatus(force = false): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const key = getKeyEnv(i);
    if (!key) continue;

    await probeKey(i);
  }
}

export function getTinyfishStatus(): TinyFishStatus {
  const usableKeys = moduleState.keys.filter(
    (k) => k.available && !k.rateLimited
  );
  const rateLimitedKeys = moduleState.keys.filter(
    (k) => k.rateLimited
  ).map((k) => k.keyIndex);

  return {
    available: moduleState.online,
    configuredKeys: 5,
    usableKeys: usableKeys.length,
    rateLimitedKeys,
  };
}

export async function initTinyfishRouter(): Promise<void> {
  await refreshTinyfishStatus();
}

// Re-export types
export type { TinyFishKeyState, TinyFishSearchResult, TinyFishScrapeResult, TinyFishStatus };