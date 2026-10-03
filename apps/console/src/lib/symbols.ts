// APP-6/2525-style unit symbols via milsymbol, rendered once per (affiliation, class) and cached.
// Frame shape encodes affiliation (rectangle friend, diamond hostile, square neutral, quatrefoil unknown),
// so faction is never conveyed by color alone.
import ms from "milsymbol";
import { getClass, hasClass } from "@sentinel/catalog";
import { FACTION_COLORS, type Domain, type Faction, type View } from "@sentinel/protocol";

export type Affil = "F" | "H" | "N" | "U";

const DOMAIN_SIDC: Record<Domain, string> = {
  LAND: "S?GPU-------", SEA: "S?SP--------", AIR: "S?AP--------", DRONE: "S?APMFQ-----", SPACE: "S?PP--------",
};

export function sidcFor(cls: string | undefined, domain: Domain, affil: Affil): string {
  const base = cls && hasClass(cls) ? getClass(cls).sidc : DOMAIN_SIDC[domain];
  return (base.replace("?", affil) + "---------------").slice(0, 15);
}

export function affiliationOf(faction: Faction, view: View): Affil {
  if (view === "WHITE") return faction === "BLUE" ? "F" : faction === "RED" ? "H" : "N";
  if (faction === view) return "F";
  return faction === "GREEN" ? "N" : "H";
}

export function fillFor(affil: Affil, faction: Faction | undefined, view: View): string {
  if (view === "WHITE" && faction) return FACTION_COLORS[faction];
  if (affil === "F") return view === "RED" ? FACTION_COLORS.RED : FACTION_COLORS.BLUE;
  if (affil === "H") return view === "RED" ? FACTION_COLORS.BLUE : FACTION_COLORS.RED;
  if (affil === "N") return FACTION_COLORS.GREEN;
  return FACTION_COLORS.UNKNOWN;
}

const cache = new Map<string, { canvas: HTMLCanvasElement; anchor: { x: number; y: number } }>();

/** key format: `${affil}|${cls or domain}|${fill}` */
export function symbolCanvas(key: string, size = 22) {
  const hit = cache.get(key);
  if (hit) return hit;
  const [affil, clsOrDomain, fill] = key.split("|");
  const domain = (["LAND", "SEA", "AIR", "DRONE", "SPACE"].includes(clsOrDomain) ? clsOrDomain : "LAND") as Domain;
  const cls = hasClass(clsOrDomain) ? clsOrDomain : undefined;
  const sym = new ms.Symbol(sidcFor(cls, cls ? getClass(cls).domain : domain, affil as Affil), { size, fillColor: fill, outlineWidth: 2, outlineColor: "rgba(0,0,0,0.55)" });
  const out = { canvas: sym.asCanvas(2), anchor: sym.getAnchor() };
  cache.set(key, out);
  return out;
}

export function symbolKey(affil: Affil, clsOrDomain: string, fill: string) {
  return `${affil}|${clsOrDomain}|${fill}`;
}

export function symbolDataUrl(key: string, size = 22): string {
  return symbolCanvas(key, size).canvas.toDataURL();
}
