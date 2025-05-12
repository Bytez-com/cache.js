// tests/test.ts
import { Cache } from "../dist/index.mjs"; // adjust path if needed

const cache = new Cache({ maxItems: 5, ttl: 1000 });

cache.set("a", 1);
cache.set("b", 2);
console.log(cache.size); //

cache.delete("a");

console.log(cache.size); //
setTimeout(() => {
  console.log(cache.size); //

  console.log(cache.get("b")); // should print 2
}, 1e3);
cache.set;
