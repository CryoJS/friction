import { useEffect, useState, type FormEvent } from "react";
import { normalizeTargetUrl, type ScanListItem } from "@friction/shared";
import { api } from "../lib/api";
import { DEMO_MODE } from "../lib/config";
import { shortUrl } from "../lib/format";
import { SCAN_STATUS } from "../lib/scan";
import { Dot } from "./badges";
import { ArrowRight, LogoMark } from "./icons";

interface Props {
  onHome: () => void;
  /** Frosted over the hero; graphite over scrolling content, where text would bleed through. */
  frosted?: boolean;
  /** Links or tabs, between the logo and the action. */
  children?: React.ReactNode;
  /** The one white pill, where a view has one. */
  action?: React.ReactNode;
}

/** A detached, frosted bar that floats 16px off the top of the viewport. */
export function Nav({ onHome, frosted = false, children, action }: Props) {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <nav
        aria-label="Main"
        className={`pointer-events-auto flex max-w-full items-center gap-1 rounded-nav border p-1.5 shadow-nav backdrop-blur-[4px] transition-[background-color,border-color] duration-300 ease-out ${
          frosted ? "border-white/20 bg-frost/10" : "border-hairline/15 bg-graphite/90"
        }`}
      >
        <button type="button" onClick={onHome} className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full p-1" title="All runs" aria-label="All runs">
          <LogoMark size={26} />
        </button>
        {children && <div className="flex min-w-0 items-center gap-1">{children}</div>}
        {action && <div className="ml-1 shrink-0">{action}</div>}
      </nav>
    </header>
  );
}

interface HomeScanNavProps {
  onOpenScan: (scanId: string) => void;
}

/** The landing nav is either a compact scan launcher or a link to the newest scan. */
export function HomeScanNav({ onOpenScan }: HomeScanNavProps) {
  if (DEMO_MODE) return <DemoHomeNav />;
  return <LiveHomeScanNav onOpenScan={onOpenScan} />;
}

function DemoHomeNav() {
  return (
    <a href="#scans" className="pill-ghost">
      Golden run
    </a>
  );
}

function LiveHomeScanNav({ onOpenScan }: HomeScanNavProps) {
  const [scans, setScans] = useState<ScanListItem[]>([]);
  const [url, setUrl] = useState(() => loadSavedScanUrl());
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    let live = true;
    const refresh = (): void => {
      api
        .listScans()
        .then((body) => live && setScans(body.scans))
        .catch(() => live && setScans([]));
    };
    refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  const latestScan = [...scans].sort((left, right) => right.createdAt - left.createdAt)[0];

  async function start(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const target = normalizeTargetUrl(url);
    if (!target) {
      setInvalid(true);
      return;
    }

    setBusy(true);
    setInvalid(false);
    try {
      window.localStorage.setItem("friction:last-scan-url", target);
    } catch {
      /* Storage is a convenience only. */
    }
    try {
      const { scanId } = await api.startScan(target);
      onOpenScan(scanId);
    } catch {
      setInvalid(true);
    } finally {
      setBusy(false);
    }
  }

  if (latestScan) {
    const status = SCAN_STATUS[latestScan.status];
    const progress = latestScan.tasksTotal > 0
      ? `${latestScan.tasksPassed}/${latestScan.tasksTotal} tasks`
      : latestScan.pages.length > 0
        ? `${latestScan.pages.length} pages`
        : "Starting";
    return (
      <button
        type="button"
        onClick={() => onOpenScan(latestScan.id)}
        className="home-nav-scan-preview"
        title={`Open scan for ${latestScan.url}`}
        aria-label={`Open ${status.label.toLowerCase()} scan for ${shortUrl(latestScan.url)}`}
      >
        <Dot tone={status.tone} size={7} />
        <span className="home-nav-scan-status">{status.label}</span>
        <span className="home-nav-scan-url" title={latestScan.url}>{shortUrl(latestScan.url)}</span>
        <span className="home-nav-scan-progress">{progress}</span>
        <ArrowRight size={14} />
      </button>
    );
  }

  return (
    <form onSubmit={(event) => void start(event)} className="home-nav-scan-form" aria-label="Start a scan">
      <input
        type="text"
        inputMode="url"
        value={url}
        onChange={(event) => {
          setUrl(event.target.value);
          if (invalid) setInvalid(false);
        }}
        aria-invalid={invalid}
        aria-label="Website URL"
        placeholder="Scan a URL"
        autoComplete="url"
        spellCheck={false}
        className="home-nav-scan-input"
      />
      <button type="submit" disabled={busy} className="pill-cta home-nav-scan-submit" aria-label="Scan" title="Scan">
        <ArrowRight size={15} />
      </button>
    </form>
  );
}

function loadSavedScanUrl(): string {
  try {
    return window.localStorage.getItem("friction:last-scan-url") ?? "";
  } catch {
    return "";
  }
}
