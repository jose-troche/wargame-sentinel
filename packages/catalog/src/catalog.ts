// Notional asset catalogue: 42 classes across five domains. Every performance value is a band
// calibrated for plausible *relative* behavior, never engineering accuracy (spec §1, §5, §10).
import type { AssetClass, EffectorSpec, SensorSpec } from "./types";

export const CATALOG_VERSION = "2026.10.1";

type Partial2<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };

const base: Omit<AssetClass, "id" | "name" | "domain" | "sidc" | "description"> = {
  echelon: "unit",
  kinematics: { speed: "slow", maxSpeed: "medium", turn: "medium", ceiling: "none" },
  endurance: { fuel: "high", burn: "low", refuelable: true },
  sensors: [],
  signatures: { radar: "medium", ir: "medium", acoustic: "medium", visual: "medium" },
  emitsByDefault: false,
  effectors: [],
  defenses: { hardKill: "none", softKill: "low", armor: "low", hardening: "low" },
  cost: { points: 10, replacementDays: 30 },
  combatPower: 0,
  tags: [],
};

function def(
  id: string, name: string, domain: AssetClass["domain"], sidc: string, description: string,
  o: Partial2<Omit<AssetClass, "id" | "name" | "domain" | "sidc" | "description">>,
): AssetClass {
  return {
    ...base,
    ...(o as object),
    id, name, domain, sidc, description,
    kinematics: { ...base.kinematics, ...o.kinematics },
    endurance: { ...base.endurance, ...o.endurance },
    signatures: { ...base.signatures, ...o.signatures },
    defenses: { ...base.defenses, ...o.defenses },
    cost: { ...base.cost, ...o.cost },
    sensors: (o.sensors as SensorSpec[]) ?? [],
    effectors: (o.effectors as EffectorSpec[]) ?? [],
    tags: (o.tags as AssetClass["tags"]) ?? [],
  } as AssetClass;
}

const S = (type: SensorSpec["type"], range: SensorSpec["range"], strength: SensorSpec["strength"], revisit: SensorSpec["revisit"] = "high", fov: SensorSpec["fov"] = "360"): SensorSpec =>
  ({ type, range, strength, revisit, fov });
const E = (type: EffectorSpec["type"], range: EffectorSpec["range"], pk: EffectorSpec["pk"], salvo: number, magazine: number, targets: EffectorSpec["targets"]): EffectorSpec =>
  ({ type, range, pk, salvo, magazine, targets });

