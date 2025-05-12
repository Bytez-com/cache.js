'use strict';

var require$$0 = require('functional-red-black-tree');

const RBTree = require$$0;
class Cache {
  constructor({
    ttl = Infinity,
    maxItems = Infinity,
    maxMemoryInMb = Infinity
  } = {}) {
    this.#ttl = ttl;
    this.#maxItems = maxItems;
    this.#memory.max = maxMemoryInMb * 1024 ** 2;
  }
  // max number of items
  #maxItems = Infinity;
  // default ttl
  #ttl = Infinity;
  // storage
  #data = /* @__PURE__ */ new Map();
  // memory management
  #memory = { current: 0, max: 0 };
  // timeout logic - for single timer
  #timeout = {
    id: void 0,
    tree: RBTree(),
    timestamp: Infinity
  };
  // only one prune at a time allowed
  #noPruneScheduled = true;
  /**
   * Stores a value in the cache with optional custom TTL.
   *
   * If the number of items or memory usage exceeds configured limits, the cache will auto-prune.
   *
   * @param key - The key to associate with the value.
   *              Same as {@link Map.set}'s key: any primitive or object.
   * @param value - The value to store.
   *                Same as {@link Map.set}'s value: any primitive or object.
   * @param ttl - Optional time-to-live in milliseconds for this item.
   *              Defaults to the cache-wide TTL set in the constructor (`Infinity` by default).
   *
   * @example
   * cache.set('user', { name: 'Alice' });
   * cache.set(123, 'some value');
   * cache.set({ id: 1 }, [1, 2, 3]); // using object as key
   * cache.set('user', { name: 'Alice' }, 5000); // custom TTL 5 seconds
   */
  set(key, value, ttl = this.#ttl) {
    this.delete(key);
    const size = Cache.measureSize(value);
    const expiresAt = Date.now() + ttl;
    this.#data.set(key, { size, value, expiresAt });
    this.#memory.current += size;
    if (this.#noPruneScheduled && (this.#maxItems < this.#data.size || // if we're above the max items allowed, or
    this.#memory.max < this.#memory.current)) {
      this.#noPruneScheduled = false;
      setImmediate(() => this.#prune());
    }
    if (expiresAt !== Infinity) {
      setImmediate(() => this.#addTTL(key, expiresAt));
    }
  }
  /**
   * Retrieves a value from the cache.
   * Accessing the value marks it as most recently used (for LRU behavior).
   * @param key Key to look up.
   * @returns Value or undefined if not found or expired.
   */
  get(key) {
    const cache = this.#data.get(key);
    if (cache !== void 0 && Date.now() < cache.expiresAt) {
      this.#data.delete(key);
      this.#data.set(key, cache);
      return cache.value;
    }
  }
  /**
   * Checks whether a key exists and has not expired.
   * @param key Key to check.
   * @returns True if the key exists and is valid, false otherwise.
   */
  has(key) {
    const cache = this.#data.get(key);
    return cache !== void 0 && Date.now() < cache.expiresAt;
  }
  /**
   * Delete a key/value from the cache
   * @param key Key to remove.
   */
  delete(key) {
    const cache = this.#data.get(key);
    if (cache !== void 0) {
      this.#data.delete(key);
      this.#memory.current -= cache.size;
      if (cache.expiresAt !== Infinity) {
        const keysToExpire = this.#timeout.tree.get(
          cache.expiresAt
        );
        if (keysToExpire !== void 0) {
          if (keysToExpire.size === 1) {
            this.#timeout.tree = this.#timeout.tree.remove(cache.expiresAt);
            if (cache.expiresAt === this.#timeout.timestamp) {
              this.#scheduleNextTimer();
            }
          } else {
            keysToExpire.delete(key);
          }
        }
      }
    }
  }
  /**
   * Clears all items from the cache and resets memory usage.
   */
  clear() {
    clearTimeout(this.#timeout.id);
    this.#data = /* @__PURE__ */ new Map();
    this.#memory.current = 0;
    this.#timeout = {
      id: void 0,
      tree: RBTree(),
      timestamp: Infinity
    };
  }
  // memory management
  // Prune the cache to fit within the max memory limit
  #prune() {
    this.#noPruneScheduled = true;
    for (const key of this.#data.keys()) {
      if (this.#data.size < this.#maxItems && this.#memory.current < this.#memory.max) {
        break;
      }
      this.#memory.current -= this.#data.get(key).size;
      this.#data.delete(key);
    }
  }
  // TTL management
  // Schedules or re-schedules the timer
  #addTTL(key, expiresAt) {
    let keysExpiring = this.#timeout.tree.get(expiresAt);
    if (keysExpiring === void 0) {
      keysExpiring = /* @__PURE__ */ new Set();
      this.#timeout.tree = this.#timeout.tree.insert(expiresAt, keysExpiring);
    }
    keysExpiring.add(key);
    if (expiresAt < this.#timeout.timestamp) {
      this.#scheduleNextTimer();
    }
  }
  #scheduleNextTimer() {
    if (this.#timeout.id !== void 0) {
      clearTimeout(this.#timeout.id);
    }
    this.#timeout.timestamp = this.#timeout.tree.begin.key || Infinity;
    if (this.#timeout.timestamp !== Infinity) {
      this.#timeout.id = setTimeout(
        () => this.#onKeyExpired(),
        Math.max(this.#timeout.timestamp - Date.now(), 0)
      );
    }
  }
  #onKeyExpired() {
    this.#timeout.id = void 0;
    for (
      let key, cache, now = Date.now(), keysToExpire = this.#timeout.tree.begin.value;
      // if our smallest timestamp is less than `now`, its expired
      this.#timeout.tree.begin.key <= now;
      // set keysToExpire to the next Set of expiring key
      keysToExpire = this.#timeout.tree.begin.value
    ) {
      for (key of keysToExpire) {
        cache = this.#data.get(key);
        if (cache !== void 0) {
          this.#data.delete(key);
          this.#memory.current -= cache.size;
        }
      }
      this.#timeout.tree = this.#timeout.tree.begin.remove();
    }
    if (this.#timeout.tree.begin.valid) {
      this.#scheduleNextTimer();
    }
  }
  /**
   * Estimates the memory size of a value (used for memory tracking).
   * @param value Value to measure.
   * @returns Estimated size in bytes.
   */
  static measureSize(value) {
    if (Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      return value.byteLength;
    }
    switch (typeof value) {
      case "string": {
        return Buffer.byteLength(value);
      }
      case "number": {
        return 8;
      }
      case "boolean": {
        return 4;
      }
      case "bigint": {
        return Math.ceil((value === 0n ? 1 : value.toString(2).length) / 8) + 8;
      }
      case "object": {
        try {
          return Buffer.byteLength(JSON.stringify(value));
        } catch {
          return 0;
        }
      }
      default:
      case "undefined":
      case "symbol":
      // reference only
      case "function": {
        return 0;
      }
    }
  }
  /**
   * Returns the number of items in the cache
   */
  get size() {
    return this.#data.size;
  }
  /**
   * Returns current and maximum memory usage of the cache.
   * Values are expressed in megabytes (MB).
   *
   * @returns An object with `current` and `max` memory values.
   *
   * @example
   * const { current, max } = cache.memory;
   */
  get memory() {
    const toMegabytes = 1024 ** 2;
    return {
      current: this.#memory.current / toMegabytes,
      max: this.#memory.max / toMegabytes
    };
  }
}

exports.Cache = Cache;
