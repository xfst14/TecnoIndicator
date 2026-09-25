import { getCache, setCache, deleteCache } from "./cache.js";
import {
  ANALYTICS_CACHE_MS,
  clamp,
  parsePositiveNumber,
  round,
} from "./http.js";
import { REGION_NAMES, type Region } from "./regions.js";
import type { AnalyticsSnapshot, RegionalAnalyticsSnapshot } from "./types.js";

export interface PriceInput {
  currentDieselPrice: number;
  baselineDieselPrice: number;
  currentElectricityTariff: number;
  baselineElectricityTariff: number;
  currentWaterPrice: number;
  baselineWaterPrice: number;
}

export interface AnalyticsConfig {
  fuelBaseDieselPrice: number;
  fuelFactor: number;
  gridLossFactor: number;
  waterScarcityMultiplier: number;
}

export const DEFAULT_ANALYTICS_CONFIG: AnalyticsConfig = {
  fuelBaseDieselPrice: 3.42,
  fuelFactor: 0.08,
  gridLossFactor: 1.08,
  waterScarcityMultiplier: 1.35,
};

export const REGIONAL_DEFAULTS: Record<
  Region,
  {
    diesel: { current: number; baseline: number; source: string };
    electricity: { current: number; baseline: number; source: string };
    water: { current: number; baseline: number; source: string };
  }
> = {
  asia: {
    diesel: { current: 3.18, baseline: 2.95, source: "Asia-Pacific retail fuel benchmark (public composite)" },
    electricity: { current: 98, baseline: 88, source: "Asia residential electricity benchmark (public composite)" },
    water: { current: 1.65, baseline: 1.42, source: "Asia municipal water tariff benchmark (public composite)" },
  },
  europe: {
    diesel: { current: 3.86, baseline: 3.55, source: "EU retail fuel benchmark (public composite)" },
    electricity: { current: 258, baseline: 236, source: "EU residential electricity benchmark (public composite)" },
    water: { current: 3.85, baseline: 3.52, source: "EU municipal water tariff benchmark (public composite)" },
  },
  africa: {
    diesel: { current: 3.42, baseline: 3.05, source: "African retail fuel benchmark (public composite)" },
    electricity: { current: 142, baseline: 128, source: "African residential electricity benchmark (public composite)" },
    water: { current: 1.35, baseline: 1.18, source: "African municipal water tariff benchmark (public composite)" },
  },
  americas: {
    diesel: { current: 3.28, baseline: 3.02, source: "Americas retail fuel benchmark (public composite)" },
    electricity: { current: 158, baseline: 145, source: "Americas residential electricity benchmark (public composite)" },
    water: { current: 2.15, baseline: 1.95, source: "Americas municipal water tariff benchmark (public composite)" },
  },
  oceania: {
    diesel: { current: 3.72, baseline: 3.45, source: "Oceania retail fuel benchmark (public composite)" },
    electricity: { current: 252, baseline: 232, source: "Oceania residential electricity benchmark (public composite)" },
    water: { current: 3.55, baseline: 3.25, source: "Oceania municipal water tariff benchmark (public composite)" },
  },
};

export const GLOBAL_DEFAULTS: PriceInput = {
  currentDieselPrice: 3.62,
  baselineDieselPrice: 3.42,
  currentElectricityTariff: 166,
  baselineElectricityTariff: 152,
  currentWaterPrice: 2.5,
  baselineWaterPrice: 2.28,
};

function readConfig(): AnalyticsConfig {
  return {
    fuelBaseDieselPrice: parsePositiveNumber(process.env.FUEL_BASE_DIESEL_PRICE, DEFAULT_ANALYTICS_CONFIG.fuelBaseDieselPrice),
    fuelFactor: parsePositiveNumber(process.env.FUEL_FACTOR, DEFAULT_ANALYTICS_CONFIG.fuelFactor),
    gridLossFactor: parsePositiveNumber(process.env.GRID_LOSS_FACTOR, DEFAULT_ANALYTICS_CONFIG.gridLossFactor),
    waterScarcityMultiplier: parsePositiveNumber(process.env.WATER_SCARCITY_MULTIPLIER, DEFAULT_ANALYTICS_CONFIG.waterScarcityMultiplier),
  };
}

