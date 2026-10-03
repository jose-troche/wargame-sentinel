# WARFARE SENTINEL — Multi-Agent Global Warfare Simulator: System Specification

Oct 2, 2026 · @Jose

## 1. Purpose and scope

WARFARE SENTINEL is a multi-domain, multi-agent wargame in which AI agents (and optional human players) command notional forces across land, sea, air, drone and space domains on a global map. It exists to teach and explore how joint operations behave as systems: how sensing, command latency, logistics and attrition interact, and where the decisive constraints sit.

**Intended users**

- Educators and students in strategy, international relations and systems engineering courses.
- Game designers and analysts running "what-if" studies on abstract force structures.
- AI researchers studying hierarchical multi-agent coordination under uncertainty, deception and degraded communications.

**In scope**

- Strategic (national), operational (theater) and tactical (unit) decision layers, each run by agents.
- Five physical domains plus cyber and electronic warfare (EW) as effects layers.
- Fog of war: every faction acts on its own picture, never on ground truth.
- A web console with graphical consoles that make the underlying concepts visible.
- Deterministic replay, after-action review (AAR) and batch Monte Carlo runs.

**Non-goals**

- Not a targeting, mission-planning or decision-support tool for real operations.
- No connection to real command-and-control, sensor or weapon systems, and no live feeds of real force positions.
- No classified, export-controlled or real-world-sourced performance data.

**Notional-data principle.** Every asset parameter is a game-balanced band (for example "speed: fast", "range: long") calibrated for plausible relative behavior, not engineering accuracy. Scenarios default to fictional factions, and can use a fictional continent or a real basemap with fictional actors.

## 2. Simulation model

The world is a WGS84 globe indexed by an H3 hexagonal grid, advanced by a hybrid clock, and judged by a single authoritative adjudicator so that every agent sees the consequences of its orders but only through its own sensors.

**Spatial model**

| Layer | H3 resolution | Cell area (approx.) | Used for |
| --- | --- | --- | --- |
| Strategic | 3 | \~12,000 km² | National objectives, theater control, weather fronts |
| Operational | 5 | \~250 km² | Formation movement, air defense zones, sea areas |
| Tactical | 7 | \~5 km² | Unit engagement, terrain effects, drone patrols |

Each cell carries terrain class, elevation band, land cover, urban density, coast flag, ocean depth band, sea state and a weather cell reference. Air and space entities hold continuous latitude, longitude and altitude; the grid is used only for spatial queries.

**Time model**

- Discrete-event core with three nested ticks: strategic 1 h, operational 10 min, tactical 1 min (simulated time).
- Time compression from 1x to 3600x; the World Engine skips quiet periods by jumping to the next scheduled event.
- Orbital positions are computed analytically for any timestamp, so space assets never need per-tick stepping.

**Domains and effects layers**

- **Land** — maneuver, fires, air defense, sustainment over terrain and road networks.
- **Sea** — surface and subsurface, with sea lanes, chokepoints and acoustic layers.
- **Air** — sorties from bases or carriers, combat air patrols, tanking, strike and ISR.
- **Drones** — uncrewed systems in every medium (air, surface, undersea, ground), from long-endurance ISR to swarms.
- **Space** — ISR, communications, navigation (PNT) and missile warning constellations, plus ground segments.
- **Cyber / EW** — not a place but a set of modifiers that degrade sensors, communications, navigation and C2 latency.
- **Information / political** — national will, alliance cohesion and escalation level, which constrain what strategic agents may order.

**Fog of war.** Ground truth lives only inside the World Engine. Each faction holds a Common Operational Picture (COP) of tracks with a quality level (Detected → Classified → Identified → Tracked), an uncertainty ellipse and an age. Tracks decay when sensors lose contact, and deception (decoys, emissions control, spoofing) can create false tracks.

**Factions.** Blue and Red (opposing), Green (neutral or third parties, also agent-driven) and White (control cell: environment, adjudication, scenario injects).

**Adjudication.** A White-cell Adjudicator resolves every interaction with a seeded random number generator, so a run with the same seed, scenario and orders reproduces exactly.

## 3. Multi-agent architecture

