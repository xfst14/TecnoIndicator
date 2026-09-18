export type CommodityId = "oil" | "electricity" | "water";
export type RegionId = "global" | "americas" | "europe" | "asia" | "africa" | "oceania";
export type Direction = "up" | "down" | "mixed";
export type Magnitude = "High" | "Medium" | "Low";
export type HorizonBias = "short" | "mid" | "long" | "flat";

export interface Commodity {
  id: CommodityId;
  name: string;
  short: string;
  unit: string;
  base: number;
  cagr: number;
  maxVol: number;
  cycleAmp: number;
  cyclePhase: number;
  color: string;
  floor: number;
  ceil: number;
  decimals: number;
}

export interface PriceBand {
  avg: number;
  min: number;
  max: number;
}

export interface ForecastPoint {
  year: number;
  label: string;
  oil: PriceBand;
  electricity: PriceBand;
  water: PriceBand;
}

export interface Factor {
  id: string;
  name: string;
  category: string;
  commodities: CommodityId[];
  explanation: string;
  direction: Direction;
  magnitude: Magnitude;
  source: string;
  bias: HorizonBias;
  drift: Partial<Record<CommodityId, number>>;
  regions?: RegionId[];
  importanceScore?: number;
  createdAt?: string;
  updatedAt?: string;
  aiCurated?: boolean;
}

export interface KiloModel {
  id: string;
  name?: string;
  inputPrice?: number | string | null;
  outputPrice?: number | string | null;
  pricing?: {
    input?: number | string | null;
    output?: number | string | null;
    prompt?: number | string | null;
    completion?: number | string | null;
  };
  metadata?: Record<string, unknown>;
  capabilities?: string[];
}

export interface KiloModelCatalog {
  data: KiloModel[];
  object: string;
  etag?: string;
  lastModified?: string;
}

export interface KiloChatCompletionRequest {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
}

export interface KiloChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost?: number;
  };
}

export interface KiloResponse {
  content: string;
  model: string;
  usage?: KiloChatCompletionResponse["usage"];
}

export interface KiloKeyState {
  keyIndex: number;
  available: boolean;
  rateLimited: boolean;
  rateLimitRemaining: number | null;
  rateLimitResetAt: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
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
  unsuitableForStructuredOutput: boolean;
}

export interface KiloStatus {
  available: boolean;
  zeroCostModels: string[];
  defaultModel: string;
  activeModel: string;
  configuredKeys: number;
  usableKeys: number;
  rateLimitedKeys: number[];
  rateLimitedModels: string[];
  globalRateLimited: boolean;
  catalogLastRefresh: string | null;
}

export interface TinyFishKeyState {
  keyIndex: number;
  available: boolean;
  rateLimited: boolean;
  rateLimitRemaining: number | null;
  rateLimitResetAt: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
}

export interface TinyFishSearchResult {
  query: string;
  results: Array<{
    url: string;
    title: string;
    snippet: string;
    publishedAt?: string;
    source?: string;
  }>;
  cached: boolean;
}

export interface TinyFishScrapeResult {
  url: string;
  content: string;
  title?: string;
  cached: boolean;
}

export interface TinyFishStatus {
  available: boolean;
  configuredKeys: number;
  usableKeys: number;
  rateLimitedKeys: number[];
}

export interface AnalyticsResult {
  fuelLevy: number;
  electricityTariffIndex: number;
  waterScarcityIndex: number;
  baseDieselPrice: number;
  currentDieselPrice: number;
  baseElectricityTariff: number;
  currentElectricityTariff: number;
  baseWaterPrice: number;
  currentWaterPrice: number;
  fuelFactor: number;
  gridLossFactor: number;
  waterScarcityMultiplier: number;
  audit: {
    fuelLevyCalculation: string;
    electricityTariffCalculation: string;
    waterScarcityCalculation: string;
  };
  timestamp: string;
  source: "live" | "defaults";
}

export interface DynamicFactor extends Factor {
  importanceScore: number;
  createdAt: string;
  updatedAt: string;
  aiCurated: boolean;
}

export interface HealthResponse {
  kiloGateway: KiloStatus;
  tinyfish: TinyFishStatus;
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

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
  fallback?: boolean;
}

export interface KiloInferPayload {
  systemPrompt: string;
  userPrompt: string;
  responseFormat?: "json" | "text";
  temperature?: number;
  maxTokens?: number;
}