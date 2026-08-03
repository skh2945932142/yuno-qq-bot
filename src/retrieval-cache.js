import { createHash } from 'node:crypto';

function nowMs() {
  return Date.now();
}

function normalizeTtl(ttlMs) {
  const value = Number(ttlMs);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export function hashRetrievalCacheKey(parts = []) {
  const source = Array.isArray(parts) ? JSON.stringify(parts) : String(parts || '');
  return createHash('sha256').update(source).digest('hex');
}

export function createRetrievalCache(options = {}) {
  const entries = new Map();
  const maxEntries = Math.max(16, Number(options.maxEntries || 512));
  const now = options.now || nowMs;
  const redis = options.redis || null;
  const prefix = String(options.prefix || 'yuno:retrieval:').trim();

  function prune() {
    const current = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= current) entries.delete(key);
    }
    while (entries.size > maxEntries) {
      const firstKey = entries.keys().next().value;
      if (!firstKey) break;
      entries.delete(firstKey);
    }
  }

  return {
    async get(key) {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) return null;
      if (redis?.get) {
        try {
          const raw = await redis.get(`${prefix}${normalizedKey}`);
          return raw ? JSON.parse(raw) : null;
        } catch {
          // Shared-cache failures are intentionally non-fatal; local cache still
          // keeps the reply path usable when Redis is unavailable.
        }
      }
      const entry = entries.get(normalizedKey);
      if (!entry || entry.expiresAt <= now()) {
        entries.delete(normalizedKey);
        return null;
      }
      return entry.value;
    },
    async set(key, value, ttlMs) {
      const normalizedKey = String(key || '').trim();
      const ttl = normalizeTtl(ttlMs);
      if (!normalizedKey || ttl === 0) return value;
      if (redis?.set) {
        try {
          await redis.set(`${prefix}${normalizedKey}`, JSON.stringify(value), 'PX', ttl);
          return value;
        } catch {
          // Fall through to the process-local LRU cache.
        }
      }
      entries.set(normalizedKey, { value, expiresAt: now() + ttl });
      prune();
      return value;
    },
    async delete(key) {
      const normalizedKey = String(key || '').trim();
      entries.delete(normalizedKey);
      if (redis?.del && normalizedKey) {
        try {
          await redis.del(`${prefix}${normalizedKey}`);
        } catch {}
      }
    },
    clear() {
      entries.clear();
    },
    size() {
      prune();
      return entries.size;
    },
  };
}

export const retrievalCache = createRetrievalCache();