export const CATALOG: AssetClass[] = [
  // ---------------- LAND (10) ----------------
  def("armored_bde", "Armored brigade", "LAND", "S?GPUCA----H", "Heavy maneuver formation; high combat power, high fuel use.", {
    echelon: "formation", kinematics: { speed: "slow", maxSpeed: "medium" },
    sensors: [S("EOIR", "short", "medium")], signatures: { radar: "high", ir: "high", visual: "high", acoustic: "high" },
    effectors: [E("DIRECT", "short", "high", 4, 60, ["LAND"])], defenses: { armor: "very_high", hardKill: "low" },
    cost: { points: 90, replacementDays: 120 }, combatPower: 100, tags: ["COMBAT_LAND"], endurance: { burn: "high" },
  }),
  def("mech_inf_bde", "Mechanized infantry brigade", "LAND", "S?GPUCII---H", "Balanced formation able to seize and hold ground.", {
    echelon: "formation", kinematics: { speed: "slow", maxSpeed: "medium" },
    sensors: [S("EOIR", "short", "medium")], signatures: { radar: "high", ir: "high", visual: "high" },
    effectors: [E("DIRECT", "short", "medium", 4, 60, ["LAND"]), E("MISSILE_AA", "very_short", "low", 2, 12, ["AIR", "DRONE"])],
    defenses: { armor: "high" }, cost: { points: 70, replacementDays: 100 }, combatPower: 80, tags: ["COMBAT_LAND"], endurance: { burn: "medium" },
  }),
  def("light_inf_bde", "Light / airborne infantry brigade", "LAND", "S?GPUCI----H", "Light, air-mobile force; good in close terrain, weak in the open.", {
    echelon: "formation", kinematics: { speed: "very_slow", maxSpeed: "slow" },
    sensors: [S("EOIR", "very_short", "medium")], signatures: { radar: "low", ir: "medium", visual: "medium" },
    effectors: [E("DIRECT", "very_short", "medium", 3, 40, ["LAND"]), E("MISSILE_AA", "very_short", "low", 1, 8, ["AIR", "DRONE"])],
    defenses: { armor: "low" }, cost: { points: 40, replacementDays: 90 }, combatPower: 50, tags: ["COMBAT_LAND"], endurance: { burn: "low" },
  }),
  def("artillery_bn", "Rocket and tube artillery battalion", "LAND", "S?GPUCF----F", "Indirect fires; depends on targeting from other sensors.", {
    kinematics: { speed: "slow", maxSpeed: "medium" }, sensors: [S("RADAR", "short", "medium")],
    effectors: [E("INDIRECT", "medium", "medium", 6, 48, ["LAND"]), E("MISSILE_LAND", "long", "medium", 2, 8, ["LAND"])],
    signatures: { radar: "medium", ir: "high" }, emitsByDefault: true,
    cost: { points: 35, replacementDays: 60 }, combatPower: 40, tags: ["ARTILLERY", "COMBAT_LAND"],
  }),
  def("shorad_bn", "Short-range air defense battalion", "LAND", "S?GPUCD----F", "Point defense against aircraft, drones and helicopters.", {
    kinematics: { speed: "slow", maxSpeed: "medium" }, sensors: [S("RADAR", "short", "high"), S("EOIR", "short", "medium")],
    effectors: [E("MISSILE_AA", "short", "medium", 2, 24, ["AIR", "DRONE"]), E("DIRECT", "very_short", "medium", 6, 200, ["DRONE"])],
    defenses: { hardKill: "high", softKill: "medium" }, emitsByDefault: true,
    cost: { points: 25, replacementDays: 60 }, combatPower: 10, tags: ["AIR_DEFENSE"],
  }),
  def("lrad_bn", "Long-range air defense battalion", "LAND", "S?GPUCDM---F", "Area air defense umbrella; a key A2/AD layer and a priority target.", {
    kinematics: { speed: "very_slow", maxSpeed: "slow" }, sensors: [S("RADAR", "long", "very_high")],
    effectors: [E("MISSILE_AA", "long", "high", 2, 16, ["AIR", "DRONE"])], defenses: { hardKill: "high", softKill: "medium" },
    signatures: { radar: "high" }, emitsByDefault: true, cost: { points: 60, replacementDays: 120 }, combatPower: 10, tags: ["AIR_DEFENSE"],
  }),
  def("coastal_ashm", "Coastal anti-ship battery", "LAND", "S?GPUCFR---F", "Shore-based anti-ship missiles; denies sea areas near the coast.", {
    kinematics: { speed: "slow", maxSpeed: "medium" }, sensors: [S("RADAR", "medium", "high")],
    effectors: [E("MISSILE_ASHM", "long", "high", 2, 8, ["SEA"])], signatures: { radar: "low", ir: "medium" },
    cost: { points: 40, replacementDays: 90 }, combatPower: 5, tags: [],
  }),
  def("engineer_bn", "Engineer battalion", "LAND", "S?GPUCE----F", "Breaching, obstacles and entrenchment; speeds friendly movement.", {
    kinematics: { speed: "slow", maxSpeed: "medium" }, sensors: [S("EOIR", "very_short", "low")],
    cost: { points: 20, replacementDays: 45 }, combatPower: 20, tags: ["COMBAT_LAND"],
  }),
  def("log_convoy", "Logistics convoy", "LAND", "S?GPUSS----E", "Moves fuel, munitions and spares from depots to units; soft target.", {
    kinematics: { speed: "slow", maxSpeed: "medium" }, signatures: { radar: "high", ir: "high", visual: "high" },
    defenses: { armor: "very_low" }, cost: { points: 8, replacementDays: 10 }, combatPower: 2, tags: ["DEPOT", "LOGISTICS"],
  }),
  def("hq", "Headquarters", "LAND", "S?GPU------A", "Command node; its loss slows every order that routes through it.", {
    kinematics: { speed: "very_slow", maxSpeed: "slow" }, sensors: [S("SIGINT", "medium", "medium")],
    signatures: { radar: "medium", ir: "medium" }, emitsByDefault: true, defenses: { hardening: "high" },
    cost: { points: 50, replacementDays: 30 }, combatPower: 5, tags: ["HQ", "DEPOT"],
  }),

  // ---------------- SEA (8) ----------------
  def("csg", "Carrier strike group", "SEA", "S?SPCLCV----", "Mobile airbase with layered fleet air defense; very high value.", {
    echelon: "formation", kinematics: { speed: "slow", maxSpeed: "slow" },
    sensors: [S("RADAR", "long", "very_high"), S("SONAR", "short", "medium")],
    effectors: [E("MISSILE_AA", "medium", "high", 4, 64, ["AIR", "DRONE"]), E("MISSILE_ASHM", "long", "medium", 2, 8, ["SEA"])],
    signatures: { radar: "very_high", ir: "high", acoustic: "high", visual: "very_high" }, emitsByDefault: true,
    defenses: { hardKill: "very_high", softKill: "high", armor: "medium" }, cost: { points: 300, replacementDays: 900 },
    tags: ["CARRIER", "AIRBASE", "AIR_DEFENSE"],
  }),
  def("destroyer", "Destroyer", "SEA", "S?SPCLDD----", "Multi-mission escort; backbone of fleet air defense.", {
    kinematics: { speed: "slow", maxSpeed: "slow" }, sensors: [S("RADAR", "long", "high"), S("SONAR", "short", "medium")],
    effectors: [E("MISSILE_AA", "medium", "high", 2, 48, ["AIR", "DRONE"]), E("MISSILE_ASHM", "long", "medium", 2, 8, ["SEA"]), E("MISSILE_LAND", "very_long", "medium", 2, 12, ["LAND"])],
    signatures: { radar: "high", acoustic: "medium" }, emitsByDefault: true, defenses: { hardKill: "high", softKill: "medium", armor: "low" },
    cost: { points: 60, replacementDays: 600 }, tags: ["AIR_DEFENSE"],
  }),
  def("frigate", "Frigate", "SEA", "S?SPCLFF----", "Escort optimized for anti-submarine warfare.", {
    kinematics: { speed: "slow", maxSpeed: "slow" }, sensors: [S("RADAR", "medium", "medium"), S("SONAR", "medium", "high")],
    effectors: [E("MISSILE_AA", "short", "medium", 2, 16, ["AIR", "DRONE"]), E("TORPEDO", "short", "medium", 2, 8, ["SEA"]), E("MISSILE_ASHM", "long", "medium", 2, 8, ["SEA"])],
    signatures: { radar: "medium", acoustic: "low" }, emitsByDefault: true, defenses: { hardKill: "medium", softKill: "medium" },
    cost: { points: 40, replacementDays: 500 }, tags: [],
  }),
  def("ssn", "Attack submarine (nuclear)", "SEA", "S?UPSNA-----", "Fast, quiet hunter; trades speed for stealth.", {
    kinematics: { speed: "slow", maxSpeed: "medium" }, sensors: [S("SONAR", "medium", "very_high")],
    effectors: [E("TORPEDO", "short", "high", 2, 20, ["SEA"]), E("MISSILE_LAND", "very_long", "medium", 2, 8, ["LAND"])],
    signatures: { radar: "none", ir: "none", acoustic: "very_low", visual: "none" }, defenses: { softKill: "high" },
    cost: { points: 80, replacementDays: 1200 }, tags: ["SUBMARINE"],
  }),
  def("ssk", "Diesel-electric submarine", "SEA", "S?UPSCA-----", "Very quiet on batteries, slow, must snorkel to recharge.", {
    kinematics: { speed: "very_slow", maxSpeed: "slow" }, sensors: [S("SONAR", "short", "high")],
    effectors: [E("TORPEDO", "short", "high", 2, 14, ["SEA"]), E("MISSILE_ASHM", "medium", "medium", 2, 4, ["SEA"])],
    signatures: { radar: "none", ir: "none", acoustic: "very_low", visual: "none" }, endurance: { fuel: "medium" },
    cost: { points: 30, replacementDays: 700 }, tags: ["SUBMARINE"],
  }),
  def("arg", "Amphibious ready group", "SEA", "S?SPCALA----", "Carries a landing force; vulnerable during the landing.", {
    echelon: "formation", kinematics: { speed: "slow", maxSpeed: "slow" }, sensors: [S("RADAR", "medium", "medium")],
    effectors: [E("MISSILE_AA", "short", "medium", 2, 16, ["AIR", "DRONE"])], signatures: { radar: "very_high", visual: "very_high" },
    emitsByDefault: true, defenses: { hardKill: "medium" }, cost: { points: 120, replacementDays: 800 }, combatPower: 60, tags: ["AMPHIB"],
  }),
  def("oiler", "Fleet oiler", "SEA", "S?SPNR------", "Underway replenishment; extends the fleet's reach.", {
    kinematics: { speed: "slow", maxSpeed: "slow" }, signatures: { radar: "very_high", visual: "very_high" },
    cost: { points: 20, replacementDays: 400 }, tags: ["DEPOT", "LOGISTICS"],
  }),
  def("mcm_group", "Mine countermeasures group", "SEA", "S?SPCM------", "Clears mined chokepoints; slow and lightly defended.", {
    kinematics: { speed: "very_slow", maxSpeed: "slow" }, sensors: [S("SONAR", "very_short", "high")],
    signatures: { radar: "medium", acoustic: "very_low" }, cost: { points: 15, replacementDays: 300 }, tags: ["MCM"],
  }),

  // ---------------- AIR (8) ----------------
  def("fighter_as", "Air superiority fighter flight", "AIR", "S?APMFF-----", "Controls the air; flies CAP and escort.", {
    echelon: "section", kinematics: { speed: "very_fast", maxSpeed: "supersonic", turn: "very_high", ceiling: "high" },
    endurance: { fuel: "low", burn: "high", refuelable: true }, sensors: [S("RADAR", "medium", "high"), S("EOIR", "short", "medium")],
    effectors: [E("MISSILE_AA", "medium", "high", 2, 8, ["AIR", "DRONE"])], signatures: { radar: "low", ir: "medium" },
    emitsByDefault: true, defenses: { softKill: "medium" }, cost: { points: 12, replacementDays: 180 }, tags: ["FIGHTER"], members: 4,
  }),
  def("fighter_mr", "Multirole fighter flight", "AIR", "S?APMFA-----", "Strike or counter-air; the workhorse of the air tasking order.", {
    echelon: "section", kinematics: { speed: "very_fast", maxSpeed: "supersonic", turn: "high", ceiling: "high" },
    endurance: { fuel: "low", burn: "high", refuelable: true }, sensors: [S("RADAR", "medium", "medium")],
    effectors: [E("MISSILE_AA", "short", "medium", 2, 4, ["AIR", "DRONE"]), E("MISSILE_AS", "medium", "high", 2, 4, ["LAND", "SEA"])],
    signatures: { radar: "medium", ir: "medium" }, emitsByDefault: true, defenses: { softKill: "medium" },
    cost: { points: 10, replacementDays: 150 }, tags: ["FIGHTER", "STRIKE"], members: 4,
  }),
  def("bomber", "Long-range bomber", "AIR", "S?APMFB-----", "Long-range standoff strike; depends on escorts and tankers.", {
    echelon: "section", kinematics: { speed: "very_fast", maxSpeed: "very_fast", turn: "low", ceiling: "high" },
    endurance: { fuel: "very_high", burn: "medium", refuelable: true }, sensors: [S("RADAR", "medium", "medium")],
    effectors: [E("MISSILE_LAND", "very_long", "high", 4, 12, ["LAND"]), E("MISSILE_ASHM", "very_long", "medium", 4, 8, ["SEA"])],
    signatures: { radar: "low", ir: "medium" }, cost: { points: 60, replacementDays: 720 }, tags: ["STRIKE"], members: 2,
  }),
  def("aewc", "Airborne early warning and control", "AIR", "S?APMFRW----", "Flying radar and relay; extends sensing and C2 over the horizon.", {
    echelon: "platform", kinematics: { speed: "very_fast", maxSpeed: "very_fast", turn: "low", ceiling: "high" },
    endurance: { fuel: "high", burn: "medium", refuelable: true }, sensors: [S("RADAR", "very_long", "very_high")],
    signatures: { radar: "very_high", ir: "high" }, emitsByDefault: true, cost: { points: 40, replacementDays: 720 }, tags: ["AEW", "ISR"],
  }),
  def("tanker", "Aerial tanker", "AIR", "S?APMFKB----", "Refuels aircraft in flight; the hidden limit on air reach.", {
    echelon: "platform", kinematics: { speed: "very_fast", maxSpeed: "very_fast", turn: "low", ceiling: "high" },
    endurance: { fuel: "very_high", burn: "medium", refuelable: false }, signatures: { radar: "very_high", ir: "high" },
    cost: { points: 25, replacementDays: 500 }, tags: ["TANKER"],
  }),
  def("airlifter", "Strategic airlifter", "AIR", "S?APMFC-----", "Moves supplies by air; flexible but low volume.", {
    echelon: "platform", kinematics: { speed: "very_fast", maxSpeed: "very_fast", turn: "low", ceiling: "high" },
    endurance: { fuel: "very_high", burn: "medium" }, signatures: { radar: "very_high" }, cost: { points: 20, replacementDays: 500 }, tags: ["AIRLIFT", "LOGISTICS"],
  }),
  def("mpa", "Maritime patrol aircraft", "AIR", "S?APMFP-----", "Hunts submarines and ships over wide sea areas.", {
    echelon: "platform", kinematics: { speed: "fast", maxSpeed: "very_fast", turn: "low", ceiling: "medium" },
    endurance: { fuel: "very_high", burn: "low", refuelable: true }, sensors: [S("RADAR", "long", "high"), S("SONAR", "short", "high")],
    effectors: [E("TORPEDO", "short", "medium", 1, 4, ["SEA"]), E("MISSILE_ASHM", "long", "medium", 1, 2, ["SEA"])],
    signatures: { radar: "high" }, emitsByDefault: true, cost: { points: 20, replacementDays: 400 }, tags: ["ISR"],
  }),
  def("helo", "Attack / utility helicopter flight", "AIR", "S?APMHA-----", "Low-flying fires and lift close to the front.", {
    echelon: "section", kinematics: { speed: "fast", maxSpeed: "fast", turn: "very_high", ceiling: "low" },
    endurance: { fuel: "low", burn: "medium" }, sensors: [S("EOIR", "short", "high")],
    effectors: [E("MISSILE_AS", "short", "high", 2, 16, ["LAND", "SEA"])], signatures: { radar: "medium", ir: "high", acoustic: "high" },
    cost: { points: 8, replacementDays: 120 }, tags: ["HELICOPTER"], members: 4,
  }),

  // ---------------- DRONES (8) ----------------
  def("hale_isr", "HALE ISR drone", "DRONE", "S?APMFQ-----", "High-altitude, long-endurance surveillance; datalink dependent.", {
    echelon: "platform", kinematics: { speed: "fast", maxSpeed: "fast", turn: "low", ceiling: "very_high" },
    endurance: { fuel: "very_high", burn: "very_low", refuelable: false }, sensors: [S("RADAR", "long", "high"), S("EOIR", "medium", "high"), S("SIGINT", "long", "medium")],
    signatures: { radar: "medium", ir: "low" }, cost: { points: 15, replacementDays: 200 }, tags: ["ISR", "DRONE_LINK"],
  }),
  def("male_drone", "MALE ISR/strike drone", "DRONE", "S?APMFQ-----", "Medium-altitude armed overwatch; cheap enough to risk.", {
    echelon: "platform", kinematics: { speed: "fast", maxSpeed: "fast", turn: "medium", ceiling: "medium" },
    endurance: { fuel: "very_high", burn: "very_low" }, sensors: [S("EOIR", "medium", "high")],
    effectors: [E("MISSILE_AS", "short", "medium", 1, 4, ["LAND", "SEA"])], signatures: { radar: "medium", ir: "low", acoustic: "medium" },
    cost: { points: 4, replacementDays: 60 }, tags: ["ISR", "DRONE_LINK", "STRIKE"],
  }),
  def("cca", "Collaborative combat aircraft", "DRONE", "S?APMFQ-----", "Uncrewed wingman that adds mass to crewed fighters.", {
    echelon: "section", kinematics: { speed: "very_fast", maxSpeed: "very_fast", turn: "high", ceiling: "high" },
    endurance: { fuel: "medium", burn: "medium" }, sensors: [S("RADAR", "medium", "medium")],
    effectors: [E("MISSILE_AA", "medium", "medium", 2, 4, ["AIR", "DRONE"])], signatures: { radar: "low", ir: "low" },
    emitsByDefault: true, cost: { points: 5, replacementDays: 90 }, tags: ["FIGHTER", "DRONE_LINK"], members: 4,
  }),
  def("loitering_munition", "Loitering munition pack", "DRONE", "S?APWM------", "One-way attack drones that search, then dive on a target.", {
    echelon: "section", kinematics: { speed: "fast", maxSpeed: "fast", turn: "medium", ceiling: "low" },
    endurance: { fuel: "medium", burn: "low", refuelable: false }, sensors: [S("EOIR", "short", "medium")],
    effectors: [E("LOITER", "medium", "medium", 2, 12, ["LAND", "SEA"])], signatures: { radar: "very_low", ir: "very_low", acoustic: "low" },
    cost: { points: 2, replacementDays: 14 }, tags: ["DRONE_LINK", "STRIKE"], members: 12,
  }),
  def("quad_swarm", "Small quadcopter swarm", "DRONE", "S?APMFQ-----", "Dozens of cheap quadcopters moving as one flocking swarm.", {
    echelon: "section", kinematics: { speed: "medium", maxSpeed: "medium", turn: "very_high", ceiling: "very_low" },
    endurance: { fuel: "low", burn: "high", refuelable: false }, sensors: [S("EOIR", "very_short", "medium")],
    effectors: [E("LOITER", "very_short", "low", 6, 40, ["LAND"])], signatures: { radar: "very_low", ir: "very_low", acoustic: "medium", visual: "low" },
    cost: { points: 1, replacementDays: 7 }, tags: ["SWARM", "DRONE_LINK"], members: 40,
  }),
  def("usv", "Uncrewed surface vessel group", "DRONE", "S?SP--------", "Small autonomous boats for patrol and attack.", {
    echelon: "section", kinematics: { speed: "medium", maxSpeed: "medium", turn: "high" },
    endurance: { fuel: "medium", burn: "low" }, sensors: [S("RADAR", "short", "medium"), S("EOIR", "short", "medium")],
    effectors: [E("DIRECT", "very_short", "medium", 1, 6, ["SEA"])], signatures: { radar: "low", visual: "low", acoustic: "medium" },
    cost: { points: 3, replacementDays: 30 }, tags: ["DRONE_LINK"], members: 6,
  }),
  def("uuv", "Uncrewed undersea vehicle", "DRONE", "S?UP--------", "Slow, silent underwater sensor and mine layer.", {
    echelon: "platform", kinematics: { speed: "very_slow", maxSpeed: "very_slow" },
    endurance: { fuel: "high", burn: "very_low", refuelable: false }, sensors: [S("SONAR", "short", "medium")],
    signatures: { radar: "none", ir: "none", acoustic: "very_low", visual: "none" }, cost: { points: 3, replacementDays: 60 }, tags: ["ISR"],
  }),
  def("ugv", "Uncrewed ground vehicle company", "DRONE", "S?GPE-------", "Robotic scouts and breachers that lead attacks.", {
    echelon: "section", kinematics: { speed: "slow", maxSpeed: "slow" }, sensors: [S("EOIR", "short", "medium")],
    effectors: [E("DIRECT", "very_short", "low", 2, 20, ["LAND"])], signatures: { radar: "low", ir: "medium" },
    cost: { points: 4, replacementDays: 30 }, combatPower: 12, tags: ["DRONE_LINK", "COMBAT_LAND"],
  }),

  // ---------------- SPACE (8) ----------------
  def("leo_imaging", "LEO imaging satellite", "SPACE", "S?PPS-------", "Electro-optical imaging during passes; blind at night and in cloud.", {
    echelon: "platform", kinematics: { speed: "orbital", maxSpeed: "orbital" }, sensors: [S("EOIR", "long", "very_high", "low", "sector")],
    signatures: { radar: "low", visual: "low" }, cost: { points: 30, replacementDays: 365 }, tags: ["ISR", "ORBITAL"],
  }),
  def("leo_sar", "LEO SAR satellite", "SPACE", "S?PPS-------", "Radar imaging through cloud and at night, during passes.", {
    echelon: "platform", kinematics: { speed: "orbital", maxSpeed: "orbital" }, sensors: [S("SAR", "long", "high", "low", "sector")],
    signatures: { radar: "low", visual: "low" }, emitsByDefault: true, cost: { points: 35, replacementDays: 365 }, tags: ["ISR", "ORBITAL"],
  }),
  def("leo_comms", "LEO broadband satellite", "SPACE", "S?PPS-------", "Proliferated communications; hard to deny all at once.", {
    echelon: "platform", kinematics: { speed: "orbital", maxSpeed: "orbital" }, signatures: { radar: "low", visual: "low" },
    cost: { points: 3, replacementDays: 30 }, tags: ["SATCOM", "BROADBAND", "ORBITAL"],
  }),
  def("meo_pnt", "MEO navigation (PNT) satellite", "SPACE", "S?PPS-------", "Positioning, navigation and timing for precision weapons and drones.", {
    echelon: "platform", kinematics: { speed: "orbital", maxSpeed: "orbital" }, signatures: { radar: "low", visual: "very_low" },
    cost: { points: 40, replacementDays: 720 }, tags: ["PNT", "ORBITAL"],
  }),
  def("geo_satcom", "GEO SATCOM satellite", "SPACE", "S?PPS-------", "Wide-area communications; downlinks can be jammed.", {
    echelon: "platform", kinematics: { speed: "orbital", maxSpeed: "orbital" }, signatures: { radar: "medium", visual: "low" },
    cost: { points: 80, replacementDays: 1000 }, tags: ["SATCOM", "ORBITAL"],
  }),
  def("missile_warning", "GEO/HEO missile warning satellite", "SPACE", "S?PPS-------", "Infrared launch detection; attacking it is highly escalatory.", {
    echelon: "platform", kinematics: { speed: "orbital", maxSpeed: "orbital" }, sensors: [S("EOIR", "global", "high", "very_high", "360")],
    signatures: { radar: "medium", visual: "low" }, cost: { points: 100, replacementDays: 1200 }, tags: ["MISSILE_WARNING", "ORBITAL"],
  }),
  def("ground_station", "Satellite ground control station", "SPACE", "S?GPI-------", "Commands satellites and receives imagery downlinks.", {
    kinematics: { speed: "static", maxSpeed: "static" }, sensors: [S("PASSIVE_RF", "medium", "low")],
    signatures: { radar: "high", visual: "high" }, emitsByDefault: true, defenses: { hardening: "medium" },
    effectors: [E("JAMMER", "long", "medium", 1, 999, ["SPACE"])], cost: { points: 30, replacementDays: 180 }, tags: ["GROUND_STATION"],
  }),
  def("launch_site", "Launch site", "SPACE", "S?GPI-------", "Replaces lost satellites over days to weeks; also hosts counter-space weapons.", {
    kinematics: { speed: "static", maxSpeed: "static" }, signatures: { radar: "very_high", visual: "very_high", ir: "very_high" },
    effectors: [E("ASAT", "global", "medium", 1, 3, ["SPACE"])], defenses: { hardening: "high" },
    cost: { points: 120, replacementDays: 720 }, tags: ["LAUNCH"],
  }),
];

