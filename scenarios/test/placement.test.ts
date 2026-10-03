import { describe, expect, it } from "vitest";
import { getClass } from "@sentinel/catalog";
import { WorldMap } from "@sentinel/engine";
import { SCENARIOS } from "../index";

// Real coastlines (Natural Earth 50m): land forces start on land, ships at sea, airbases on land.
describe.each(SCENARIOS.map((s) => [s.id, s] as const))("%s placement", (_id, s) => {
  const map = new WorldMap(s, 1);
  it("puts every unit on the right side of the coast", () => {
    const bad: string[] = [];
    for (const u of s.orbat) {
      const c = getClass(u.cls);
      const land = map.isLand(u.at[0], u.at[1]);
      const sea = c.domain === "SEA" || u.cls === "usv" || u.cls === "uuv";
      const carrierAir = (c.domain === "AIR" || c.domain === "DRONE") && s.orbat.some((x) => x.cls === "csg" && x.faction === u.faction && x.at[0] === u.at[0] && x.at[1] === u.at[1]);
      if (sea && land) bad.push(`${u.callsign} (${u.cls}) is on land at ${u.at}`);
      if (!sea && !carrierAir && !land) bad.push(`${u.callsign} (${u.cls}) is at sea at ${u.at}`);
    }
    expect(bad).toEqual([]);
  });
  it("puts land objectives on land and sea objectives at sea", () => {
    for (const f of s.factions) for (const o of f.objectives) {
      if (o.domain === "LAND") expect(map.isLand(o.center[0], o.center[1]), o.name).toBe(true);
      if (o.domain === "SEA") expect(map.isLand(o.center[0], o.center[1]), o.name).toBe(false);
    }
  });
});