Agents are arranged as a command hierarchy per faction, mirroring joint military structure, with expensive language-model reasoning concentrated at the top and cheap, fast rule-based behavior at the bottom.

&#91;embedded content: agent hierarchy · one faction plus the White cell\]

LLM reasoning sits in the top three tiers; tactical controllers run fast behavior trees, and only the White cell ever touches ground truth.

**Agent tiers**

| Tier | Example agents | Decision cadence (sim time) | Reasoning engine | Typical output |
| --- | --- | --- | --- | --- |
| Strategic | National Command Authority (NCA) | Every 6–24 h or on trigger | LLM with structured output | Objectives, rules of engagement (ROE), escalation limits, resource priorities |
| Operational | Joint Force Commander; Land, Maritime, Air, Space and Cyber/EW component commanders | Every 1–6 h or on trigger | LLM plan proposal + utility scoring | Campaign phases, task organization, operation orders |
| Staff | Intelligence (J2), Logistics (J4), Plans (J5), Communications (J6) | Continuous, event-driven | Deterministic fusion and optimization; LLM for summaries | Fused COP, sustainment forecasts, courses of action, network status |
| Tactical | Brigade, task group, air wing, squadron, swarm, constellation controllers | Every tactical tick | Behavior trees + utility AI | Movement, sensor modes, engagement requests |
| Entity | Individual platforms and formations | Physics step | None (state only) | Telemetry to the World Engine |
| White cell | Scenario Director, Adjudicator, World Engine, Environment, AAR Analyst | Every tick / on event | Deterministic (Analyst uses LLM) | Ground truth, outcomes, injects, narrative |

**Role responsibilities**

- **National Command Authority** sets end states (for example "restore control of Strait X within 10 days"), approves escalation steps and arbitrates resources between components. It cannot move units directly.
- **Joint Force Commander** turns objectives into a phased campaign, assigns supported and supporting components, and resolves conflicts such as two components wanting the same ISR satellite pass.
- **Component commanders** own one domain each: Land (maneuver and fires), Maritime (sea control, undersea), Air (air tasking order, tanking, strike), Space (constellation tasking, launch, space situational awareness) and Cyber/EW (jamming, deception, network defense).
- **J2 Intelligence** fuses raw detections into tracks, estimates enemy intent and flags confidence. It is the only path by which sensor data reaches commanders.
- **J4 Logistics** forecasts fuel, munitions and spares, and vetoes or warns on plans that exceed sustainment.
- **J5 Plans** generates and war-games two or three courses of action against the J2 estimate before the commander picks one.
- **J6 Communications** models the faction's C2 network and reports which units are reachable and with what delay.
- **Tactical controllers** execute orders with local autonomy: they choose routes, formations, emissions posture and engagement timing inside the ROE.

**Design rules**

- An agent sees only its faction's COP filtered to its echelon; ground truth is never exposed outside the White cell.
- Every agent seat can be taken over by a human at runtime, and handed back.
- Each agent has a reasoning budget (LLM calls per sim-day) and degrades gracefully to its rule-based fallback when the budget is spent or the model is unavailable.
- Agents must justify each order with a short structured rationale, which the console displays.

## 4. Agent communication and C2 modeling

Agents never call each other directly: every order and report travels as a typed message over a simulated C2 network, so jamming, satellite loss or a destroyed headquarters delays or drops traffic exactly as it would degrade a real chain of command.

&#91;embedded content: C2 routing · an order rerouted around a jammed link\]

The order still arrives, but later; if no path survives, the unit keeps executing its last order under its autonomy level.

**Message families**

| Family | Direction | Examples | Delivered via |
| --- | --- | --- | --- |
| Orders | Down | OPORD (full plan), FRAGO (change), ATO (air tasking), Space Tasking Order, ROE update | Simulated C2 network |
| Reports | Up | SITREP, SPOTREP, INTSUM, LOGSTAT, BDA (battle damage assessment) | Simulated C2 network |
| Coordination | Lateral | Support request, deconfliction, airspace control, fires clearance | Simulated C2 network |
| Adjudication | White → all | Detection, engagement result, entity destroyed, weather change | Direct (out of band) |
| Control | White ↔ agents | Pause, inject, budget update, human takeover | Direct (out of band) |