/** Extra electronic-warfare emitters folded into the land domain (not counted in the 42 platform classes). */
export const EW_CLASSES: AssetClass[] = [
  def("ew_bn", "Electronic warfare battalion", "LAND", "S?GPUUE----F", "Ground jammers that degrade radar, datalinks and GNSS nearby.", {
    kinematics: { speed: "slow", maxSpeed: "medium" }, sensors: [S("PASSIVE_RF", "long", "high")],
    effectors: [E("JAMMER", "medium", "high", 1, 999, ["AIR", "DRONE", "LAND", "SEA"])], emitsByDefault: true,
    cost: { points: 25, replacementDays: 60 }, tags: ["JAMMER"],
  }),
  def("cyber_unit", "Cyber operations unit", "LAND", "S?GPUUS----E", "Timed effects on enemy C2 nodes: delay, deny or deceive.", {
    kinematics: { speed: "static", maxSpeed: "static" }, effectors: [E("CYBER", "global", "medium", 1, 999, ["LAND", "SEA", "AIR", "SPACE"])],
    signatures: { radar: "very_low", visual: "very_low", ir: "very_low", acoustic: "very_low" }, cost: { points: 15, replacementDays: 30 }, tags: [],
  }),
  def("decoy_group", "Decoy group", "LAND", "S?GPUCA----H", "Inflatable and emitter decoys that create false tracks.", {
    kinematics: { speed: "slow", maxSpeed: "medium" }, signatures: { radar: "high", ir: "medium", visual: "high" }, emitsByDefault: true,
    cost: { points: 2, replacementDays: 5 }, tags: [],
  }),
];

export const ALL_CLASSES: AssetClass[] = [...CATALOG, ...EW_CLASSES];
const byId = new Map(ALL_CLASSES.map((c) => [c.id, c]));

export function getClass(id: string): AssetClass {
  const c = byId.get(id);
  if (!c) throw new Error(`unknown asset class: ${id}`);
  return c;
}
export const hasClass = (id: string) => byId.has(id);
