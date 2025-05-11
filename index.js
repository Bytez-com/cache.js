import RBTree from "functional-red-black-tree";

export class Cache {
  constructor({
    ttl = Infinity,
    maxItems = Infinity,
    maxMemoryInMb = Infinity
  } = {}) {
    // default ttl
    this.#ttl = ttl;
    // max number of items
    this.#maxItems = maxItems;
    // in bytes
    this.#memory.max = maxMemoryInMb * 1024 ** 2;
  }

  // max number of items
  #maxItems = Infinity;

  // default ttl
  #ttl = Infinity;

  // storage
  #data = new Map();

  // memory management
  #memory = { current: 0, max: 0 };

  // timeout logic - for single timer
  #timeout = {
    id: undefined,
    tree: new RBTree(),
    timestamp: Infinity
  };

  // only one prune at a time allowed
  #noPruneScheduled = true;

  set(key, value, ttl = this.#ttl) {
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
  get(key) {
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
  has(key) {
    const cache = this.#data.get(key);

    return cache !== undefined && Date.now() < cache.expiresAt;
  }
  delete(key) {
    const cache = this.#data.get(key);

    if (cache !== undefined) {
      this.#data.delete(key);
      this.#memory.current -= cache.size;

      if (cache.expiresAt !== Infinity) {
        // delete key from the timeout tree
        const keysToExpire = this.#timeout.tree.get(cache.expiresAt);

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
  clear() {
    clearTimeout(this.#timeout.id);

    this.#data = new Map();
    this.#memory.current = 0;
    this.#timeout = {
      id: undefined,
      tree: new RBTree(),
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
  #addTTL(key, expiresAt) {
    let keysExpiring = this.#timeout.tree.get(expiresAt);

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
      let key,
        cache,
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

  static measureSize(value) {
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

  get size() {
    return this.#data.size;
  }
  get memory() {
    return { ...this.#memory };
  }
}
