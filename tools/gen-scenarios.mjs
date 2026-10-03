// Generates the starter scenarios in /scenarios. Scenarios use real geography (Natural Earth 50m
// coastlines) with fictional factions, place names and forces — the spec's "real basemap with
// fictional actors". Run: pnpm --filter @sentinel/tools gen:scenarios
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "scenarios");
mkdirSync(out, { recursive: true });

const u = (faction, cls, count, at, callsign, extra = {}) => ({ faction, cls, count, at, callsign, spreadKm: count > 1 ? 12 : 0, ...extra });
const constellation = (faction, cls, planes, perPlane, altKm, incDeg, callsign, raanDeg = 0) => ({ faction, cls, planes, perPlane, altKm, incDeg, raanDeg, callsign });
const fixed = { spreadKm: 0 };

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

// ---------------------------------------------------------------- Strait Crisis — Bass Strait
const strait = {
  id: "strait-crisis",
  name: "Strait Crisis",
  version: "2.0.0",
  scale: "Regional, 10 days",
  description: "In the Bass Strait, the fictional Corvane Union moves from the northern coast to seize Meridian Island (Flinders Island). The fictional Republic of Aster, holding the southern island, must keep the strait open under an anti-access umbrella.",
  teachingFocus: "A2/AD, sea control, ISR revisit gaps",
  domains: ["SEA", "AIR", "SPACE", "DRONE"],
  durationH: 240,
  map: {
    kind: "real",
    bbox: [142.5, -44, 151, -36.8],
    center: [-40.1, 146.8],
    zoom: 6.1,
    land: [],
    cities: [
      { name: "Port Haldane", at: [-41.18, 146.36], faction: "BLUE" },
      { name: "Aster City", at: [-42.88, 147.33], faction: "BLUE" },
      { name: "Velmora", at: [-38.15, 145.95], faction: "RED" },
      { name: "Corvane Capital", at: [-37.85, 145.0], faction: "RED" },
    ],
    chokepoints: [{ name: "Meridian Strait", at: [-39.9, 146.6], radiusKm: 110 }],
  },
  factions: [
    { id: "BLUE", name: "Republic of Aster", will: 72, objectives: [
      { id: "B1", name: "Keep the Meridian Strait open", kind: "CONTROL", domain: "SEA", center: [-39.9, 146.6], radiusKm: 110, weight: 2 },
      { id: "B2", name: "Deny Meridian Island", kind: "DENY", domain: "LAND", center: [-40.0, 148.05], radiusKm: 35, weight: 1 },
    ] },
    { id: "RED", name: "Corvane Union", will: 70, objectives: [
      { id: "R1", name: "Seize Meridian Island", kind: "CONTROL", domain: "LAND", center: [-40.0, 148.05], radiusKm: 35, weight: 2 },
      { id: "R2", name: "Deny the strait to Aster", kind: "DENY", domain: "SEA", center: [-39.9, 146.6], radiusKm: 110, weight: 1 },
    ] },
  ],
  orbat: [
    // Blue — Republic of Aster (southern island)
    u("BLUE", "hq", 1, [-42.2, 146.9], "ASTER-HQ"),
    u("BLUE", "ground_station", 1, [-42.6, 147.3], "ASTER-GS"),
    u("BLUE", "launch_site", 1, [-42.0, 145.6], "ASTER-LS"),
    u("BLUE", "cyber_unit", 1, [-42.25, 146.95], "GHOST"),
    u("BLUE", "armored_bde", 1, [-41.45, 146.6], "IRON"),
    u("BLUE", "mech_inf_bde", 2, [-41.4, 147.3], "LANCER"),
    u("BLUE", "light_inf_bde", 1, [-41.15, 147.9], "RANGER"),
    u("BLUE", "artillery_bn", 2, [-41.35, 146.9], "THUNDER"),
    u("BLUE", "shorad_bn", 2, [-41.3, 147.1], "SHIELD"),
    u("BLUE", "lrad_bn", 2, [-41.4, 146.4], "AEGIS"),
    u("BLUE", "coastal_ashm", 2, [-41.25, 146.7], "TRIDENT"),
    u("BLUE", "engineer_bn", 1, [-41.6, 146.8], "BRIDGE"),
    u("BLUE", "log_convoy", 3, [-41.7, 147.0], "MULE"),
    u("BLUE", "ew_bn", 1, [-41.3, 147.6], "STATIC"),
    u("BLUE", "decoy_group", 2, [-41.3, 146.2], "MIRAGE"),
    u("BLUE", "csg", 1, [-41.4, 149.6], "VALIANT"),
    u("BLUE", "fighter_mr", 2, [-41.4, 149.6], "TALON", fixed),
    u("BLUE", "destroyer", 3, [-40.5, 148.9], "SENTRY"),
    u("BLUE", "frigate", 3, [-40.3, 146.6], "WATCH"),
    u("BLUE", "ssn", 2, [-39.6, 147.6], "SHADOW"),
    u("BLUE", "oiler", 1, [-42.2, 149.2], "WELL"),
    u("BLUE", "mcm_group", 1, [-40.6, 145.5], "SWEEP"),
    u("BLUE", "fighter_as", 4, [-41.54, 147.2], "VIPER", fixed),
    u("BLUE", "fighter_mr", 4, [-41.54, 147.2], "HAWK", fixed),
    u("BLUE", "bomber", 1, [-42.84, 147.5], "ANVIL", fixed),
    u("BLUE", "aewc", 1, [-41.54, 147.2], "SKYEYE", fixed),
    u("BLUE", "tanker", 1, [-41.54, 147.2], "TEXACO", fixed),
    u("BLUE", "mpa", 1, [-41.54, 147.2], "ORCA", fixed),
    u("BLUE", "helo", 2, [-41.4, 147.0], "KESTREL", fixed),
    u("BLUE", "hale_isr", 1, [-41.54, 147.2], "HIGHWATCH", fixed),
    u("BLUE", "male_drone", 3, [-41.54, 147.2], "SPECTRE", fixed),
    u("BLUE", "cca", 2, [-41.54, 147.2], "WINGMAN", fixed),
    u("BLUE", "loitering_munition", 2, [-41.3, 147.0], "HORNET", fixed),
    u("BLUE", "usv", 2, [-40.4, 147.5], "SKIFF"),
    u("BLUE", "uuv", 2, [-40.2, 147.2], "EEL"),
    // Red — Corvane Union (northern coast)
    u("RED", "hq", 1, [-37.9, 145.6], "CORV-HQ"),
    u("RED", "ground_station", 1, [-37.6, 144.6], "CORV-GS"),
    u("RED", "launch_site", 1, [-38.0, 147.1], "CORV-LS"),
    u("RED", "cyber_unit", 1, [-37.95, 145.7], "SPIDER"),
    u("RED", "armored_bde", 1, [-38.3, 146.3], "BEAR"),
    u("RED", "mech_inf_bde", 2, [-38.4, 146.0], "WOLF"),
    u("RED", "light_inf_bde", 2, [-38.6, 146.3], "FALCON"),
    u("RED", "artillery_bn", 3, [-38.5, 146.1], "HAMMER"),
    u("RED", "shorad_bn", 2, [-38.4, 146.5], "WALL"),
    u("RED", "lrad_bn", 3, [-38.3, 145.9], "DOME"),
    u("RED", "coastal_ashm", 4, [-38.97, 146.37], "SPEAR", { spreadKm: 3 }),
    u("RED", "log_convoy", 3, [-38.2, 145.8], "OX"),
    u("RED", "ew_bn", 2, [-38.5, 146.6], "STORMCLOUD"),
    u("RED", "decoy_group", 2, [-38.4, 146.8], "PHANTOM"),
    u("RED", "arg", 1, [-38.9, 147.6], "TIDE"),
    u("RED", "destroyer", 3, [-39.3, 147.0], "BLADE"),
    u("RED", "frigate", 2, [-39.4, 145.6], "PIKE"),
    u("RED", "ssk", 3, [-39.9, 145.9], "MORAY"),
    u("RED", "ssn", 1, [-40.4, 144.6], "KRAKEN"),
    u("RED", "oiler", 1, [-38.95, 148.4], "SPRING"),
    u("RED", "fighter_as", 4, [-38.1, 145.9], "FLANK", fixed),
    u("RED", "fighter_mr", 4, [-38.1, 145.9], "STRIKE", fixed),
    u("RED", "bomber", 2, [-37.7, 144.8], "BADGER", fixed),
    u("RED", "aewc", 1, [-38.1, 145.9], "MAINSTAY", fixed),
    u("RED", "tanker", 1, [-38.1, 145.9], "CAMEL", fixed),
    u("RED", "mpa", 1, [-38.1, 145.9], "MAY", fixed),
    u("RED", "helo", 2, [-38.4, 146.2], "HIND", fixed),
    u("RED", "hale_isr", 1, [-38.1, 145.9], "ALTAIR", fixed),
    u("RED", "male_drone", 3, [-38.1, 145.9], "ORION", fixed),
    u("RED", "loitering_munition", 3, [-38.5, 146.4], "LANCET", fixed),
    u("RED", "quad_swarm", 2, [-38.6, 146.2], "GNAT", fixed),
    u("RED", "usv", 3, [-39.2, 146.6], "WASP"),
  ],
  space: [...space("BLUE", 147, "A"), ...space("RED", 140, "C")],
  environment: { seaState: "moderate", fronts: 2, startHourUtc: 21 },
  rules: { startEscalation: 2, tickMs: 60000 },
  injects: [
    { atH: 18, kind: "CONVOY", text: "A neutral merchant convoy transits the strait from the east.", at: [-40.3, 150.6], target: "-39.6,143.0" },
    { atH: 48, kind: "SAT_FAILURE", text: "An Aster imaging satellite suffers an on-orbit failure.", faction: "BLUE", target: "leo_imaging" },
    { atH: 72, kind: "STORM", text: "A deep Southern Ocean front crosses the strait.", at: [-40.5, 145] },
    { atH: 120, kind: "CEASEFIRE_OFFER", text: "A neutral mediator proposes a 48-hour ceasefire." },
    { atH: 150, kind: "GNSS_OUTAGE", text: "Widespread GNSS interference over the strait.", faction: "BLUE", at: [-39.9, 146.6] },
  ],
};

