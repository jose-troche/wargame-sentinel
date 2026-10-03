// Generates the starter scenarios in /scenarios. All factions, places and landmasses are fictional;
// landmasses sit in open ocean so they never overlap a real coastline. Run: pnpm --filter @sentinel/tools gen:scenarios
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "scenarios");
mkdirSync(out, { recursive: true });

/** Irregular closed ring ([lon, lat]) around a center, deterministic from `salt`. */
function blob(lat, lon, rLat, rLon, salt, n = 22) {
  const ring = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const j = 0.86 + 0.14 * Math.sin(a * 3 + salt) + 0.06 * Math.cos(a * 5 + salt * 2);
    ring.push([+(lon + Math.cos(a) * rLon * j).toFixed(3), +(lat + Math.sin(a) * rLat * j).toFixed(3)]);
  }
  ring.push(ring[0]);
  return ring;
}

const u = (faction, cls, count, at, callsign, extra = {}) => ({ faction, cls, count, at, callsign, spreadKm: count > 1 ? 15 : 0, ...extra });
const constellation = (faction, cls, planes, perPlane, altKm, incDeg, callsign, raanDeg = 0) => ({ faction, cls, planes, perPlane, altKm, incDeg, raanDeg, callsign });

function space(f, lonGeo, sfx) {
  return [
    constellation(f, "leo_imaging", 2, 3, 550, 97.6, `${sfx}EYE`, f === "BLUE" ? 10 : 40),
    constellation(f, "leo_sar", 1, 2, 600, 97.4, `${sfx}SAR`, f === "BLUE" ? 100 : 130),
    constellation(f, "leo_comms", 3, 4, 560, 53, `${sfx}NET`, f === "BLUE" ? 0 : 20),
    constellation(f, "meo_pnt", 3, 2, 20200, 55, `${sfx}NAV`, f === "BLUE" ? 0 : 60),
    constellation(f, "geo_satcom", 1, 1, 35786, 0, `${sfx}COM`, lonGeo),
    constellation(f, "missile_warning", 1, 1, 35786, 0, `${sfx}WARN`, lonGeo - 8),
  ];
}

