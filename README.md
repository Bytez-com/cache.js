# cache.js

High performance LRU-like cache with built-in TTL and memory management.

Everything has been written to be ultra simple, yet V8 machine code optimized, and blazing fast.

This cache is fast, uses minimal memory/cpu, and is built for both high volume traffic and small applications. We use 1 JS timer, to manage everything, allowing your cache layer to consume minimal overhead and provide strong consistency.

---

## Installation

```bash
npm i @nawar/cache
# or
pnpm add @nawar/cache
```

### API

```js
import Cache from "@nawar/cache";

const cache = new Cache({
  ttl: 60e3, // optionally set a default ttl for cache entries (defaults to infinity)
  maxItems: 10, // optionally set the max number of items to keep in cache (defaults to infinity)
  maxMemoryInMb: 1 // optionally set the max memory this cache pool uses (defaults to infinity)
});

cache.set("key", "value"); // set a key, using default ttl
cache.set(true, { value: false }, 1); // set any key to any value with custom ttls (in milliseconds)

console.log(cache.size); // returns 2
console.log(cache.memory); // returns memory taken by your values

cache.get("key"); // returns "value"

cache.has("key"); // returns true

cache.delete("key");

cache.clear(); // wipe the cache
```

---

## Mathematical optimal performance, across every operation

| Operation                    | Hot-path work                         | Worst-case Big-O\* | Average Big-O† | Average time \* |
| ---------------------------- | ------------------------------------- | ------------------ | -------------- | --------------- |
| `get()`                      | 1 × `Map.get`                         | **O(1)**           | O(1)           | 0.008 ms        |
| `set()`                      | 1 × `Map.set`                         | **O(log K + S)**   | O(1)           | 0.011 ms        |
| `has()`                      | 1 × `Map.get`                         | **O(1)**           | O(1)           | 0.004 ms        |
| `delete()`                   | 1 × `Map.delete`                      | **O(1)**           | O(1)           | 0.007 ms        |
| `clear()`                    | 1 x `new Map()`                       | **O(1)**           | O(1)           | 0.044 ms        |
| Internal prune / mass expiry | Sequential deletes until under limits | **O(N log K)**     | O(E)           | 0.007 ms        |

\* Across 1 million runs

- `K` = number of distinct expiry buckets
- `N` = items cached
- `E` = items that actually expire in that tick
  † In real workloads many keys share the same rounded expiry, so `K ≪ N` and `log K` is < 10 even with 1 M items.

**Why it matters**

- Hot-path reads (`get`/`has`) stay _constant time_ no matter how big your cache grows.
- Writes with TTL scale _logarithmically_ with the number of distinct expiry buckets – in practice a handful of pointer swaps (< 20) even at one million entries.
- Heavy lifting (pruning, mass expiry) is kicked to the next event-loop turn via `setImmediate`, so it never blocks user requests.

---

# Optimal ttl management

If you use `ttl`, then under the hood, we only use `1 JS timeout` timer. Even if you have 100,000 cache entries, we still use `1 JS timeout` timer to manage everything.

This has 3 benefits:

1. Minimized overhead: truly minimal cpu and memory is taken, even with huge caches (+50k)
2. Auto-pruning: when an item expires we actually delete it, freeing up memory (unlike other npm cache libraries that delete only on read, or delete when the cache has its max limit)
3. It just works. If you set `ttl` for 10 minutes, its gone in 10 minutes guaranteed.

# Memory management

Sometimes its nice to know your cache wont exceed a certain size in megabytes.

Under the hood, we measure the size of every `value` you `set`, and we `prune` when the memory has the limit. Pruning occurs during the Event Loop's callback phase, so it doesn't slow down your code / hot path execution. Here's the source from `index.js`:

```js
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
```
