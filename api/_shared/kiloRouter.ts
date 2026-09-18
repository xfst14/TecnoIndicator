import {
  KiloCatalogModel,
  KiloCatalogResponse,
  KiloInferPayload,
  KiloInferResponse,
  KiloModelCandidate,
  KiloStatus,
  SanitizedLogEntry,
} from "./types";
import { SimpleCache } from "./cache";
import { fetchWithTimeout, ApiError } from "./http";
import { isValidNumber, parseRateLimitResetAt } from "./validation";

const DEFAULT_KILO_MODEL_ID = "kilo-auto/free";
const KILO_BASE_URL = "https://api.kilo.ai/api/gateway";
const MODELS_URL = `${KILO_BASE_URL}/models`;
const CHAT_URL = `${KILO_BASE_URL}/chat/completions`;

const CATALOG_TTL_MS = 60000;
const PROBE_TTL_MS = 300000;

const keys = [
  process.env.KILO_GATEWAY_KEY_1,
  process.env.KILO_GATEWAY_KEY_2,
  process.env.KILO_GATEWAY_KEY_3,
  process.env.KILO_GATEWAY_KEY_4,
  process.env.KILO_GATEWAY_KEY_5,
].filter((k): k is string => typeof k === "string" && k.length > 0);

const catalogCache = new SimpleCache<KiloCatalogResponse>();
const probeCache = new SimpleCache<Record<number, boolean>>();

export const kiloState: {
  candidates: KiloModelCandidate[];
  globalRateLimited: boolean;
  globalLimitResetAt: string | null;
  lastProbeSuccessful: boolean;
} = {
  candidates: [],
  globalRateLimited: false,
  globalLimitResetAt: null,
  lastProbeSuccessful: false,
};

export const kiloLogs: SanitizedLogEntry[] = [];

function addLog(
  event: string,
  details?: { keyIndex?: number; modelId?: string },
): void {
  kiloLogs.push({
    timestamp: new Date().toISOString(),
    event,
    keyIndex: details?.keyIndex,
    modelId: details?.modelId,
  });
  if (kiloLogs.length > 500) kiloLogs.splice(0, kiloLogs.length - 500);
}

function maskKey(key: string): string {
  return key.length > 8 ? key.substring(0, 4) + "***" : "***";
}