// ---------------------------------------------------------------- Northern Plains — the Pampas
const plains = {
  id: "northern-plains", name: "Northern Plains", version: "2.0.0", scale: "Regional, 14 days",
  description: "On the open grasslands of the Pampas, the fictional Dravic Federation drives south toward the Hesk corridor. The fictional Commonwealth of Lysa must hold with combined arms, drones and fragile supply lines.",
  teachingFocus: "Combined arms, logistics, attritable drones", domains: ["LAND", "AIR", "DRONE"], durationH: 336,
  map: {
    kind: "real", bbox: [-67, -40, -57, -31], center: [-35.4, -62.5], zoom: 5.4, land: [],
    cities: [
      { name: "Hesk", at: [-35.6, -62.6], faction: "BLUE" }, { name: "Lysa", at: [-38.0, -62.4], faction: "BLUE" },
      { name: "Dravograd", at: [-32.6, -62.4], faction: "RED" }, { name: "Orlen", at: [-33.8, -61.0], faction: "RED" },
    ],
    chokepoints: [],
  },
  factions: [
    { id: "BLUE", name: "Commonwealth of Lysa", will: 70, objectives: [
      { id: "B1", name: "Hold the Hesk corridor", kind: "CONTROL", domain: "LAND", center: [-35.6, -62.6], radiusKm: 40, weight: 2 },
      { id: "B2", name: "Protect Lysa", kind: "DENY", domain: "LAND", center: [-38.0, -62.4], radiusKm: 60, weight: 1 },
    ] },
    { id: "RED", name: "Dravic Federation", will: 68, objectives: [
      { id: "R1", name: "Seize the Hesk corridor", kind: "CONTROL", domain: "LAND", center: [-35.6, -62.6], radiusKm: 40, weight: 2 },
      { id: "R2", name: "Destroy forces in the Orlen salient", kind: "DESTROY", domain: "LAND", center: [-34.4, -61.2], radiusKm: 50, weight: 1 },
    ] },
  ],
  orbat: [
    u("BLUE", "hq", 1, [-37.6, -62.8], "LYSA-HQ"), u("BLUE", "ground_station", 1, [-38.2, -61.6], "LYSA-GS"),
    u("BLUE", "armored_bde", 2, [-36.1, -63.2], "STEEL"), u("BLUE", "mech_inf_bde", 3, [-35.9, -62.0], "GUARD"),
    u("BLUE", "light_inf_bde", 2, [-35.4, -62.7], "HILL"), u("BLUE", "artillery_bn", 3, [-36.3, -62.6], "BOOM"),
    u("BLUE", "shorad_bn", 3, [-36.0, -62.5], "UMBRELLA"), u("BLUE", "lrad_bn", 1, [-36.9, -62.7], "CANOPY"),
    u("BLUE", "engineer_bn", 2, [-35.8, -62.3], "SAPPER"), u("BLUE", "log_convoy", 5, [-37.0, -62.6], "CART"),
    u("BLUE", "ew_bn", 1, [-36.0, -62.9], "HUM"), u("BLUE", "ugv", 3, [-35.6, -62.3], "MULEBOT"),
    u("BLUE", "fighter_as", 3, [-38.1, -63.4], "EAGLE", fixed), u("BLUE", "fighter_mr", 3, [-38.1, -63.4], "FALCO", fixed),
    u("BLUE", "aewc", 1, [-38.1, -63.4], "LOOKOUT", fixed), u("BLUE", "tanker", 1, [-38.1, -63.4], "STRAW", fixed),
    u("BLUE", "airlifter", 1, [-38.1, -63.4], "DRAFT", fixed), u("BLUE", "helo", 3, [-36.5, -62.6], "WARHORSE", fixed),
    u("BLUE", "hale_isr", 1, [-38.1, -63.4], "SENTINEL", fixed), u("BLUE", "male_drone", 4, [-37.0, -62.2], "WATCHER", fixed),
    u("BLUE", "loitering_munition", 4, [-36.1, -62.4], "STINGER", fixed), u("BLUE", "quad_swarm", 3, [-35.8, -62.2], "BEE", fixed),
    u("RED", "hq", 1, [-32.8, -62.6], "DRAV-HQ"), u("RED", "ground_station", 1, [-32.3, -61.8], "DRAV-GS"),
    u("RED", "armored_bde", 3, [-34.5, -62.9], "TANK"), u("RED", "mech_inf_bde", 4, [-34.6, -62.0], "MARCH"),
    u("RED", "light_inf_bde", 1, [-34.3, -61.2], "SCOUT"), u("RED", "artillery_bn", 4, [-34.1, -62.5], "GROM"),
    u("RED", "shorad_bn", 3, [-34.4, -62.4], "NET"), u("RED", "lrad_bn", 2, [-33.6, -62.4], "VAULT"),
    u("RED", "engineer_bn", 1, [-34.6, -62.6], "DIGGER"), u("RED", "log_convoy", 5, [-33.5, -62.5], "YAK"),
    u("RED", "ew_bn", 2, [-34.4, -62.7], "BUZZ"), u("RED", "decoy_group", 3, [-34.7, -63.4], "GHOSTTANK"),
    u("RED", "fighter_as", 3, [-32.4, -63.4], "BLACKJACK", fixed), u("RED", "fighter_mr", 4, [-32.4, -63.4], "FENCER", fixed),
    u("RED", "aewc", 1, [-32.4, -63.4], "BEACON", fixed), u("RED", "helo", 3, [-33.9, -62.6], "HAVOC", fixed),
    u("RED", "male_drone", 4, [-33.2, -62.0], "FORPOST", fixed), u("RED", "loitering_munition", 6, [-34.3, -62.3], "CUBE", fixed),
    u("RED", "quad_swarm", 5, [-34.5, -62.4], "MOSQUITO", fixed), u("RED", "ugv", 2, [-34.6, -62.3], "IRONDOG"),
  ],
  space: [constellation("BLUE", "leo_imaging", 1, 3, 550, 97.6, "LEYE"), constellation("RED", "leo_imaging", 1, 2, 560, 97.6, "DEYE", 90),
    constellation("BLUE", "geo_satcom", 1, 1, 35786, 0, "LCOM", -62), constellation("RED", "geo_satcom", 1, 1, 35786, 0, "DCOM", -58)],
  environment: { seaState: "calm", fronts: 3, startHourUtc: 9 },
  rules: { startEscalation: 3, tickMs: 60000 },
  injects: [
    { atH: 36, kind: "STORM", text: "Spring storms turn the plains to mud.", at: [-35.4, -62.5] },
    { atH: 96, kind: "REINFORCE", text: "A Commonwealth reserve brigade arrives at Lysa.", faction: "BLUE", at: [-37.9, -62.5], target: "mech_inf_bde" },
    { atH: 200, kind: "CEASEFIRE_OFFER", text: "Regional powers call for a ceasefire." },
  ],
};

