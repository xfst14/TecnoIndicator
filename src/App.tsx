import { useCallback, useEffect, useMemo, useState } from "react";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import ForecastTool from "./components/ForecastTool";
import RegionalEvaluation from "./components/RegionalEvaluation";
import SolutionsSection from "./components/SolutionsSection";
import AboutSection from "./components/AboutSection";
import Footer from "./components/Footer";
import { useLiveMarket } from "./hook/useLiveMarket";
import { generateForecast, type RegionId, REGIONAL_FACTORS, EVAL_REGIONS, type Factor } from "./lib/model";

export type Solution = {
  id: string;
  title: string;
  summary: string;
  actions: string[];
  commodities: ("oil" | "electricity" | "water")[];
  regions?: RegionId[];
  scope: RegionId;
  relatedFactors: string[];
  confidence: number;
  createdAt: string;
  updatedAt: string;
};

const ANALYTICS_POLL_MS = 60_000;
const FACTORS_POLL_MS = 120_000;
const HEALTH_POLL_MS = 5 * 60_000;
const REGION_STAGGER_MS = 8_000;

export default function App() {
  const [horizon, setHorizon] = useState(7);
  const [region, setRegion] = useState<RegionId>("global");

  const {
    prices,
    deltas,
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

   const [healthStatus, setHealthStatus] = useState<"Initializing AI" | "Online Model Connected" | "Offline Model">("Initializing AI");
   const [_onlineModelConnected, setOnlineModelConnected] = useState(false);
   const [globalFactors, setGlobalFactors] = useState<Factor[]>([]);
   const [regionalFactors, setRegionalFactors] = useState<Record<string, Factor[]>>({});
   const [globalSolutions, setGlobalSolutions] = useState<Solution[]>([]);
   const [_regionalAnalytics, setRegionalAnalytics] = useState<Record<string, unknown>>({});

  const points = useMemo(
    () => generateForecast(prices, horizon, jitter, region),
    [prices, horizon, jitter, region],
  );

  const handleFetchWater = useCallback(() => void fetchWater(), [fetchWater]);

  // Initialize regional factors with static fallbacks
  useEffect(() => {
    const init: Record<string, Factor[]> = {};
    for (const r of EVAL_REGIONS) {
      init[r.id] = REGIONAL_FACTORS[r.id] ?? [];
    }
    setRegionalFactors(init);
  }, []);

  // Poll health endpoint
  useEffect(() => {
    let active = true;
    const pollHealth = async () => {
      try {
        const res = await fetch("/api/health");
        if (!res.ok) throw new Error("Health check failed");
        const data = await res.json();
        if (active) {
          setOnlineModelConnected(data.onlineModelConnected === true);
          setHealthStatus(data.onlineModelConnected === true ? "Online Model Connected" : "Offline Model");
        }
      } catch {
        if (active) {
          setOnlineModelConnected(false);
          setHealthStatus("Offline Model");
        }
      }
    };
    pollHealth();
    const id = setInterval(pollHealth, HEALTH_POLL_MS);
    return () => { active = false; clearInterval(id); };
  }, []);

  // Poll analytics (global + regional)
  useEffect(() => {
    let active = true;
    const pollAnalytics = async () => {
      try {
        const res = await fetch("/api/analytics");
        if (res.ok) {
          const data = await res.json();
          if (active) setRegionalAnalytics(prev => ({ ...prev, global: data }));
        }
      } catch { /* ignore */ }
      for (const r of EVAL_REGIONS) {
        try {
          const res = await fetch(`/api/regional-analytics?region=${r.id}`);
          if (res.ok) {
            const data = await res.json();
            if (active) setRegionalAnalytics(prev => ({ ...prev, [r.id]: data }));
          }
        } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, REGION_STAGGER_MS));
      }
    };
    pollAnalytics();
    const id = setInterval(pollAnalytics, ANALYTICS_POLL_MS);
    return () => { active = false; clearInterval(id); };
  }, []);

  // Poll dynamic factors (global + regional)
  useEffect(() => {
    let active = true;
    const pollFactors = async () => {
      try {
        const res = await fetch("/api/dynamic-factors");
        if (res.ok) {
          const data = await res.json();
          if (active && Array.isArray(data.factors) && data.factors.length > 0) {
            setGlobalFactors(data.factors);
          }
        }
      } catch { /* ignore */ }
      for (const r of EVAL_REGIONS) {
        try {
          const res = await fetch(`/api/regional-factors?region=${r.id}`);
          if (res.ok) {
            const data = await res.json();
            if (active && Array.isArray(data.factors) && data.factors.length > 0) {
              setRegionalFactors(prev => ({ ...prev, [r.id]: data.factors }));
            }
          }
        } catch { /* ignore */ }
        await new Promise(resolve => setTimeout(resolve, REGION_STAGGER_MS));
      }
    };
    pollFactors();
    const id = setInterval(pollFactors, FACTORS_POLL_MS);
    return () => { active = false; clearInterval(id); };
  }, []);

  // Poll solutions
  useEffect(() => {
    let active = true;
    const pollSolutions = async () => {
      try {
        const scope = region === "global" ? "global" : region;
         const res = await fetch(`/api/solutions?region=${scope}`);
        if (res.ok) {
          const data = await res.json();
          if (active && Array.isArray(data.solutions)) {
            setGlobalSolutions(data.solutions);
          }
        }
      } catch { /* ignore */ }
    };
    pollSolutions();
    const id = setInterval(pollSolutions, FACTORS_POLL_MS);
    return () => { active = false; clearInterval(id); };
  }, [region]);

  return (
    <div className="min-h-screen bg-base font-sans text-slate-200 antialiased">
      <Navbar />
      <main>
         <Hero prices={prices} deltas={deltas} />
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
        <SolutionsSection
          globalFactors={globalFactors}
          dynamicFactors={regionalFactors}
          healthStatus={healthStatus}
          globalSolutions={globalSolutions}
        />
        <RegionalEvaluation
          prices={prices}
          horizon={horizon}
          jitter={jitter}
          region={region}
          onRegion={setRegion}
          dynamicFactors={regionalFactors}
          healthStatus={healthStatus}
        />
        <AboutSection />
      </main>
      <Footer lastUpdated={lastUpdated} />
    </div>
  );
}