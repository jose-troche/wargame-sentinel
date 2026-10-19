// Commander's actions: intent (main effort and posture), the escalation ladder, and one-click plays.
// Each button says what it will do and what it costs; buttons that cannot work right now are
// disabled with the reason, so the player learns the rules by using them.
import { useMemo, useState } from "react";
import { ESCALATION_LADDER, type Posture } from "@sentinel/protocol";
import { PLAY_IDS, PLAYS, buildPlay, type PlayId } from "@sentinel/agents-rules";
import { useStore } from "../store";
import { useGame } from "../game/store";
import { copFromView } from "../game/cop";
import { execute } from "../game/actions";
import { POSTURE_INFO } from "../game/levels";
import { Icon } from "./Icons";

export function Actions() {
  const side = useGame((s) => s.side)!;
  const brief = useGame((s) => s.brief);
  const politics = useStore((s) => s.politics);
  // Availability is recomputed with the briefing (once a second), not on every map frame.
  const own = politics?.factions.find((f) => f.faction === side);
  const enemy = politics?.factions.find((f) => f.faction !== side);
  const mine = (brief?.objectives ?? []).filter((o) => o.mine);
  const [target, setTarget] = useState<string | undefined>(undefined);
  const objective = target ?? own?.mainEffort ?? mine[0]?.id;
  const avail = useMemo(() => {
    const cop = copFromView(side, useStore.getState());
    return Object.fromEntries(PLAY_IDS.map((id) => [id, buildPlay(id, cop, PLAYS[id].needsObjective ? objective : undefined)])) as Record<PlayId, ReturnType<typeof buildPlay>>;
  }, [brief, side, objective]);
  const run = (fn: () => { ok: boolean; text: string }) => {
    const r = fn();
    useStore.getState().notify(r.text, !r.ok);
    useGame.getState().logEntry(r.text, r.ok ? "info" : "warning");
  };
  const esc = own?.escalation ?? 0;
  const next = ESCALATION_LADDER[Math.min(6, esc + 1)];
  return (
    <div className="actions" data-tour="actions">
      <section>
        <h3 className="panel-title">Your intent</h3>
        <div className="field-label">Main effort</div>
        <div className="choice-row">
          {mine.map((o, i) => (
            <button key={o.id} className={`choice${own?.mainEffort === o.id ? " on" : ""}`} aria-pressed={own?.mainEffort === o.id}
              onClick={() => run(() => execute({ kind: "intent", objective: o.id }, side))} title={`Make ${o.place} the main effort`}>
              <span className="obj-num">{i + 1}</span> {o.place} <small className={`st st-${o.state}`}>{o.stateText}</small>
            </button>
          ))}
        </div>
        <div className="field-label">Posture</div>
        <div className="segmented" role="group" aria-label="Posture">
          {(["DEFENSIVE", "BALANCED", "AGGRESSIVE"] as Posture[]).map((p) => (
            <button key={p} className={own?.posture === p ? "on" : ""} aria-pressed={own?.posture === p} title={POSTURE_INFO[p].text} onClick={() => run(() => execute({ kind: "intent", posture: p }, side))}>{POSTURE_INFO[p].title}</button>
          ))}
        </div>
        <p className="hint">{POSTURE_INFO[own?.posture ?? "BALANCED"].text}</p>
      </section>

      <section>
        <h3 className="panel-title">Escalation</h3>
        <div className="ladder" aria-label="Escalation ladder">
          {ESCALATION_LADDER.slice(0, 6).map((r) => (
            <div key={r.rung} className={`rung${r.rung === esc ? " own" : ""}${r.rung === (enemy?.escalation ?? -1) ? " enemy" : ""}${r.rung <= esc ? " reached" : ""}`} title={r.allows}>
              <span className="rung-n">{r.rung}</span><span className="rung-name">{r.name}</span>
              {r.rung === esc && <span className="tag own">us</span>}
              {r.rung === enemy?.escalation && <span className="tag enemy">enemy</span>}
            </div>
          ))}
        </div>
        <div className="row wrap">
          <button disabled={esc >= 5} onClick={() => { if (confirm(`Escalate to rung ${next.rung} (${next.name})?\n\nAllows: ${next.allows}\n\nCosts national will and will alarm the enemy.`)) run(() => execute({ kind: "escalate", steps: 1 }, side)); }}>Escalate to {esc + 1}</button>
          <button disabled={esc <= 0} onClick={() => run(() => execute({ kind: "escalate", steps: -1 }, side))}>Step down to {Math.max(0, esc - 1)}</button>
        </div>
        <p className="hint">Rung {esc}: {ESCALATION_LADDER[esc].allows}</p>
      </section>

      <section>
        <h3 className="panel-title">Plays</h3>
        {mine.length > 1 && (
          <div className="row wrap target-row">
            <span className="field-label">Aim at</span>
            {mine.map((o, i) => <button key={o.id} className={`choice small${objective === o.id ? " on" : ""}`} onClick={() => setTarget(o.id)} aria-pressed={objective === o.id}><span className="obj-num">{i + 1}</span> {o.place}</button>)}
          </div>
        )}
        <div className="plays">
          {PLAY_IDS.map((id) => {
            const p = PLAYS[id];
            const a = avail[id];
            return (
              <button key={id} className={`play cat-${p.category}`} disabled={!a?.ok} onClick={() => run(() => execute({ kind: "play", play: id, objective: p.needsObjective ? objective : undefined }, side))}
                title={a?.ok ? `${p.summary}\n\nTrade-off: ${p.tradeoff}` : a?.reason}>
                <span className="play-head"><Icon name={p.category === "strike" ? "target" : p.category === "intel" ? "intel" : p.category === "cyber" ? "cyber" : p.category === "logistics" ? "logistics" : p.category === "sea" ? "sea" : p.category === "air" ? "air" : "land"} size={14} /> {p.title}</span>
                <span className="play-sub">{a?.ok ? `${a.units.length} unit${a.units.length === 1 ? "" : "s"} · ${p.tradeoff}` : a?.reason}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
