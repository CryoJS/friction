import type { CSSProperties } from "react";
import { MousePointer2 } from "lucide-react";

type Accent = "coral" | "amber" | "cobalt";

interface Scene {
  position: "left" | "right" | "bottom";
  url: string;
  agent: string;
  action: string;
  caption: string;
  accent: Accent;
  delay: number;
}

const ACCENTS: Record<Accent, string> = {
  coral: "var(--color-sev-5)",
  amber: "var(--color-sev-4)",
  cobalt: "var(--color-sev-1)",
};

const SCENES: Scene[] = [
  {
    position: "left",
    url: "demo.store / search",
    agent: "impatient",
    action: "retry click",
    caption: "friction signal",
    accent: "coral",
    delay: 0,
  },
  {
    position: "right",
    url: "docs.example / settings",
    agent: "cautious",
    action: "reading labels",
    caption: "observe",
    accent: "amber",
    delay: 0.9,
  },
  {
    position: "bottom",
    url: "checkout.test / cart",
    agent: "keyboard",
    action: "Tab → Enter",
    caption: "keyboard pass",
    accent: "cobalt",
    delay: 1.7,
  },
];

/** Quiet browser traces that make the hero feel observed without competing with the run form. */
export function AgentAmbient() {
  return (
    <div className="agent-ambient" aria-hidden="true">
      {SCENES.map((scene) => (
        <AgentScene key={scene.position} scene={scene} />
      ))}
    </div>
  );
}

function AgentScene({ scene }: { scene: Scene }) {
  return (
    <div
      className={`agent-scene agent-scene--${scene.position}`}
      style={{ "--agent-accent": ACCENTS[scene.accent], "--agent-delay": `${scene.delay}s` } as CSSProperties}
    >
      <div className="agent-browser">
        <div className="agent-browser-bar">
          <span className="agent-browser-dots">
            <span />
            <span />
            <span />
          </span>
          <span className="agent-url">{scene.url}</span>
          <span className="agent-live">
            <span className="agent-live-dot" />
            live
          </span>
        </div>

        <div className="agent-browser-body">
          <span className="agent-skeleton agent-skeleton--hero" />
          <span className="agent-skeleton agent-skeleton--wide" />
          <span className="agent-skeleton agent-skeleton--medium" />
          <div className="agent-skeleton-row">
            <span className="agent-skeleton agent-skeleton--card" />
            <span className="agent-skeleton agent-skeleton--card agent-skeleton--card-short" />
          </div>
          <span className="agent-target" />
          <MousePointer2 className="agent-pointer" fill="currentColor" stroke="currentColor" strokeWidth={1.5} />
          <span className="agent-callout">{scene.action}</span>
        </div>
      </div>

      <div className="agent-caption">
        <span className="agent-caption-dot" />
        <span>{scene.agent}</span>
        <span className="agent-caption-separator">·</span>
        <span>{scene.caption}</span>
      </div>
    </div>
  );
}
