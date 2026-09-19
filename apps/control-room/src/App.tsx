import { useCallback, useMemo, useState } from "react";
import { GOLDEN_RUN_ID, PERSONA_IDS, type PersonaId, type StepPayload } from "@friction/shared";
import { Landing } from "./components/Landing";
import { Nav } from "./components/Nav";
import { PersonaColumn } from "./components/PersonaColumn";
import { ReportView } from "./components/ReportView";
import { RunBar } from "./components/RunBar";
import { Play, Plus, Sparkle } from "./components/icons";
import { ScanPage } from "./components/scan/ScanPage";
import { useReport } from "./hooks/useReport";
import { useRunStream } from "./hooks/useRunStream";
import { snapshotFromView, summarize } from "./lib/runState";
import { useQuery, type Tab } from "./lib/useQuery";

export default function App() {
  const [query, setQuery] = useQuery();
  const [overHero, setOverHero] = useState(true);

  // The single-run view only: a scan page streams its selected persona node itself.
  const runId = query.scan ? null : query.run;
  const stream = useRunStream(runId, { replay: query.replay });
  const { view } = stream;
  const summary = summarize(view);

  // Whatever is on screen, as a snapshot: lets the report be built with no Worker.
  const localSnapshot = useMemo(() => stream.snapshot ?? snapshotFromView(view), [stream.snapshot, view]);
  const report = useReport(runId, query.tab === "report", localSnapshot, {
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

  const goHome = useCallback(() => setQuery({ run: null, scan: null, node: null, replay: false, tab: "room" }), [setQuery]);
  const openScan = useCallback((scanId: string) => setQuery({ scan: scanId, node: null, run: null, replay: false, tab: "room" }), [setQuery]);
  const openRun = useCallback(
    (id: string, replay = false) => setQuery({ run: id, scan: null, node: null, replay, tab: "room" }),
    [setQuery],
  );
  const selectNode = useCallback((node: string) => setQuery({ node }), [setQuery]);

  // Every view but the landing carries the same white pill: scans start on the home page.
  const newScan = (
    <button type="button" onClick={goHome} className="pill-cta h-8.5 px-3.5 text-ui sm:px-4" aria-label="New scan">
      <Plus size={14} />
      <span className="hidden sm:inline">New scan</span>
    </button>
  );

  if (query.scan) {
    return (
      <div className="flex h-full flex-col">
        <Nav onHome={goHome} compact action={newScan} />
        <ScanPage key={query.scan} scanId={query.scan} nodeId={query.node} onSelectNode={selectNode} onOpenRun={openRun} />
      </div>
    );
  }

  if (!runId) {
    return (
      <div className="flex h-full flex-col">
        <Nav
          onHome={goHome}
          frosted={overHero}
          action={
            <button type="button" onClick={() => openRun(GOLDEN_RUN_ID, true)} className="pill-cta h-8.5 px-4 text-ui">
              <Play size={12} />
              Watch the demo
            </button>
          }
        >
          <a href="#how" className="pill-ghost hidden border-transparent md:inline-flex">
            How it works
          </a>
          <a href="#scans" className="pill-ghost hidden border-transparent md:inline-flex">
            Recent scans
          </a>
        </Nav>
        <Landing onOpenScan={openScan} onOpenRun={openRun} onOverHero={setOverHero} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Nav onHome={goHome} compact action={newScan}>
        <TabButton tab="room" current={query.tab} onTab={(tab) => setQuery({ tab })}>
          <span className="sm:hidden">Room</span>
          <span className="hidden sm:inline">Control room</span>
        </TabButton>
        <TabButton tab="report" current={query.tab} onTab={(tab) => setQuery({ tab })}>
          Report
          {summary.frictionCount > 0 && (
            <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/12 px-1.5 text-[12px] tabular-nums text-white">
              {summary.frictionCount}
            </span>
          )}
        </TabButton>
      </Nav>

      <RunBar
        view={view}
        origin={stream.origin}
        connection={stream.connection}
        elapsedMs={stream.elapsedMs}
        replay={stream.replay}
        isReplay={query.replay}
        onToggleReplay={() => setQuery({ replay: !query.replay })}
      />

      {stream.notice && (
        <div className="flex shrink-0 justify-center px-4 pt-4">
          <p role="status" className="glass inline-flex max-w-3xl items-start gap-2.5 rounded-nav border border-hairline/20 px-4 py-2 text-ui text-bone">
            <Sparkle size={14} className="mt-0.75 shrink-0 text-white" />
            <span>
              <span className="text-white">Heads up.</span> {stream.notice}
            </span>
          </p>
        </div>
      )}

      {query.tab === "report" ? (
        <ReportView report={report.report} loading={report.loading} local={report.local} findStep={findStep} />
      ) : (
        <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-4 pb-4 pt-5 sm:px-6 sm:pb-6 lg:grid-cols-3 lg:overflow-hidden">
          {PERSONA_IDS.map((id) => (
            <PersonaColumn key={id} persona={view.personas[id]} allowLiveView={stream.origin === "live"} startTs={view.firstTs} />
          ))}
        </main>
      )}
    </div>
  );
}

function TabButton({ tab, current, onTab, children }: { tab: Tab; current: Tab; onTab: (tab: Tab) => void; children: React.ReactNode }) {
  const active = tab === current;
  return (
    <button
      type="button"
      onClick={() => onTab(tab)}
      aria-current={active ? "page" : undefined}
      className={`pill-ghost ${active ? "" : "border-transparent text-white/70"}`}
    >
      {children}
    </button>
  );
}
