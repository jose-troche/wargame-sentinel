// "Why did that happen?": the named factors behind an outcome, the formula, and the concept in plain words.
import { useStore } from "../store";
import { FACTOR_HELP, TEACH, explainFormula } from "../lib/explain";
import { simTime } from "../lib/format";

export function ExplainModal() {
  const e = useStore((s) => s.explain)!;
  const set = useStore((s) => s.set);
  const formula = explainFormula(e);
  const teach = TEACH[e.type];
  return (
    <div className="modal-back" onClick={() => set({ explain: null })}>
      <div className="modal" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-label="Explain">
        <div className="row"><h3>Why: {e.type.replace(/_/g, " ").toLowerCase()}</h3><span className="mono dim" style={{ marginLeft: "auto" }}>#{e.seq} · {simTime(e.simMs)}</span></div>
        <p>{e.text}</p>
        {formula && <p className="mono" style={{ fontSize: 12, background: "var(--bg-2)", padding: 8, borderRadius: 6 }}>{formula}</p>}
        {e.factors && (
          <table className="grid"><thead><tr><th>Factor</th><th>Value</th><th>Meaning</th></tr></thead>
            <tbody>{Object.entries(e.factors).map(([k, v]) => <tr key={k}><td className="mono">{k}</td><td className="mono">{String(v)}</td><td className="dim">{FACTOR_HELP[k] ?? ""}</td></tr>)}</tbody></table>
        )}
        {teach && <p className="muted" style={{ marginTop: 10 }}><b>{teach.title}.</b> {teach.body}</p>}
        {e.rng !== undefined && <p className="dim" style={{ fontSize: 11 }}>Random draws used: {e.rng}. Same seed and orders reproduce this exactly.</p>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          {e.entities?.[0] && <button onClick={() => set({ selected: e.entities![0], explain: null })}>Select unit</button>}
          <button className="primary" onClick={() => set({ explain: null })}>Close</button>
        </div>
      </div>
    </div>
  );
}
