import { isTerminalState, scanNodeId, type PersonaId, type ScanTreeTask } from "@friction/shared";
import { useRunStream } from "../../hooks/useRunStream";
import { EvidenceImage } from "../EvidenceImage";
import { PersonaColumn } from "../PersonaColumn";
import { SEVERITY_STYLES, SeverityBadge, categoryLabel } from "../badges";
import { ArrowLeft } from "../icons";
import { Notice } from "./Notice";

interface Props {
  task: ScanTreeTask;
  personaId: PersonaId;
  onSelect: (nodeId: string) => void;
}

/**
 * One persona run, live: the control room's own PersonaColumn on the run's SSE
 * stream, then this persona's findings with their screenshots. SidePanel keys
 * it by run id, so selecting a persona of another task opens that run's stream.
 */
export function PersonaPanel({ task, personaId, onSelect }: Props) {
  const stream = useRunStream(task.runId, { replay: false });
  const persona = stream.view.personas[personaId];
  const findings = [...persona.frictions].sort((a, b) => b.payload.severity - a.payload.severity || a.seq - b.seq);

  return (
    <div className="space-y-5">
      <header>
        <button type="button" onClick={() => onSelect(scanNodeId({ kind: "task", index: task.index }))} className="pill-ghost h-8 px-3 text-caption">
          <ArrowLeft size={13} />
          Back to T{task.index + 1}
        </button>
        <h2 className="mt-3 font-heading text-subheading text-white">{task.title}</h2>
      </header>

      {stream.notice && <Notice tone="warn">{stream.notice}</Notice>}

      {/* From lg the panel scrolls on its own, so the column gets a fixed height and scrolls its friction and timeline pane inside it. */}
      <div className="grid lg:h-160">
        <PersonaColumn persona={persona} allowLiveView={stream.origin === "live"} startTs={stream.view.firstTs} idleLabel="Queued" />
      </div>

      <section aria-label="Evidence">
        <h3 className="flex items-center gap-2 text-caption text-ash">
          Evidence
          <span className={`tabular-nums ${findings.length > 0 ? "text-sev-5" : "text-smoke"}`}>{findings.length}</span>
        </h3>
        {findings.length === 0 ? (
          <p className="mt-2 text-caption text-smoke">{isTerminalState(persona.state) ? "No friction was detected in this run." : "Nothing detected yet."}</p>
        ) : (
          <div className="mt-3 space-y-4">
            {findings.map((friction) => {
              const index = persona.steps.findIndex((step) => step.seq === friction.payload.evidenceSeq);
              const step = persona.steps[index];
              const style = SEVERITY_STYLES[friction.payload.severity];
              return (
                <article key={`${personaId}:${friction.seq}`} className="overflow-hidden rounded-card border border-hairline/10 bg-white/4">
                  <div className="p-3 pb-0">
                    {step ? (
                      <div className="overflow-hidden rounded-xl">
                        <EvidenceImage
                          source={{ screenshotKey: step.payload.screenshotKey, bbox: step.payload.bbox, viewport: step.payload.viewport, payload: step.payload }}
                          boxClass={style.box}
                          label={step.payload.targetLabel}
                        />
                      </div>
                    ) : (
                      <div className="flex aspect-video items-center justify-center rounded-xl bg-graphite px-6 text-center text-caption text-smoke">
                        The evidence step was never received.
                      </div>
                    )}
                  </div>
                  <div className="px-5 pb-4 pt-3">
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={friction.payload.severity} />
                      <h4 className={`min-w-0 truncate text-body ${style.text}`}>{categoryLabel(friction.payload.category)}</h4>
                      {index >= 0 && <span className="ml-auto shrink-0 text-caption tabular-nums text-smoke">step {index + 1}</span>}
                    </div>
                    {friction.payload.summary && <p className="mt-2 text-ui leading-snug text-bone">{friction.payload.summary}</p>}
                    <p className="mt-1.5 text-caption text-ash">
                      <span className="text-bone">Fix: </span>
                      {friction.payload.recommendation}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
