const { Cache } = require("./index.js");

const cache = new Cache({
  ttl: 1000,
  maxItems: 10,
  maxMemoryInMb: 1
});

cache.clear();

for (var i = 0; i < 1e6; i++) {
  cache.set(i, { name: "test" });
  cache.get(i);
  cache.has(i);
  cache.clear();
}

cache.set(0, { name: "test" });
cache.set(0, { name: "test" });
cache.set(0, { name: "test" });
cache.set(0, { name: "test" });
cache.set(0, { name: "test" });
cache.set(0, { name: "test" });

console.time();
cache.set(-1, { name: "test" });

console.timeEnd();

console.time();
cache.get(0);

console.timeEnd();

console.time();
cache.has(0);

console.timeEnd();

console.time();
cache.delete(0);

console.timeEnd();

console.time();
cache.clear();

console.timeEnd();
