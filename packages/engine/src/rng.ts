// Seeded xoshiro128** generator. State is four uint32 words so it serializes into snapshots.
import { cos, log, TWO_PI } from "./dmath";

export type RngState = [number, number, number, number];

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function seedRng(seed: number): RngState {
  const sm = splitmix32(seed);
  const st: RngState = [sm(), sm(), sm(), sm()];
  if ((st[0] | st[1] | st[2] | st[3]) === 0) st[0] = 1;
  return st;
}

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

export class Rng {
  draws = 0;
  constructor(public s: RngState) {}

  nextU32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] = (s[2] ^ s[0]) >>> 0;
    s[3] = (s[3] ^ s[1]) >>> 0;
    s[1] = (s[1] ^ s[2]) >>> 0;
    s[0] = (s[0] ^ s[3]) >>> 0;
    s[2] = (s[2] ^ t) >>> 0;
    s[3] = rotl(s[3], 11);
    this.draws++;
    return result;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  /** Standard normal via Box–Muller using deterministic log/cos. */
  normal(): number {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * log(u)) * cos(TWO_PI * v);
  }
}

/** Stateless hash noise for terrain and weather: a deterministic float in [0,1). */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul((x | 0) ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul((y | 0) ^ 0x61c88647, 0x27d4eb2f) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
