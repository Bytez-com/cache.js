export interface CacheOptions {
  /** Default time-to-live for cache entries in milliseconds. */
  ttl?: number;
  /** Maximum number of items the cache can hold. */
  maxItems?: number;
  /** Maximum memory usage in megabytes. */
  maxMemoryInMb?: number;
}
export interface CacheEntry<Value> {
  /** Size of the cached item in bytes. */
  size: number;
  /** The actual value stored in the cache. */
  value: Value;
  /** Timestamp indicating when the entry expires. */
  expiresAt: number;
}
export interface MemoryStats {
  /** Current memory usage in MB. */
  current: number;
  /** Maximum allowed memory usage in MB. */
  max: number;
}
import type { Tree } from "functional-red-black-tree";

export interface TimeoutTree<Key> {
  /** Identifier for the current timeout. */
  id?: NodeJS.Timeout;
  /** Red-black tree mapping expiration timestamps to sets of keys. */
  tree: Tree<number, Set<Key>>;
  /** Timestamp of the next scheduled expiration. */
  timestamp: number;
}