// ---------------------------------------------------------------- Archipelago — Hawaiian chain
const archipelago = {
  id: "archipelago", name: "Archipelago", version: "2.0.0", scale: "Regional, 21 days",
  description: "Two fictional maritime powers contest the central islands of the Hawaiian chain: the Westmark League holds the western islands, the Eastreach Compact the large eastern island. Distributed forces hop between islands while tankers and oilers set the limits of reach.",
  teachingFocus: "Distributed operations, tanker and supply limits", domains: ["SEA", "AIR", "LAND"], durationH: 504,
  map: {
    kind: "real", bbox: [-161, 18.4, -154.4, 22.8], center: [20.8, -157.2], zoom: 6.2, land: [],
    cities: [{ name: "Westmark Port", at: [21.31, -157.86], faction: "BLUE" }, { name: "Eastreach Harbor", at: [19.72, -155.08], faction: "RED" }],
    chokepoints: [{ name: "Tavi Passage", at: [21.2, -157.35], radiusKm: 40 }, { name: "Alen Channel", at: [20.25, -156.0], radiusKm: 40 }],
  },
  factions: [
    { id: "BLUE", name: "Westmark League", will: 70, objectives: [
      { id: "B1", name: "Control Brenn (Molokai)", kind: "CONTROL", domain: "LAND", center: [21.13, -157.0], radiusKm: 30, weight: 1 },
      { id: "B2", name: "Control Tavi (Maui)", kind: "CONTROL", domain: "LAND", center: [20.8, -156.3], radiusKm: 35, weight: 2 },
      { id: "B3", name: "Sea control of the Tavi Passage", kind: "CONTROL", domain: "SEA", center: [21.2, -157.35], radiusKm: 45, weight: 1 },
    ] },
    { id: "RED", name: "Eastreach Compact", will: 70, objectives: [
      { id: "R1", name: "Control Morrow (Lanai)", kind: "CONTROL", domain: "LAND", center: [20.83, -156.92], radiusKm: 15, weight: 1 },
      { id: "R2", name: "Control Tavi (Maui)", kind: "CONTROL", domain: "LAND", center: [20.8, -156.3], radiusKm: 35, weight: 2 },
      { id: "R3", name: "Deny the Alen Channel", kind: "DENY", domain: "SEA", center: [20.25, -156.0], radiusKm: 45, weight: 1 },
    ] },
  ],
  orbat: [
    u("BLUE", "hq", 1, [21.45, -157.95], "WEST-HQ"), u("BLUE", "ground_station", 1, [22.05, -159.5], "WEST-GS"),
    u("BLUE", "light_inf_bde", 1, [21.13, -157.05], "MARINE", { spreadKm: 3 }), u("BLUE", "light_inf_bde", 1, [21.5, -158.0], "ISLE", { spreadKm: 3 }),
    u("BLUE", "coastal_ashm", 2, [21.3, -157.7], "REEF", { spreadKm: 4 }), u("BLUE", "shorad_bn", 1, [21.13, -157.1], "ATOLL", { spreadKm: 3 }),
    u("BLUE", "lrad_bn", 1, [21.4, -157.85], "LIGHTHOUSE", { spreadKm: 3 }),
    u("BLUE", "arg", 1, [21.15, -157.75], "SURF"), u("BLUE", "csg", 1, [21.9, -157.2], "RESOLUTE"),
    u("BLUE", "fighter_mr", 2, [21.9, -157.2], "OSPREY", fixed),
    u("BLUE", "destroyer", 3, [21.25, -157.4], "LANTERN"), u("BLUE", "frigate", 3, [21.4, -156.7], "HERON"),
    u("BLUE", "ssn", 2, [20.5, -157.4], "LURKER"), u("BLUE", "oiler", 2, [21.7, -158.3], "FOUNT"), u("BLUE", "mcm_group", 1, [21.15, -157.3], "BROOM"),
    u("BLUE", "fighter_as", 2, [21.48, -158.03], "GULL", fixed), u("BLUE", "tanker", 2, [21.48, -158.03], "CISTERN", fixed),
    u("BLUE", "aewc", 1, [21.48, -158.03], "PERISCOPE", fixed), u("BLUE", "mpa", 2, [21.48, -158.03], "ALBATROSS", fixed),
    u("BLUE", "hale_isr", 1, [21.48, -158.03], "TOWER", fixed), u("BLUE", "usv", 3, [21.0, -157.3], "DART"), u("BLUE", "uuv", 2, [20.9, -157.2], "SQUID"),
    u("RED", "hq", 1, [19.7, -155.4], "EAST-HQ"), u("RED", "ground_station", 1, [19.5, -155.6], "EAST-GS"),
    u("RED", "light_inf_bde", 1, [20.83, -156.92], "TIDEWATER", fixed), u("RED", "light_inf_bde", 1, [20.0, -155.7], "SALT", { spreadKm: 4 }),
    u("RED", "coastal_ashm", 3, [20.15, -155.8], "HARPOON", { spreadKm: 4 }), u("RED", "shorad_bn", 1, [20.82, -156.93], "SHELL", fixed),
    u("RED", "lrad_bn", 1, [19.9, -155.6], "CITADEL", { spreadKm: 3 }),
    u("RED", "arg", 1, [20.3, -155.4], "BREAKER"), u("RED", "destroyer", 4, [20.4, -156.2], "GALE"), u("RED", "frigate", 2, [20.15, -156.5], "SQUALL"),
    u("RED", "ssk", 3, [20.6, -157.0], "LAMPREY"), u("RED", "oiler", 2, [19.4, -156.2], "BASIN"),
    u("RED", "fighter_as", 3, [19.73, -155.05], "SKUA", fixed), u("RED", "fighter_mr", 3, [19.73, -155.05], "TERN", fixed),
    u("RED", "bomber", 2, [19.73, -155.05], "CONDOR", fixed), u("RED", "tanker", 1, [19.73, -155.05], "FLASK", fixed),
    u("RED", "mpa", 1, [19.73, -155.05], "PETREL", fixed), u("RED", "male_drone", 3, [19.73, -155.05], "KITE", fixed),
    u("RED", "usv", 4, [20.35, -156.35], "STING"),
  ],
  space: [constellation("BLUE", "leo_imaging", 1, 3, 550, 97.6, "WEYE", 200), constellation("RED", "leo_sar", 1, 3, 600, 97.4, "ESAR", 230),
    constellation("BLUE", "geo_satcom", 1, 1, 35786, 0, "WCOM", -160), constellation("RED", "geo_satcom", 1, 1, 35786, 0, "ECOM", -150)],
  environment: { seaState: "rough", fronts: 3, startHourUtc: 18 },
  rules: { startEscalation: 2, tickMs: 60000 },
  injects: [
    { atH: 30, kind: "CONVOY", text: "A neutral fishing fleet moves through the passage.", at: [21.0, -158.6], target: "21.25,-156.4" },
    { atH: 100, kind: "STORM", text: "A Pacific squall line crosses the islands.", at: [20.8, -157.0] },
    { atH: 300, kind: "CEASEFIRE_OFFER", text: "Mediators propose talks." },
  ],
};

