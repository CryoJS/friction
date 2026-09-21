import { useEffect, useState } from "react";
import { DEFAULT_VIEWPORT, GOLDEN_EVIDENCE_PREFIX, mockScreenshotDataUri, type BBox, type StepPayload, type Viewport } from "@friction/shared";
import { api } from "../lib/api";
import { DEMO_MODE } from "../lib/config";
import { goldenPayloadForScreenshot } from "../lib/demo";

/** What we need from a step to show it as evidence. ReportEvidence and StepPayload both fit. */
export interface EvidenceSource {
  screenshotKey: string;
  bbox: BBox | null;
  viewport?: Viewport;
  /** Present when the full step is known; lets wireframes render with no network. */
  payload?: StepPayload;
}

type Stage = "network" | "wireframe" | "missing";

/**
 * Where to look for the pixels, in order:
 *   golden/* keys   render the wireframe locally, never touch the network
 *   anything else   the Worker (R2); if that fails and the step is a mock
 *                   (.svg) wireframe, render it locally; otherwise say so.
 */
function firstStage(source: EvidenceSource): Stage {
  if (!source.screenshotKey) return source.payload ? "wireframe" : "missing";
  if (source.screenshotKey.startsWith(GOLDEN_EVIDENCE_PREFIX) && (source.payload || (DEMO_MODE && goldenPayloadForScreenshot(source.screenshotKey)))) return "wireframe";
  return "network";
}

interface Props {
  source: EvidenceSource;
  /** Tailwind border colour class for the bbox, e.g. "border-sev-5". */
  boxClass?: string;
  label?: string;
  className?: string;
}

/** A screenshot with the target's bbox drawn over it as an overlay rectangle. */
export function EvidenceImage({ source, boxClass = "border-white", label, className = "" }: Props) {
  const [stage, setStage] = useState<Stage>(() => firstStage(source));
  useEffect(() => setStage(firstStage(source)), [source.screenshotKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewport = source.viewport ?? DEFAULT_VIEWPORT;
  const demoPayload = DEMO_MODE ? goldenPayloadForScreenshot(source.screenshotKey) : null;
  const wireframePayload = source.payload ?? demoPayload;
  const canWireframe = Boolean(wireframePayload) && (source.screenshotKey.endsWith(".svg") || !source.screenshotKey);

  let src: string | null = null;
  if (stage === "network") src = api.evidenceUrl(source.screenshotKey);
  else if (stage === "wireframe" && wireframePayload) src = mockScreenshotDataUri(wireframePayload);

  const box = source.bbox && src ? clampBox(source.bbox, viewport) : null;

  return (
    <div
      className={`relative w-full overflow-hidden bg-graphite ${className}`}
      style={{ aspectRatio: `${viewport.w} / ${viewport.h}` }}
    >
      {src ? (
        <img
          src={src}
          alt={label ? `Screenshot: ${label}` : "Evidence screenshot"}
          className="absolute inset-0 h-full w-full object-fill"
          draggable={false}
          onError={() => setStage(canWireframe && stage === "network" ? "wireframe" : "missing")}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-caption text-smoke">Screenshot unavailable</div>
      )}
      {box && (
        <div
          className={`pointer-events-none absolute rounded-[3px] border-2 ${boxClass}`}
          style={{
            left: `${box.left}%`,
            top: `${box.top}%`,
            width: `${box.width}%`,
            height: `${box.height}%`,
            // Dims everything except the target. (A Tailwind ring is also a box-shadow
            // and would be overwritten by this, which is why the rectangle is a border.)
            boxShadow: "0 0 0 9999px rgba(10, 10, 10, 0.42)",
          }}
        />
      )}
    </div>
  );
}

/** bbox (CSS px in the viewport) -> percentages of the image, clipped to it. Null if fully off-screen. */
function clampBox(bbox: BBox, viewport: Viewport): { left: number; top: number; width: number; height: number } | null {
  const x1 = Math.max(0, bbox.x);
  const y1 = Math.max(0, bbox.y);
  const x2 = Math.min(viewport.w, bbox.x + bbox.w);
  const y2 = Math.min(viewport.h, bbox.y + bbox.h);
  if (x2 - x1 < 2 || y2 - y1 < 2) return null;
  return {
    left: (x1 / viewport.w) * 100,
    top: (y1 / viewport.h) * 100,
    width: ((x2 - x1) / viewport.w) * 100,
    height: ((y2 - y1) / viewport.h) * 100,
  };
}
