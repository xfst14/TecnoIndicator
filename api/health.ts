import { REGION_NAMES, type Region } from "./_shared/regions.js";
import { kiloRouter } from "./_shared/kiloRouter.js";
import { tinyfishRouter } from "./_shared/tinyfishRouter.js";

interface HealthResponse {
  kiloGateway: {
    available: boolean;
    usableKeys: number;
    configuredKeys: number;
    keyFormats?: { jwt: number; opaque: number; unrecognized: number };
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
  // Health check triggers full initialization (model catalog fetch + key probing)
  // so that the returned status accurately reflects whether a live Kilo Gateway
  // connection is available.  The initialization is protected by the same
  // abortController, so a cold start that exceeds the timeout will still be
  // caught and the endpoint will return a degraded-but-informed response.
  const abortController = new AbortController();
  const totalTimeoutId = setTimeout(() => abortController.abort(), 10000);

  try {
    // Run all checks in parallel with the same abort signal
    const [kiloStatus, tinyfishStatus] = await Promise.all([
      kiloRouter.getKiloStatus(abortController.signal),
      tinyfishRouter.getTinyfishStatus(abortController.signal),
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
        keyFormats: kiloStatus.keyFormats,
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
      kiloGateway: { available: false, usableKeys: 0, configuredKeys: 0, keyFormats: { jwt: 0, opaque: 0, unrecognized: 0 } },
      tinyfish: { available: false, usableKeys: 0, configuredKeys: 0 },
    }, { status: 200 });
  } finally {
    clearTimeout(totalTimeoutId);
  }
}
