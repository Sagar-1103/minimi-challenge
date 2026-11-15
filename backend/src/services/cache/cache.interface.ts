export interface CacheStore {
  get<T>(key: string): Promise<T | null> | T | null;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> | void;
  has(key: string): Promise<boolean> | boolean;
  delete(key: string): Promise<void> | void;
  clear(): Promise<void> | void;
}

interface CacheEntry<T> {
  value: T;
  expiresAt?: number;
}

// In-memory cache implementation with TTL support.
// Can be replaced with a Redis-backed implementation in the future.
export class InMemoryCacheStore implements CacheStore {
  private store = new Map<string, CacheEntry<any>>();

  public get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.value as T;
  }

  public set<T>(key: string, value: T, ttlSeconds?: number): void {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.store.set(key, { value, expiresAt });
  }

  public has(key: string): boolean {
    return this.get(key) !== null;
  }

  public delete(key: string): void {
    this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
  }

  public size(): number {
    return this.store.size;
  }
}
