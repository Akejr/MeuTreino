import type { SVGProps } from 'react';

const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

type P = SVGProps<SVGSVGElement>;
const mk = (d: string | string[]) => (p: P) => (
  <svg {...base} {...p}>
    {(Array.isArray(d) ? d : [d]).map((x, i) => (
      <path key={i} d={x} />
    ))}
  </svg>
);

/** Alça de arrastar (6 pontos). */
export const IconGrip = (p: P) => (
  <svg {...base} {...p} stroke="none" fill="currentColor">
    {[8, 16].map((x) => [6, 12, 18].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.7} />))}
  </svg>
);
export const IconTreino = mk('M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11');
export const IconDieta = mk('M7 2v8a2 2 0 0 0 2 2v10M11 2v8a2 2 0 0 1-2 2M17 22V2c-2 1.5-3 4-3 7s1 4 3 4');
export const IconResumo = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);
export const IconConfig = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
export const IconBack = mk('M15 18l-6-6 6-6');
export const IconNext = mk('M9 18l6-6-6-6');
export const IconDown = mk('M6 9l6 6 6-6');
export const IconSend = mk('M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z');
export const IconTrash = mk('M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6');
export const IconCheck = mk('M20 6L9 17l-5-5');
export const IconClose = mk('M18 6L6 18M6 6l12 12');
export const IconPlus = mk('M12 5v14M5 12h14');
export const IconMinus = mk('M5 12h14');
export const IconSwap = mk(['M16 3l4 4-4 4', 'M20 7H4', 'M8 21l-4-4 4-4', 'M4 17h16']);
export const IconSkip = mk(['M5 4l10 8-10 8V4z', 'M19 5v14']);
export const IconPlay = mk('M6 4l14 8-14 8V4z');
export const IconPause = mk(['M8 5v14', 'M16 5v14']);
export const IconEdit = mk(['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z']);
export const IconAlert = mk(['M12 9v4', 'M12 17h.01', 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z']);
export const IconInfo = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4M12 8h.01" />
  </svg>
);
export const IconTimer = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2 2M9 2h6" />
  </svg>
);
export const IconCloud = mk('M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 1 0 6 17.7');
export const IconCloudOk = mk(['M17.5 19H8a5 5 0 1 1 1-9.9 6 6 0 0 1 11.3 3', 'M14 16l2 2 4-4']);
export const IconCloudOff = mk(['M2 2l20 20', 'M5.8 8.6A5 5 0 0 0 8 19h9.5', 'M21 15.5A4.5 4.5 0 0 0 17.5 11h-.6A6 6 0 0 0 9.5 6.3']);
export const IconSync = mk(['M21 12a9 9 0 0 1-15.5 6.3L3 16', 'M3 12a9 9 0 0 1 15.5-6.3L21 8', 'M21 3v5h-5', 'M3 21v-5h5']);
export const IconSparkle = mk(['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z', 'M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z']);
export const IconChat = mk('M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z');
export const IconList = mk(['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01']);
export const IconHistory = mk(['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5', 'M12 7v5l3 2']);
export const IconUser = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);
export const IconShield = mk(['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M9 12l2 2 4-4']);
export const IconFlame = mk('M12 22c4 0 7-2.7 7-6.8 0-3.2-2-5.7-3.6-7.4-.5 1.8-1.6 3-2.9 3.4.4-3.3-1-6.6-3.5-9.2-.3 3.1-1.7 5.2-3.2 7C4.6 10.5 5 12.6 5 15.2 5 19.3 8 22 12 22z');
export const IconBox = mk(['M21 8l-9-5-9 5 9 5 9-5z', 'M3 8v8l9 5 9-5V8', 'M12 13v8']);
export const IconSunrise = mk('M12 2v4M4.9 8.9l1.4 1.4M2 16h2M20 16h2M17.7 10.3l1.4-1.4M22 20H2M8 16a4 4 0 0 1 8 0');
export const IconSun = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
export const IconMoon = mk('M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z');
export const IconCoffee = mk('M17 8h1a4 4 0 0 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8zM6 2v2M10 2v2M14 2v2');
export const IconApple = mk('M12 6.5c-1.5-1.2-3.5-1.4-5-.6C4.6 7.2 3.5 10.4 4.6 14c1 3.4 3.3 6.5 5.4 6.5 1 0 1.3-.5 2-.5s1 .5 2 .5c2.1 0 4.4-3.1 5.4-6.5 1.1-3.6 0-6.8-2.4-8.1-1.5-.8-3.5-.6-5 .6zM12 6.5C12 4.5 13 3 15 2');
export const IconZap = mk('M13 2L3 14h9l-1 8 10-12h-9l1-8z');