**Envelope schema**

```json
{
  "id": "msg_01J9...",
  "sim_time": "D+3T14:20Z",
  "faction": "BLUE",
  "from": "blue.jfacc",
  "to": ["blue.wing.12"],
  "family": "ORDER",
  "type": "FRAGO",
  "priority": "IMMEDIATE",
  "classification_tier": "FACTION",
  "path_hint": ["SATCOM", "LOS_DATALINK"],
  "body": {
    "task": "CAP",
    "area_h3": "85283473fffffff",
    "window": ["D+3T15:00Z", "D+3T19:00Z"],
    "roe": "WEAPONS_TIGHT"
  },
  "rationale": "Cover tanker track ALPHA against detected fighter activity.",
  "correlation_id": "opord_blue_007"
}
```

**C2 network model**

- Each faction has a graph of nodes (headquarters, units, ground stations, satellites, relay aircraft) and links (fiber, HF radio, line-of-sight datalink, SATCOM, laser crosslink).
- Each link has bandwidth class, base latency, reliability and vulnerability to jamming, cyber effects and physical destruction.
- The J6 agent routes each message along the best available path; delivery time is the sum of link latencies plus queueing, and failure probability compounds per hop.
- Messages to an unreachable unit are held; the unit keeps executing its last order under its own autonomy level (Strict, Mission-type, Full).

**Interaction protocol (one operational cycle)**

1. World Engine publishes sensor detections to each faction's J2.
2. J2 fuses detections into the COP and issues an INTSUM.
3. J5 proposes courses of action; J4 checks sustainment.
4. Commander selects a course of action and issues orders with rationale.
5. Orders traverse the C2 network to tactical controllers.
6. Tactical controllers act; the Adjudicator resolves outcomes.
7. Results return as reports up the chain and as AAR events to the White cell.

## 5. Asset catalogue and domain models

The catalogue holds 42 notional asset classes across five domains, all sharing one attribute schema so that sensing, engagement and logistics models treat a frigate, a satellite and a drone swarm the same way.

**Common attribute schema**

| Attribute group | Fields | Notes |
| --- | --- | --- |
| Identity | id, faction, class, echelon, parent, callsign | Echelon: platform, section, unit, formation |
| Position | lat, lon, alt\_m (or depth\_m), h3, heading, orbit\_elements (space only) | Space assets store orbital elements, not positions |
| Kinematics | speed\_band, max\_speed\_band, turn\_class, ceiling\_band | Bands: very slow → hypersonic |
| Endurance | fuel\_capacity, burn\_rate\_by\_mode, endurance\_h, refuelable | Space: propellant for station-keeping |
| Sensors | list of {type, range\_band, field\_of\_view, modes, revisit} | Radar, passive RF, EO/IR, sonar, SIGINT, SAR |
| Signatures | radar\_band, ir\_band, acoustic\_band, visual\_band, emissions\_state | Low-observable assets have low bands |
| Effectors | list of {type, range\_band, pk\_band, salvo, magazine} | Abstracted: direct fire, indirect fire, missile, jammer, cyber |
| Defenses | {hard\_kill\_band, soft\_kill\_band, armor\_band, hardening} | Hardening covers EMP and cyber resilience |
| Status | health (0–1), readiness, morale (land), supply\_days, comms\_state | Readiness drives sortie and repair rates |
| Cost | acquisition\_points, replacement\_time\_days | Used in cost-exchange analysis |

**Asset classes by domain**

