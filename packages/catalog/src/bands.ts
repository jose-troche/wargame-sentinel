// Mapping from notional bands to the abstract numbers the engine computes with.
// These are game-balance values, deliberately round and coarse.
import type { Band, Domain, RangeBand, SpeedBand } from "@sentinel/protocol";

export const BAND_FACTOR: Record<Band, number> = {
  none: 0, very_low: 0.1, low: 0.3, medium: 0.6, high: 1.0, very_high: 1.6,
};

export const PK: Record<Band, number> = {
  none: 0, very_low: 0.1, low: 0.25, medium: 0.45, high: 0.65, very_high: 0.8,
};

/** km per band. */
export const RANGE_KM: Record<RangeBand, number> = {
  none: 0, very_short: 5, short: 25, medium: 80, long: 300, very_long: 1000, global: 20000,
};

/** km/h per band; sea and land "slow" share a value on purpose (relative behavior only). */
export const SPEED_KMH: Record<SpeedBand, number> = {
  static: 0, very_slow: 10, slow: 30, medium: 60, fast: 250, very_fast: 800, supersonic: 1500, hypersonic: 5000, orbital: 0,
};

/** Endurance in hours at cruise, from fuel band and burn band. */
export function enduranceHours(fuel: Band, burn: Band, domain: Domain): number {
  const f = BAND_FACTOR[fuel] || 0.1;
  const b = BAND_FACTOR[burn] || 0.05;
  const scale = domain === "AIR" ? 8 : domain === "DRONE" ? 12 : 24 * 6;
  return Math.max(1, Math.round((f / b) * scale));
}

/** Typical cruise altitude (m) by domain and ceiling band. */
export function cruiseAltitude(domain: Domain, ceiling: Band, submarine: boolean): number {
  if (submarine) return -150;
  if (domain === "AIR" || domain === "DRONE") {
    return ({ none: 0, very_low: 100, low: 500, medium: 6000, high: 9000, very_high: 18000 } as Record<Band, number>)[ceiling];
  }
  return 0;
}
