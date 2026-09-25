import { useCallback, useEffect, useRef, useState } from "react";
import { COMMODITIES, type CommodityId, type LivePricesResponse } from "../lib/model";

function getDefaultPrices(): Record<CommodityId, number> {
  return Object.fromEntries(COMMODITIES.map((c) => [c.id, c.base])) as Record<CommodityId, number>;
}

export function useLivePrices(): {
  prices: Record<CommodityId, number>;
  isLive: boolean;
  asOf: string;
  dataSource: string;
} & { refetch: () => void } {
  const [prices, setPrices] = useState<Record<CommodityId, number>>(getDefaultPrices);
  const [isLive, setIsLive] = useState(true);
  const [asOf, setAsOf] = useState("");
  const [dataSource, setDataSource] = useState("");
  const ref = useRef<number | null>(null);

  const fetchPrices = useCallback(async (force = false) => {
    try {
      const url = force ? "/api/prices?force=true" : "/api/prices";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as LivePricesResponse;
      setPrices({
        oil: data.oil.price,
        electricity: data.electricity.price,
        water: data.water.price,
      });
      setIsLive(data.isLive);
      setAsOf(data.asOf);
      setDataSource(data.dataSource);
    } catch {
      setPrices(getDefaultPrices());
      setIsLive(false);
    }
  }, []);

  useEffect(() => {
    void fetchPrices();
    ref.current = window.setInterval(() => { void fetchPrices(); }, 60_000);
    return () => {
      if (ref.current !== null) {
        clearInterval(ref.current);
        ref.current = null;
      }
    };
  }, [fetchPrices]);

  const refetch = useCallback(() => { void fetchPrices(true); }, [fetchPrices]);

  return { prices, isLive, asOf, dataSource, refetch };
}
