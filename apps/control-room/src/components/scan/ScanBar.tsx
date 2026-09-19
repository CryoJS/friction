import { useEffect, useState } from "react";
import { isScanFinished, type ScanTreeResponse } from "@friction/shared";
import { formatElapsed, shortUrl } from "../../lib/format";
import { SCAN_STATUS, hostOf, runProgress } from "../../lib/scan";
import { Chip, Dot } from "../badges";
import { ArrowUpRight } from "../icons";

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** The scan's identity and clock, under the floating nav: the same anatomy as RunBar. */
export function ScanBar({ tree }: { tree: ScanTreeResponse }) {
  const { scan } = tree;
  const finished = isScanFinished(scan.status);
  const now = useNow(!finished);
  const status = SCAN_STATUS[scan.status];
  const progress = runProgress(tree);
  const elapsed = (finished ? (scan.completedAt ?? now) : now) - scan.createdAt;
  const line =
    progress.total > 0
      ? `${progress.done}/${progress.total} runs done`
      : scan.status === "failed"
        ? "No runs were started"
        : `${scan.pages.length} ${scan.pages.length === 1 ? "page" : "pages"} read`;

  return (
    <div className="shrink-0 px-4 pt-20 sm:px-6">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-85">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="shrink-0">
              <Chip tone={status.tone}>{status.label}</Chip>
            </span>
            {scan.taskSource === "mock" && (
              <span className="shrink-0" title="No API keys: canned tasks, and every run replays the golden run">
                <Chip tone="warn">Mock scan</Chip>
              </span>
            )}
            {scan.taskSource === "fallback" && (
              <span className="shrink-0" title="The site could not be read, so the tasks are generic">
                <Chip tone="warn">Generic tasks</Chip>
              </span>
            )}
            <a
              href={scan.url}
              target="_blank"
              rel="noreferrer"
              className="group inline-flex min-w-0 items-center gap-1 font-mono text-caption tracking-normal text-smoke transition-colors hover:text-white"
              title={scan.url}
            >
              <span className="truncate">{shortUrl(scan.url)}</span>
              <ArrowUpRight size={13} className="shrink-0 opacity-60 group-hover:opacity-100" />
            </a>
          </div>
          <h1 className="mt-1.5 truncate font-heading text-heading-sm font-medium tracking-[-0.02em] text-bone">Site scan of {hostOf(scan.url)}</h1>
        </div>

        <div className="shrink-0 text-right max-sm:text-left">
          <div className="font-mono text-[32px] leading-none tabular-nums tracking-[-0.02em] text-white" title="Elapsed">
            {formatElapsed(elapsed)}
          </div>
          <div className="mt-1.5 flex items-center justify-end gap-2 text-caption tabular-nums text-ash max-sm:justify-start">
            <Dot tone={status.tone} size={7} />
            {line}
          </div>
        </div>
      </div>
    </div>
  );
}
