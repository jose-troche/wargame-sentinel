// Deterministic transcendental functions. Only +, -, *, /, Math.sqrt (IEEE correctly rounded),
// Math.floor/round/abs are used, so results are bit-identical on every JS engine (impl. §6).

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
export const DEG = PI / 180;
export const RAD = 180 / PI;
const PIO2_HI = 1.5707963267341256;
const PIO2_LO = 6.077100506506192e-11;
const LN2 = 0.6931471805599453;

function sinPoly(x: number): number {
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))));
}
function cosPoly(x: number): number {
  const x2 = x * x;
  return 1 + x2 * (-1 / 2 + x2 * (1 / 24 + x2 * (-1 / 720 + x2 * (1 / 40320 + x2 * (-1 / 3628800 + x2 * (1 / 479001600 + x2 * (-1 / 87178291200 + x2 * (1 / 20922789888000))))))));
}

export function sin(x: number): number {
  const k = Math.round(x / HALF_PI);
  const r = x - k * PIO2_HI - k * PIO2_LO;
  switch (((k % 4) + 4) % 4) {
    case 0: return sinPoly(r);
    case 1: return cosPoly(r);
    case 2: return -sinPoly(r);
    default: return -cosPoly(r);
  }
}

export function cos(x: number): number {
  const k = Math.round(x / HALF_PI);
  const r = x - k * PIO2_HI - k * PIO2_LO;
  switch (((k % 4) + 4) % 4) {
    case 0: return cosPoly(r);
    case 1: return -sinPoly(r);
    case 2: return -cosPoly(r);
    default: return sinPoly(r);
  }
}

function atanSmall(x: number): number {
  // |x| <= ~0.2 after two argument halvings
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 3; n <= 31; n += 2) {
    term *= -x2;
    sum += term / n;
  }
  return sum;
}

export function atan(x: number): number {
  if (x !== x) return NaN;
  const neg = x < 0;
  let a = neg ? -x : x;
  let inv = false;
  if (a > 1) {
    a = 1 / a;
    inv = true;
  }
  // atan(a) = 2 atan(a / (1 + sqrt(1 + a^2)))
  a = a / (1 + Math.sqrt(1 + a * a));
  a = a / (1 + Math.sqrt(1 + a * a));
  let r = 4 * atanSmall(a);
  if (inv) r = HALF_PI - r;
  return neg ? -r : r;
}

export function atan2(y: number, x: number): number {
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

export function asin(x: number): number {
  const c = x > 1 ? 1 : x < -1 ? -1 : x;
  return atan2(c, Math.sqrt(1 - c * c));
}

export function acos(x: number): number {
  const c = x > 1 ? 1 : x < -1 ? -1 : x;
  return atan2(Math.sqrt(1 - c * c), c);
}

export function exp(x: number): number {
  if (x > 709) return Infinity;
  if (x < -745) return 0;
  const k = Math.round(x / LN2);
  const r = x - k * LN2;
  let term = 1;
  let sum = 1;
  for (let n = 1; n <= 18; n++) {
    term = (term * r) / n;
    sum += term;
  }
  let scale = 1;
  if (k > 0) for (let i = 0; i < k; i++) scale *= 2;
  else for (let i = 0; i < -k; i++) scale /= 2;
  return sum * scale;
}

export function log(x: number): number {
  if (x <= 0) return x === 0 ? -Infinity : NaN;
  let e = 0;
  let m = x;
  while (m >= 2) { m /= 2; e++; }
  while (m < 1) { m *= 2; e--; }
  // log(m) = 2 atanh(s), s = (m-1)/(m+1), |s| <= 1/3
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  let term = s;
  let sum = s;
  for (let n = 3; n <= 41; n += 2) {
    term *= s2;
    sum += term / n;
  }
  return 2 * sum + e * LN2;
}

export function pow(x: number, y: number): number {
  if (y === 0) return 1;
  if (x === 0) return 0;
  return exp(y * log(x));
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Quantize to a fixed number of decimals, deterministically. */
export const q = (v: number, scale = 1e4) => Math.round(v * scale) / scale;

/** Normalize longitude into [-180, 180). */
export function wrapLon(lon: number): number {
  let l = lon;
  while (l >= 180) l -= 360;
  while (l < -180) l += 360;
  return l;
}
