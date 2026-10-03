import type { Band, Domain, Echelon, RangeBand, SpeedBand } from "@sentinel/protocol";

export type SensorType = "RADAR" | "PASSIVE_RF" | "EOIR" | "SONAR" | "SIGINT" | "SAR";
export type EffectorType =
  | "DIRECT" | "INDIRECT" | "MISSILE_AA" | "MISSILE_AS" | "MISSILE_ASHM" | "MISSILE_LAND"
  | "TORPEDO" | "JAMMER" | "CYBER" | "ASAT" | "LOITER";

export interface SensorSpec {
  type: SensorType;
  range: RangeBand;
  strength: Band;
  fov: "360" | "sector";
  /** How often the sensor can look (affects detection rolls per tick). */
  revisit: Band;
}

export interface EffectorSpec {
  type: EffectorType;
  range: RangeBand;
  pk: Band;
  salvo: number;
  magazine: number;
  targets: Domain[];
}

export type AssetTag =
  | "HQ" | "DEPOT" | "TANKER" | "AEW" | "SATCOM" | "PNT" | "MISSILE_WARNING" | "ISR" | "GROUND_STATION"
  | "LAUNCH" | "SWARM" | "JAMMER" | "CARRIER" | "AIRBASE" | "SUBMARINE" | "AIR_DEFENSE" | "AMPHIB"
  | "COMBAT_LAND" | "ARTILLERY" | "LOGISTICS" | "DRONE_LINK" | "ORBITAL" | "BROADBAND" | "MCM" | "AIRLIFT"
  | "HELICOPTER" | "STRIKE" | "FIGHTER";

export interface AssetClass {
  id: string;
  name: string;
  domain: Domain;
  echelon: Echelon;
  /** MIL-STD-2525C function id (positions 3..10, '?' for affiliation is applied at render time). */
  sidc: string;
  kinematics: { speed: SpeedBand; maxSpeed: SpeedBand; turn: Band; ceiling: Band };
  endurance: { fuel: Band; burn: Band; refuelable: boolean };
  sensors: SensorSpec[];
  signatures: { radar: Band; ir: Band; acoustic: Band; visual: Band };
  emitsByDefault: boolean;
  effectors: EffectorSpec[];
  defenses: { hardKill: Band; softKill: Band; armor: Band; hardening: Band };
  cost: { points: number; replacementDays: number };
  /** Aggregate land combat power (Lanchester); 0 for non-combat assets. */
  combatPower: number;
  tags: AssetTag[];
  /** Members in a swarm, sortie aircraft in a flight, etc. */
  members?: number;
  description: string;
}