| Domain | Asset classes | Distinctive behavior modeled |
| --- | --- | --- |
| Land | Armored brigade, mechanized infantry brigade, light/airborne infantry, rocket and tube artillery battalion, short-range air defense, long-range air defense, coastal anti-ship battery, engineers, logistics convoy, headquarters | Terrain and road movement, force ratios, entrenchment, fires coordination, air defense umbrellas |
| Sea | Carrier strike group, destroyer, frigate, attack submarine (nuclear), diesel-electric submarine, amphibious ready group, fleet oiler, mine countermeasures group | Sea lanes and chokepoints, acoustic detection, layered fleet air defense, underway replenishment |
| Air | Air superiority fighter, multirole fighter, long-range bomber, airborne early warning and control (AEW&C), aerial tanker, strategic airlifter, maritime patrol aircraft, attack/utility helicopter | Sortie generation from bases and carriers, tanker dependence, combat radius, CAP stations |
| Drones | High-altitude long-endurance (HALE) ISR, medium-altitude long-endurance (MALE) ISR/strike, collaborative combat aircraft, loitering munition, small quadcopter swarm, uncrewed surface vessel, uncrewed undersea vehicle, uncrewed ground vehicle | Long endurance, attritability, swarm behaviors, datalink dependence, cost-exchange ratio |
| Space | Low Earth orbit (LEO) imaging constellation, LEO SAR constellation, LEO broadband comms constellation, medium Earth orbit (MEO) navigation (PNT) constellation, geostationary (GEO) SATCOM, GEO/HEO missile warning, ground control station, launch site | Orbital passes and revisit gaps, ground segment dependence, jamming of downlinks, debris from destruction, launch replenishment |

**Domain-specific rules**

- **Land** units fight as aggregated formations with strength, morale and supply; movement cost depends on terrain, weather and road condition.
- **Sea** units operate as task groups; submarines trade speed for stealth, and surface groups trade emissions for awareness.
- **Air** missions are planned as packages (strike, escort, tanking, suppression of air defenses) on an air tasking order cycle; aircraft return to base to rearm and refuel.
- **Drones** are controlled either by a ground station link (degradable by EW) or with onboard autonomy (less effective, but resistant to jamming); swarms move as a single flocking controller.
- **Space** assets follow orbits that agents cannot change quickly; tasking is a scheduling problem over future passes. Destroying a satellite creates a debris field that raises collision risk for every faction in that orbital shell.

All values are notional bands calibrated for relative plausibility; the catalogue is a versioned data file that scenario designers can edit.

## 6. Physics, sensing, engagement and sustainment models

The models favor explainable, tunable abstractions over engineering fidelity: every outcome can be traced to a handful of named factors that the console can display.

**Movement**

- Land: A\* pathfinding over the H3 tactical grid; cost = terrain × weather × road state × congestion.
- Sea: great-circle routing constrained to a sea-lane graph with chokepoints and depth limits for submarines.
- Air: great-circle legs with waypoints; fuel burn by mode (cruise, combat, loiter); tanker rendezvous extends range.
- Space: two-body Keplerian propagation with J2 nodal precession, which is enough to produce realistic ground tracks and revisit gaps.

**Sensing.** Each tick, the World Engine evaluates candidate sensor–target pairs pre-filtered by H3 neighborhood and line of sight (radar horizon from altitude, terrain masking, sea-surface ducting band, sonar layer). The probability of detection per look is:

```latex
P_d = 1 - \exp\left(-k \cdot \frac{S_{sensor} \cdot \sigma_{target}}{R^{4}} \cdot E_{env} \cdot (1 - J_{EW})\right)
```

Here S is the sensor strength band, σ the target signature band for that sensor type, R the range, E an environmental factor (weather, sea state, clutter) and J the jamming fraction. Passive sensors use an R² law and depend on the target's emissions state. Satellites detect only during passes whose footprint covers the target, and imagery reaches J2 only after the next ground-station downlink.

**Engagement (abstract kill chain).** An engagement succeeds only if every link holds: Find → Fix → Track → Target → Engage → Assess (F2T2EA).

- Each link has a time cost and a failure chance driven by track quality, C2 latency and ROE approval.
- Weapon effect uses Pk bands modified by target defenses; salvos are resolved against layered defenses, so saturation (more incoming than defenders can handle) emerges naturally.
- Battle damage assessment is itself a sensing task: shooters may believe a target is destroyed when it is not.

**Aggregate land combat.** Formation-on-formation combat uses a stochastic Lanchester square law with modifiers for terrain, posture (attack, defend, entrenched), supply and morale. Units below 50% strength lose cohesion; below 30% they become combat-ineffective and withdraw.

