const RBTree = require("functional-red-black-tree");

import type {
  CacheOptions,
  CacheEntry,
  MemoryStats,
  TimeoutTree
} from "./types";

/**
 * Creates a new cache instance.
 *
 * @param options - Optional configuration:
 *  - `ttl` (number): default time-to-live in milliseconds for all items. Default: `Infinity`.
 *  - `maxItems` (number): maximum number of items before pruning starts. Default: `Infinity`.
 *  - `maxMemoryInMb` (number): maximum memory (MB) before pruning starts. Default: `Infinity`.
 *
 * @example
 * const cache = new Cache({ ttl: 5000, maxItems: 100 });
 */
export class Cache<Key = any, Value = any> {
  constructor({
    ttl = Infinity,
    maxItems = Infinity,
    maxMemoryInMb = Infinity
  }: CacheOptions = {}) {
    // default ttl
    this.#ttl = ttl;
    // max number of items
    this.#maxItems = maxItems;
    // in bytes
    this.#memory.max = maxMemoryInMb * 1024 ** 2;
  }

  // max number of items
  #maxItems: number = Infinity;

  // default ttl
  #ttl: number = Infinity;

  // storage
  #data: Map<Key, CacheEntry<Value>> = new Map();

  // memory management
  #memory: MemoryStats = { current: 0, max: 0 };

