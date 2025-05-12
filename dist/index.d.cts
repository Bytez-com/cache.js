interface CacheOptions {
    /** Default time-to-live for cache entries in milliseconds. */
    ttl?: number;
    /** Maximum number of items the cache can hold. */
    maxItems?: number;
    /** Maximum memory usage in megabytes. */
    maxMemoryInMb?: number;
}
interface MemoryStats {
    /** Current memory usage in MB. */
    current: number;
    /** Maximum allowed memory usage in MB. */
    max: number;
}

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
declare class Cache<Key = any, Value = any> {
    #private;
    constructor({ ttl, maxItems, maxMemoryInMb }?: CacheOptions);
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
    set(key: Key, value: Value, ttl?: number): void;
    /**
     * Retrieves a value from the cache.
     * Accessing the value marks it as most recently used (for LRU behavior).
     * @param key Key to look up.
     * @returns Value or undefined if not found or expired.
     */
    get(key: Key): Value | undefined;
    /**
     * Checks whether a key exists and has not expired.
     * @param key Key to check.
     * @returns True if the key exists and is valid, false otherwise.
     */
    has(key: Key): boolean;
    /**
     * Delete a key/value from the cache
     * @param key Key to remove.
     */
    delete(key: Key): void;
    /**
     * Clears all items from the cache and resets memory usage.
     */
    clear(): void;
    /**
     * Estimates the memory size of a value (used for memory tracking).
     * @param value Value to measure.
     * @returns Estimated size in bytes.
     */
    static measureSize(value: any): number;
    /**
     * Returns the number of items in the cache
     */
    get size(): number;
    /**
     * Returns current and maximum memory usage of the cache.
     * Values are expressed in megabytes (MB).
     *
     * @returns An object with `current` and `max` memory values.
     *
     * @example
     * const { current, max } = cache.memory;
     */
    get memory(): MemoryStats;
}

export { Cache };
