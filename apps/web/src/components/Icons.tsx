// Inline stroke icons. No emoji anywhere (DESIGN.md §7).
import type { SVGProps } from "react";

const base = (props: SVGProps<SVGSVGElement>) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...props,
  className: ["icon", props.className].filter(Boolean).join(" "),
});

export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconMic = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
);
export const IconArrowRight = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
export const IconArrowLeft = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
);
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const IconUpload = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>
);
export const IconWalk = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 18l4-10 4 6 2-3 6 7" /></svg>
);
export const IconChevronDown = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 9l6 6 6-6" /></svg>
);
export const IconLayers = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 4l9 5-9 5-9-5 9-5zM3 14l9 5 9-5" /></svg>
);
export const IconCursor = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 4l14 7-6 2-2 6z" /></svg>
);
export const IconCorridor = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 18l6-9 5 5 5-10" /><circle cx="4" cy="18" r="1.5" /><circle cx="20" cy="4" r="1.5" /></svg>
);
export const IconFixture = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="4" y="6" width="16" height="12" rx="1.5" /></svg>
);
export const IconPin = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 21s-6-6.5-6-11a6 6 0 0 1 12 0c0 4.5-6 11-6 11z" /><circle cx="12" cy="10" r="2" /></svg>
);
export const IconDoor = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 20V5a1 1 0 0 1 1-1h8v16M14 12h6M17 9l3 3-3 3" /></svg>
);
export const IconImage = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="4" y="5" width="16" height="14" rx="1.5" /><path d="M4 16l5-5 4 4 3-3 4 4" /><circle cx="15.5" cy="9.5" r="1.2" /></svg>
);
export const IconRuler = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 17l14-14 4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2" /></svg>
);
export const IconCube = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5" /></svg>
);
export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