// ---------------------------------------------------------------- Dark Skies — global, Indian Ocean
const darkSkies = {
  id: "dark-skies", name: "Dark Skies", version: "2.0.0", scale: "Global, 7 days",
  description: "A global confrontation between two fictional continental powers — the Aurelian Federation (Australia) and the Khoros Directorate (southern Africa) — opens in space and cyberspace. Fight with degraded navigation, communications and ISR while task groups race to the Kerguelen plateau.",
  teachingFocus: "Fighting with degraded PNT, comms and ISR", domains: ["SPACE", "SEA", "AIR", "LAND", "DRONE"], durationH: 168,
  map: {
    kind: "real", bbox: [10, -56, 156, -10], center: [-36, 82], zoom: 1.9, land: [],
    cities: [{ name: "Aurel", at: [-25.0, 133.0], faction: "BLUE" }, { name: "Khor", at: [-26.0, 28.0], faction: "RED" }],
    chokepoints: [{ name: "Halcyon Approaches", at: [-48.5, 72.0], radiusKm: 250 }],
  },
  factions: [
    { id: "BLUE", name: "Aurelian Federation", will: 70, objectives: [
      { id: "B1", name: "Control the Halcyon Rise", kind: "CONTROL", domain: "SEA", center: [-48.5, 72.0], radiusKm: 250, weight: 2 },
      { id: "B2", name: "Protect Aurelian ground stations", kind: "DENY", domain: "LAND", center: [-23.7, 133.8], radiusKm: 150, weight: 1 },
    ] },
    { id: "RED", name: "Khoros Directorate", will: 70, objectives: [
      { id: "R1", name: "Control the Halcyon Rise", kind: "CONTROL", domain: "SEA", center: [-48.5, 72.0], radiusKm: 250, weight: 2 },
      { id: "R2", name: "Protect Khoros ground stations", kind: "DENY", domain: "LAND", center: [-25.9, 27.7], radiusKm: 150, weight: 1 },
    ] },
  ],
  orbat: [
    u("BLUE", "hq", 1, [-25.0, 133.0], "AUR-HQ"), u("BLUE", "ground_station", 2, [-23.7, 133.8], "AUR-GS"), u("BLUE", "launch_site", 1, [-31.0, 136.8], "AUR-LS"),
    u("BLUE", "cyber_unit", 2, [-25.1, 133.2], "CIPHER"), u("BLUE", "ew_bn", 1, [-24.8, 133.5], "SCRAMBLE"), u("BLUE", "lrad_bn", 2, [-23.9, 133.6], "HALO"),
    u("BLUE", "csg", 1, [-36.0, 112.0], "INDOMITABLE"), u("BLUE", "fighter_mr", 2, [-36.0, 112.0], "CORSAIR", fixed), u("BLUE", "destroyer", 3, [-35.5, 111.0], "VANGUARD"),
    u("BLUE", "ssn", 2, [-42.0, 95.0], "SILENT"), u("BLUE", "oiler", 1, [-36.5, 113.0], "RIVER"),
    u("BLUE", "fighter_as", 2, [-31.9, 115.95], "ARROW", fixed), u("BLUE", "bomber", 2, [-31.9, 115.95], "STRATO", fixed),
    u("BLUE", "tanker", 2, [-31.9, 115.95], "OASIS", fixed), u("BLUE", "hale_isr", 2, [-31.9, 115.95], "ZENITH", fixed), u("BLUE", "mpa", 1, [-31.9, 115.95], "SEAHAWK", fixed),
    u("RED", "hq", 1, [-26.0, 28.0], "KHO-HQ"), u("RED", "ground_station", 2, [-25.9, 27.7], "KHO-GS"), u("RED", "launch_site", 2, [-28.5, 22.5], "KHO-LS"),
    u("RED", "cyber_unit", 2, [-26.1, 28.2], "WORM"), u("RED", "ew_bn", 2, [-26.2, 27.9], "STATICWALL"), u("RED", "lrad_bn", 2, [-25.8, 27.9], "BASTION"),
    u("RED", "destroyer", 4, [-36.0, 33.0], "TEMPEST"), u("RED", "frigate", 2, [-36.5, 31.0], "SPRAY"), u("RED", "ssn", 2, [-42.0, 45.0], "ABYSS"), u("RED", "oiler", 1, [-36.0, 34.0], "DELTA"),
    u("RED", "fighter_as", 2, [-33.97, 25.6], "RAPTOR", fixed), u("RED", "bomber", 3, [-33.97, 25.6], "THUNDERHEAD", fixed),
    u("RED", "tanker", 2, [-33.97, 25.6], "BARREL", fixed), u("RED", "hale_isr", 2, [-33.97, 25.6], "NADIR", fixed), u("RED", "mpa", 1, [-33.97, 25.6], "GULLWING", fixed),
  ],
  space: [
    ...space("BLUE", 130, "AU"), ...space("RED", 25, "KH"),
    constellation("BLUE", "leo_comms", 4, 6, 600, 70, "AUWEB", 45), constellation("RED", "leo_comms", 4, 6, 620, 70, "KHWEB", 65),
    constellation("BLUE", "geo_satcom", 1, 1, 35786, 0, "AUCOM2", 80), constellation("RED", "geo_satcom", 1, 1, 35786, 0, "KHCOM2", 60),
  ],
  environment: { seaState: "rough", fronts: 4, startHourUtc: 0 },
  rules: { startEscalation: 3, tickMs: 120000 },
  injects: [
    { atH: 6, kind: "CYBER_OUTAGE", text: "Cyber attack disrupts the Aurelian headquarters network.", faction: "BLUE" },
    { atH: 12, kind: "GNSS_OUTAGE", text: "GNSS jamming across the Halcyon Approaches.", faction: "BLUE", at: [-48.5, 72.0] },
    { atH: 30, kind: "SAT_FAILURE", text: "Khoros SATCOM satellite anomaly.", faction: "RED", target: "geo_satcom" },
    { atH: 96, kind: "CEASEFIRE_OFFER", text: "Back-channel talks open." },
  ],
};