**Electronic warfare and cyber.** Jammers project a degradation field over sensors, datalinks and navigation in their footprint. Cyber actions are timed effects (delay, deny, deceive) on specific C2 nodes, with a detection chance that can expose the attacker. GNSS denial degrades precision weapons and drone navigation in an area.

**Logistics.** Supply flows from depots along road, rail, sea and air lines of communication. Units consume fuel, munitions and spares by activity; when supply days fall to zero their speed, sortie rate and Pk degrade in steps. Interdicting supply lines is therefore a valid strategy.

**Political and escalation model.** Each faction has national will (0–100) and an escalation level on a seven-rung ladder, from "posturing" to "strategic". Events move will (losses, civilian harm, objectives gained) and certain actions, such as attacks on space assets or the homeland, raise escalation. Strategic agents are constrained by ROE tied to the current rung, and a faction whose will reaches zero seeks terms. Nuclear use is out of scope: the top rung ends the scenario with an adjudicated "catastrophic outcome" rather than modeling it.

## 7. Web console

The web console is a single-page application with 12 graphical consoles arranged as dockable panels around a central globe; each console exists to make one concept visible, and every console can switch between a faction's view (fog of war) and the White cell's ground truth.

**Consoles and the concepts they illustrate**

| # | Console | Key visuals | Concept illustrated |
| --- | --- | --- | --- |
| 1 | Global Theater Map | 3D globe / 2D map, APP-6-style unit symbols, track uncertainty ellipses, H3 control shading | Common operational picture; fog of war (toggle faction view vs ground truth) |
| 2 | Orbital Console | Orbits around a 3D Earth, ground tracks, sensor footprints, pass timeline per region | Space as an enabler; revisit gaps and the windows they create |
| 3 | Kill Chain Console | Swimlane per engagement across F2T2EA stages, time per stage, break point highlighted | Sensor-to-shooter latency; which link failed and why |
| 4 | Sensor and Signature Console | Detection range rings vs target signature, radar horizon profile, sonar layer cross-section, jamming fields | Detection physics; stealth, emissions control and EW trade-offs |
| 5 | Air Operations Board | Air tasking order Gantt, CAP stations, tanker tracks, sortie-rate gauges | Sortie generation and tanker dependence |
| 6 | Maritime Console | Task group positions, anti-access/area-denial (A2/AD) range bubbles, chokepoints, submarine probability areas | Sea control and denial; layered fleet defense |
| 7 | Land Operations Console | Front-line trace, force-ratio heat map, terrain overlay, supply-status badges | Combat power ratios, terrain and sustainment effects |
| 8 | Drone and Swarm Console | Swarm flocking animation, link status, attrition tally, cost-exchange chart | Attritable mass; autonomy vs datalink dependence |
| 9 | C2 Network Graph | Force-directed graph of HQs, units, satellites and links; latency heat; jammed links dashed | Command latency, network resilience and single points of failure |
| 10 | Logistics Console | Sankey of supply flows, days-of-supply bars, interdicted routes | Sustainment as the limit of operational reach |
| 11 | Agent Reasoning Console | Live agent hierarchy, message trace, each decision's rationale, LLM vs rule-based badge, budget meter | Explainable multi-agent decision-making |
| 12 | Strategic Dashboard | Escalation ladder, national will curves, objective status, loss-exchange ratios | How tactical events translate into strategic outcomes |

**Shared console features**

- **Timeline scrubber** with play, pause, speed (1x–3600x), jump to event and branch from any point ("what if Blue had waited 6 hours?").
- **Linked selection**: selecting a unit anywhere highlights it in every console, including its messages and its kill-chain lanes.
- **Explain button** on any outcome: shows the factors behind it (for example detection probability components or Lanchester inputs).
- **Teaching mode**: guided overlays that pause at notable events and explain the concept in plain language.
- **Seat takeover**: a human can assume any agent's role, using the same order forms the agents use.
- **Accessibility**: colorblind-safe faction palettes, shape and pattern redundancy for every color code, keyboard navigation.

**Rendering targets**

- Globe with up to 5,000 entity symbols at 60 frames per second on a mid-range laptop, using WebGL with instanced rendering.
- Orbital console propagates orbits client-side from elements, so smooth motion costs no server traffic.
- Consoles update from a delta stream; panels not visible pause their rendering.