// ---------------------------------------------------------------- Strait Crisis
const strait = {
  id: "strait-crisis",
  name: "Strait Crisis",
  version: "1.0.0",
  scale: "Regional, 10 days",
  description: "The Corvane Union moves to seize Meridian Island in the strait that separates it from the Republic of Aster. Aster must keep the strait open under an anti-access umbrella.",
  teachingFocus: "A2/AD, sea control, ISR revisit gaps",
  domains: ["SEA", "AIR", "SPACE", "DRONE"],
  durationH: 240,
  map: {
    kind: "fictional",
    bbox: [-145, -50, -114, -32],
    center: [-41, -130],
    zoom: 4.2,
    land: [
      { name: "Aster", owner: "BLUE", ring: blob(-41, -136.5, 5, 5.2, 1) },
      { name: "Corvane", owner: "RED", ring: blob(-41, -123.5, 5.5, 5.2, 2) },
      { name: "Meridian Island", ring: blob(-41, -130, 0.28, 0.38, 3, 14) },
    ],
    cities: [
      { name: "Port Haldane", at: [-40.6, -132.6], faction: "BLUE" },
      { name: "Aster City", at: [-41.6, -137], faction: "BLUE" },
      { name: "Velmora", at: [-40.8, -127.4], faction: "RED" },
      { name: "Corvane Capital", at: [-41.5, -122.5], faction: "RED" },
    ],
    chokepoints: [{ name: "Meridian Strait", at: [-41, -130], radiusKm: 120 }],
  },
  factions: [
    { id: "BLUE", name: "Republic of Aster", will: 72, objectives: [
      { id: "B1", name: "Keep the Meridian Strait open", kind: "CONTROL", domain: "SEA", center: [-42.2, -130], radiusKm: 120, weight: 2 },
      { id: "B2", name: "Deny Meridian Island", kind: "DENY", domain: "LAND", center: [-41, -130], radiusKm: 35, weight: 1 },
    ] },
    { id: "RED", name: "Corvane Union", will: 70, objectives: [
      { id: "R1", name: "Seize Meridian Island", kind: "CONTROL", domain: "LAND", center: [-41, -130], radiusKm: 35, weight: 2 },
      { id: "R2", name: "Deny the strait to Aster", kind: "DENY", domain: "SEA", center: [-42.2, -130], radiusKm: 120, weight: 1 },
    ] },
  ],
  orbat: [
    // Blue — Republic of Aster
    u("BLUE", "hq", 1, [-41.3, -135.6], "ASTER-HQ"),
    u("BLUE", "ground_station", 1, [-42.5, -138], "ASTER-GS"),
    u("BLUE", "launch_site", 1, [-44, -137], "ASTER-LS"),
    u("BLUE", "cyber_unit", 1, [-41.4, -135.8], "GHOST"),
    u("BLUE", "armored_bde", 1, [-40.8, -133.6], "IRON"),
    u("BLUE", "mech_inf_bde", 2, [-41.4, -133.2], "LANCER"),
    u("BLUE", "light_inf_bde", 1, [-40.6, -132.8], "RANGER"),
    u("BLUE", "artillery_bn", 2, [-41.0, -133.0], "THUNDER"),
    u("BLUE", "shorad_bn", 2, [-40.9, -132.8], "SHIELD"),
    u("BLUE", "lrad_bn", 2, [-41.3, -133.4], "AEGIS"),
    u("BLUE", "coastal_ashm", 2, [-40.6, -132.5], "TRIDENT"),
    u("BLUE", "engineer_bn", 1, [-41.2, -134.0], "BRIDGE"),
    u("BLUE", "log_convoy", 3, [-41.3, -134.6], "MULE"),
    u("BLUE", "ew_bn", 1, [-40.9, -132.9], "STATIC"),
    u("BLUE", "decoy_group", 2, [-40.7, -133.0], "MIRAGE"),
    u("BLUE", "csg", 1, [-44.6, -130.6], "VALIANT"),
    u("BLUE", "fighter_mr", 2, [-44.6, -130.6], "TALON", { spreadKm: 0 }),
    u("BLUE", "destroyer", 3, [-43.4, -130.8], "SENTRY"),
    u("BLUE", "frigate", 3, [-42.6, -130.6], "WATCH"),
    u("BLUE", "ssn", 2, [-42.6, -129.9], "SHADOW"),
    u("BLUE", "oiler", 1, [-45.0, -131.0], "WELL"),
    u("BLUE", "mcm_group", 1, [-39.6, -130.4], "SWEEP"),
    u("BLUE", "fighter_as", 4, [-41.0, -134.9], "VIPER", { spreadKm: 0 }),
    u("BLUE", "fighter_mr", 4, [-41.0, -134.9], "HAWK", { spreadKm: 0 }),
    u("BLUE", "bomber", 1, [-42.0, -138.0], "ANVIL"),
    u("BLUE", "aewc", 1, [-41.0, -134.9], "SKYEYE", { spreadKm: 0 }),
    u("BLUE", "tanker", 1, [-41.0, -134.9], "TEXACO", { spreadKm: 0 }),
    u("BLUE", "mpa", 1, [-41.0, -134.9], "ORCA", { spreadKm: 0 }),
    u("BLUE", "helo", 2, [-40.9, -133.9], "KESTREL", { spreadKm: 0 }),
    u("BLUE", "hale_isr", 1, [-41.0, -134.9], "HIGHWATCH", { spreadKm: 0 }),
    u("BLUE", "male_drone", 3, [-41.0, -134.9], "SPECTRE", { spreadKm: 0 }),
    u("BLUE", "cca", 2, [-41.0, -134.9], "WINGMAN", { spreadKm: 0 }),
    u("BLUE", "loitering_munition", 2, [-40.8, -133.3], "HORNET", { spreadKm: 0 }),
    u("BLUE", "usv", 2, [-41.9, -130.9], "SKIFF"),
    u("BLUE", "uuv", 2, [-41.6, -130.7], "EEL"),
    // Red — Corvane Union
    u("RED", "hq", 1, [-41.4, -123.0], "CORV-HQ"),
    u("RED", "ground_station", 1, [-43.0, -121.0], "CORV-GS"),
    u("RED", "launch_site", 1, [-38.5, -121.5], "CORV-LS"),
    u("RED", "cyber_unit", 1, [-41.5, -122.8], "SPIDER"),
    u("RED", "armored_bde", 1, [-40.8, -126.4], "BEAR"),
    u("RED", "mech_inf_bde", 2, [-41.3, -126.8], "WOLF"),
    u("RED", "light_inf_bde", 2, [-40.5, -127.3], "FALCON"),
    u("RED", "artillery_bn", 3, [-41.0, -127.0], "HAMMER"),
    u("RED", "shorad_bn", 2, [-40.9, -127.2], "WALL"),
    u("RED", "lrad_bn", 3, [-41.2, -126.6], "DOME"),
    u("RED", "coastal_ashm", 4, [-40.6, -127.6], "SPEAR"),
    u("RED", "log_convoy", 3, [-41.3, -125.5], "OX"),
    u("RED", "ew_bn", 2, [-40.9, -127.0], "STORMCLOUD"),
    u("RED", "decoy_group", 2, [-40.6, -127.0], "PHANTOM"),
    u("RED", "arg", 1, [-39.2, -128.4], "TIDE"),
    u("RED", "destroyer", 3, [-40.0, -128.6], "BLADE"),
    u("RED", "frigate", 2, [-39.6, -129.0], "PIKE"),
    u("RED", "ssk", 3, [-42.0, -128.8], "MORAY"),
    u("RED", "ssn", 1, [-43.5, -128.5], "KRAKEN"),
    u("RED", "oiler", 1, [-38.6, -128.0], "SPRING"),
    u("RED", "fighter_as", 4, [-41.1, -124.8], "FLANK", { spreadKm: 0 }),
    u("RED", "fighter_mr", 4, [-41.1, -124.8], "STRIKE", { spreadKm: 0 }),
    u("RED", "bomber", 2, [-40.0, -121.0], "BADGER"),
    u("RED", "aewc", 1, [-41.1, -124.8], "MAINSTAY", { spreadKm: 0 }),
    u("RED", "tanker", 1, [-41.1, -124.8], "CAMEL", { spreadKm: 0 }),
    u("RED", "mpa", 1, [-41.1, -124.8], "MAY", { spreadKm: 0 }),
    u("RED", "helo", 2, [-40.9, -126.0], "HIND", { spreadKm: 0 }),
    u("RED", "hale_isr", 1, [-41.1, -124.8], "ALTAIR", { spreadKm: 0 }),
    u("RED", "male_drone", 3, [-41.1, -124.8], "ORION", { spreadKm: 0 }),
    u("RED", "loitering_munition", 3, [-40.8, -126.5], "LANCET", { spreadKm: 0 }),
    u("RED", "quad_swarm", 2, [-40.8, -126.8], "GNAT", { spreadKm: 0 }),
    u("RED", "usv", 3, [-40.3, -128.9], "WASP"),
  ],
  space: [...space("BLUE", -135, "A"), ...space("RED", -120, "C")],
  environment: { seaState: "moderate", fronts: 2, startHourUtc: 6 },
  rules: { startEscalation: 2, tickMs: 60000 },
  injects: [
    { atH: 18, kind: "CONVOY", text: "A neutral merchant convoy enters the strait from the south.", at: [-46.6, -130.2] },
    { atH: 48, kind: "SAT_FAILURE", text: "An Aster imaging satellite suffers an on-orbit failure.", faction: "BLUE", target: "leo_imaging" },
    { atH: 72, kind: "STORM", text: "A deep storm front crosses the strait.", at: [-42, -128] },
    { atH: 120, kind: "CEASEFIRE_OFFER", text: "A neutral mediator proposes a 48-hour ceasefire." },
    { atH: 150, kind: "GNSS_OUTAGE", text: "Widespread GNSS interference over the strait.", faction: "BLUE", at: [-41, -130] },
  ],
};

