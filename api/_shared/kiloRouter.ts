import { InMemoryCache, analyticsCache, dynamicFactorsCache, tinyfishSearchCache, tinyfishScrapeCache, kiloModelCatalogCache, kiloAccessProbeCache } from "./cache";
import {
  KiloKeyState,
  KiloModelCandidate,
  KiloModel,
  KiloModelCatalog,
  KiloResponse,
  KiloStatus,
  KiloInferPayload,
  type KiloStatus,
  type KiloModelCandidate,
  type KiloResponse,
  type KiloChatCompletionRequest,
  type KiloChatCompletionResponse,
  type DEFAULT_KILO_MODEL_ID,
  parseNumericPrice,
  safeJsonParse,
  isValidUrl,
  clamp,
  sanitizeNumber,
  extractDateFromText,
  KiloHttpError,
  type KiloModelCatalog as KiloModelCatalogType,
  safeParse,
} from "./types";
import { httpJson } from "./http";
import { InMemoryCache as Cache } from "./cache";

const KILO_BASE_URL = "https://api.kilo.ai/api/gateway";
const CATALOG_REFRESH_TTL_MS = 60_000;
const ACCESS_PROBE_TTL_MS = 5 * 60_000;
const DEFAULT_MODEL_ID = "kilo-auto/free";

interface KeyProbeResult {
  keyIndex: number;
  available: boolean;
  rateLimited: boolean;
  rateLimitScope: "key" | "model" | "global" | "unknown" | null;
  rateLimitRemaining: number | null;
  rateLimitResetAt: string | null;
  lastSuccessAt: string | null;
  lastCheckedAt: string | null;
  modelId?: string;
  modelError?: string;
}

interface ModelCandidate {
  keyIndex: number;
  modelId: string;
  endpointUrl: string;
  inputPrice: number | null;
  outputPrice: number | null;
  zeroCostVerified: boolean;
  available: boolean;
  rateLimited: boolean;
  rateLimitScope: "key" | "model" | "global" | "unknown" | null;
  rateLimitRemaining: number | null;
  rateLimitResetAt: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  unsuitableForStructuredOutput: boolean;
}

let moduleState: {
  keys: KiloKeyState[];
  modelCandidates: ModelCandidate[];
  catalog: KiloModelCatalog | null;
  catalogLastRefresh: string | null;
  globalRateLimited: boolean;
  globalRateLimitResetAt: string | null;
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
  modelCandidates: [],
  catalog: null,
  catalogLastRefresh: null,
  globalRateLimited: false,
  globalRateLimitResetAt: null,
  online: false,
};

let internalRandomSeed = Date.now();

function secureRandomSelect<T>(items: T[]): T {
  internalRandomSeed = (internalRandomSeed * 16807 + 1) % 2147483647;
  const idx = internalRandomSeed % items.length;
  return items[idx];
}

function getKeyEnv(keyIndex: number): string | undefined {
  return process.env[`KILO_GATEWAY_KEY_${keyIndex + 1}`];
}