// ---------------------------------------------------------------- Sandbox — Cook Strait
const sandbox = {
  id: "sandbox", name: "Sandbox", version: "2.0.0", scale: "Any",
  description: "A small free-play map across Cook Strait: two fictional island states with a handful of units per domain to try orders, sensors and C2 effects.",
  teachingFocus: "Free play for designers", domains: ["LAND", "SEA", "AIR", "DRONE", "SPACE"], durationH: 72,
  map: {
    kind: "real", bbox: [172.4, -42.4, 176.4, -40.2], center: [-41.35, 174.4], zoom: 7.4, land: [],
    cities: [{ name: "Southport", at: [-41.52, 173.95], faction: "BLUE" }, { name: "Northport", at: [-41.29, 174.78], faction: "RED" }],
    chokepoints: [{ name: "The Narrows", at: [-41.4, 174.5], radiusKm: 25 }],
  },
  factions: [
    { id: "BLUE", name: "South Isle", will: 70, objectives: [{ id: "B1", name: "Control the channel", kind: "CONTROL", domain: "SEA", center: [-41.45, 174.55], radiusKm: 35, weight: 1 }] },
    { id: "RED", name: "North Isle", will: 70, objectives: [{ id: "R1", name: "Control the channel", kind: "CONTROL", domain: "SEA", center: [-41.45, 174.55], radiusKm: 35, weight: 1 }] },
  ],
  orbat: [
    u("BLUE", "hq", 1, [-41.7, 173.4], "S-HQ"), u("BLUE", "ground_station", 1, [-41.8, 173.2], "S-GS"), u("BLUE", "mech_inf_bde", 1, [-41.6, 173.8], "S-INF"),
    u("BLUE", "lrad_bn", 1, [-41.65, 173.6], "S-SAM"), u("BLUE", "destroyer", 2, [-41.6, 174.5], "S-DDG"), u("BLUE", "ssn", 1, [-41.9, 174.7], "S-SUB"),
    u("BLUE", "fighter_mr", 2, [-41.52, 173.87], "S-FTR", fixed), u("BLUE", "male_drone", 2, [-41.52, 173.87], "S-UAV", fixed), u("BLUE", "ew_bn", 1, [-41.55, 173.95], "S-EW"),
    u("RED", "hq", 1, [-40.95, 175.6], "N-HQ"), u("RED", "ground_station", 1, [-41.1, 175.4], "N-GS"), u("RED", "mech_inf_bde", 1, [-41.15, 175.0], "N-INF"),
    u("RED", "lrad_bn", 1, [-41.2, 175.1], "N-SAM"), u("RED", "frigate", 2, [-41.4, 174.85], "N-FFG"), u("RED", "ssk", 1, [-41.15, 174.3], "N-SUB"),
    u("RED", "fighter_mr", 2, [-41.12, 175.05], "N-FTR", fixed), u("RED", "quad_swarm", 2, [-41.2, 174.95], "N-SWM", fixed), u("RED", "coastal_ashm", 1, [-41.25, 174.75], "N-CDCM"),
  ],
  space: [constellation("BLUE", "leo_imaging", 1, 2, 550, 97.6, "SEYE"), constellation("RED", "leo_imaging", 1, 2, 550, 97.6, "NEYE", 90),
    constellation("BLUE", "geo_satcom", 1, 1, 35786, 0, "SCOM", 172), constellation("RED", "geo_satcom", 1, 1, 35786, 0, "NCOM", 176)],
  environment: { seaState: "moderate", fronts: 1, startHourUtc: 20 },
  rules: { startEscalation: 2, tickMs: 60000 },
  injects: [],
};

for (const s of [strait, plains, archipelago, darkSkies, sandbox]) {
  writeFileSync(join(out, `${s.id}.json`), JSON.stringify(s, null, 2) + "\n");
  const n = s.orbat.reduce((a, x) => a + x.count, 0) + s.space.reduce((a, c) => a + c.planes * c.perPlane, 0);
  console.log(`${s.id}: ${n} entities`);
}