  // timeout logic - for single timer
  #timeout: TimeoutTree<Key> = {
    id: undefined,
    tree: RBTree(),
    timestamp: Infinity
  };

  // only one prune at a time allowed
  #noPruneScheduled: boolean = true;

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
  set(key: Key, value: Value, ttl = this.#ttl): void {
    this.delete(key);

    const size = Cache.measureSize(value);
    const expiresAt = Date.now() + ttl;

    this.#data.set(key, { size, value, expiresAt });
    this.#memory.current += size;

    if (
      this.#noPruneScheduled &&
      (this.#maxItems < this.#data.size ||
        // if we're above the max items allowed, or
        this.#memory.max < this.#memory.current)
      // if we're above the max memory allowed, then prune
    ) {
      this.#noPruneScheduled = false;

      setImmediate(() => this.#prune());
    }

    if (expiresAt !== Infinity) {
      // add the ttl to the timer, as a background job
      setImmediate(() => this.#addTTL(key, expiresAt));
    }
  }
  /**
   * Retrieves a value from the cache.
   * Accessing the value marks it as most recently used (for LRU behavior).
   * @param key Key to look up.
   * @returns Value or undefined if not found or expired.
   */
  get(key: Key): Value | undefined {
    const cache = this.#data.get(key);

    if (cache !== undefined && Date.now() < cache.expiresAt) {
      // A LRU cache requires an ordered data structure.
      // Meanwhile, Map's have "insertion ordering" built-in.
      // To mark this key as recently used, we'll delete and re-insert it.
      // This move the key to the end of the map, with an O(1) complexity.
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
  has(key: Key): boolean {
    const cache = this.#data.get(key);

    return cache !== undefined && Date.now() < cache.expiresAt;
  }
  /**
   * Delete a key/value from the cache
   * @param key Key to remove.
   */
  delete(key: Key): void {
    const cache = this.#data.get(key);

    if (cache !== undefined) {
      this.#data.delete(key);
      this.#memory.current -= cache.size;

      if (cache.expiresAt !== Infinity) {
        // delete key from the timeout tree
        const keysToExpire = this.#timeout.tree.get(
          cache.expiresAt
        ) as Set<Key>;

        if (keysToExpire !== undefined) {
          if (keysToExpire.size === 1) {
            // delete the key, if we're out of values
            this.#timeout.tree = this.#timeout.tree.remove(cache.expiresAt);

            // if we deleted the bucket that the timer was waiting on, reschedule
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

    this.#data = new Map();
    this.#memory.current = 0;
    this.#timeout = {
      id: undefined,
      tree: RBTree(),
      timestamp: Infinity
    };
  }
  // memory management
  // Prune the cache to fit within the max memory limit
  #prune() {
    // allow a prune to occur during the next event loop cycle
    this.#noPruneScheduled = true;

    // keep deleting the least recently used items
    for (const key of this.#data.keys()) {
      // stop deleting if we're under the max limits
      if (
        this.#data.size < this.#maxItems &&
        this.#memory.current < this.#memory.max
      ) {
        break;
      }

      this.#memory.current -= this.#data.get(key).size;
      this.#data.delete(key);
    }
  }
  // TTL management
  // Schedules or re-schedules the timer
  #addTTL(key: any, expiresAt: number) {
    let keysExpiring = this.#timeout.tree.get(expiresAt) as Set<Key>;

    if (keysExpiring === undefined) {
      keysExpiring = new Set();

      this.#timeout.tree = this.#timeout.tree.insert(expiresAt, keysExpiring);
    }

    keysExpiring.add(key);

    // If this new TTL is less than the current timer
    if (expiresAt < this.#timeout.timestamp) {
      // then set this this TTL as the new timer
      this.#scheduleNextTimer();
    }
  }
  #scheduleNextTimer() {
    if (this.#timeout.id !== undefined) {
      clearTimeout(this.#timeout.id);
    }

    // this.#timeout.tree.begin.key is the smallest timestamp in our tree
    this.#timeout.timestamp = this.#timeout.tree.begin.key || Infinity;

    if (this.#timeout.timestamp !== Infinity) {
      this.#timeout.id = setTimeout(
        () => this.#onKeyExpired(),
        Math.max(this.#timeout.timestamp - Date.now(), 0)
      );
    }
  }
  #onKeyExpired() {
    this.#timeout.id = undefined;

    // loop over smallest expiring timestamps, deleting expired keys
    for (
      let key: Key,
        cache: any,
        now = Date.now(),
        // keysToExpire is the Set of keys expiring at the smallest timestamp
        keysToExpire = this.#timeout.tree.begin.value;
      // if our smallest timestamp is less than `now`, its expired
      this.#timeout.tree.begin.key <= now;
      // set keysToExpire to the next Set of expiring key
      keysToExpire = this.#timeout.tree.begin.value
    ) {
      // delete each key in the expiring set of keys
      for (key of keysToExpire) {
        cache = this.#data.get(key);

        if (cache !== undefined) {
          this.#data.delete(key);
          this.#memory.current -= cache.size;
        }
      }

      // delete the smallest timestamp; and set tree to the next smallest timestamp
      this.#timeout.tree = this.#timeout.tree.begin.remove();
    }

    // if we have another key that needs to expire, then schedule the timer
    if (this.#timeout.tree.begin.valid) {
      this.#scheduleNextTimer();
    }
  }
  /**
   * Estimates the memory size of a value (used for memory tracking).
   * @param value Value to measure.
   * @returns Estimated size in bytes.
   */
  static measureSize(value: any): number {
    // Buffers and typed views
    if (
      Buffer.isBuffer(value) ||
      value instanceof ArrayBuffer ||
      ArrayBuffer.isView(value)
    ) {
      return value.byteLength;
    }

    switch (typeof value) {
      case "string": {
        return Buffer.byteLength(value); // UTF-8 bytes
      }
      case "number": {
        return 8; // IEEE-754 double
      }
      case "boolean": {
        return 4; // stored as 32-bit in V8
      }
      case "bigint": {
        // bits + 8-byte header
        return Math.ceil((value === 0n ? 1 : value.toString(2).length) / 8) + 8;
      }
      case "object": {
        try {
          return Buffer.byteLength(JSON.stringify(value));
        } catch {
          return 0; // circular refs / unserializable
        }
      }
      default:
      case "undefined":
      case "symbol": // reference only
      case "function": {
        return 0;
      }
    }
  }
  /**
   * Returns the number of items in the cache
   */
  get size(): number {
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
  get memory(): MemoryStats {
    const toMegabytes = 1024 ** 2;

    return {
      current: this.#memory.current / toMegabytes,
      max: this.#memory.max / toMegabytes
    };
  }
}