async function fetchCatalog(): Promise<KiloCatalogResponse | null> {
  const cached = catalogCache.get("catalog");
  if (cached && !false) return cached;

  try {
    const resp = await fetchWithTimeout(MODELS_URL, {
      headers: { Authorization: `Bearer ${keys[0] ?? ""}` },
      timeout: 15000,
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as KiloCatalogResponse;
    if (!data || !Array.isArray(data.models)) return null;
    catalogCache.set("catalog", data, CATALOG_TTL_MS);
    addLog("catalog_refresh", {});
    return data;
  } catch {
    return null;
  }
}

function isZeroCostModel(model: KiloCatalogModel): boolean {
  const inp = model.pricing?.input;
  const out = model.pricing?.output;
  if (inp === undefined || inp === null || out === undefined || out === null)
    return false;
  if (!isValidNumber(inp) || !isValidNumber(out)) return false;
  if (inp !== 0 || out !== 0) return false;
  return true;
}

function buildCandidates(
  catalog: KiloCatalogResponse,
): KiloModelCandidate[] {
  const candidates: KiloModelCandidate[] = [];
  for (let ki = 0; ki < keys.length; ki++) {
    for (const m of catalog.models) {
      if (!isZeroCostModel(m)) continue;
      candidates.push({
        keyIndex: ki,
        modelId: m.id,
        endpointUrl: CHAT_URL,
        inputPrice: m.pricing?.input ?? null,
        outputPrice: m.pricing?.output ?? null,
        zeroCostVerified: true,
        available: true,
        rateLimited: false,
        rateLimitScope: null,
        rateLimitRemaining: null,
        rateLimitResetAt: null,
        lastCheckedAt: null,
        lastSuccessAt: null,
      });
    }
  }
  return candidates;
}

async function probeKeyModel(
  keyIndex: number,
  modelId: string,
): Promise<boolean> {
  const key = keys[keyIndex];
  if (!key) return false;
  const cacheKey = `probe_${keyIndex}_${modelId}`;
  const cached = probeCache.get(cacheKey);
  if (cached !== null) return cached;

  try {
    const resp = await fetchWithTimeout(
      `${KILO_BASE_URL}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          temperature: 0,
        }),
        timeout: 10000,
      },
    );

    const success = resp.status === 200;
    probeCache.set(cacheKey, success, PROBE_TTL_MS);
    return success;
  } catch {
    probeCache.set(cacheKey, false, PROBE_TTL_MS);
    return false;
  }
}

function secureRandomSelect<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return items[arr[0] % items.length];
}

function classifyRateLimitScope(resp: Response): "key" | "model" | "global" | "unknown" {
  const header = resp.headers.get("x-ratelimit-scope") ?? resp.headers.get("retry-after") ?? "";
  const scope = header.toLowerCase();
  if (scope.includes("key")) return "key";
  if (scope.includes("model")) return "model";
  if (scope.includes("global") || scope.includes("ip")) return "global";
  return "unknown";
}

export async function initKiloRouter(): Promise<void> {
  const catalog = await fetchCatalog();
  if (!catalog) {
    addLog("init_no_catalog", {});
    return;
  }
  kiloState.candidates = buildCandidates(catalog);
  addLog("init_complete", { modelId: String(kiloState.candidates.length) });
}

export async function refreshKiloModels(force = false): Promise<void> {
  const catalog = await fetchCatalog();
  if (!catalog) return;
  kiloState.candidates = buildCandidates(catalog);
  addLog("catalog_refreshed", {});
}

export async function kiloInfer(
  payload: KiloInferPayload,
): Promise<KiloInferResponse | null> {
  if (kiloState.candidates.length === 0) {
    await refreshKiloModels(true);
  }

  const candidates = kiloState.candidates.filter((c) => c.available && !c.rateLimited);
  if (candidates.length === 0) return null;

  const defaultCandidate = candidates.find((c) => c.modelId === DEFAULT_KILO_MODEL_ID);
  const selected = defaultCandidate ?? secureRandomSelect(candidates);
  if (!selected) return null;

  const key = keys[selected.keyIndex];
  if (!key) return null;

  addLog("inference_start", { keyIndex: selected.keyIndex, modelId: selected.modelId });

  try {
    const resp = await fetchWithTimeout(CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: payload.model ?? selected.modelId,
        messages: payload.messages,
        temperature: payload.temperature ?? 0.2,
        max_tokens: payload.max_tokens ?? 500,
        response_format: payload.response_format ?? { type: "json_object" },
      }),
      timeout: 30000,
    });

    if (resp.status === 429) {
      const scope = classifyRateLimitScope(resp);
      selected.rateLimited = true;
      selected.rateLimitScope = scope;
      const retryAfter = parseInt(resp.headers.get("retry-after") ?? "60", 10);
      selected.rateLimitResetAt = new Date(Date.now() + retryAfter * 1000).toISOString();
      addLog("rate_limit_detected", { keyIndex: selected.keyIndex, modelId: selected.modelId });

      if (scope === "global" || scope === "ip") {
        kiloState.globalRateLimited = true;
        kiloState.globalLimitResetAt = selected.rateLimitResetAt;
      }

      return kiloInfer(payload);
    }

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      const errCode = body.error?.code ?? body.code ?? String(resp.status);
      if (
        errCode === "payment_required" ||
        errCode === "insufficient_balance" ||
        errCode === "access_denied" ||
        errCode === "entitlement_error"
      ) {
        selected.available = false;
        addLog("model_unavailable", { keyIndex: selected.keyIndex, modelId: selected.modelId });
        await refreshKiloModels(true);
        return kiloInfer(payload);
      }
      return null;
    }

    const data = (await resp.json()) as KiloInferResponse;
    selected.lastSuccessAt = new Date().toISOString();
    addLog("inference_success", { keyIndex: selected.keyIndex, modelId: selected.modelId });
    return data;
  } catch {
    return null;
  }
}

export function getKiloStatus(): KiloStatus {
  const usableKeys = new Set<number>();
  const rateLimitedKeys: number[] = [];
  const rateLimitedModels: string[] = [];

  for (const c of kiloState.candidates) {
    if (c.rateLimited) {
      if (c.rateLimitScope === "key") rateLimitedKeys.push(c.keyIndex);
      if (c.rateLimitScope === "model") rateLimitedModels.push(c.modelId);
    } else {
      usableKeys.add(c.keyIndex);
    }
  }

  const zeroCostModels = kiloState.candidates
    .filter((c) => c.zeroCostVerified && c.available)
    .map((c) => c.modelId);

  const activeModel = kiloState.candidates.find((c) => !c.rateLimited)?.modelId ?? null;

  return {
    available: kiloState.candidates.some((c) => c.available && !c.rateLimited),
    zeroCostModels: [...new Set(zeroCostModels)],
    defaultModel: DEFAULT_KILO_MODEL_ID,
    activeModel,
    configuredKeys: keys.length,
    usableKeys: usableKeys.size,
    rateLimitedKeys: [...new Set(rateLimitedKeys)],
    rateLimitedModels: [...new Set(rateLimitedModels)],
    globalRateLimited: kiloState.globalRateLimited,
    catalogLastRefresh:
      catalogCache.get("catalog") !== null ? new Date().toISOString() : null,
  };
}