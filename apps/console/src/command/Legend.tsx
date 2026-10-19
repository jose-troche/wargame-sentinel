// Map legend: what each symbol, ring and shading means, with the layer switches beside the items
// they control. Collapsible so it never hides much of the map; starts collapsed on small screens.
import { useMemo, useState } from "react";
import { FACTION_COLORS } from "@sentinel/protocol";
import { symbolDataUrl, symbolKey } from "../lib/symbols";
import type { Side } from "../game/types";
import { Icon } from "./Icons";

export interface MapLayers {
  contacts: boolean;
  uncertainty: boolean;
  control: boolean;
  jamming: boolean;
  satellites: boolean;
}

const initialOpen = (compact?: boolean) => {
  if (compact) return false;
  try {
    const v = localStorage.getItem("ws.legend");
    if (v) return v === "1";
    return window.innerWidth > 900;
  } catch { return true; }
};

export function Legend({ side, layers, onLayers, compact }: { side: Side; layers?: MapLayers; onLayers?: (l: MapLayers) => void; compact?: boolean }) {
  const [open, setOpen] = useState(() => initialOpen(compact));
  const own = FACTION_COLORS[side];
  const enemy = FACTION_COLORS[side === "BLUE" ? "RED" : "BLUE"];
  const icons = useMemo(() => ({
    own: symbolDataUrl(symbolKey("F", "mech_inf_bde", own)),
    ownSea: symbolDataUrl(symbolKey("F", "destroyer", own)),
    enemy: symbolDataUrl(symbolKey("H", "destroyer", enemy)),
    unknown: symbolDataUrl(symbolKey("U", "SEA", FACTION_COLORS.UNKNOWN)),
    neutral: symbolDataUrl(symbolKey("N", "oiler", FACTION_COLORS.GREEN)),
  }), [own, enemy]);
  const toggle = () => {
    setOpen((o) => {
      if (!compact) try { localStorage.setItem("ws.legend", o ? "0" : "1"); } catch { /* storage unavailable */ }
      return !o;
    });
  };
  const sw = (k: keyof MapLayers) => layers && onLayers && (
    <input type="checkbox" className="legend-switch" checked={layers[k]} onChange={() => onLayers({ ...layers, [k]: !layers[k] })} aria-label={`Show ${k}`} />
  );
  return (
    <div className={`legend-panel${open ? " open" : ""}${compact ? " compact" : ""}`} data-tour="legend">
      <button className="legend-head" onClick={toggle} aria-expanded={open}>
        <Icon name="layers" size={14} /> Legend <span className="grow" /> <Icon name={open ? "down" : "chevron"} size={14} />
      </button>
      {open && (
        <div className="legend-body">
          <div className="legend-sec">Forces</div>
          <Row icon={<img src={icons.own} alt="" />} label="Our units" sub="Rectangle frame" />
          <Row icon={<img src={icons.enemy} alt="" />} label="Enemy contact" sub="Diamond; faded = less certain" />
          <Row icon={<img src={icons.unknown} alt="" />} label="Unknown contact" sub="Not yet classified" />
          <Row icon={<img src={icons.neutral} alt="" />} label="Neutral" sub="Civilian; do not strike" />
          <div className="legend-sec">Areas</div>
          <Row icon={<span className="lg-ring" style={{ borderColor: own }}><b>1</b></span>} label="Our objective" sub="Numbered; label color = status" />
          <Row icon={<span className="lg-ring" style={{ borderColor: enemy }}><b>!</b></span>} label="Enemy aim" sub="What the enemy wants" />
          {!compact && <>
            <Row icon={<span className="lg-ellipse" />} label="Where a contact may be" sub="Bigger = older report" toggle={sw("uncertainty")} />
            <Row icon={<span className="lg-jam" />} label="Jamming zone" sub="Radar and orders degraded" toggle={sw("jamming")} />
            <Row icon={<span className="lg-hex" />} label="Control" sub="Who has more forces there" toggle={sw("control")} />
            <Row icon={<span className="lg-sel" />} label="Selected" sub="Dashed line = its orders" />
            <Row icon={<span className="lg-dot" />} label="Show enemy contacts" sub="Hide to see only ours" toggle={sw("contacts")} />
            <Row icon={<span className="lg-sat" />} label="Satellites" sub="Our satellites overhead" toggle={sw("satellites")} />
          </>}
          <div className="legend-foot"><span className="sev-dot sev-good" /> held <span className="sev-dot sev-warning" /> contested <span className="sev-dot sev-critical" /> lost</div>
        </div>
      )}
    </div>
  );
}

function Row({ icon, label, sub, toggle }: { icon: React.ReactNode; label: string; sub: string; toggle?: React.ReactNode }) {
  return (
    <label className="legend-row">
      <span className="lg-icon">{icon}</span>
      <span className="grow"><b>{label}</b><small>{sub}</small></span>
      {toggle}
    </label>
  );
}
