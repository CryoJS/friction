/**
 * One small icon set, drawn for this app: 20px grid, 1.5px stroke, round caps.
 * Icons inherit currentColor and are decorative unless given a label.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Three paths; the middle one hits something. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <rect width="28" height="28" rx="8" fill="#ffffff" />
      <path d="M7 9h14M7 14h4.5l2.5-3.5 2.5 3.5H21M7 19h14" fill="none" stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const Sparkle = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 2.5c.4 3.6 1.9 5.1 5.5 5.5-3.6.4-5.1 1.9-5.5 5.5-.4-3.6-1.9-5.1-5.5-5.5 3.6-.4 5.1-1.9 5.5-5.5Z" fill="currentColor" stroke="none" />
    <path d="M15.5 13.5c.2 1.4.8 2 2.2 2.2-1.4.2-2 .8-2.2 2.2-.2-1.4-.8-2-2.2-2.2 1.4-.2 2-.8 2.2-2.2Z" fill="currentColor" stroke="none" />
  </Icon>
);

export const ArrowRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 10h12M11 5l5 5-5 5" />
  </Icon>
);

export const ArrowUpRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 14 14 6M7.5 6H14v6.5" />
  </Icon>
);

export const ArrowLeft = (p: IconProps) => (
  <Icon {...p}>
    <path d="M16 10H4M9 5 4 10l5 5" />
  </Icon>
);

export const Play = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.5 4.5v11l9-5.5-9-5.5Z" fill="currentColor" />
  </Icon>
);

export const Pause = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 4.5v11M13 4.5v11" strokeWidth={2.2} />
  </Icon>
);

export const Restart = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 10a6 6 0 1 0 1.8-4.3M4 3.5v3.2h3.2" />
  </Icon>
);

export const Check = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </Icon>
);

export const Plus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 4v12M4 10h12" />
  </Icon>
);

/** A task whose run failed or timed out, on its node. */
export const Cross = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
  </Icon>
);

export const Minus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 10h12" />
  </Icon>
);
