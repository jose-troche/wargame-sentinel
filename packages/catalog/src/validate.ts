// Scenario validation: schema, catalogue references and the notional-data guardrail (spec §10).
import { BANDS, RANGE_BANDS, SPEED_BANDS, ScenarioSchema, type Scenario } from "@sentinel/protocol";
import { ALL_CLASSES, CATALOG, hasClass } from "./catalog";

export interface ValidationResult {
  ok: boolean;
  scenario?: Scenario;
  errors: string[];
  warnings: string[];
}

/** Keys that, paired with a number, look like precise real-world performance data. */
const SUSPICIOUS_KEY = /(speed_?(kts|kmh|mps|knots)|range_?(km|nm|m)$|max_?range|pk$|p_?kill|rcs|thrust|warhead|yield|ceiling_?(ft|m)|frequency|mhz|ghz|cep|mach)/i;

/** Names that must never appear as commanders or targets. */
const REAL_PERSON_HINT = /\b([Pp]resident|[Pp]rime [Mm]inister|[Gg]eneral|[Aa]dmiral|[Cc]hairman|[Kk]ing|[Qq]ueen)\s+[A-Z][a-z]+/;

function walk(obj: unknown, path: string, out: string[]) {
  if (Array.isArray(obj)) obj.forEach((v, i) => walk(v, `${path}[${i}]`, out));
  else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === "number" && SUSPICIOUS_KEY.test(k)) {
        out.push(`${path}.${k}: numeric performance values are not allowed; use notional bands`);
      }
      if (typeof v === "string" && REAL_PERSON_HINT.test(v)) {
        out.push(`${path}.${k}: scenarios may not name real persons as commanders or targets`);
      }
      walk(v, `${path}.${k}`, out);
    }
  }
}

export function validateScenario(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  walk(raw, "$", errors);
  const parsed = ScenarioSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`${issue.path.join(".")}: ${issue.message}`);
    return { ok: false, errors, warnings };
  }
  const s = parsed.data;
  for (const u of s.orbat) if (!hasClass(u.cls)) errors.push(`orbat ${u.callsign}: unknown class ${u.cls}`);
  for (const c of s.space) {
    if (!hasClass(c.cls)) errors.push(`space ${c.callsign}: unknown class ${c.cls}`);
    else if (!ALL_CLASSES.find((x) => x.id === c.cls)?.tags.includes("ORBITAL")) errors.push(`space ${c.callsign}: ${c.cls} is not an orbital class`);
  }
  const factions = new Set(s.factions.map((f) => f.id));
  for (const f of ["BLUE", "RED"] as const) if (!factions.has(f)) errors.push(`factions: ${f} is required`);
  const total = s.orbat.reduce((n, u) => n + u.count, 0) + s.space.reduce((n, c) => n + c.planes * c.perPlane, 0);
  if (total > 5000) errors.push(`scenario has ${total} entities; the limit is 5,000`);
  if (total > 2000) warnings.push(`${total} entities: use a coarser tick for global scale`);
  return { ok: errors.length === 0, scenario: s, errors, warnings };
}

/** Checks the catalogue itself: every performance field must be a band. */
export function validateCatalog(): string[] {
  const errs: string[] = [];
  const isBand = (v: unknown) => (BANDS as readonly string[]).includes(v as string);
  const isRange = (v: unknown) => (RANGE_BANDS as readonly string[]).includes(v as string);
  const isSpeed = (v: unknown) => (SPEED_BANDS as readonly string[]).includes(v as string);
  for (const c of ALL_CLASSES) {
    if (!isSpeed(c.kinematics.speed) || !isSpeed(c.kinematics.maxSpeed)) errs.push(`${c.id}: speed must be a band`);
    for (const k of ["turn", "ceiling"] as const) if (!isBand(c.kinematics[k])) errs.push(`${c.id}: ${k} must be a band`);
    for (const [k, v] of Object.entries(c.signatures)) if (!isBand(v)) errs.push(`${c.id}: signature ${k} must be a band`);
    for (const [k, v] of Object.entries(c.defenses)) if (!isBand(v)) errs.push(`${c.id}: defense ${k} must be a band`);
    for (const s of c.sensors) if (!isRange(s.range) || !isBand(s.strength)) errs.push(`${c.id}: sensor bands invalid`);
    for (const e of c.effectors) if (!isRange(e.range) || !isBand(e.pk)) errs.push(`${c.id}: effector bands invalid`);
  }
  if (CATALOG.length !== 42) errs.push(`catalogue must hold 42 platform classes, has ${CATALOG.length}`);
  return errs;
}