// ---------------------------------------------------------------- Northern Plains
const plains = {
  id: "northern-plains", name: "Northern Plains", version: "1.0.0", scale: "Regional, 14 days",
  description: "The Dravic Federation drives south across the open plains of Tessaria toward the Hesk corridor. The Commonwealth of Lysa must hold with combined arms, drones and fragile supply lines.",
  teachingFocus: "Combined arms, logistics, attritable drones", domains: ["LAND", "AIR", "DRONE"], durationH: 336,
  map: {
    kind: "fictional", bbox: [-116, -48, -92, -30], center: [-39.5, -104], zoom: 4.6,
    land: [{ name: "Tessaria", ring: blob(-39.5, -104, 7.5, 10, 4, 26) }],
    cities: [
      { name: "Hesk", at: [-40.2, -104.5], faction: "BLUE" }, { name: "Lysa", at: [-44, -105], faction: "BLUE" },
      { name: "Dravograd", at: [-35.0, -103], faction: "RED" }, { name: "Orlen", at: [-37.2, -100.5], faction: "RED" },
    ],
    chokepoints: [],
  },
  factions: [
    { id: "BLUE", name: "Commonwealth of Lysa", will: 70, objectives: [
      { id: "B1", name: "Hold the Hesk corridor", kind: "CONTROL", domain: "LAND", center: [-40.2, -104.5], radiusKm: 40, weight: 2 },
      { id: "B2", name: "Protect Lysa", kind: "DENY", domain: "LAND", center: [-44, -105], radiusKm: 60, weight: 1 },
    ] },
    { id: "RED", name: "Dravic Federation", will: 68, objectives: [
      { id: "R1", name: "Seize the Hesk corridor", kind: "CONTROL", domain: "LAND", center: [-40.2, -104.5], radiusKm: 40, weight: 2 },
      { id: "R2", name: "Destroy forces in the Orlen salient", kind: "DESTROY", domain: "LAND", center: [-38.4, -101.5], radiusKm: 50, weight: 1 },
    ] },
  ],
  orbat: [
    u("BLUE", "hq", 1, [-43.0, -105.0], "LYSA-HQ"), u("BLUE", "ground_station", 1, [-44.5, -103], "LYSA-GS"),
    u("BLUE", "armored_bde", 2, [-40.8, -105.5], "STEEL"), u("BLUE", "mech_inf_bde", 3, [-40.6, -103.5], "GUARD"),
    u("BLUE", "light_inf_bde", 2, [-39.9, -104.6], "HILL"), u("BLUE", "artillery_bn", 3, [-41.2, -104.5], "BOOM"),
    u("BLUE", "shorad_bn", 3, [-40.9, -104.4], "UMBRELLA"), u("BLUE", "lrad_bn", 1, [-42.0, -104.8], "CANOPY"),
    u("BLUE", "engineer_bn", 2, [-40.7, -104.0], "SAPPER"), u("BLUE", "log_convoy", 5, [-42.2, -104.9], "CART"),
    u("BLUE", "ew_bn", 1, [-40.9, -104.9], "HUM"), u("BLUE", "ugv", 3, [-40.4, -104.3], "MULEBOT"),
    u("BLUE", "fighter_as", 3, [-43.5, -106.0], "EAGLE", { spreadKm: 0 }), u("BLUE", "fighter_mr", 3, [-43.5, -106.0], "FALCO", { spreadKm: 0 }),
    u("BLUE", "aewc", 1, [-43.5, -106.0], "LOOKOUT", { spreadKm: 0 }), u("BLUE", "tanker", 1, [-43.5, -106.0], "STRAW", { spreadKm: 0 }),
    u("BLUE", "airlifter", 1, [-43.5, -106.0], "DRAFT", { spreadKm: 0 }), u("BLUE", "helo", 3, [-41.5, -104.6], "WARHORSE", { spreadKm: 0 }),
    u("BLUE", "hale_isr", 1, [-43.5, -106.0], "SENTINEL", { spreadKm: 0 }), u("BLUE", "male_drone", 4, [-42.0, -104.0], "WATCHER", { spreadKm: 0 }),
    u("BLUE", "loitering_munition", 4, [-41.0, -104.2], "STINGER", { spreadKm: 0 }), u("BLUE", "quad_swarm", 3, [-40.6, -104.0], "BEE", { spreadKm: 0 }),
    u("RED", "hq", 1, [-35.6, -103.0], "DRAV-HQ"), u("RED", "ground_station", 1, [-34.0, -101.5], "DRAV-GS"),
    u("RED", "armored_bde", 3, [-37.6, -104.4], "TANK"), u("RED", "mech_inf_bde", 4, [-37.9, -103.0], "MARCH"),
    u("RED", "light_inf_bde", 1, [-38.3, -101.4], "SCOUT"), u("RED", "artillery_bn", 4, [-37.2, -103.6], "GROM"),
    u("RED", "shorad_bn", 3, [-37.6, -103.4], "NET"), u("RED", "lrad_bn", 2, [-36.5, -103.2], "VAULT"),
    u("RED", "engineer_bn", 1, [-37.8, -103.8], "DIGGER"), u("RED", "log_convoy", 5, [-36.4, -103.4], "YAK"),
    u("RED", "ew_bn", 2, [-37.6, -103.8], "BUZZ"), u("RED", "decoy_group", 3, [-37.9, -104.8], "GHOSTTANK"),
    u("RED", "fighter_as", 3, [-34.8, -104.2], "BLACKJACK", { spreadKm: 0 }), u("RED", "fighter_mr", 4, [-34.8, -104.2], "FENCER", { spreadKm: 0 }),
    u("RED", "aewc", 1, [-34.8, -104.2], "BEACON", { spreadKm: 0 }), u("RED", "helo", 3, [-36.9, -103.6], "HAVOC", { spreadKm: 0 }),
    u("RED", "male_drone", 4, [-36.0, -103.0], "FORPOST", { spreadKm: 0 }), u("RED", "loitering_munition", 6, [-37.4, -103.4], "CUBE", { spreadKm: 0 }),
    u("RED", "quad_swarm", 5, [-37.6, -103.6], "MOSQUITO", { spreadKm: 0 }), u("RED", "ugv", 2, [-37.7, -104.0], "IRONDOG"),
  ],
  space: [constellation("BLUE", "leo_imaging", 1, 3, 550, 97.6, "LEYE"), constellation("RED", "leo_imaging", 1, 2, 560, 97.6, "DEYE", 90),
    constellation("BLUE", "geo_satcom", 1, 1, 35786, 0, "LCOM", -104), constellation("RED", "geo_satcom", 1, 1, 35786, 0, "DCOM", -100)],
  environment: { seaState: "calm", fronts: 3, startHourUtc: 5 },
  rules: { startEscalation: 3, tickMs: 60000 },
  injects: [
    { atH: 36, kind: "STORM", text: "Spring storms turn the plains to mud.", at: [-39, -104] },
    { atH: 96, kind: "REINFORCE", text: "A Commonwealth reserve brigade arrives at Lysa.", faction: "BLUE", at: [-43.6, -105.2], target: "mech_inf_bde" },
    { atH: 200, kind: "CEASEFIRE_OFFER", text: "Regional powers call for a ceasefire." },
  ],
};

