import { z } from "zod";
import { FACTIONS, TASKS, AUTONOMY } from "./core";

const LatLon = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);

export const ScenarioSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  version: z.string(),
  scale: z.string(),
  description: z.string(),
  teachingFocus: z.string(),
  domains: z.array(z.string()),
  durationH: z.number().int().positive().max(24 * 30),
  map: z.object({
    kind: z.enum(["fictional", "real"]),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    center: LatLon,
    zoom: z.number(),
    /** Fictional landmasses: [lon, lat] rings, like GeoJSON. */
    land: z.array(z.object({ name: z.string(), owner: z.enum(FACTIONS).optional(), ring: z.array(z.tuple([z.number(), z.number()])).min(3) })),
    cities: z.array(z.object({ name: z.string(), at: LatLon, faction: z.enum(FACTIONS) })).default([]),
    chokepoints: z.array(z.object({ name: z.string(), at: LatLon, radiusKm: z.number() })).default([]),
  }),
  factions: z.array(
    z.object({
      id: z.enum(FACTIONS),
      name: z.string(),
      will: z.number().min(0).max(100),
      objectives: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          kind: z.enum(["CONTROL", "DESTROY", "DENY"]),
          domain: z.enum(["LAND", "SEA", "ANY"]).default("ANY"),
          center: LatLon,
          radiusKm: z.number().positive(),
          weight: z.number().positive().default(1),
        }),
      ),
    }),
  ),
  orbat: z.array(
    z.object({
      faction: z.enum(FACTIONS),
      cls: z.string(),
      count: z.number().int().positive().max(500),
      at: LatLon,
      spreadKm: z.number().nonnegative().default(10),
      callsign: z.string(),
      readiness: z.enum(["low", "medium", "high"]).default("high"),
      supplyDays: z.number().nonnegative().max(60).default(10),
      task: z.enum(TASKS).default("HOLD"),
      autonomy: z.enum(AUTONOMY).default("MISSION"),
      decoy: z.boolean().default(false),
    }),
  ),
  space: z
    .array(
      z.object({
        faction: z.enum(FACTIONS),
        cls: z.string(),
        planes: z.number().int().positive().max(12),
        perPlane: z.number().int().positive().max(24),
        altKm: z.number().positive(),
        incDeg: z.number().min(0).max(180),
        raanDeg: z.number().default(0),
        callsign: z.string(),
      }),
    )
    .default([]),
  environment: z
    .object({
      seaState: z.enum(["calm", "moderate", "rough"]).default("moderate"),
      fronts: z.number().int().min(0).max(8).default(2),
      startHourUtc: z.number().min(0).max(23).default(6),
    })
    .default({ seaState: "moderate", fronts: 2, startHourUtc: 6 }),
  rules: z
    .object({
      startEscalation: z.number().int().min(0).max(5).default(1),
      tickMs: z.number().int().positive().default(60_000),
      neuronGrant: z.number().int().nonnegative().optional(),
    })
    .default({ startEscalation: 1, tickMs: 60_000 }),
  injects: z
    .array(
      z.object({
        atH: z.number().nonnegative(),
        kind: z.enum(["CONVOY", "SAT_FAILURE", "CEASEFIRE_OFFER", "STORM", "CYBER_OUTAGE", "GNSS_OUTAGE", "REINFORCE"]),
        text: z.string(),
        faction: z.enum(FACTIONS).optional(),
        at: LatLon.optional(),
        target: z.string().optional(),
      }),
    )
    .default([]),
});
export type Scenario = z.infer<typeof ScenarioSchema>;
export type ScenarioInput = z.input<typeof ScenarioSchema>;

export interface ScenarioSummary {
  id: string;
  name: string;
  version: string;
  scale: string;
  description: string;
  teachingFocus: string;
  domains: string[];
  entities: number;
}
