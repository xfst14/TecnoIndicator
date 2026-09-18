interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class SimpleCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, data: T, ttlMs: number): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export const analyticsCache = new SimpleCache<unknown>();
export const factorsCache = new SimpleCache<unknown>();
export const tinyfishSearchCache = new SimpleCache<unknown>();
export const tinyfishScrapeCache = new SimpleCache<unknown>();
export const kiloCatalogCache = new SimpleCache<unknown>();
export const kiloProbeCache = new SimpleCache<unknown>();