// ---------------------------------------------------------------- Archipelago
const islands = [
  ["Ostra", -50.2, -118.0], ["Calla", -51.0, -114.6], ["Brenn", -52.0, -111.2], ["Tavi", -53.0, -108.0],
  ["Morrow", -54.0, -104.8], ["Seld", -55.0, -101.6], ["Ivo", -55.8, -98.4],
];
const archipelago = {
  id: "archipelago", name: "Archipelago", version: "1.0.0", scale: "Regional, 21 days",
  description: "Two maritime powers contest the Tavi chain, a string of seven islands. Distributed forces must hop between islands while tankers and oilers set the limits of reach.",
  teachingFocus: "Distributed operations, tanker and supply limits", domains: ["SEA", "AIR", "LAND"], durationH: 504,
  map: {
    kind: "fictional", bbox: [-125, -60, -90, -45], center: [-53, -108], zoom: 4.2,
    land: [
      ...islands.map(([n, la, lo], i) => ({ name: n, ring: blob(la, lo, 0.45, 0.8, 10 + i, 16) })),
      { name: "Westmark", owner: "BLUE", ring: blob(-50.5, -123, 2.0, 2.8, 30) },
      { name: "Eastreach", owner: "RED", ring: blob(-57.0, -93.5, 2.0, 3.0, 31) },
    ],
    cities: [{ name: "Westmark Port", at: [-50.4, -121.6], faction: "BLUE" }, { name: "Eastreach Harbor", at: [-56.8, -95.6], faction: "RED" }],
    chokepoints: [{ name: "Tavi Passage", at: [-53.6, -106.4], radiusKm: 80 }],
  },
  factions: [
    { id: "BLUE", name: "Westmark League", will: 70, objectives: [
      { id: "B1", name: "Control Brenn", kind: "CONTROL", domain: "LAND", center: [-52.0, -111.2], radiusKm: 35, weight: 1 },
      { id: "B2", name: "Control Tavi", kind: "CONTROL", domain: "LAND", center: [-53.0, -108.0], radiusKm: 35, weight: 2 },
      { id: "B3", name: "Sea control of the Tavi Passage", kind: "CONTROL", domain: "SEA", center: [-53.6, -106.4], radiusKm: 100, weight: 1 },
    ] },
    { id: "RED", name: "Eastreach Compact", will: 70, objectives: [
      { id: "R1", name: "Control Morrow", kind: "CONTROL", domain: "LAND", center: [-54.0, -104.8], radiusKm: 35, weight: 1 },
      { id: "R2", name: "Control Tavi", kind: "CONTROL", domain: "LAND", center: [-53.0, -108.0], radiusKm: 35, weight: 2 },
      { id: "R3", name: "Deny the Tavi Passage", kind: "DENY", domain: "SEA", center: [-53.6, -106.4], radiusKm: 100, weight: 1 },
    ] },
  ],
  orbat: [
    u("BLUE", "hq", 1, [-50.5, -123.5], "WEST-HQ"), u("BLUE", "ground_station", 1, [-51.0, -124.5], "WEST-GS"),
    u("BLUE", "light_inf_bde", 1, [-52.0, -111.2], "MARINE", { spreadKm: 4 }), u("BLUE", "light_inf_bde", 1, [-51.0, -114.6], "ISLE", { spreadKm: 4 }),
    u("BLUE", "coastal_ashm", 2, [-51.0, -114.6], "REEF", { spreadKm: 6 }), u("BLUE", "shorad_bn", 1, [-52.0, -111.2], "ATOLL", { spreadKm: 4 }),
    u("BLUE", "lrad_bn", 1, [-50.2, -118.0], "LIGHTHOUSE", { spreadKm: 4 }),
    u("BLUE", "arg", 1, [-51.5, -116.5], "SURF"), u("BLUE", "csg", 1, [-52.5, -119.0], "RESOLUTE"),
    u("BLUE", "fighter_mr", 2, [-52.5, -119.0], "OSPREY", { spreadKm: 0 }),
    u("BLUE", "destroyer", 3, [-52.6, -113.5], "LANTERN"), u("BLUE", "frigate", 3, [-53.0, -111.0], "HERON"),
    u("BLUE", "ssn", 2, [-54.0, -110.0], "LURKER"), u("BLUE", "oiler", 2, [-51.6, -118.4], "FOUNT"), u("BLUE", "mcm_group", 1, [-53.2, -109.8], "BROOM"),
    u("BLUE", "fighter_as", 2, [-50.5, -122.8], "GULL", { spreadKm: 0 }), u("BLUE", "tanker", 2, [-50.5, -122.8], "CISTERN", { spreadKm: 0 }),
    u("BLUE", "aewc", 1, [-50.5, -122.8], "PERISCOPE", { spreadKm: 0 }), u("BLUE", "mpa", 2, [-50.5, -122.8], "ALBATROSS", { spreadKm: 0 }),
    u("BLUE", "hale_isr", 1, [-50.5, -122.8], "TOWER", { spreadKm: 0 }), u("BLUE", "usv", 3, [-52.8, -110.5], "DART"), u("BLUE", "uuv", 2, [-53.4, -108.4], "SQUID"),
    u("RED", "hq", 1, [-57.0, -92.5], "EAST-HQ"), u("RED", "ground_station", 1, [-57.5, -91.5], "EAST-GS"),
    u("RED", "light_inf_bde", 1, [-54.0, -104.8], "TIDEWATER", { spreadKm: 4 }), u("RED", "light_inf_bde", 1, [-55.0, -101.6], "SALT", { spreadKm: 4 }),
    u("RED", "coastal_ashm", 3, [-55.0, -101.6], "HARPOON", { spreadKm: 6 }), u("RED", "shorad_bn", 1, [-54.0, -104.8], "SHELL", { spreadKm: 4 }),
    u("RED", "lrad_bn", 1, [-55.8, -98.4], "CITADEL", { spreadKm: 4 }),
    u("RED", "arg", 1, [-55.2, -99.0], "BREAKER"), u("RED", "destroyer", 4, [-54.8, -103.0], "GALE"), u("RED", "frigate", 2, [-54.2, -102.5], "SQUALL"),
    u("RED", "ssk", 3, [-54.0, -106.0], "LAMPREY"), u("RED", "oiler", 2, [-56.0, -96.5], "BASIN"),
    u("RED", "fighter_as", 3, [-56.9, -94.0], "SKUA", { spreadKm: 0 }), u("RED", "fighter_mr", 3, [-56.9, -94.0], "TERN", { spreadKm: 0 }),
    u("RED", "bomber", 2, [-56.9, -94.0], "CONDOR", { spreadKm: 0 }), u("RED", "tanker", 1, [-56.9, -94.0], "FLASK", { spreadKm: 0 }),
    u("RED", "mpa", 1, [-56.9, -94.0], "PETREL", { spreadKm: 0 }), u("RED", "male_drone", 3, [-56.9, -94.0], "KITE", { spreadKm: 0 }),
    u("RED", "usv", 4, [-54.5, -102.0], "STING"),
  ],
  space: [constellation("BLUE", "leo_imaging", 1, 3, 550, 97.6, "WEYE", 200), constellation("RED", "leo_sar", 1, 3, 600, 97.4, "ESAR", 230),
    constellation("BLUE", "geo_satcom", 1, 1, 35786, 0, "WCOM", -115), constellation("RED", "geo_satcom", 1, 1, 35786, 0, "ECOM", -95)],
  environment: { seaState: "rough", fronts: 3, startHourUtc: 8 },
  rules: { startEscalation: 2, tickMs: 60000 },
  injects: [
    { atH: 30, kind: "CONVOY", text: "Neutral fishing fleet moves through the passage.", at: [-58.8, -106.4] },
    { atH: 100, kind: "STORM", text: "Southern Ocean gale.", at: [-54, -105] },
    { atH: 300, kind: "CEASEFIRE_OFFER", text: "Mediators propose talks." },
  ],
};

