import { REGION_NAMES, type Region } from "./_shared/regions.js";
import { kiloRouter } from "./_shared/kiloRouter.js";
import { tinyfishRouter } from "./_shared/tinyfishRouter.js";

interface HealthResponse {
  kiloGateway: {
    available: boolean;
    usableKeys: number;
    configuredKeys: number;
  };
  tinyfish: {
    available: boolean;
    usableKeys: number;
    configuredKeys: number;
  };
  onlineModelConnected: boolean;
  analytics: {
    global: {
      lastFetch: string | null;
      success: boolean;
    };
    regional: Record<
      Region,
      {
        lastFetch: string | null;
        success: boolean;
      }
    >;
  };
  dynamicFactors: {
    global: {
      lastRun: string | null;
      nextRun: string | null;
      aiCurated: boolean;
      pollIntervalMs: number;
    };
    regional: Record<
      Region,
      {
        lastRun: string | null;
        nextRun: string | null;
        aiCurated: boolean;
        pollIntervalMs: number;
      }
    >;
  };
}

export default async function handler(_req: Request): Promise<Response> {
  // Health check uses quick mode to avoid triggering expensive initialization.
  // Full initialization (model catalog fetch + key probing) happens lazily
  // when actual API endpoints (solutions, dynamic-factors) are called.
  const abortController = new AbortController();
  const totalTimeoutId = setTimeout(() => abortController.abort(), 4000);

  try {
    // Run all checks in parallel with the same abort signal
    const [kiloStatus, tinyfishStatus] = await Promise.all([
      kiloRouter.getKiloStatus(abortController.signal, true),
      tinyfishRouter.getTinyfishStatus(abortController.signal, true),
    ]);

    const onlineModelConnected =
      kiloStatus.available &&
      kiloStatus.usableKeys > 0 &&
      kiloStatus.zeroCostModels.length > 0 &&
      tinyfishStatus.available &&
      tinyfishStatus.usableKeys > 0;

    const response: HealthResponse = {
      kiloGateway: {
        available: kiloStatus.available,
        usableKeys: kiloStatus.usableKeys,
        configuredKeys: kiloStatus.configuredKeys,
      },
      tinyfish: {
        available: tinyfishStatus.available,
        usableKeys: tinyfishStatus.usableKeys,
        configuredKeys: tinyfishStatus.configuredKeys,
      },
      onlineModelConnected,
      analytics: {
        global: {
          lastFetch: null,
          success: true,
        },
        regional: Object.fromEntries(
          (Object.keys(REGION_NAMES) as Region[]).map((region) => [
            region,
            { lastFetch: null, success: true },
          ])
        ) as Record<Region, { lastFetch: string | null; success: boolean }>,
      },
      dynamicFactors: {
        global: {
          lastRun: null,
          nextRun: null,
          aiCurated: false,
          pollIntervalMs: 120000,
        },
        regional: Object.fromEntries(
          (Object.keys(REGION_NAMES) as Region[]).map((region) => [
            region,
            {
              lastRun: null,
              nextRun: null,
              aiCurated: false,
              pollIntervalMs: 120000,
            },
          ])
        ) as Record<
          Region,
          {
            lastRun: string | null;
            nextRun: string | null;
            aiCurated: boolean;
            pollIntervalMs: number;
          }
        >,
      },
    };

    return Response.json(response);
  } catch (error) {
    console.error("Health check failed:", error);
    return Response.json({
      error: "Health check temporarily unavailable",
      onlineModelConnected: false,
      kiloGateway: { available: false, usableKeys: 0, configuredKeys: 0 },
      tinyfish: { available: false, usableKeys: 0, configuredKeys: 0 },
    }, { status: 200 });
  } finally {
    clearTimeout(totalTimeoutId);
  }
}