## 8. Scenarios, replay and after-action review

Every run is an append-only event log plus a seed, so any session can be replayed exactly, branched at any moment, or re-run hundreds of times to separate skill from luck.

**Scenario definition** (versioned JSON or YAML)

- Map: fictional continent or real basemap; theater bounding box; H3 resolutions in use.
- Factions: names, objectives with victory conditions, starting national will, alliance links.
- Order of battle: asset classes, quantities, positions, readiness, supply.
- Space segment: constellations as orbital element sets plus ground stations.
- Environment: weather seed or scripted fronts, day/night, sea state.
- Rules: ROE per escalation rung, autonomy levels, agent reasoning budgets, time limit.
- Injects: scheduled or conditional White-cell events (a neutral shipping convoy, a satellite failure, a ceasefire offer).

**Starter scenarios**

| Scenario | Scale | Domains emphasized | Teaching focus |
| --- | --- | --- | --- |
| Strait Crisis | Regional, 10 days | Sea, air, space, drones | A2/AD, sea control, ISR revisit gaps |
| Northern Plains | Regional, 14 days | Land, air, drones | Combined arms, logistics, attritable drones |
| Archipelago | Regional, 21 days | Sea, air, amphibious land | Distributed operations, tanker and supply limits |
| Dark Skies | Global, 7 days | Space, cyber/EW, all | Fighting with degraded PNT, comms and ISR |
| Sandbox | Any | Any | Free play for designers |

**Replay and branching**

- The event log records orders, adjudication results, injects and RNG draws with sim timestamps.
- Replay rebuilds state from the nearest snapshot (taken every simulated hour) plus subsequent events.
- Branching forks the log at a chosen event, so a human or agent can try an alternative decision.

**After-action review**

- Metrics: objective timeline, loss-exchange ratio by domain, cost-exchange ratio, mean sensor-to-shooter time, percentage of kill chains broken by link, supply shortfall hours, escalation peak.
- The AAR Analyst agent writes a narrative: key turning points, decisions that mattered and counterfactual suggestions, each linked to the events that support it.
- Batch mode runs N seeds (for example 200) and shows outcome distributions, so users can see whether a plan is robust or merely lucky.

## 9. Requirements, data model and APIs

The system must run a regional scenario of about 2,000 entities and 40 agents in real time on modest infrastructure, and stay deterministic under replay.

**Functional requirements**

| ID | Requirement |
| --- | --- |
| FR-01 | Load, validate and start a scenario from a versioned definition file. |
| FR-02 | Advance simulated time with pause, resume, speed change and jump-to-next-event. |
| FR-03 | Maintain ground truth and a separate COP per faction; never leak ground truth to faction agents or faction views. |
| FR-04 | Run strategic, operational, staff and tactical agents per faction on their cadences, with rule-based fallback. |
| FR-05 | Route all orders and reports through the simulated C2 network with latency and loss. |
| FR-06 | Model land, sea, air, drone and space assets per sections 5 and 6, plus EW and cyber effects. |
| FR-07 | Adjudicate detections and engagements deterministically from a seed. |
| FR-08 | Stream state deltas to web consoles and render the 12 consoles in section 7. |
| FR-09 | Allow a human to take over and release any agent seat. |
| FR-10 | Record an append-only event log; support replay, branching and batch runs. |
| FR-11 | Produce AAR metrics and an AAR narrative with links to supporting events. |
| FR-12 | Display a rationale for every agent order. |

**Non-functional requirements**

| ID | Category | Target |
| --- | --- | --- |
| NFR-01 | Scale | 2,000 entities and 40 agents per regional session; 5,000 entities in global scenarios with coarser ticks |
| NFR-02 | Tick performance | Tactical tick computed in under 200 ms of wall time at reference scale |
| NFR-03 | Console latency | State delta visible in consoles within 1 s of tick completion |
| NFR-04 | Rendering | 60 fps globe with 5,000 symbols on a mid-range laptop |
| NFR-05 | Determinism | Identical seed, scenario and order log produce byte-identical event logs |
| NFR-06 | Resilience | Session survives server restarts; state recoverable from snapshot + log |
| NFR-07 | Cost control | Per-agent reasoning budgets; system remains playable with zero LLM calls |
| NFR-08 | Security | Faction views authorized per player; White-cell view restricted to session owner |
| NFR-09 | Auditability | Every LLM prompt, response and resulting order logged per session |