async function fetchCatalog(force = false): Promise<KiloModelCatalog | null> {
  const now = Date.now();
  const lastRefresh = kiloModelCatalogCache.get("lastRefresh") ?? 0;
  if (!force && catalogIsValid(catalogLastRefresh, now, lastRefresh)) {
    const cached = kiloModelCatalogCache.get<KiloModelCatalog>("catalog");
    if (cached) return cached;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const key = getKeyEnv(0);
    if (!key) continue;

    try {
      const res = await httpJson<KiloModelCatalog>(`${KILO_BASE_URL}/models`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${key}`,
        },
      });

      const parsed = parseCatalogDefensive(res);

      kiloModelCatalogCache.set("catalog", parsed, CATALOG_REFRESH_TTL_MS);
      kiloModelCatalogCache.set("lastRefresh", now, CATALOG_REFRESH_TTL_MS);

      return parsed;
    } catch (err) {
      if (attempt < 2) continue;
      console.error("Kilo catalog fetch failed after retries:", err);
    }
  }

  return kiloModelCatalogCache.get<KiloModelCatalog>("catalog") ?? null;
}

function catalogIsValid(
  lastRefresh: string | null,
  now: number,
  cachedLastRefresh: number
): boolean {
  if (!lastRefresh) return false;
  const lastRefreshDate = new Date(lastRefresh).getTime();
  const diff = now - lastRefreshDate;
  if (diff > CATALOG_REFRESH_TTL_MS) return false;
  if (diff < 0) return false;
  return true;
}

function parseCatalogDefensive(
  res: KiloChatCompletionResponse
): KiloModelCatalog {
  const models: KiloModel[] = [];

  if (res.choices && res.choices[0]?.message?.content) {
    const parsed = safeJsonParse(res.choices[0].message.content, []);
    if (Array.isArray(parsed)) {
      models.push(...parsed as KiloModel[]);
    }
  }

  return {
    data: models,
    object: "list",
  };
}

function parseModelFromCatalog(
  model: KiloModel
): {
  id: string;
  inputPrice: number | null;
  outputPrice: number | null;
  pricing: { input?: number | null; output?: number | null };
  suitableForZeroCost: boolean;
} {
  const parsed = model.pricing ?? model;
  const inputPrice = parseNumericPrice(parsed.input ?? parsed.prompt ?? parsed.inputPrice);
  const outputPrice = parseNumericPrice(parsed.output ?? parsed.completion ?? parsed.outputPrice);

  const priceConflicts =
    (inputPrice !== null && inputPrice !== 0) ||
    (outputPrice !== null && outputPrice !== 0);

  const suitableForZeroCost = !priceConflicts && inputPrice === 0 && outputPrice === 0;

  return {
    id: model.id,
    inputPrice,
    outputPrice,
    pricing: { input: inputPrice, output: outputPrice },
    suitableForZeroCost,
  };
}

function isDefaultModel(modelId: string): boolean {
  return modelId === DEFAULT_MODEL_ID || modelId.endsWith(`/${DEFAULT_MODEL_ID.split("/")[1]}`);
}

function buildKeyState(
  keyIndex: number,
  available: boolean,
  rateLimited: boolean,
  rateLimitScope: "key" | "model" | "global" | "unknown" | null,
  rateLimitRemaining: number | null,
  rateLimitResetAt: string | null,
  lastSuccessAt: string | null
): KiloKeyState {
  return {
    keyIndex,
    available,
    rateLimited,
    rateLimitScope,
    rateLimitRemaining,
    rateLimitResetAt,
    lastSuccessAt,
  };
}

function updateKeyState(state: KiloKeyState, update: Partial<KiloKeyState>): KiloKeyState {
  return { ...state, ...update };
}

function buildModelCandidate(
  keyIndex: number,
  modelId: string,
  endpointUrl: string,
  inputPrice: number | null,
  outputPrice: number | null,
  zeroCostVerified: boolean,
  available: boolean,
  rateLimited: boolean,
  rateLimitScope: "key" | "model" | "global" | "unknown" | null,
  rateLimitRemaining: number | null,
  rateLimitResetAt: string | null,
  lastCheckedAt: string | null,
  lastSuccessAt: string | null,
  unsuitableForStructuredOutput: boolean = false
): ModelCandidate {
  return {
    keyIndex,
    modelId,
    endpointUrl,
    inputPrice,
    outputPrice,
    zeroCostVerified,
    available,
    rateLimited,
    rateLimitScope,
    rateLimitRemaining,
    rateLimitResetAt,
    lastCheckedAt,
    lastSuccessAt,
    unsuitableForStructuredOutput,
  };
}

function discoverEligibleModels(
  catalog: KiloModelCatalog | null
): ModelCandidate[] {
  if (!catalog?.data) return [];

  const candidates: ModelCandidate[] = [];
  const usedKeys = new Set<number>();

  for (const model of catalog.data) {
    const parsed = parseModelFromCatalog(model);
    if (!parsed.suitableForZeroCost) continue;

    let keyIndex = 0;
    for (let i = 0; i < 5; i++) {
      const key = getKeyEnv(i);
      if (key && !moduleState.keys[i].rateLimited) {
        keyIndex = i;
        usedKeys.add(i);
        break;
      }
    }

    const candidate = buildModelCandidate(
      keyIndex,
      parsed.id,
      `${KILO_BASE_URL}/chat/completions`,
      parsed.inputPrice,
      parsed.outputPrice,
      true,
      true,
      false,
      "key",
      null,
      null,
      null,
      false
    );

    candidates.push(candidate);
  }

  return candidates;
}

function getCandidateKeyIndex(
  candidate: ModelCandidate,
  excludeKeys: Set<number> = new Set()
): number | null {
  if (!candidate.available && candidate.rateLimited) {
    const resetDate = candidate.rateLimitResetAt
      ? new Date(candidate.rateLimitResetAt).getTime()
      : 0;
    const now = Date.now();
    if (now < resetDate) return null;
  }

  for (let i = 0; i < 5; i++) {
    if (!excludeKeys.has(i) && moduleState.keys[i].available && !moduleState.keys[i].rateLimited) {
      return i;
    }
  }

  // Try rate-limited keys after their reset time
  for (let i = 0; i < 5; i++) {
    if (!excludeKeys.has(i) && moduleState.keys[i].rateLimited) {
      const resetDate = moduleState.keys[i].rateLimitResetAt
        ? new Date(moduleState.keys[i].rateLimitResetAt).getTime()
        : 0;
      if (Date.now() >= resetDate) {
        return i;
      }
    }
  }

  return null;
}

function probeKeyForModel(
  keyIndex: number,
  modelId: string
): KeyProbeResult {
  const key = getKeyEnv(keyIndex);
  if (!key) {
    return {
      keyIndex,
      available: false,
      rateLimited: false,
      rateLimitScope: "key",
      rateLimitRemaining: null,
      rateLimitResetAt: null,
      lastSuccessAt: null,
      lastCheckedAt: new Date().toISOString(),
    };
  }

  return {
    keyIndex,
    available: true,
    rateLimited: false,
    rateLimitScope: "key",
    rateLimitRemaining: null,
    rateLimitResetAt: null,
    lastSuccessAt: new Date().toISOString(),
    lastCheckedAt: new Date().toISOString(),
    modelId,
  };
}

function isKeyUsable(keyIndex: number): boolean {
  const key = moduleState.keys[keyIndex];
  return key.available && !key.rateLimited;
}

function isModelCandidateUsable(
  candidate: ModelCandidate
): boolean {
  if (!candidate.zeroCostVerified) return false;
  if (candidate.rateLimited) {
    const resetDate = candidate.rateLimitResetAt
      ? new Date(candidate.rateLimitResetAt).getTime()
      : 0;
    if (Date.now() < resetDate) return false;
  }
  return isKeyUsable(candidate.keyIndex);
}

function selectBestCandidate(
  candidates: ModelCandidate[],
  excludeKeys: Set<number> = new Set()
): ModelCandidate | null {
  const usable = candidates.filter(isModelCandidateUsable);

  if (usable.length === 0) return null;

  // Prefer the default model if available
  const defaultModel = usable.find((c) => isDefaultModel(c.modelId));
  if (defaultModel) return defaultModel;

  // If kilo-auto/free is in the pool, prefer it
  const freeModel = usable.find((c) => c.modelId === DEFAULT_MODEL_ID);
  if (freeModel) return freeModel;

  // Secure random selection from remaining eligible models
  return secureRandomSelect(usable);
}

function resetKeyAfterRateLimit(keyIndex: number): void {
  moduleState.keys[keyIndex] = {
    ...moduleState.keys[keyIndex],
    rateLimited: false,
    rateLimitRemaining: null,
    rateLimitResetAt: null,
    lastSuccessAt: new Date().toISOString(),
  };
}

function resetModelCandidateAfterRateLimit(candidate: ModelCandidate): void {
  moduleState.keys[candidate.keyIndex] = {
    ...moduleState.keys[candidate.keyIndex],
    rateLimited: false,
    rateLimitRemaining: null,
    rateLimitResetAt: null,
    lastSuccessAt: new Date().toISOString(),
  };
}

async function refreshProviderState(force = false): Promise<void> {
  // Refresh Kilo catalog
  const catalog = await fetchCatalog(force);

  // Rebuild eligible model candidates
  const candidates = discoverEligibleModels(catalog);
  moduleState.modelCandidates = candidates;

  // Update key states from catalog inference
  for (const keyIdx of [0, 1, 2, 3, 4]) {
    const key = getKeyEnv(keyIdx);
    if (!key) {
      moduleState.keys[keyIdx] = {
        keyIndex: keyIdx,
        available: false,
        rateLimited: false,
        rateLimitRemaining: null,
        rateLimitResetAt: null,
        lastCheckedAt: null,
        lastSuccessAt: null,
      };
      continue;
    }
  }

  // Recompute global rate-limit state
  const allRateLimited = moduleState.keys.every(
    (k) => k.rateLimited
  );
  if (allRateLimited && !moduleState.globalRateLimited) {
    moduleState.globalRateLimited = true;
    moduleState.globalRateLimitResetAt = new Date(
      Date.now() + 60_000
    ).toISOString();
  } else if (!allRateLimited && moduleState.globalRateLimited) {
    moduleState.globalRateLimited = false;
    moduleState.globalRateLimitResetAt = null;
  }

  // Set online status based on available keys and models
  const hasUsableKey = moduleState.keys.some((k) => k.available && !k.rateLimited);
  const hasUsableModel = moduleState.modelCandidates.some(
    (c) => c.available && !c.rateLimited && c.zeroCostVerified
  );
  moduleState.online = hasUsableKey && hasUsableModel;
}

async function kiloInfer(
  payload: KiloInferPayload
): Promise<KiloResponse> {
  await refreshProviderState();

  // Select a valid model candidate
  const candidate = selectBestCandidate(moduleState.modelCandidates);
  if (!candidate) {
    // No eligible model - return deterministic fallback response
    return {
      content: JSON.stringify({
        forecast: [],
        status: "unavailable",
        fallback: true,
      }),
      model: "unavailable",
      usage: undefined,
    };
  }

  // Try the selected candidate
  const keyIndex = candidate.keyIndex;
  const key = getKeyEnv(keyIndex);
  if (!key) {
    // Key invalid, try next candidate
    const remaining = moduleState.modelCandidates.filter(
      (c) => c.keyIndex !== keyIndex
    );
    if (remaining.length > 0) {
      const newCandidate = selectBestCandidate(remaining);
      if (newCandidate) {
        return await kiloInfer(payload); // Recursive retry with different candidate
      }
    }
    return {
      content: JSON.stringify({
        forecast: [],
        status: "unavailable",
        fallback: true,
      }),
      model: "unavailable",
      usage: undefined,
    };
  }

  // Build the system prompt + user prompt based on payload type
  let systemPrompt = "";
  let userPrompt = "";

  if (payload.responseFormat === "json") {
    systemPrompt =
      "You are a quantitative commodities forecasting system. Use the supplied analytics snapshot, dynamic factors, and historical series to produce 1-10 year forecasts for oil, electricity, and water. Emulate LSTM-style sequence continuation, Temporal Fusion Transformer-style multi-horizon attention, XGBoost-style feature-importance reasoning, and Bayesian Neural Network-style uncertainty bands. Return strict JSON only.";
    userPrompt = payload.userPrompt || "";
  } else {
    systemPrompt = payload.systemPrompt || "You are a helpful assistant.";
    userPrompt = payload.userPrompt || "";
  }

  try {
    const res = await httpJson<KiloChatCompletionResponse>(
      `${KILO_BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: candidate.modelId,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: payload.temperature ?? 0.7,
          max_tokens: payload.maxTokens ?? 1000,
          response_format: payload.responseFormat === "json"
            ? { type: "json_object" }
            : undefined,
        }),
      }
    );

    // Check for rate limits in response
    if (res.status === 429 || res.status === 403) {
      const rateLimitScope: "key" | "model" | "global" | "unknown" = "key";
      moduleState.keys[keyIndex] = updateKeyState(
        moduleState.keys[keyIndex],
        {
          rateLimited: true,
          rateLimitScope,
          rateLimitRemaining: extractRateLimitRemaining(res.headers),
          rateLimitResetAt: extractRateLimitResetAt(res.headers),
        }
      );

      // Try another candidate
      const remaining = moduleState.modelCandidates.filter(
        (c) => c.keyIndex !== keyIndex
      );
      if (remaining.length > 0) {
        const newCandidate = selectBestCandidate(remaining);
        if (newCandidate) {
          return await kiloInfer(payload);
        }
      }
      return {
        content: JSON.stringify({
          forecast: [],
          status: "rate-limited",
          fallback: true,
        }),
        model: candidate.modelId,
        usage: undefined,
      };
    }

    // Validate response is valid JSON
    if (res.choices && res.choices[0]?.message?.content) {
      const content = res.choices[0].message.content;
      try {
        JSON.parse(content);
      } catch {
        // Model returned malformed JSON - mark unsuitable and try another
        const remaining = moduleState.modelCandidates.filter(
          (c) => c.keyIndex !== keyIndex && c.modelId !== candidate.modelId
        );
        if (remaining.length > 0) {
          const newCandidate = selectBestCandidate(remaining);
          if (newCandidate) {
            return await kiloInfer(payload);
          }
        }
        return {
          content: JSON.stringify({
            forecast: [],
            status: "malformed-json",
            fallback: true,
          }),
          model: candidate.modelId,
          usage: undefined,
        };
      }
    }

    return {
      content: res.choices?.[0]?.message?.content || JSON.stringify({ forecast: [] }),
      model: candidate.modelId,
      usage: res.usage,
    };
  } catch (err: any) {
    if (err instanceof KiloHttpError) {
      const { status } = err;
      if (status === 429 || status === 403) {
        moduleState.keys[keyIndex] = updateKeyState(
          moduleState.keys[keyIndex],
          {
            rateLimited: true,
            rateLimitScope: "key",
            rateLimitRemaining: err.sanitizedHeaders["x-ratelimit-remaining"]
              ? Number(err.sanitizedHeaders["x-ratelimit-remaining"])
              : null,
            rateLimitResetAt: err.sanitizedHeaders["retry-after"]
              ? err.sanitizedHeaders["retry-after"]
              : null,
          }
        );

        const remaining = moduleState.modelCandidates.filter(
          (c) => c.keyIndex !== keyIndex
        );
        if (remaining.length > 0) {
          const newCandidate = selectBestCandidate(remaining);
          if (newCandidate) {
            return await kiloInfer(payload);
          }
        }
      }
    }

    // Key or model failed - try another candidate
    const remaining = moduleState.modelCandidates.filter(
      (c) => c.keyIndex !== keyIndex
    );
    if (remaining.length > 0) {
      const newCandidate = selectBestCandidate(remaining);
      if (newCandidate) {
        return await kiloInfer(payload);
      }
    }

    return {
      content: JSON.stringify({
        forecast: [],
        status: "error",
        fallback: true,
      }),
      model: candidate?.modelId ?? "unknown",
      usage: undefined,
    };
  }
}

