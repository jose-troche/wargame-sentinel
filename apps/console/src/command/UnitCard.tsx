// Details for the selected unit or contact, in plain words, with simple direct orders:
// pick an order, then tap the map (or an enemy contact). Direct orders hold the unit for 12 hours.
import type { EntityView, Order, Task, TrackView } from "@sentinel/protocol";
import { useStore } from "../store";
import { useGame } from "../game/store";
import { execute } from "../game/actions";
import { clsName } from "../lib/format";
import { km, where } from "../game/places";
import { fmtShort } from "./Briefing";
import { Icon } from "./Icons";

const TASK_TEXT: Partial<Record<Task, string>> = {
  HOLD: "holding position", MOVE: "moving", PATROL: "patrolling", CAP: "flying air patrol", STRIKE: "on a strike mission", DEFEND: "defending", ATTACK: "attacking",
  WITHDRAW: "withdrawing", ISR: "watching an area", JAM: "jamming", CYBER: "on a cyber operation", ESCORT: "escorting", RESUPPLY: "resupplying", TANK: "refueling aircraft",
  EMCON: "silent (emissions off)", RTB: "returning to base",
};

interface QuickOrder { label: string; task: Task; needs: "point" | "target" | "none"; type?: Order["type"] }

function ordersFor(e: EntityView): QuickOrder[] {
  const air = e.domain === "AIR" || (e.domain === "DRONE" && !["usv", "uuv", "ugv"].includes(e.cls));
  if (e.domain === "SPACE") return [{ label: "Watch here", task: "ISR", needs: "point", type: "STO" }];
  if (e.cls === "ew_bn") return [{ label: "Jam here", task: "JAM", needs: "point" }, { label: "Move", task: "MOVE", needs: "point" }, { label: "Hold", task: "HOLD", needs: "none" }];
  if (e.cls === "tanker") return [{ label: "Refuel here", task: "TANK", needs: "point", type: "ATO" }, { label: "Return to base", task: "RTB", needs: "none" }];
  if (air) {
    const out: QuickOrder[] = [];
    if (["fighter_as", "fighter_mr", "cca"].includes(e.cls)) out.push({ label: "Air patrol here", task: "CAP", needs: "point", type: "ATO" });
    if (["fighter_mr", "bomber", "male_drone", "loitering_munition", "helo", "mpa"].includes(e.cls)) out.push({ label: "Strike a contact", task: "STRIKE", needs: "target", type: "ATO" });
    if (["hale_isr", "male_drone", "mpa", "aewc"].includes(e.cls)) out.push({ label: "Watch here", task: "ISR", needs: "point", type: "ATO" });
    out.push({ label: "Return to base", task: "RTB", needs: "none" });
    return out;
  }
  if (e.domain === "SEA" || e.cls === "usv" || e.cls === "uuv") {
    const out: QuickOrder[] = [{ label: "Patrol here", task: "PATROL", needs: "point", type: "OPORD" }, { label: "Move", task: "MOVE", needs: "point" }];
    if (["destroyer", "frigate", "ssn", "ssk", "csg"].includes(e.cls)) out.push({ label: "Strike a contact", task: "STRIKE", needs: "target" });
    out.push({ label: "Hold", task: "HOLD", needs: "none" });
    return out;
  }
  const out: QuickOrder[] = [{ label: "Move", task: "MOVE", needs: "point" }, { label: "Defend here", task: "DEFEND", needs: "point" }];
  if (["armored_bde", "mech_inf_bde", "light_inf_bde", "ugv"].includes(e.cls)) out.push({ label: "Attack a contact", task: "ATTACK", needs: "target" });
  if (["artillery_bn", "coastal_ashm"].includes(e.cls)) out.push({ label: "Strike a contact", task: "STRIKE", needs: "target" });
  out.push({ label: "Withdraw", task: "WITHDRAW", needs: "point" }, { label: "Hold", task: "HOLD", needs: "none" });
  return out;
}

function Meter({ label, value, warn }: { label: string; value: number; warn: number }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="meter" title={`${label} ${Math.round(v * 100)}%`}>
      <span>{label}</span>
      <span className="meter-bar"><span className={v < warn ? "low" : ""} style={{ width: `${v * 100}%` }} /></span>
      <span className="mono">{Math.round(v * 100)}%</span>
    </div>
  );
}

export function UnitCard() {
  useStore((s) => s.version);
  const selected = useStore((s) => s.selected);
  const side = useGame((s) => s.side);
  const st = useStore.getState();
  if (!selected || !side) return null;
  const e = st.entities.get(selected);
  const t = e ? undefined : st.tracks.find((x) => x.id === selected);
  if (!e && !t) return null;
  const close = () => useStore.getState().select(null);
  return (
    <aside className="unit-card" aria-label="Selection">
      <button className="ghost close" onClick={close} aria-label="Close"><Icon name="close" size={14} /></button>
      {e ? <OwnUnit e={e} side={side} /> : <Contact t={t!} side={side} />}
    </aside>
  );
}

