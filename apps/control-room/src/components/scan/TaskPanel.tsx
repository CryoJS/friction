import { PERSONA_BY_ID, scanNodeId, taskVerdict, type ScanReportResponse, type ScanTreeTask } from "@friction/shared";
import { VERDICT } from "../../lib/scan";
import { Chip, StateBadge } from "../badges";
import { ArrowRight, PERSONA_GLYPHS } from "../icons";
import { IssueCard } from "./IssueCard";

interface Props {
  task: ScanTreeTask;
  report: ScanReportResponse | null;
  onSelect: (nodeId: string) => void;
  onOpenRun: (runId: string) => void;
}

/** One task: what it is, why it matters, how its three personas did, and the issues it hit. */
export function TaskPanel({ task, report, onSelect, onOpenRun }: Props) {
  const verdict = VERDICT[taskVerdict(task.personas.map((p) => p.state))];
  const ranked = report
    ? report.issues.map((issue, index) => ({ issue, rank: index + 1 })).filter(({ issue }) => issue.taskIndexes.includes(task.index))
    : [];

  return (
    <div className="space-y-5">
      <header>
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-caption tabular-nums tracking-normal text-ash">T{task.index + 1}</span>
          <Chip tone={verdict.tone}>{verdict.label}</Chip>
        </div>
        <h2 className="mt-2 font-heading text-heading-sm font-medium tracking-[-0.02em] text-white">{task.title}</h2>
      </header>

      <dl className="space-y-3">
        <div>
          <dt className="text-caption text-smoke">Why it's critical</dt>
          <dd className="mt-1 text-body text-ash">{task.whyCritical}</dd>
        </div>
        <div>
          <dt className="text-caption text-smoke">Success looks like</dt>
          <dd className="mt-1 text-body text-ash">{task.successCheck}</dd>
        </div>
      </dl>

      <section aria-label="Personas">
        <h3 className="text-caption text-ash">Personas</h3>
        <ul className="mt-2 overflow-hidden rounded-card border border-hairline/10 bg-white/4">
          {task.personas.map((p) => {
            const Glyph = PERSONA_GLYPHS[p.personaId];
            return (
              <li key={p.personaId} className="border-b border-hairline/10 last:border-b-0">
                <button
                  type="button"
                  onClick={() => onSelect(scanNodeId({ kind: "persona", index: task.index, personaId: p.personaId }))}
                  className="group flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-white/3"
                >
                  <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-icon bg-white text-black">
                    <Glyph size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ui text-bone group-hover:text-white">{PERSONA_BY_ID[p.personaId].displayName}</span>
                    <span className="block text-caption tabular-nums text-smoke">
                      {p.stepCount} steps · {p.findingCount} {p.findingCount === 1 ? "finding" : "findings"}
                    </span>
                  </span>
                  <StateBadge state={p.state} idleLabel="Queued" />
                </button>
              </li>
            );
          })}
        </ul>
        {/* A real link, so it opens in a new tab too; a plain click stays in the app. */}
        <a
          href={`?run=${encodeURIComponent(task.runId)}`}
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
            event.preventDefault();
            onOpenRun(task.runId);
          }}
          className="pill-ghost mt-3"
        >
          Open full control room
          <ArrowRight size={14} />
        </a>
      </section>

      <section aria-label="Issues in this task">
        <h3 className="font-heading text-subheading text-bone">
          Issues in this task <span className="tabular-nums text-smoke">{ranked.length}</span>
        </h3>
        <div className="mt-3 space-y-4">
          {ranked.length === 0 && <p className="text-caption text-smoke">{report ? "None so far." : "Building the report…"}</p>}
          {ranked.map(({ issue, rank }) => (
            <IssueCard key={issue.key} issue={issue} rank={rank} onSelect={onSelect} />
          ))}
        </div>
      </section>
    </div>
  );
}
