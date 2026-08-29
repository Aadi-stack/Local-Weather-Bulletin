"use strict";

/**
 * Minimal in-memory TTL cache. Good enough for a single-instance deployment
 * or as a local L1 cache in front of a shared store (Redis, etc.) later.
 * Swap this module out without touching callers if you outgrow it.
 */
class TtlCache {
  constructor({ ttlSeconds = 300, maxEntries = 500 } = {}) {
    this.ttlMs = ttlSeconds * 1000;
    this.maxEntries = maxEntries;
    this.store = new Map();
  }

  _isExpired(entry) {
    return Date.now() > entry.expiresAt;
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this._isExpired(entry)) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value) {
    if (this.store.size >= this.maxEntries) {
      // Evict oldest entry (Map preserves insertion order).
      const oldestKey = this.store.keys().next().value;
      this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear() {
    this.store.clear();
  }

  get size() {
    return this.store.size;
  }
}

module.exports = TtlCache;