function extractRateLimitRemaining(headers: Headers): number | null {
  const remaining = headers.get("x-ratelimit-remaining");
  if (remaining !== null) {
    const num = parseInt(remaining);
    if (!isNaN(num)) return num;
  }
  return null;
}

function extractRateLimitResetAt(headers: Headers): string | null {
  const reset = headers.get("x-ratelimit-reset-at") ?? headers.get("retry-after");
  if (reset) {
    const date = new Date(reset);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return null;
}

function rateLimitBackoffDelay(
  cycle: number,
  maxDelayMs = 15_000
): number {
  const baseDelays = [1_000, 2_000, 4_000];
  const base = baseDelays[Math.min(cycle, baseDelays.length - 1)];
  return Math.min(base, maxDelayMs);
}

export async function initKiloRouter(): Promise<void> {
  await refreshProviderState();
}

export async function refreshKiloModels(force = false): Promise<void> {
  await refreshProviderState(force);
}

export function getKiloStatus(): KiloStatus {
  const usableKeys = moduleState.keys.filter(
    (k) => k.available && !k.rateLimited
  );
  const rateLimitedKeys = moduleState.keys.filter(
    (k) => k.rateLimited
  ).map((k) => k.keyIndex);

  const usableModels = moduleState.modelCandidates.filter(
    (c) => c.available && !c.rateLimited && c.zeroCostVerified
  );
  const rateLimitedModels = moduleState.modelCandidates.filter(
    (c) => c.rateLimited
  ).map((c) => c.modelId);

  const zeroCostModels = [
    ...new Set(
      moduleState.modelCandidates
        .filter((c) => c.zeroCostVerified)
        .map((c) => c.modelId)
    ),
  ];

  const defaultModel =
    moduleState.modelCandidates.find((c) => isDefaultModel(c.modelId))?.modelId ||
    DEFAULT_MODEL_ID;

  const activeModel =
    moduleState.modelCandidates.find(
      (c) => isModelCandidateUsable(c) && isDefaultModel(c.modelId)
    )?.modelId || defaultModel;

  return {
    available: moduleState.online,
    zeroCostModels,
    defaultModel,
    activeModel,
    configuredKeys: 5,
    usableKeys: usableKeys.length,
    rateLimitedKeys,
    rateLimitedModels,
    globalRateLimited: moduleState.globalRateLimited,
    catalogLastRefresh: moduleState.catalogLastRefresh,
  };
}

export async function kiloInfer(payload: {
  systemPrompt: string;
  userPrompt: string;
  responseFormat?: "json" | "text";
  temperature?: number;
  maxTokens?: number;
}): Promise<KiloResponse> {
  return await kiloInfer({
    systemPrompt: payload.systemPrompt,
    userPrompt: payload.userPrompt,
    responseFormat: payload.responseFormat,
    temperature: payload.temperature,
    maxTokens: payload.maxTokens,
  });
}

export function getKiloStatus(): KiloStatus {
  return getKiloStatus();
}