// Console 11 — Agent Reasoning Console: the live command hierarchy, every decision's rationale with an
// LLM / RULES / CACHE / HUMAN badge, the neuron budget, the C2 message trace, and seat takeover with
// the same order form the agents use.
import { useMemo, useState } from "react";
import { ROLE_INFO, TASKS, agentId, type AgentStatus, type Decision, type Order, type Role, type Task } from "@sentinel/protocol";
import { roleCanCommand } from "@sentinel/catalog";
import { useStore } from "../store";
import { Console, FactionToggle, useVersion } from "./common";
import { controller } from "../session/controller";
import { getUser } from "../lib/identity";
import { api } from "../lib/api";
import { clsName, simTime, minutes } from "../lib/format";

const COMMAND: Role[][] = [["nca"], ["jfc"], ["lcc", "mcc", "acc", "scc", "cyber"]];
const STAFF: Role[] = ["j2", "j4", "j5", "j6"];

function SourcePill({ s }: { s?: Decision["source"] }) {
  if (!s) return <span className="pill dim">—</span>;
  return <span className={`pill ${s.toLowerCase()}`}>{s}</span>;
}

export function AgentConsole() {
  useVersion();
  const view = useStore((s) => s.view);
  const agents = useStore((s) => s.agents);
  const decisions = useStore((s) => s.decisions);
  const messages = useStore((s) => s.messages);
  const selected = useStore((s) => s.selected);
  const meta = useStore((s) => s.meta);
  const mode = useStore((s) => s.mode);
  const [fac, setFac] = useState<"BLUE" | "RED">(view === "RED" ? "RED" : "BLUE");
  const f = view === "WHITE" ? fac : (view as "BLUE" | "RED");
  const [focus, setFocus] = useState<string | null>(null);
  const [orderSeat, setOrderSeat] = useState<string | null>(null);
  const [audit, setAudit] = useState<{ role: string; model: string; source: string; prompt: string; response: string; neurons: number }[] | null>(null);
  const me = getUser().id;
  const byId = new Map(agents.map((a) => [a.id, a]));
  const grant = 6000;

  const feed = useMemo(() => decisions.filter((d) => d.faction === f && (!focus || d.agent === focus)).slice(-60).reverse(), [decisions, f, focus]);
  const trace = useMemo(() => {
    const arr = [...messages.values()].filter((m) => m.faction === f && (!selected || m.to.includes(selected) || m.from === selected) && (!focus || m.from === focus || !selected));
    return arr.slice(-80).reverse();
  }, [messages, f, selected, focus]);

  const budgetLeft = Math.min(...agents.filter((a) => a.faction === f && a.budgetLeft !== undefined).map((a) => a.budgetLeft!), Infinity);
  const llm = decisions.filter((d) => d.faction === f && d.source === "LLM").length;
  const rules = decisions.filter((d) => d.faction === f && d.source === "RULES").length;

  const Node = ({ role }: { role: Role }) => {
    const id = agentId(f, role);
    const a: AgentStatus | undefined = byId.get(id);
    const held = a && a.seat !== "AI";
    const mine = a?.seat === me;
    return (
      <div className="card" style={{ padding: 8, minWidth: 130, borderColor: focus === id ? "var(--accent)" : undefined, cursor: "pointer" }} onClick={() => setFocus(focus === id ? null : id)}>
        <div style={{ fontWeight: 600, fontSize: 12 }}>{ROLE_INFO[role].title}</div>
        <div className="row" style={{ gap: 4, marginTop: 4 }}>
          <span className={`pill ${held ? "human" : ""}`}>{held ? (mine ? "you" : "human") : "AI"}</span>
          <SourcePill s={a?.lastSource} />
        </div>
        <div className="dim" style={{ fontSize: 10, marginTop: 2 }}>{a?.lastDecisionMs !== undefined ? `last ${simTime(a.lastDecisionMs)}` : "no decision yet"}</div>
        {(view === f || meta?.owner === me) && (
          <div className="row" style={{ marginTop: 4, gap: 4 }} onClick={(e) => e.stopPropagation()}>
            {!held && <button className="small" onClick={() => controller.seat(id, true)}>Take seat</button>}
            {mine && <><button className="small primary" onClick={() => setOrderSeat(id)}>Order…</button><button className="small" onClick={() => controller.seat(id, false)}>Hand back</button></>}
          </div>
        )}
      </div>
    );
  };

  return (
    <Console title="Agent Reasoning Console" concept="Explainable multi-agent decision-making"
      tools={
        <>
          <FactionToggle value={f} onChange={setFac} />
          <span className="muted">decisions: <span className="pill llm">LLM {llm}</span> <span className="pill rules">RULES {rules}</span></span>
          {mode !== "local" && Number.isFinite(budgetLeft) && (
            <span className="row" style={{ gap: 4 }} title="Session neuron budget left (Workers AI)">budget
              <span style={{ width: 80, height: 8, background: "var(--line)", borderRadius: 4, display: "inline-block", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${Math.min(100, (budgetLeft / grant) * 100)}%`, background: budgetLeft < 500 ? "var(--bad)" : "var(--accent)" }} /></span>
              <span className="mono">{Math.round(budgetLeft)}</span>
            </span>
          )}
          {mode === "local" && <span className="dim">Local play: rules-based agents (no LLM)</span>}
          {mode !== "local" && meta?.owner === me && (
            <button className="small" onClick={async () => { const t = useStore.getState().tokens.WHITE ?? Object.values(useStore.getState().tokens)[0]; if (t && meta) setAudit((await api.audit(meta.id, t, f)).log); }}>Audit log</button>
          )}
        </>
      }>
      <div className="col" style={{ gap: 6, alignItems: "center" }}>
        {COMMAND.map((row, i) => <div key={i} className="row wrap" style={{ justifyContent: "center" }}>{row.map((r) => <Node key={r} role={r} />)}</div>)}
        <div className="section-title">Staff</div>
        <div className="row wrap" style={{ justifyContent: "center" }}>{STAFF.map((r) => <Node key={r} role={r} />)}</div>
      </div>

      <div className="row wrap" style={{ alignItems: "flex-start", gap: 12, marginTop: 10 }}>
        <div style={{ flex: "2 1 320px" }}>
          <div className="section-title">Decisions {focus ? `· ${focus}` : ""}</div>
          {feed.length === 0 && <div className="dim">No decisions yet.</div>}
          {feed.map((d) => (
            <div key={d.id} className="card" style={{ padding: 8, marginBottom: 6 }}>
              <div className="row" style={{ gap: 6 }}>
                <b style={{ fontSize: 12 }}>{d.agent}</b><SourcePill s={d.source} />
                <span className="dim mono" style={{ fontSize: 11 }}>{simTime(d.simMs)}</span>
                {d.model && <span className="dim" style={{ fontSize: 10 }}>{d.model.split("/").pop()} · {d.neurons ?? 0} neurons</span>}
                <span className="dim" style={{ marginLeft: "auto", fontSize: 11 }}>confidence {Math.round((d.confidence ?? 0.5) * 100)}%</span>
              </div>
              <div style={{ fontSize: 12, margin: "4px 0" }}>{d.rationale}</div>
              {d.coas && <div className="row wrap" style={{ gap: 4 }}>{d.coas.map((c) => <span key={c.name} className="pill" title={c.summary}>{c.name} · {c.score}</span>)}</div>}
              {d.orders.length > 0 && (
                <div className="dim mono" style={{ fontSize: 11 }}>{d.orders.slice(0, 6).map((o) => `${o.type} ${o.to}${o.task ? ` ${o.task}` : ""}${o.target ? ` → ${o.target}` : ""}`).join(" · ")}{d.orders.length > 6 ? ` +${d.orders.length - 6}` : ""}</div>
              )}
            </div>
          ))}
        </div>
        <div style={{ flex: "1 1 260px" }}>
          <div className="section-title">C2 message trace {selected ? `· ${selected}` : ""}</div>
          <table className="grid">
            <thead><tr><th>Time</th><th>Msg</th><th>To</th><th>State</th><th>Latency</th></tr></thead>
            <tbody>
              {trace.map((m) => (
                <tr key={m.id} title={`path: ${m.delivery.path.join(" → ") || "none"}${m.rationale ? `\n${m.rationale}` : ""}`}>
                  <td className="mono">{m.sim_time}</td><td>{m.type}{m.body.task ? ` ${String(m.body.task)}` : ""}</td><td>{m.to.join(",")}</td>
                  <td><span className={`pill ${m.delivery.state === "DELIVERED" ? "ok" : m.delivery.state === "HELD" ? "warn" : m.delivery.state === "DROPPED" ? "bad" : ""}`}>{m.delivery.state}</span></td>
                  <td className="mono">{m.delivery.latencyMs !== undefined ? minutes(m.delivery.latencyMs) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {orderSeat && <OrderForm seat={orderSeat} onClose={() => setOrderSeat(null)} />}
      {audit && (
        <div className="modal-back" onClick={() => setAudit(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row"><h3>Audit log · {f}</h3><button className="small" style={{ marginLeft: "auto" }} onClick={() => setAudit(null)}>Close</button></div>
            <p className="dim">Every LLM prompt, response and resulting order is logged per session (NFR-09).</p>
            {audit.length === 0 && <div className="dim">No LLM calls yet.</div>}
            {audit.map((a, i) => (
              <details key={i} style={{ marginBottom: 6 }}>
                <summary>{a.role} · {a.model} · {a.source} · {Math.round(a.neurons)} neurons</summary>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{a.prompt}</pre>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, color: "var(--text-2)" }}>{a.response}</pre>
              </details>
            ))}
          </div>
        </div>
      )}
    </Console>
  );
}

/** The human order form: same schema and authority rules as agent orders. */
function OrderForm({ seat, onClose }: { seat: string; onClose: () => void }) {
  const [faction, role] = seat.split(".") as [string, Role];
  const F = faction.toUpperCase() as "BLUE" | "RED";
  const entities = useStore((s) => s.entities);
  const tracks = useStore((s) => s.tracks);
  const set = useStore((s) => s.set);
  const units = [...entities.values()].filter((e) => e.faction === F && !e.destroyed && roleCanCommand(role, e));
  const [type, setType] = useState<Order["type"]>(role === "nca" ? "ROE" : "FRAGO");
  const [to, setTo] = useState<string>(units[0]?.id ?? "");
  const [task, setTask] = useState<Task>("MOVE");
  const [point, setPoint] = useState<[number, number] | undefined>();
  const [target, setTarget] = useState("");
  const [roe, setRoe] = useState<Order["roe"]>("WEAPONS_TIGHT");
  const [hours, setHours] = useState(6);
  const [rationale, setRationale] = useState("");
  const simMs = useStore((s) => s.simMs);

  const submit = () => {
    const now = simMs / 3_600_000;
    const order: Order = type === "ROE" ? { type, to: `${faction}.jfc`, roe } : type === "ESCALATE" || type === "DEESCALATE" ? { type, to: `${faction}.nca` } : {
      type, to, task, point, target: target || undefined, window_sim_h: type === "ATO" ? [Math.round(now * 10) / 10, Math.round((now + hours) * 10) / 10] : undefined,
    };
    controller.order(seat, { orders: [order], rationale: rationale || `${type} issued by human at ${seat}`, confidence: 0.7 });
    useStore.getState().notify(`Order sent from ${seat}: it travels over the C2 network before it takes effect.`);
    onClose();
  };

  const picking = useStore((s) => s.pick);
  if (picking) return null; // hide while the user picks a point on the map
  const types: Order["type"][] = role === "nca" ? ["ROE", "ESCALATE", "DEESCALATE"] : role === "jfc" ? ["ROE", "FRAGO", "OPORD"] : role === "acc" ? ["ATO", "FRAGO"] : role === "scc" ? ["STO", "FRAGO"] : ["FRAGO", "OPORD"];
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Order form">
        <h3>Order from {ROLE_INFO[role].title} ({seat})</h3>
        <p className="dim">The same order form the agents use. Orders reach units only after C2 latency; unreachable units keep their last order.</p>
        <div className="col">
          <label className="row">Type <select value={type} onChange={(e) => setType(e.target.value as Order["type"])}>{types.map((t) => <option key={t}>{t}</option>)}</select></label>
          {type === "ROE" && <label className="row">ROE <select value={roe} onChange={(e) => setRoe(e.target.value as Order["roe"])}>{["WEAPONS_HOLD", "WEAPONS_TIGHT", "WEAPONS_FREE"].map((r) => <option key={r}>{r}</option>)}</select></label>}
          {!["ROE", "ESCALATE", "DEESCALATE"].includes(type) && (
            <>
              <label className="row">Unit <select value={to} onChange={(e) => setTo(e.target.value)}>{units.map((u) => <option key={u.id} value={u.id}>{u.callsign} · {clsName(u.cls)} · {u.task}</option>)}</select></label>
              <label className="row">Task <select value={task} onChange={(e) => setTask(e.target.value as Task)}>{TASKS.map((t) => <option key={t}>{t}</option>)}</select></label>
              <div className="row">Point <span className="mono">{point ? `${point[0]}, ${point[1]}` : "none"}</span>
                <button className="small" onClick={() => { set({ pick: { label: "Pick the task point", cb: (p) => setPoint(p) } }); }}>Pick on map</button>
              </div>
              <label className="row">Target <select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">none</option>{tracks.filter((t) => t.owner === F).slice(0, 200).map((t) => <option key={t.id} value={t.id}>{t.id} · {t.believedClass ?? t.believedDomain} · {t.quality}</option>)}{units.map((u) => <option key={u.id} value={u.id}>{u.callsign} (friendly)</option>)}</select></label>
              {type === "ATO" && <label className="row">Window <input type="number" min={1} max={48} value={hours} onChange={(e) => setHours(+e.target.value)} style={{ width: 70 }} /> h from now</label>}
            </>
          )}
          <label className="col" style={{ gap: 2 }}>Rationale (shown in the console, like every agent order)
            <textarea rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Why this order?" />
          </label>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button onClick={onClose}>Cancel</button>
            <button className="primary" onClick={submit} disabled={!["ROE", "ESCALATE", "DEESCALATE"].includes(type) && !to}>Issue order</button>
          </div>
        </div>
      </div>
    </div>
  );
}
