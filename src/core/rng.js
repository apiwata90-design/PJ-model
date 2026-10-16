// Seeded random numbers so every forecast can be replayed exactly.

export function makeRng(seed) {
  let a = seed >>> 0;
  return function mulberry32() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normal(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export function poisson(rng, lambda) {
  if (!(lambda > 0)) return 0;
  const limit = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > limit);
  return k - 1;
}