function computeAnalytics(
  input: PriceInput,
  config: AnalyticsConfig,
  dataSource: string,
  isLive: boolean,
  region?: Region,
): AnalyticsSnapshot | RegionalAnalyticsSnapshot {
  const dieselRatio = input.baselineDieselPrice > 0 ? (input.currentDieselPrice - input.baselineDieselPrice) / input.baselineDieselPrice : 0;
  const electricityRatio = input.baselineElectricityTariff > 0 ? (input.currentElectricityTariff - input.baselineElectricityTariff) / input.baselineElectricityTariff : 0;
  const waterRatio = input.baselineWaterPrice > 0 ? (input.currentWaterPrice - input.baselineWaterPrice) / input.baselineWaterPrice : 0;

  const fuelLevy = dieselRatio / config.fuelFactor;
  const electricityTariffAdjustmentIndex = electricityRatio * config.gridLossFactor;
  const waterScarcityAdjustedPriceIndex = waterRatio * config.waterScarcityMultiplier;

  const result: AnalyticsSnapshot | RegionalAnalyticsSnapshot = {
    fuelLevy: round(clamp(fuelLevy, -50, 50), 4),
    electricityTariffAdjustmentIndex: round(clamp(electricityTariffAdjustmentIndex, -10, 10), 4),
    waterScarcityAdjustedPriceIndex: round(clamp(waterScarcityAdjustedPriceIndex, -10, 10), 4),
    dataSource,
    isLive,
    timestamp: new Date().toISOString(),
  };

  if (region) {
    return { ...result, region } as RegionalAnalyticsSnapshot;
  }
  return result as AnalyticsSnapshot;
}

export async function getGlobalAnalytics(): Promise<AnalyticsSnapshot> {
  const cached = await getCache<AnalyticsSnapshot>("analytics:global", ANALYTICS_CACHE_MS);
  if (cached) return cached;

  const config = readConfig();
  const result = computeAnalytics(GLOBAL_DEFAULTS, config, "Global retail fuel, electricity and water benchmark (public composite)", false);
  await setCache("analytics:global", result, ANALYTICS_CACHE_MS);
  return result;
}

export async function getRegionalAnalytics(region: Region): Promise<RegionalAnalyticsSnapshot> {
    const cached = await getCache<RegionalAnalyticsSnapshot>(`analytics:regional:${region}`, ANALYTICS_CACHE_MS);
    if (cached) return cached;

    const config = readConfig();
    const defaults = REGIONAL_DEFAULTS[region];
    const result = computeAnalytics(
        {
            currentDieselPrice: defaults.diesel.current,
            baselineDieselPrice: defaults.diesel.baseline,
            currentElectricityTariff: defaults.electricity.current,
            baselineElectricityTariff: defaults.electricity.baseline,
            currentWaterPrice: defaults.water.current,
            baselineWaterPrice: defaults.water.baseline,
        },
        config,
        `${REGION_NAMES[region]} regional retail fuel, electricity and water benchmark (public composite)`,
        false,
        region,
    );
    await setCache(`analytics:regional:${region}`, result, ANALYTICS_CACHE_MS);
    return result as RegionalAnalyticsSnapshot;
}

export async function clearAnalyticsCache(): Promise<void> {
  await Promise.all(
    ["analytics:global", ...Object.keys(REGION_NAMES).map((r) => `analytics:regional:${r}`)].map((key) => deleteCache(key)),
  );
}

export async function computeAnalyticsFromLivePrices(
  input: PriceInput,
  config: AnalyticsConfig = readConfig(),
  dataSource: string = "Live market prices",
  isLive: boolean = true,
  region?: Region,
): Promise<AnalyticsSnapshot | RegionalAnalyticsSnapshot> {
  const dieselRatio = input.baselineDieselPrice > 0 ? (input.currentDieselPrice - input.baselineDieselPrice) / input.baselineDieselPrice : 0;
  const electricityRatio = input.baselineElectricityTariff > 0 ? (input.currentElectricityTariff - input.baselineElectricityTariff) / input.baselineElectricityTariff : 0;
  const waterRatio = input.baselineWaterPrice > 0 ? (input.currentWaterPrice - input.baselineWaterPrice) / input.baselineWaterPrice : 0;

  const fuelLevy = dieselRatio / config.fuelFactor;
  const electricityTariffAdjustmentIndex = electricityRatio * config.gridLossFactor;
  const waterScarcityAdjustedPriceIndex = waterRatio * config.waterScarcityMultiplier;

  const result: AnalyticsSnapshot | RegionalAnalyticsSnapshot = {
    fuelLevy: round(clamp(fuelLevy, -50, 50), 4),
    electricityTariffAdjustmentIndex: round(clamp(electricityTariffAdjustmentIndex, -10, 10), 4),
    waterScarcityAdjustedPriceIndex: round(clamp(waterScarcityAdjustedPriceIndex, -10, 10), 4),
    dataSource,
    isLive,
    timestamp: new Date().toISOString(),
  };

  if (region) {
    return { ...result, region } as RegionalAnalyticsSnapshot;
  }
  return result as AnalyticsSnapshot;
}