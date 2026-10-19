// Small inline SVG icons. Severity and category icons pair with color so that no meaning is carried
// by color alone (colorblind-safe), and they inherit currentColor for theming.
import type { Category, Severity } from "../game/types";

type P = { size?: number; className?: string; title?: string };

function Svg({ size = 16, className, title, children }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

const PATHS: Record<string, React.ReactNode> = {
  // severity
  critical: <><path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z" /><path d="M12 7v6M12 17h.01" /></>,
  warning: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>,
  good: <><circle cx="12" cy="12" r="10" /><path d="m8 12 3 3 5-6" /></>,
  // categories
  intel: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  land: <><path d="M3 17h18M5 17l2-5h10l2 5" /><path d="M9 12V9h6v3M15 10h5" /></>,
  sea: <><circle cx="12" cy="5" r="2" /><path d="M12 7v14M5 12H2a10 10 0 0 0 20 0h-3M8 11h8" /></>,
  air: <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />,
  space: <><path d="m13 7 4-4 4 4-4 4M7 13l-4 4 4 4 4-4" /><path d="m9 9 6 6M14.5 9.5l-5 5" /><path d="M16 16a4 4 0 0 0 4 4" /></>,
  cyber: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
  logistics: <><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="m3 8 9 5 9-5M12 13v8" /></>,
  comms: <><path d="M5 12a7 7 0 0 1 14 0M8.5 12a3.5 3.5 0 0 1 7 0" /><circle cx="12" cy="12" r="1" /><path d="M12 13v8" /></>,
  strategy: <><path d="M4 22V4M4 4h13l-2 4 2 4H4" /></>,
  // ui
  play: <path d="M7 4v16l13-8z" fill="currentColor" />,
  pause: <><rect x="6" y="4" width="4" height="16" fill="currentColor" /><rect x="14" y="4" width="4" height="16" fill="currentColor" /></>,
  mic: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" /></>,
  send: <path d="m22 2-7 20-4-9-9-4z" />,
  help: <><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" /></>,
  layers: <><path d="m12 2 10 5-10 5L2 7z" /><path d="m2 17 10 5 10-5M2 12l10 5 10-5" /></>,
  recenter: <><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  down: <path d="m6 9 6 6 6-6" />,
  volume: <><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></>,
  mute: <><path d="M11 5 6 9H2v6h4l5 4z" /><path d="m22 9-6 6M16 9l6 6" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></>,
  target: <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>,
  flag: <><path d="M4 22V4M4 4h13l-2 4 2 4H4" /></>,
  bolt: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
  cpu: <><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  gauge: <><path d="M12 14l4-4" /><path d="M3.3 19a10 10 0 1 1 17.4 0" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
};

export function Icon({ name, ...p }: P & { name: keyof typeof PATHS | Severity | Category }) {
  return <Svg {...p}>{PATHS[name]}</Svg>;
}

export function SeverityIcon({ s, size = 16 }: { s: Severity; size?: number }) {
  return <span className={`sev-icon sev-${s}`}><Icon name={s} size={size} title={s} /></span>;
}