// ---------------------------------------------------------------- Dark Skies (global)
const darkSkies = {
  id: "dark-skies", name: "Dark Skies", version: "1.0.0", scale: "Global, 7 days",
  description: "A global confrontation between two distant continental powers opens in space and cyberspace. Fight with degraded navigation, communications and ISR while task groups race to the Halcyon Rise.",
  teachingFocus: "Fighting with degraded PNT, comms and ISR", domains: ["SPACE", "SEA", "AIR", "LAND", "DRONE"], durationH: 168,
  map: {
    kind: "fictional", bbox: [-150, -55, 110, -25], center: [-40, -20], zoom: 1.6,
    land: [
      { name: "Aurelia", owner: "BLUE", ring: blob(-38, -135, 6, 8, 40, 26) },
      { name: "Khoros", owner: "RED", ring: blob(-38, 95, 6, 8, 41, 26) },
      { name: "Halcyon Rise", ring: blob(-42, -25, 0.5, 0.8, 42, 14) },
    ],
    cities: [{ name: "Aurel", at: [-38, -134], faction: "BLUE" }, { name: "Khor", at: [-38, 96], faction: "RED" }],
    chokepoints: [{ name: "Halcyon Approaches", at: [-42, -25], radiusKm: 200 }],
  },
  factions: [
    { id: "BLUE", name: "Aurelian Federation", will: 70, objectives: [
      { id: "B1", name: "Control the Halcyon Rise", kind: "CONTROL", domain: "SEA", center: [-42, -25], radiusKm: 220, weight: 2 },
      { id: "B2", name: "Protect Aurelian ground stations", kind: "DENY", domain: "LAND", center: [-39, -137], radiusKm: 150, weight: 1 },
    ] },
    { id: "RED", name: "Khoros Directorate", will: 70, objectives: [
      { id: "R1", name: "Control the Halcyon Rise", kind: "CONTROL", domain: "SEA", center: [-42, -25], radiusKm: 220, weight: 2 },
      { id: "R2", name: "Protect Khoros ground stations", kind: "DENY", domain: "LAND", center: [-39, 93], radiusKm: 150, weight: 1 },
    ] },
  ],
  orbat: [
    u("BLUE", "hq", 1, [-38, -135], "AUR-HQ"), u("BLUE", "ground_station", 2, [-39, -137], "AUR-GS"), u("BLUE", "launch_site", 1, [-42, -133], "AUR-LS"),
    u("BLUE", "cyber_unit", 2, [-38.2, -135.2], "CIPHER"), u("BLUE", "ew_bn", 1, [-38.5, -134], "SCRAMBLE"), u("BLUE", "lrad_bn", 2, [-38.5, -135.5], "HALO"),
    u("BLUE", "csg", 1, [-44, -60], "INDOMITABLE"), u("BLUE", "fighter_mr", 2, [-44, -60], "CORSAIR", { spreadKm: 0 }), u("BLUE", "destroyer", 3, [-43.5, -58], "VANGUARD"),
    u("BLUE", "ssn", 2, [-42, -40], "SILENT"), u("BLUE", "oiler", 1, [-45, -62], "RIVER"),
    u("BLUE", "fighter_as", 2, [-38, -133], "ARROW", { spreadKm: 0 }), u("BLUE", "bomber", 2, [-38, -133], "STRATO", { spreadKm: 0 }),
    u("BLUE", "tanker", 2, [-38, -133], "OASIS", { spreadKm: 0 }), u("BLUE", "hale_isr", 2, [-38, -133], "ZENITH", { spreadKm: 0 }), u("BLUE", "mpa", 1, [-38, -133], "SEAHAWK", { spreadKm: 0 }),
    u("RED", "hq", 1, [-38, 95], "KHO-HQ"), u("RED", "ground_station", 2, [-39, 93], "KHO-GS"), u("RED", "launch_site", 2, [-41, 97], "KHO-LS"),
    u("RED", "cyber_unit", 2, [-38.2, 95.2], "WORM"), u("RED", "ew_bn", 2, [-38.4, 94], "STATICWALL"), u("RED", "lrad_bn", 2, [-38.5, 95.5], "BASTION"),
    u("RED", "destroyer", 4, [-43, 10], "TEMPEST"), u("RED", "frigate", 2, [-42.5, 8], "SPRAY"), u("RED", "ssn", 2, [-42, -10], "ABYSS"), u("RED", "oiler", 1, [-44, 12], "DELTA"),
    u("RED", "fighter_as", 2, [-38, 97], "RAPTOR", { spreadKm: 0 }), u("RED", "bomber", 3, [-38, 97], "THUNDERHEAD", { spreadKm: 0 }),
    u("RED", "tanker", 2, [-38, 97], "BARREL", { spreadKm: 0 }), u("RED", "hale_isr", 2, [-38, 97], "NADIR", { spreadKm: 0 }), u("RED", "mpa", 1, [-38, 97], "GULLWING", { spreadKm: 0 }),
  ],
  space: [
    ...space("BLUE", -130, "AU"), ...space("RED", 95, "KH"),
    constellation("BLUE", "leo_comms", 4, 6, 600, 70, "AUWEB", 45), constellation("RED", "leo_comms", 4, 6, 620, 70, "KHWEB", 65),
    constellation("BLUE", "geo_satcom", 1, 1, 35786, 0, "AUCOM2", -30), constellation("RED", "geo_satcom", 1, 1, 35786, 0, "KHCOM2", 0),
  ],
  environment: { seaState: "rough", fronts: 4, startHourUtc: 0 },
  rules: { startEscalation: 3, tickMs: 120000 },
  injects: [
    { atH: 6, kind: "CYBER_OUTAGE", text: "Cyber attack disrupts the Aurelian headquarters network.", faction: "BLUE" },
    { atH: 12, kind: "GNSS_OUTAGE", text: "GNSS jamming across the Halcyon Approaches.", faction: "BLUE", at: [-42, -25] },
    { atH: 30, kind: "SAT_FAILURE", text: "Khoros SATCOM satellite anomaly.", faction: "RED", target: "geo_satcom" },
    { atH: 96, kind: "CEASEFIRE_OFFER", text: "Back-channel talks open." },
  ],
};

