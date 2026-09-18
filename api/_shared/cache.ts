interface CacheEntry<T = unknown> {
  data: T;
  expiresAt: number;
}

export class InMemoryCache<T = unknown> {
  private store = new Map<string, CacheEntry<T>>();

  constructor(private defaultTtlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data;
  }

  set(key: string, data: T, ttlMs?: number): void {
    this.store.set(key, {
      data,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export const analyticsCache = new InMemoryCache<any>(60_000);
export const dynamicFactorsCache = new InMemoryCache<any>(10 * 60_000);
export const tinyfishSearchCache = new InMemoryCache<any>(10 * 60_000);
export const tinyfishScrapeCache = new InMemoryCache<any>(10 * 60_000);
export const kiloModelCatalogCache = new InMemoryCache<any>(60_000);
export const kiloAccessProbeCache = new InMemoryCache<any>(5 * 60_000);