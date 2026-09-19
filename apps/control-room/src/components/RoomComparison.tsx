import { useState } from "react";
import type { FixEvent } from "@friction/shared";
import { fixList, type RunView } from "../lib/runState";
import { StageBadge, categoryLabel } from "./badges";
import { LanePane } from "./LanePane";

interface Props {
  view: RunView;
  allowLiveView: boolean;
}

/** The fix being verified right now, else the most recent one. */
function defaultFix(fixes: readonly FixEvent[]): string | null {
  const active = fixes.find((f) => f.payload.stage === "verifying" || f.payload.stage === "proposed");
  return (active ?? fixes[fixes.length - 1])?.payload.findingId ?? null;
}

/**
 * The control room once verification starts: the primary run on the left, a
 * verify run on the right, one tab per fix. Before it starts the room stays a
 * single pane (see App).
 */
export function RoomComparison({ view, allowLiveView }: Props) {
  const fixes = fixList(view);
  const [picked, setPicked] = useState<string | null>(null);
  const selectedId = picked && view.fixes[picked] ? picked : defaultFix(fixes);
  const selected = selectedId ? view.fixes[selectedId] : undefined;
  const lane = selectedId ? view.verify[selectedId] : undefined;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
      <LanePane lane={view.primary} title="Before" subtitle="lane primary · the original run" allowLiveView={allowLiveView} startTs={view.firstTs} layout="stacked" />

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Fixes being verified">
          {fixes.map((fix) => {
            const id = fix.payload.findingId;
            const active = id === selectedId;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPicked(id)}
                className={`pill-ghost gap-2 ${active ? "" : "border-transparent text-white/70"}`}
              >
                {fix.payload.category ? categoryLabel(fix.payload.category) : id}
                <StageBadge stage={fix.payload.stage} />
              </button>
            );
          })}
        </div>

        {selected && (
          <p className={`text-ui leading-snug ${selected.payload.stage === "rejected" ? "text-sev-3" : "text-bone"}`}>
            {selected.payload.note && selected.payload.stage !== "verifying" && selected.payload.stage !== "proposed" ? selected.payload.note : selected.payload.summary}
          </p>
        )}

        {lane ? (
          <LanePane
            lane={lane}
            title={selected?.payload.stage === "verifying" ? "After · re-running with the fix applied" : "After · with the fix applied"}
            subtitle={`lane verify · fix for ${selectedId}`}
            accent={selected?.payload.stage === "rejected" ? "warn" : selected?.payload.stage === "verified" || selected?.payload.stage === "pr_opened" ? "good" : "none"}
            allowLiveView={allowLiveView}
            startTs={view.firstTs}
            layout="stacked"
          />
        ) : (
          <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center gap-3 rounded-card border border-dashed border-hairline/20 px-6 text-center">
            <p className="text-body text-bone">{selected ? "Opening a fresh browser session with the fix installed" : "Proposing fixes for the top findings"}</p>
            <div className="wash wash-sweep h-px w-40" aria-hidden="true" />
          </div>
        )}
      </div>
    </div>
  );
}
