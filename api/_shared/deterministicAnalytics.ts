import { isValidNumber } from "./validation";

const FUEL_BASE_DIESEL_PRICE = parseFloat(process.env.FUEL_BASE_DIESEL_PRICE ?? "1.35");
const FUEL_FACTOR = parseFloat(process.env.FUEL_FACTOR ?? "0.15");
const GRID_LOSS_FACTOR = parseFloat(process.env.GRID_LOSS_FACTOR ?? "0.08");
const WATER_SCARCITY_MULTIPLIER = parseFloat(process.env.WATER_SCARCITY_MULTIPLIER ?? "1.2");

export interface DeterministicAnalyticsResult {
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

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function computeFuelLevy(currentDieselPrice: number): number {
  if (!isValidNumber(currentDieselPrice) || currentDieselPrice === 0) return 0;
  const levy = ((currentDieselPrice - FUEL_BASE_DIESEL_PRICE) / FUEL_BASE_DIESEL_PRICE) / FUEL_FACTOR;
  return clamp(levy, -10, 10);
}

export function computeElectricityTariffAdjustment(
  currentTariff: number,
  baseTariff: number,
): number {
  if (!isValidNumber(currentTariff) || !isValidNumber(baseTariff) || baseTariff === 0) return 0;
  const index = ((currentTariff - baseTariff) / baseTariff) * GRID_LOSS_FACTOR;
  return clamp(index, -5, 5);
}

export function computeWaterScarcityPriceIndex(
  currentPrice: number,
  basePrice: number,
): number {
  if (!isValidNumber(currentPrice) || !isValidNumber(basePrice) || basePrice === 0) return 0;
  const index = ((currentPrice - basePrice) / basePrice) * WATER_SCARCITY_MULTIPLIER;
  return clamp(index, -5, 5);
}

export function buildAnalyticsSnapshot(
  currentPrices: Record<string, number>,
): DeterministicAnalyticsResult {
  const now = new Date().toISOString();
  const brentPrice = currentPrices.oil ?? 104.86;
  const electricityPrice = currentPrices.electricity ?? 166;
  const waterPrice = currentPrices.water ?? 2.5;

  const brentBase = 100;
  const electricityBase = 160;
  const waterBase = 2.4;

  const fuelLevy = computeFuelLevy(currentPrices.diesel ?? FUEL_BASE_DIESEL_PRICE);
  const electricityTariffAdjustmentIndex = computeElectricityTariffAdjustment(
    electricityPrice,
    electricityBase,
  );
  const waterScarcityAdjustedPriceIndex = computeWaterScarcityPriceIndex(
    waterPrice,
    waterBase,
  );

  return {
    brent: {
      price: brentPrice,
      change24h: isValidNumber(currentPrices.oilChange24h) ? currentPrices.oilChange24h : 0,
      change7d: isValidNumber(currentPrices.oilChange7d) ? currentPrices.oilChange7d : 0,
      source: "EIA · ICE Brent",
    },
    diesel: {
      regional: {
        global: {
          price: currentPrices.diesel ?? FUEL_BASE_DIESEL_PRICE,
          change24h: isValidNumber(currentPrices.dieselChange24h)
            ? currentPrices.dieselChange24h
            : 0,
        },
      },
      source: "EIA · Global Diesel Index",
    },
    electricity: {
      tariff: {
        residential: clamp(electricityPrice * 0.0014, 0.1, 0.4),
        industrial: clamp(electricityPrice * 0.0008, 0.05, 0.25),
        commercial: clamp(electricityPrice * 0.0011, 0.08, 0.32),
      },
      change24h: isValidNumber(currentPrices.electricityChange24h)
        ? currentPrices.electricityChange24h
        : 0,
      source: "GlobalPetrolPrices · IEA",
    },
    water: {
      price: waterPrice,
      scarcityIndex: clamp(waterPrice / waterBase, 0.5, 3.5),
      source: "UN-Water · GWI",
    },
    fuelLevy,
    electricityTariffAdjustmentIndex,
    waterScarcityAdjustedPriceIndex,
    lastFetch: now,
    success: true,
  };
}

export function buildFallbackAnalytics(): DeterministicAnalyticsResult {
  return {
    brent: { price: 104.86, change24h: 0, change7d: 0, source: "EIA · ICE Brent" },
    diesel: {
      regional: { global: { price: FUEL_BASE_DIESEL_PRICE, change24h: 0 } },
      source: "EIA · Global Diesel Index",
    },
    electricity: {
      tariff: { residential: 0.166, industrial: 0.08, commercial: 0.11 },
      change24h: 0,
      source: "GlobalPetrolPrices · IEA",
    },
    water: { price: 2.5, scarcityIndex: 1.04, source: "UN-Water · GWI" },
    fuelLevy: 0,
    electricityTariffAdjustmentIndex: 0,
    waterScarcityAdjustedPriceIndex: 0,
    lastFetch: null,
    success: false,
  };
}