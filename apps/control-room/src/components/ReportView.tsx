import { useMemo, useState } from "react";
import { FRICTION_LABELS, SEVERITY_LABELS, type PersonaId, type ReportFinding, type ReportResponse, type Severity, type StepPayload } from "@friction/shared";
import { ACTION_VERBS, formatDuration, percent } from "../lib/format";
import { EvidenceImage } from "./EvidenceImage";
import { SEVERITY_STYLES, SeverityBadge, StateBadge, categoryLabel } from "./badges";

interface Props {
  report: ReportResponse | null;
  loading: boolean;
  /** Assembled in the browser because the Worker did not answer. */
  local: boolean;
  /** Full step payloads the control room already holds, so wireframe evidence renders offline. */
  findStep: (personaId: PersonaId, seq: number) => StepPayload | undefined;
}

const SEVERITIES: Severity[] = [5, 4, 3, 2, 1];

export function ReportView({ report, loading, local, findStep }: Props) {
  const [persona, setPersona] = useState<PersonaId | "all">("all");

  const findings = useMemo(
    () => (report ? report.findings.filter((finding) => persona === "all" || finding.personaId === persona) : []),
    [report, persona],
  );

  if (!report) {
    return <main className="flex flex-1 items-center justify-center text-sm text-slate-400">{loading ? "Building the report…" : "No report available for this run."}</main>;
  }

  return (
    <main className="pane flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-4">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
            <div>
              <div className="text-3xl font-bold tabular-nums leading-none text-slate-900">{report.totals.findings}</div>
              <div className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">friction findings</div>
            </div>
            <div className="flex items-end gap-1.5">
              {SEVERITIES.map((severity) => (
                <div key={severity} className="text-center" title={SEVERITY_LABELS[severity]}>
                  <div className={`min-w-9 rounded px-2 py-1 text-sm font-bold tabular-nums ${report.totals.bySeverity[severity] > 0 ? SEVERITY_STYLES[severity].solid : "bg-slate-100 text-slate-400"}`}>
                    {report.totals.bySeverity[severity]}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-500">S{severity}</div>
                </div>
              ))}
            </div>
            <div className="ml-auto grid gap-1.5">
              {report.personas.map((section) => (
                <div key={section.personaId} className="flex items-center justify-end gap-2 text-xs">
                  <span className="text-slate-600">{section.displayName}</span>
                  <span className="tabular-nums text-slate-400">
                    {section.stepCount} steps{section.durationMs !== null && ` · ${formatDuration(section.durationMs)}`}
                  </span>
                  <StateBadge state={section.state} />
                </div>
              ))}
            </div>
          </div>
          {(local || report.source === "fixture") && (
            <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
              {local && "The Worker did not answer, so this report was assembled in the browser from the events on screen. "}
              {report.source === "fixture" && "Data source: the golden fixture, not a live site."}
            </p>
          )}
        </section>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Ranked by severity, then confidence</span>
          <Filter active={persona === "all"} onClick={() => setPersona("all")} label="All personas" count={report.totals.findings} />
          {report.personas.map((section) => (
            <Filter key={section.personaId} active={persona === section.personaId} onClick={() => setPersona(section.personaId)} label={section.displayName} count={section.findings.length} />
          ))}
        </div>

        <div className="mt-3 space-y-3 pb-8">
          {findings.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-400">No friction found{persona === "all" ? " yet" : " for this persona"}.</p>}
          {findings.map((finding, index) => (
            <FindingCard
              key={finding.id}
              rank={index + 1}
              finding={finding}
              personaName={report.personas.find((section) => section.personaId === finding.personaId)?.displayName ?? finding.personaId}
              payload={findStep(finding.personaId, finding.evidenceSeq)}
            />
          ))}
        </div>
      </div>
    </main>
  );
}

function Filter({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${active ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200 hover:ring-slate-300"}`}
    >
      {label} <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function FindingCard({ finding, rank, personaName, payload }: { finding: ReportFinding; rank: number; personaName: string; payload: StepPayload | undefined }) {
  const style = SEVERITY_STYLES[finding.severity];
  const evidence = finding.evidence;

  return (
    <article className={`overflow-hidden rounded-lg border border-l-4 border-slate-200 bg-white shadow-sm ${style.border}`}>
      <div className="grid gap-0 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
        <div className="border-b border-slate-100 bg-slate-50 lg:border-b-0 lg:border-r">
          {evidence ? (
            <EvidenceImage
              source={{ screenshotKey: evidence.screenshotKey, bbox: evidence.bbox, viewport: evidence.viewport, payload }}
              boxClass={style.box}
              label={evidence.targetLabel}
            />
          ) : (
            <div className="flex aspect-video items-center justify-center text-xs text-slate-400">The evidence step was never received.</div>
          )}
        </div>

        <div className="min-w-0 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold tabular-nums text-slate-400">#{rank}</span>
            <SeverityBadge severity={finding.severity} withLabel />
            <h3 className={`text-sm font-semibold ${style.text}`} title={FRICTION_LABELS[finding.category].blurb}>
              {categoryLabel(finding.category)}
            </h3>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{personaName}</span>
            <Confidence value={finding.confidence} />
          </div>

          {finding.summary && <p className="mt-2 text-sm font-medium leading-snug text-slate-900">{finding.summary}</p>}
          {finding.whyItMatters && <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{finding.whyItMatters}</p>}

          <div className={`mt-3 rounded-md px-3 py-2 ${style.bg}`}>
            <div className={`text-[10px] font-bold uppercase tracking-wider ${style.text}`}>Recommendation</div>
            <p className="mt-0.5 text-[13px] leading-relaxed text-slate-800">{finding.recommendation}</p>
          </div>

          {evidence && (
            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              <dt className="text-slate-400">URL</dt>
              <dd className="truncate font-mono text-slate-700" title={evidence.url}>
                {evidence.url}
              </dd>
              <dt className="text-slate-400">Selector</dt>
              <dd className="truncate font-mono text-slate-700" title={evidence.selector}>
                {evidence.selector || "n/a"}
              </dd>
              <dt className="text-slate-400">Action</dt>
              <dd className="text-slate-700">
                {ACTION_VERBS[evidence.actionType]} {evidence.targetLabel && `“${evidence.targetLabel}”`}
                {evidence.value && evidence.actionType !== "navigate" && <span className="text-slate-500"> ({evidence.value})</span>}
                <span className="text-slate-400"> · {formatDuration(evidence.durationMs)} · event #{evidence.seq}</span>
              </dd>
              <dt className="text-slate-400">Thinking</dt>
              <dd className="italic text-slate-600">“{evidence.rationale}”</dd>
            </dl>
          )}

          <div className="mt-3">
            {finding.replayUrl ? (
              <a
                href={finding.replayUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-indigo-400 hover:text-indigo-700"
              >
                Watch the Browserbase session replay <span aria-hidden>↗</span>
              </a>
            ) : (
              <span className="text-[11px] text-slate-400">No Browserbase session replay for this run (fixture or mock data).</span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function Confidence({ value }: { value: number }) {
  return (
    <span className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-500" title="How sure the judgement is that this is real friction">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <span className="block h-full rounded-full bg-slate-700" style={{ width: percent(value) }} />
      </span>
      <span className="tabular-nums">{percent(value)} confident</span>
    </span>
  );
}
