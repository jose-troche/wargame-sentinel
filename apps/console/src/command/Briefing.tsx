// The staff briefing: bottom line up front, the decisions the commander owes the staff, then the
// reports that matter, most severe first. Updated once a second from the game store, with stable
// keys and no motion, so nothing jumps while the commander is reading.
import { memo, useMemo, useState } from "react";
import { HOUR_MS } from "@sentinel/protocol";
import { useStore } from "../store";
import { useGame } from "../game/store";
import { POSTURE_INFO, LEVELS } from "../game/levels";
import { CATEGORY_LABEL, SEVERITY_LABEL, type Alert, type Category, type DecisionCard, type Severity } from "../game/types";
import { Icon, SeverityIcon } from "./Icons";
import type { Posture } from "@sentinel/protocol";

export function ago(ms: number) {
  if (ms < 60_000) return "just now";
  if (ms < HOUR_MS) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 48 * HOUR_MS) return `${Math.round(ms / HOUR_MS)} h ago`;
  return `${Math.round(ms / (24 * HOUR_MS))} d ago`;
}
const within = (ms: number) => (ms < HOUR_MS ? `${Math.max(1, Math.round(ms / 60_000))} min` : `${(ms / HOUR_MS).toFixed(1)} h`);

type Filter = "all" | "critical" | Category;

export function Briefing({ limit = 6 }: { limit?: number }) {
  const brief = useGame((s) => s.brief);
  const cards = useGame((s) => s.cards);
  const [filter, setFilter] = useState<Filter>("all");
  const [all, setAll] = useState(false);
  const alerts = useMemo(() => (brief?.alerts ?? []).filter((a) => filter === "all" || (filter === "critical" ? a.severity === "critical" || a.severity === "warning" : a.category === filter)), [brief, filter]);
  const cats = useMemo(() => [...new Set((brief?.alerts ?? []).map((a) => a.category))], [brief]);
  if (!brief) return <div className="empty">Your staff are assembling the first briefing…</div>;
  const shown = all ? alerts : alerts.slice(0, limit);
  return (
    <div className="briefing" data-tour="briefing">
      <div className={`bluf tone-${brief.tone}`} role="status" aria-live="polite">
        <SeverityIcon s={brief.tone} size={18} />
        <p>{brief.headline}</p>
      </div>
      {cards.length > 0 && (
        <section aria-label="Decisions needed" data-tour="decisions">
          <h3 className="panel-title">Decisions needed <span className="count">{cards.length}</span></h3>
          {cards.map((c) => <DecisionCardView key={c.id} card={c} />)}
        </section>
      )}
      <section aria-label="Staff reports">
        <div className="panel-title row">
          <span>Staff reports</span>
          <span className="grow" />
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filter reports" className="small-select">
            <option value="all">All</option>
            <option value="critical">Warnings and critical</option>
            {cats.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </div>
        {shown.length === 0 && <div className="dim pad">Nothing to report.</div>}
        <ul className="alerts">
          {shown.map((a) => <AlertRow key={a.key} a={a} />)}
        </ul>
        {alerts.length > limit && <button className="link" onClick={() => setAll((x) => !x)}>{all ? "Show fewer" : `Show all ${alerts.length} reports`}</button>}
      </section>
      <DecisionLog />
    </div>
  );
}

const AlertRow = memo(function AlertRow({ a }: { a: Alert }) {
  const simMs = useStore((s) => Math.floor(s.simMs / 600_000) * 600_000); // re-render the age every 10 sim minutes, not every frame
  const [open, setOpen] = useState(false);
  const show = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (a.where) useGame.getState().focusOn(a.where);
    if (a.entity) useStore.getState().select(a.entity);
  };
  const explain = (e: React.MouseEvent) => {
    e.stopPropagation();
    const ev = useStore.getState().events.find((x) => x.seq === a.seqs[a.seqs.length - 1]);
    if (ev?.factors) useStore.getState().set({ explain: ev });
    else if (a.drill) useGame.getState().set({ drawer: a.drill });
  };
  return (
    <li className={`alert sev-${a.severity}`}>
      <button className="alert-main" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <SeverityIcon s={a.severity} />
        <span className="alert-text">
          <span className="alert-title">{a.title}{a.count > 1 && <span className="count">×{a.count}</span>}</span>
          <span className="alert-meta"><Icon name={a.category} size={12} /> {CATEGORY_LABEL[a.category]} · {SEVERITY_LABEL[a.severity]} · {ago(Math.max(0, simMs - a.simMs))}</span>
        </span>
      </button>
      {open && (
        <div className="alert-more">
          {a.detail && <p>{a.detail}</p>}
          <div className="row">
            {a.where && <button className="small" onClick={show}><Icon name="target" size={12} /> Show on map</button>}
            {(a.seqs.length > 0 || a.drill) && <button className="small" onClick={explain}>Details</button>}
          </div>
        </div>
      )}
    </li>
  );
});

