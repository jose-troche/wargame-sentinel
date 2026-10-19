// The status board: the handful of numbers a commander checks at a glance. Each tile opens the
// expert console behind it.
import { useGame } from "../game/store";
import { SEVERITY_LABEL, type StatusTile } from "../game/types";
import { SeverityIcon } from "./Icons";

const NONE: StatusTile[] = [];

export function StatusBoard({ compact }: { compact?: boolean }) {
  const tiles = useGame((s) => s.brief?.tiles ?? NONE);
  const set = useGame((s) => s.set);
  return (
    <div className={`status-board${compact ? " compact" : ""}`} data-tour="status" role="list" aria-label="Status board">
      {tiles.map((t) => (
        <button key={t.id} role="listitem" className={`tile sev-${t.severity}`} onClick={() => set({ drawer: t.drill, sheet: null })} title={`${t.help}\n\nClick for details.`} aria-label={`${t.label}: ${t.value}. ${SEVERITY_LABEL[t.severity]}. ${t.sub}`}>
          <span className="tile-label"><SeverityIcon s={t.severity} size={12} /> {t.label}</span>
          <span className="tile-value">{t.value}</span>
          <span className="tile-sub">{t.sub}</span>
        </button>
      ))}
    </div>
  );
}