// ---------------------------------------------------------------- Sandbox
const sandbox = {
  id: "sandbox", name: "Sandbox", version: "1.0.0", scale: "Any",
  description: "A small two-island free-play map for designers: a handful of units per domain to try orders, sensors and C2 effects.",
  teachingFocus: "Free play for designers", domains: ["LAND", "SEA", "AIR", "DRONE", "SPACE"], durationH: 72,
  map: {
    kind: "fictional", bbox: [-158, -42, -142, -30], center: [-36, -150], zoom: 5.5,
    land: [{ name: "West Isle", owner: "BLUE", ring: blob(-36, -154, 1.6, 2.0, 50) }, { name: "East Isle", owner: "RED", ring: blob(-36, -146, 1.6, 2.0, 51) }],
    cities: [{ name: "Westport", at: [-36, -153.2], faction: "BLUE" }, { name: "Eastport", at: [-36, -146.8], faction: "RED" }],
    chokepoints: [],
  },
  factions: [
    { id: "BLUE", name: "West Isle", will: 70, objectives: [{ id: "B1", name: "Control the channel", kind: "CONTROL", domain: "SEA", center: [-36, -150], radiusKm: 80, weight: 1 }] },
    { id: "RED", name: "East Isle", will: 70, objectives: [{ id: "R1", name: "Control the channel", kind: "CONTROL", domain: "SEA", center: [-36, -150], radiusKm: 80, weight: 1 }] },
  ],
  orbat: [
    u("BLUE", "hq", 1, [-36, -154.5], "W-HQ"), u("BLUE", "ground_station", 1, [-36.4, -154.8], "W-GS"), u("BLUE", "mech_inf_bde", 1, [-35.8, -153.4], "W-INF"),
    u("BLUE", "lrad_bn", 1, [-36.2, -153.6], "W-SAM"), u("BLUE", "destroyer", 2, [-36.2, -151.5], "W-DDG"), u("BLUE", "ssn", 1, [-35.4, -150.5], "W-SUB"),
    u("BLUE", "fighter_mr", 2, [-36, -154], "W-FTR", { spreadKm: 0 }), u("BLUE", "male_drone", 2, [-36, -154], "W-UAV", { spreadKm: 0 }), u("BLUE", "ew_bn", 1, [-36.1, -153.3], "W-EW"),
    u("RED", "hq", 1, [-36, -145.5], "E-HQ"), u("RED", "ground_station", 1, [-36.4, -145.2], "E-GS"), u("RED", "mech_inf_bde", 1, [-35.8, -146.6], "E-INF"),
    u("RED", "lrad_bn", 1, [-36.2, -146.4], "E-SAM"), u("RED", "frigate", 2, [-36.2, -148.4], "E-FFG"), u("RED", "ssk", 1, [-36.8, -149.5], "E-SUB"),
    u("RED", "fighter_mr", 2, [-36, -146], "E-FTR", { spreadKm: 0 }), u("RED", "quad_swarm", 2, [-35.9, -146.5], "E-SWM", { spreadKm: 0 }), u("RED", "coastal_ashm", 1, [-35.7, -147.0], "E-CDCM"),
  ],
  space: [constellation("BLUE", "leo_imaging", 1, 2, 550, 97.6, "WEYE"), constellation("RED", "leo_imaging", 1, 2, 550, 97.6, "EEYE", 90),
    constellation("BLUE", "geo_satcom", 1, 1, 35786, 0, "WCOM", -152), constellation("RED", "geo_satcom", 1, 1, 35786, 0, "ECOM", -148)],
  environment: { seaState: "moderate", fronts: 1, startHourUtc: 7 },
  rules: { startEscalation: 2, tickMs: 60000 },
  injects: [],
};

for (const s of [strait, plains, archipelago, darkSkies, sandbox]) {
  writeFileSync(join(out, `${s.id}.json`), JSON.stringify(s, null, 2) + "\n");
  const n = s.orbat.reduce((a, x) => a + x.count, 0) + s.space.reduce((a, c) => a + c.planes * c.perPlane, 0);
  console.log(`${s.id}: ${n} entities`);
}
