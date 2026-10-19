// End of the game: the result in plain words, the numbers that decided it, and what to do next
// (review with the referee's ground truth, play again, or go back to the start).
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { useGame } from "../game/store";
import { controller } from "../session/controller";
import { navigate } from "../router";
import { Icon } from "./Icons";

export function EndScreen({ onReview }: { onReview: () => void }) {
  const brief = useGame((s) => s.brief);
  const log = useGame((s) => s.log);
  const politics = useStore((s) => s.politics);
  const side = useGame((s) => s.side);
  const mode = useStore((s) => s.mode);
  const [hidden, setHidden] = useState(false);
  const outcome = brief?.outcome;
  useEffect(() => { if (outcome) controller.unlockTruth(); }, [outcome]);
  if (!outcome || hidden || !brief) return null;
  const own = politics?.factions.find((f) => f.faction === side);
  const enemy = politics?.factions.find((f) => f.faction !== side);
  const title = { victory: "Victory", defeat: "Defeat", draw: "Draw", catastrophe: "Catastrophe" }[outcome.result];
  return (
    <div className="modal-back">
      <div className={`modal end end-${outcome.result}`} role="dialog" aria-label="Game over">
        <div className="end-icon"><Icon name={outcome.result === "victory" ? "good" : outcome.result === "draw" ? "info" : "critical"} size={40} /></div>
        <h2>{title}</h2>
        <p className="end-reason">{outcome.text}.</p>
        <div className="end-stats">
          <div><span>Victory points</span><b>{brief.score.own} vs {brief.score.enemy}</b></div>
          <div><span>National will</span><b>{Math.round(own?.will ?? 0)} vs {Math.round(enemy?.will ?? 0)}</b></div>
          <div><span>Losses (points)</span><b>{own?.lossPoints ?? 0} vs {enemy?.lossPoints ?? 0}</b></div>
          <div><span>Civilian harm</span><b>{own?.civilianHarm ?? 0}</b></div>
          <div><span>Your decisions</span><b>{log.length}</b></div>
        </div>
        <div className="end-objs">
          {brief.objectives.filter((o) => o.mine).map((o) => <div key={o.id}><Icon name="flag" size={14} /> {o.place}: held {o.heldHours} h</div>)}
        </div>
        <div className="row wrap" style={{ justifyContent: "flex-end" }}>
          <button className="ghost" onClick={() => setHidden(true)}>Close</button>
          {mode === "local" && <button onClick={() => { setHidden(true); onReview(); }}>Review with ground truth</button>}
          <button onClick={() => { controller.stop(); navigate("/"); }}>Main menu</button>
          {mode === "local" && <button className="primary" onClick={() => { const p = new URLSearchParams(location.search); p.set("seed", String(Math.floor(Math.random() * 1e6))); location.search = p.toString(); }}>Play again</button>}
        </div>
      </div>
    </div>
  );
}
