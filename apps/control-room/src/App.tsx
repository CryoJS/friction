import { useCallback, useMemo, useState } from "react";
import { PERSONA_IDS, type PersonaId, type StepPayload } from "@friction/shared";
import { Header, type StartedRun } from "./components/Header";
import { Landing } from "./components/Landing";
import { PersonaColumn } from "./components/PersonaColumn";
import { ReportView } from "./components/ReportView";
import { RunBar } from "./components/RunBar";
import { useReport } from "./hooks/useReport";
import { useRunStream } from "./hooks/useRunStream";
import { snapshotFromView, summarize } from "./lib/runState";
import { useQuery } from "./lib/useQuery";

export default function App() {
  const [query, setQuery] = useQuery();
  const [startNotice, setStartNotice] = useState<string | null>(null);

  const stream = useRunStream(query.run, { replay: query.replay });
  const { view } = stream;
  const summary = summarize(view);

  // Whatever is on screen, as a snapshot: lets the report be built with no Worker.
  const localSnapshot = useMemo(() => stream.snapshot ?? snapshotFromView(view), [stream.snapshot, view]);
  const report = useReport(query.run, query.tab === "report", localSnapshot, {
    localOnly: stream.origin === "bundled",
    refreshKey: summary.frictionCount + (summary.phase === "complete" ? 1000 : 0),
  });

  const findStep = useCallback(
    (personaId: PersonaId, seq: number): StepPayload | undefined => {
      const live = view.personas[personaId].steps.find((step) => step.seq === seq);
      if (live) return live.payload;
      const recorded = stream.snapshot?.events.find((e) => e.type === "step" && e.personaId === personaId && e.seq === seq);
      return recorded?.type === "step" ? recorded.payload : undefined;
    },
    [view, stream.snapshot],
  );

  const onStarted = useCallback(
    (run: StartedRun) => {
      setStartNotice(run.notice);
      setQuery({ run: run.runId, replay: run.replay, tab: "room" });
    },
    [setQuery],
  );

  const notice = startNotice ?? stream.notice;

  return (
    <div className="flex h-full flex-col">
      <Header
        onStarted={onStarted}
        onHome={() => {
          setStartNotice(null);
          setQuery({ run: null, replay: false, tab: "room" });
        }}
      />

      {query.run ? (
        <>
          <RunBar
            view={view}
            origin={stream.origin}
            connection={stream.connection}
            elapsedMs={stream.elapsedMs}
            replay={stream.replay}
            tab={query.tab}
            onTab={(tab) => setQuery({ tab })}
            isReplay={query.replay}
            onToggleReplay={() => {
              setStartNotice(null);
              setQuery({ replay: !query.replay });
            }}
          />

          {notice && (
            <div className="flex shrink-0 items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900">
              <span className="font-semibold">Heads up:</span>
              <span className="min-w-0 flex-1">{notice}</span>
            </div>
          )}

          {query.tab === "report" ? (
            <ReportView report={report.report} loading={report.loading} local={report.local} findStep={findStep} />
          ) : (
            <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-3 lg:overflow-hidden">
              {PERSONA_IDS.map((id) => (
                <PersonaColumn key={id} persona={view.personas[id]} allowLiveView={stream.origin === "live"} startTs={view.firstTs} />
              ))}
            </main>
          )}
        </>
      ) : (
        <Landing
          onOpen={(runId, replay) => {
            setStartNotice(null);
            setQuery({ run: runId, replay, tab: "room" });
          }}
        />
      )}
    </div>
  );
}