function DecisionCardView({ card }: { card: DecisionCard }) {
  const simMs = useStore((s) => Math.floor(s.simMs / 300_000) * 300_000);
  const pausedFor = useGame((s) => s.pausedFor);
  const level = useGame((s) => s.level);
  const decide = useGame((s) => s.decide);
  if (card.kind === "intent") return <IntentCard card={card} />;
  return (
    <article className={`decision sev-${card.severity}`} aria-label={card.title}>
      <header>
        <SeverityIcon s={card.severity} size={18} />
        <h4>{card.title}</h4>
      </header>
      <p className="situation">{card.situation}</p>
      <div className="options">
        {card.options.map((o, i) => (
          <button key={o.label} className={`option${i === card.recommended ? " recommended" : ""}`} onClick={() => decide(card.id, i)}>
            <span className="option-label">{o.label}{i === card.recommended && <span className="rec">Staff recommend</span>}</span>
            {LEVELS[level].hints && <span className="option-detail">{o.detail}</span>}
          </button>
        ))}
      </div>
      <footer className="decision-foot">
        {card.where && <button className="link" onClick={() => useGame.getState().focusOn(card.where!)}><Icon name="target" size={12} /> Show on map</button>}
        <span className="grow" />
        {pausedFor === card.id ? <span className="dim">Paused for your decision</span> : card.deadlineMs !== undefined ? <span className="dim"><Icon name="clock" size={12} /> Staff act in {within(Math.max(0, card.deadlineMs - simMs))}</span> : null}
      </footer>
    </article>
  );
}

function IntentCard({ card }: { card: DecisionCard }) {
  const brief = useGame((s) => s.brief);
  const mine = (brief?.objectives ?? []).filter((o) => o.mine);
  const [obj, setObj] = useState(mine[0]?.id);
  const [posture, setPosture] = useState<Posture>("BALANCED");
  const go = () => {
    const g = useGame.getState();
    const idx = card.options.findIndex((o) => o.action.kind === "intent" && o.action.posture === posture);
    // Re-point the chosen option at the chosen objective, then decide.
    const options = card.options.map((o, i) => (i === idx && o.action.kind === "intent" ? { ...o, action: { ...o.action, objective: obj } } : o));
    useGame.setState({ cards: g.cards.map((c) => (c.id === card.id ? { ...c, options } : c)) });
    g.decide(card.id, Math.max(0, idx));
  };
  return (
    <article className={`decision intent sev-${card.severity}`} aria-label={card.title}>
      <header><Icon name="flag" size={18} /><h4>{card.title}</h4></header>
      <p className="situation">{card.situation}</p>
      <div className="field-label">1. Main effort: what matters most?</div>
      <div className="choice-row">
        {mine.map((o, i) => (
          <button key={o.id} className={`choice${obj === o.id ? " on" : ""}`} onClick={() => setObj(o.id)} aria-pressed={obj === o.id}>
            <span className="obj-num">{i + 1}</span> {o.place}{o.weight > 1 && <small>most points</small>}
          </button>
        ))}
      </div>
      <div className="field-label">2. Posture: how much risk?</div>
      <div className="choice-row">
        {(["DEFENSIVE", "BALANCED", "AGGRESSIVE"] as Posture[]).map((p) => (
          <button key={p} className={`choice${posture === p ? " on" : ""}`} onClick={() => setPosture(p)} aria-pressed={posture === p}>{POSTURE_INFO[p].title}</button>
        ))}
      </div>
      <p className="option-detail">{POSTURE_INFO[posture].text}</p>
      <button className="primary wide" onClick={go}>Issue intent</button>
    </article>
  );
}

function DecisionLog() {
  const log = useGame((s) => s.log);
  const [open, setOpen] = useState(false);
  if (!log.length) return null;
  return (
    <section className="decision-log">
      <button className="link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Hide" : "Show"} your decisions ({log.length})</button>
      {open && (
        <ul>
          {[...log].reverse().map((l, i) => <li key={log.length - i} className={`tone-${l.tone as Severity}`}><span className="mono dim">{fmtShort(l.simMs)}</span> {l.text}</li>)}
        </ul>
      )}
    </section>
  );
}

export function fmtShort(ms: number) {
  const d = Math.floor(ms / (24 * HOUR_MS));
  const h = Math.floor((ms % (24 * HOUR_MS)) / HOUR_MS);
  const m = Math.floor((ms % HOUR_MS) / 60_000);
  return `D+${d} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
