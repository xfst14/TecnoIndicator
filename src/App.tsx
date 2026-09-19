import { useCallback, useMemo, useState } from "react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import ForecastTool from "./components/ForecastTool";
import RegionalEvaluation from "./components/RegionalEvaluation";
import FactorsSection from "./components/FactorsSection";
import AboutSection from "./components/AboutSection";
import Footer from "./components/Footer";
import { useLiveMarket } from "./hook/useLiveMarket";
import { generateForecast, type RegionId } from "./lib/model";

export default function App() {
  const [horizon, setHorizon] = useState(7);
  const [region, setRegion] = useState<RegionId>("global");

  const {
    prices,
    jitter,
    lastUpdated,
    waterLive,
    waterFetching,
    isLive,
    streaming,
    refresh,
    fetchWater,
    toggleLive,
  } = useLiveMarket();

  const points = useMemo(
    () => generateForecast(prices, horizon, jitter, region),
    [prices, horizon, jitter, region],
  );

  const handleFetchWater = useCallback(() => void fetchWater(), [fetchWater]);

  return (
    <div className="min-h-screen bg-base font-sans text-slate-200 antialiased">
      <Navbar />
      <main>
        <Hero prices={prices} />
        <ForecastTool
          horizon={horizon}
          onHorizon={setHorizon}
          prices={prices}
          points={points}
          lastUpdated={lastUpdated}
          onRefresh={refresh}
          onFetchWater={handleFetchWater}
          waterFetching={waterFetching}
          waterLive={waterLive}
          isLive={isLive}
          streaming={streaming}
          onToggleLive={toggleLive}
          region={region}
          onRegion={setRegion}
        />
        <RegionalEvaluation
          prices={prices}
          horizon={horizon}
          jitter={jitter}
          region={region}
          onRegion={setRegion}
        />
        <FactorsSection horizon={horizon} />
        <AboutSection />
      </main>
      <Footer lastUpdated={lastUpdated} />
      <SpeedInsights />
    </div>
  );
}