**Core data model**

- **Session**: id, scenario\_ref, seed, sim\_time, speed, status, owner.
- **Entity**: the schema in section 5, plus last\_update tick.
- **Track** (per faction): track\_id, faction, believed\_class, quality, position, uncertainty, last\_seen, source\_sensors.
- **Message**: the envelope in section 4, plus delivery state and actual path.
- **Event**: seq, sim\_time, type, payload, rng\_draws, causal parent ids.
- **AgentState**: agent\_id, faction, role, memory summary, budget remaining, current plan, seat (AI or human id).
- **Snapshot**: session\_id, sim\_time, compressed full state.

**External APIs**

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /api/sessions | Create a session from a scenario |
| GET | /api/sessions/{id} | Session metadata and status |
| POST | /api/sessions/{id}/control | Pause, resume, speed, step, branch |
| POST | /api/sessions/{id}/orders | Submit an order from a human-held seat |
| POST | /api/sessions/{id}/seats/{agentId} | Take over or release an agent seat |
| GET | /api/sessions/{id}/events?from=seq | Page through the event log |
| GET | /api/sessions/{id}/aar | AAR metrics and narrative |
| GET | /api/scenarios | List available scenarios |
| WS | /ws/sessions/{id}?view=BLUE\|RED\|WHITE | Snapshot on connect, then state deltas, messages and events for that view |

## 10. Responsible use, acceptance criteria and glossary

The simulator stays an educational and research tool by design: notional data, fictional actors and guarded agent prompts are built in, not left to user discipline.

**Guardrails**

- Asset catalogue values are notional bands; the scenario validator rejects fields that look like precise real-world performance data.
- Default factions are fictional; scenarios may not name real living persons as commanders or targets.
- No ingestion of live military, vessel or aircraft tracking feeds; basemaps and weather are the only external data.
- LLM agents run with a system prompt that keeps reasoning at the game-abstraction level (bands, cells, abstract effects) and refuses to produce real-world operational, targeting or weapons-engineering detail.
- Civilian harm is modeled as a cost that reduces national will and is reported prominently in the AAR, never rewarded.
- All prompts, responses and orders are logged for audit (NFR-09).

**Acceptance criteria**

- [ ] Strait Crisis runs to completion at 600x with all agents AI-controlled and no ground-truth leaks in faction logs.
- [ ] Same seed and order log reproduce a byte-identical event log on two separate runs.
- [ ] Jamming a SATCOM link visibly increases order delivery latency in the C2 Network Graph and Kill Chain Console.
- [ ] Destroying a LEO imaging satellite widens revisit gaps in the Orbital Console and creates a debris field.
- [ ] A human takes over the Blue Air Component seat mid-run, issues a FRAGO, and hands the seat back.
- [ ] With the LLM budget set to zero, every agent falls back to rule-based behavior and the scenario still completes.
- [ ] AAR narrative links every claimed turning point to at least one event in the log.
- [ ] Globe renders 5,000 symbols at 60 fps on the reference laptop.

**Glossary**

| Term | Meaning |
| --- | --- |
| A2/AD | Anti-access / area denial: layered capabilities that keep an opponent out of an area |
| AAR | After-action review |
| ATO | Air tasking order: the daily schedule of air missions |
| C2 | Command and control |
| COP | Common operational picture: a faction's believed state of the battlespace |
| EW | Electronic warfare: jamming, deception and protection in the electromagnetic spectrum |
| F2T2EA | Find, fix, track, target, engage, assess: the stages of the kill chain |
| FRAGO / OPORD | Fragmentary order (a change) / operation order (a full plan) |
| H3 | Uber's hierarchical hexagonal geospatial index |
| ISR | Intelligence, surveillance and reconnaissance |
| PNT | Positioning, navigation and timing (for example GNSS) |
| ROE | Rules of engagement |
| White cell | The neutral control team (here, agents) that runs the environment and adjudicates |
