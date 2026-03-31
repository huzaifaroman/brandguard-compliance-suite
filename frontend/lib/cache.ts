type CacheEntry<T> = {
  data: T;
  timestamp: number;
  ttl: number;
};

const STORAGE_PREFIX = "bg_cache:";
const store = new Map<string, CacheEntry<unknown>>();

function loadFromStorage<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() - entry.timestamp > entry.ttl) {
      localStorage.removeItem(STORAGE_PREFIX + key);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function saveToStorage<T>(key: string, entry: CacheEntry<T>): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
  } catch {}
}

function removeFromStorage(key: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {}
}

export function cacheGet<T>(key: string): T | null {
  const memEntry = store.get(key);
  if (memEntry) {
    if (Date.now() - memEntry.timestamp > memEntry.ttl) {
      store.delete(key);
      removeFromStorage(key);
      return null;
    }
    return memEntry.data as T;
  }

  const diskEntry = loadFromStorage<T>(key);
  if (diskEntry) {
    store.set(key, diskEntry as CacheEntry<unknown>);
    return diskEntry.data;
  }

  return null;
}

export function cacheSet<T>(key: string, data: T, ttlMs: number): void {
  const entry: CacheEntry<T> = { data, timestamp: Date.now(), ttl: ttlMs };
  store.set(key, entry as CacheEntry<unknown>);
  if (ttlMs >= 60_000) {
    saveToStorage(key, entry);
  }
}

export function cacheInvalidate(key: string): void {
  store.delete(key);
  removeFromStorage(key);
}

export function cacheInvalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      removeFromStorage(key);
    }
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX + prefix)) {
        localStorage.removeItem(k);
      }
    }
  } catch {}
}
