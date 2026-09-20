import { useCallback, useRef, useState } from "react";
import { Landing } from "./components/Landing";
import { HomeScanNav, Nav } from "./components/Nav";
import { Plus } from "./components/icons";
import { NewScanDialog } from "./components/NewScanDialog";
import { ScanPage } from "./components/scan/ScanPage";
import { ScanViewTabs, type ScanView } from "./components/scan/ScanGraph";
import { useQuery, type Tab } from "./lib/useQuery";

export default function App() {
  const [query, setQuery] = useQuery();
  const [overHero, setOverHero] = useState(true);
  const [newScanOpen, setNewScanOpen] = useState(false);
  const [scanView, setScanView] = useState<ScanView>("graph");
  const landingScroller = useRef<HTMLElement>(null);

  const goHome = useCallback(() => {
    landingScroller.current?.scrollTo({ top: 0, behavior: "smooth" });
    setNewScanOpen(false);
    setScanView("graph");
    setQuery({ scan: null, node: null, tab: "scan" });
  }, [setQuery]);
  const openScan = useCallback((scanId: string) => {
    setScanView("graph");
    setQuery({ scan: scanId, node: null, tab: "scan" });
  }, [setQuery]);
  const startNewScan = useCallback((scanId: string) => {
    setNewScanOpen(false);
    openScan(scanId);
  }, [openScan]);
  const selectScanView = useCallback((view: ScanView) => {
    setScanView(view);
    if (query.tab === "results") setQuery({ tab: "scan" });
  }, [query.tab, setQuery]);
  const selectNode = useCallback((node: string) => setQuery({ node, tab: "scan" }), [setQuery]);
  const openNewScan = useCallback(() => setNewScanOpen(true), []);
  const closeNewScan = useCallback(() => setNewScanOpen(false), []);

  // The scan view keeps the launcher available without taking the user away from the current scan.
  const newScan = (
    <button type="button" onClick={openNewScan} className="pill-cta h-8.5 px-3.5 text-ui sm:px-4" aria-label="New scan">
      <Plus size={14} />
      <span className="hidden sm:inline">New scan</span>
    </button>
  );

  if (query.scan) {
    return (
      <div className="flex h-full flex-col">
        <Nav onHome={goHome} action={newScan}>
          <ScanViewTabs view={scanView} onChange={selectScanView} />
          <TabButton tab="results" current={query.tab === "results" ? "results" : "scan"} onTab={(tab) => setQuery({ tab })}>
            Results
          </TabButton>
        </Nav>
        <ScanPage
          key={query.scan}
          scanId={query.scan}
          nodeId={query.node}
          view={query.tab === "results" ? "results" : "scan"}
          scanView={scanView}
          onSelectNode={selectNode}
        />
        <NewScanDialog open={newScanOpen} onClose={closeNewScan} onStarted={startNewScan} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Nav onHome={goHome} frosted={overHero}>
        <HomeScanNav onOpenScan={openScan} />
      </Nav>
      <Landing onOpenScan={openScan} onOverHero={setOverHero} scrollerRef={landingScroller} />
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
