export interface KiloModelPricing {
  inputPrice: number | null;
  outputPrice: number | null;
}

export interface KiloModelCandidate {
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
}

export interface TinyfishKeyState {
  keyIndex: number;
  available: boolean;
  rateLimited: boolean;
  rateLimitRemaining: number | null;
  rateLimitResetAt: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
}

export interface KiloStatus {
  available: boolean;
  zeroCostModels: string[];
  defaultModel: string;
  activeModel: string | null;
  configuredKeys: number;
  usableKeys: number;
  rateLimitedKeys: number[];
  rateLimitedModels: string[];
  globalRateLimited: boolean;
  catalogLastRefresh: string | null;
}

export interface TinyfishStatus {
  available: boolean;
  configuredKeys: number;
  usableKeys: number;
  rateLimitedKeys: number[];
}

export interface HealthResponse {
  kiloGateway: KiloStatus;
  tinyfish: TinyfishStatus;
  onlineModelConnected: boolean;
  analytics: {
    lastFetch: string | null;
    success: boolean;
  };
  dynamicFactors: {
    lastRun: string | null;
    nextRun: string | null;
    aiCurated: boolean;
    pollIntervalMs: number;
  };
}

export interface AnalyticsRequest {
  oilPrice?: number;
  electricityPrice?: number;
  waterPrice?: number;
}

export interface AnalyticsResponse {
  brent: {
    price: number;
    change24h: number;
    change7d: number;
    source: string;
  };
  diesel: {
    regional: Record<string, { price: number; change24h: number }>;
    source: string;
  };
  electricity: {
    tariff: {
      residential: number;
      industrial: number;
      commercial: number;
    };
    change24h: number;
    source: string;
  };
  water: {
    price: number;
    scarcityIndex: number;
    source: string;
  };
  fuelLevy: number;
  electricityTariffAdjustmentIndex: number;
  waterScarcityAdjustedPriceIndex: number;
  lastFetch: string | null;
  success: boolean;
}

export interface ForecastRequest {
  horizon?: number;
  region?: string;
  prices?: Record<string, number>;
}

export interface ForecastResponse {
  points: ForecastPoint[];
  aiEnhanced: boolean;
  fallback: boolean;
}

export interface ForecastPoint {
  year: number;
  label: string;
  oil: PriceBand;
  electricity: PriceBand;
  water: PriceBand;
}

export interface PriceBand {
  avg: number;
  min: number;
  max: number;
}

export interface DynamicFactorsRequest {
  analytics?: AnalyticsResponse;
}

export interface DynamicFactor {
  id: string;
  name: string;
  category: string;
  commodities: string[];
  explanation: string;
  direction: "up" | "down" | "mixed";
  magnitude: "High" | "Medium" | "Low";
  source: string;
  bias: "short" | "mid" | "long" | "flat";
  drift: Partial<Record<string, number>>;
  regions?: string[];
  importanceScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface DynamicFactorsResponse {
  factors: DynamicFactor[];
  aiCurated: boolean;
  lastRun: string | null;
  nextRun: string | null;
  pollIntervalMs: number;
}

export interface TinyfishSearchResult {
  query: string;
  results: TinyfishSearchItem[];
}

export interface TinyfishSearchItem {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source?: string;
}

export interface TinyfishScrapeResult {
  url: string;
  title: string;
  content: string;
}

export interface KiloInferPayload {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: string };
}

export interface KiloInferResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface KiloCatalogModel {
  id: string;
  name?: string;
  provider: string;
  pricing?: {
    input?: number | null;
    output?: number | null;
    cache_input?: number | null;
    cache_output?: number | null;
  };
  capabilities?: string[];
  context_window?: number;
}

export interface KiloCatalogResponse {
  models: KiloCatalogModel[];
}

export type SanitizedLogEntry = {
  timestamp: string;
  event: string;
  keyIndex?: number;
  modelId?: string;
  detail?: string;
};
