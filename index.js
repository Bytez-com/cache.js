import RBTree from "functional-red-black-tree";

export class Cache {
  constructor({
    ttl = Infinity,
    maxItems = Infinity,
    maxMemoryInMb = Infinity
  }) {
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

  set(key, value, ttl = this.#ttl) {
    this.delete(key);

    const size = Cache.measureSize(value);
    const expiresAt = ttl === Infinity ? undefined : Date.now() + ttl;

    this.#data.set(key, { size, value, expiresAt });
    this.#memory.current += size;

    if (
      // if we're above the max memory allowed, prune
      this.#memory.max < this.#memory.current ||
      // or if we're above the max items allowed, prune
      this.#maxItems < this.#data.size
    ) {
      setImmediate(() => this.#prune());
    }

    if (ttl !== Infinity) {
      // add the ttl to the timer
      setImmediate(() => this.#addTTL(key, expiresAt));
    }
  }
  get(key) {
    const cache = this.#data.get(key);

    if (cache !== undefined && Date.now() < cache.expiresAt) {
      // To mark this as most recently used, we re-insert it into the map.
      // This moves it to the end of the map's iteration order.
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
    if (
      // if above the max items allowed, or
      this.#maxItems < this.#data.size ||
      // if above the max memory allowed
      this.#memory.max < this.#memory.current
    ) {
      if (this.now) {
        console.time("prune");
      }
      for (const key of this.#data.keys()) {
        if (
          this.#data.size < this.#maxItems ||
          this.#memory.current < this.#memory.max
        ) {
          break;
        }

        this.delete(key);
      }
      if (this.now) {
        console.timeEnd("prune");
      }
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

    // (re)-schedule if this is the new earliest expiry
    if (expiresAt < this.#timeout.timestamp) {
      this.#scheduleNextTimer();
    }
  }
  #scheduleNextTimer() {
    clearTimeout(this.#timeout.id);

    // this.#timeout.tree.begin.key === smallestTimestamp
    this.#timeout.timestamp = this.#timeout.tree.begin.key || Infinity;

    if (this.#timeout.timestamp !== Infinity) {
      this.#timeout.id = setTimeout(
        () => this.#onExpire(),
        Math.max(this.#timeout.timestamp - Date.now(), 0)
      );
    }
  }
  #onExpire() {
    this.#timeout.id = undefined;

    const now = Date.now();

    // while the smallest timestamp is less than now, delete the keys
    while (this.#timeout.tree.begin.key <= now) {
      // for each key in the expiring keys, delete
      for (const key of this.#timeout.tree.begin.value) {
        const cache = this.#data.get(key);

        if (cache !== undefined) {
          this.#data.delete(key);
          this.#memory.current -= cache.size;
        }
      }

      // delete this timestamp; set tree to the next smallest ts
      this.#timeout.tree = this.#timeout.tree.begin.remove();
    }

    this.#timeout.timestamp = this.#timeout.tree.begin.key || Infinity;

    if (this.#timeout.timestamp !== Infinity) {
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