function OwnUnit({ e, side }: { e: EntityView; side: "BLUE" | "RED" }) {
  const st = useStore.getState();
  const strength = e.domain === "LAND" ? e.strength ?? e.health : e.health;
  const held = e.heldUntilMs !== undefined && e.heldUntilMs > st.simMs;
  if (e.faction !== side) return <div className="dim">Not one of ours.</div>;
  const give = (q: QuickOrder) => {
    const seat = side;
    const send = (extra: Partial<Order>) => {
      const order: Order = { type: q.type ?? "FRAGO", to: e.id, task: q.task, ...extra, ...(q.type === "ATO" ? { window_sim_h: [st.simMs / 3_600_000, st.simMs / 3_600_000 + 8].map((x) => Math.round(x * 10) / 10) as [number, number] } : {}) };
      const r = execute({ kind: "orders", orders: [order], rationale: `Direct order from the commander: ${e.callsign} ${q.label.toLowerCase()}.` }, seat);
      useStore.getState().notify(r.text, !r.ok);
      useGame.getState().logEntry(`You ordered ${e.callsign}: ${q.label.toLowerCase()}.`);
    };
    if (q.needs === "none") return send({});
    if (q.needs === "point") return useStore.getState().set({ pick: { label: `${e.callsign}: ${q.label.toLowerCase()}`, cb: (p) => send({ point: p }) } });
    useStore.getState().set({
      pick: {
        label: `${e.callsign}: tap an enemy contact`,
        cb: (p) => {
          const s = useStore.getState();
          const near = s.tracks.filter((x) => x.owner === side && x.affiliation === "HOSTILE").sort((a, b) => km(p, [a.lat, a.lon]) - km(p, [b.lat, b.lon]))[0];
          if (!near || km(p, [near.lat, near.lon]) > 60) return useStore.getState().notify("No enemy contact there. Tap closer to a diamond symbol.", true);
          send({ target: near.id, point: [near.lat, near.lon] });
        },
      },
    });
  };
  return (
    <>
      <div className="uc-head">
        <b>{e.callsign}</b>
        <span className="dim">{clsName(e.cls)}</span>
      </div>
      <p className="uc-line">{where(st.scenario, [e.lat, e.lon])}, {TASK_TEXT[e.task] ?? e.task.toLowerCase()}{e.taskTarget ? ` (${e.taskTarget})` : ""}.</p>
      {held && <p className="uc-held"><Icon name="flag" size={12} /> Following your order until {fmtShort(e.heldUntilMs!)}. The staff will not re-task it.</p>}
      {e.comms !== "OK" && <p className="uc-warn">{e.comms === "CUT" ? "Out of contact: new orders will wait until the link returns." : "Degraded link: orders arrive late."}</p>}
      <Meter label="Strength" value={strength} warn={0.5} />
      {e.domain !== "SPACE" && <Meter label="Supply" value={Math.min(1, e.supplyDays / 7)} warn={0.15} />}
      {(e.domain === "AIR" || e.domain === "DRONE" || e.domain === "SEA") && <Meter label="Fuel" value={e.fuel} warn={0.25} />}
      <div className="field-label">Direct order</div>
      <div className="uc-orders">
        {ordersFor(e).map((q) => <button key={q.label} className="small" onClick={() => give(q)}>{q.label}</button>)}
      </div>
    </>
  );
}

function Contact({ t, side }: { t: TrackView; side: "BLUE" | "RED" }) {
  const st = useStore.getState();
  const age = Math.round((st.simMs - t.lastSeenMs) / 60000);
  const label = t.believedClass ? clsName(t.believedClass).toLowerCase() : `${t.believedDomain.toLowerCase()} contact`;
  const strike = () => {
    const r = execute({ kind: "play", play: "STRIKE_TOP", target: t.id }, side);
    useStore.getState().notify(r.text, !r.ok);
    useGame.getState().logEntry(r.ok ? `You ordered a strike on ${t.id}.` : r.text, r.ok ? "info" : "warning");
  };
  return (
    <>
      <div className="uc-head">
        <b>{t.affiliation === "HOSTILE" ? "Enemy" : t.affiliation === "NEUTRAL" ? "Neutral" : "Unknown"} {label}</b>
        <span className="dim mono">{t.id}</span>
      </div>
      <p className="uc-line">{where(st.scenario, [t.lat, t.lon])}. Last seen {age} min ago; could be anywhere within {Math.round(t.ellipse[0])} km.</p>
      <p className="uc-line dim">Certainty: {t.quality.toLowerCase()}{t.quality === "DETECTED" || t.quality === "CLASSIFIED" ? " — not yet firm enough to strike" : ""}. Seen by {t.sources.length} sensor{t.sources.length === 1 ? "" : "s"}.</p>
      {t.affiliation === "HOSTILE" && <div className="uc-orders"><button className="small primary" onClick={strike}><Icon name="target" size={12} /> Strike this contact</button></div>}
      {t.affiliation === "NEUTRAL" && <p className="uc-warn">Civilian. Striking it would harm civilians and cost national will.</p>}
    </>
  );
}
