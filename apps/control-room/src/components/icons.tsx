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

/** The Friction brand mark from the public asset. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return <img src="/friction-icon.svg" width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
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

export const Filter = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 4.5h13l-5 5.5v4.5l-3 1.5V10l-5-5.5Z" />
  </Icon>
);

export const ChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5.5 7.5 4.5 5 4.5-5" />
  </Icon>
);

export const ChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="m7.5 5.5 5 4.5-5 4.5" />
  </Icon>
);

export const AlertTriangle = (p: IconProps) => (
  <Icon {...p}>
    <path d="m10 3 7 13H3L10 3Z" />
    <path d="M10 7.5v4M10 14.25v.1" />
  </Icon>
);

/** S1: a plain dot. The mildest risk mark. */
export const RiskDot = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="2.6" fill="currentColor" stroke="none" />
  </Icon>
);

/** S2: a dot with a ring, one step up from RiskDot. */
export const RiskRing = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="3" fill="currentColor" stroke="none" />
    <circle cx="10" cy="10" r="6.5" />
  </Icon>
);

/** S5: a filled hazard triangle, the most severe mark. */
export const HazardTriangle = (p: IconProps) => (
  <Icon {...p} fill="currentColor">
    <path d="m10 2 8.5 15H1.5L10 2Z" stroke="none" />
    <path d="M10 7.2v4.6" stroke="var(--color-void)" strokeWidth={1.8} />
    <circle cx="10" cy="14.6" r="1" fill="var(--color-void)" stroke="none" />
  </Icon>
);

/** Risk marks that escalate in shape with severity, not just color: dot, ringed dot, triangle, triangle, filled hazard triangle. */
export function riskIcon(severity: 1 | 2 | 3 | 4 | 5) {
  switch (severity) {
    case 1:
      return RiskDot;
    case 2:
      return RiskRing;
    case 5:
      return HazardTriangle;
    default:
      return AlertTriangle;
  }
}

export const Sort = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 3.5v13M2.5 14l2.5 2.5L7.5 14M15 16.5v-13M12.5 6l2.5-2.5L17.5 6" />
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
