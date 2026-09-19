import { useEffect, useRef, useState } from "react";
import { normalizeTargetUrl, type OrchestratorHealth } from "@friction/shared";
import { api } from "../lib/api";
import { ArrowRight } from "./icons";

interface Props {
  onStarted: (scanId: string) => void;
  onReplayGolden: () => void;
}

const STORAGE_KEY = "friction:last-scan-url";
/** The URL + task form's key; its URL seeds the field once. */
const LEGACY_KEY = "friction:last-run-form";
const REPO_KEY = "friction:last-scan-repo";

function loadRepo(): string {
  try {
    return window.localStorage.getItem(REPO_KEY) ?? "";
  } catch {
    return "";
  }
}

function loadUrl(): string {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return saved;
    const legacy = JSON.parse(window.localStorage.getItem(LEGACY_KEY) ?? "null") as { url?: unknown } | null;
    return typeof legacy?.url === "string" ? legacy.url : "";
  } catch {
    return "";
  }
}

type Failure = { kind: "invalid" } | { kind: "unreachable"; detail: string };

/** One field, one button: Friction picks the tasks. Lives in the landing hero. */
export function ScanForm({ onStarted, onReplayGolden }: Props) {
  const [url, setUrl] = useState(loadUrl);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const field = useRef<HTMLInputElement>(null);
  // Null until the orchestrator answers; if it never does, the form is the URL field alone, as before.
  const [health, setHealth] = useState<OrchestratorHealth | null>(null);
  const [wantedRepo, setWantedRepo] = useState(loadRepo);
  const [autoPr, setAutoPr] = useState(true);
  const repos = health?.repos ?? [];
  // Only ever a repository the orchestrator offers: a remembered one that is gone reads as None.
  const repo = repos.includes(wantedRepo) ? wantedRepo : "";

  useEffect(() => {
    let live = true;
    api
      .orchestratorHealth()
      .then((answer) => live && setHealth(answer))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  function chooseRepo(next: string): void {
    setWantedRepo(next);
    try {
      window.localStorage.setItem(REPO_KEY, next);
    } catch {
      /* private mode: not worth failing over */
    }
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, url);
    } catch {
      /* private mode: not worth failing over */
    }
  }, [url]);

  async function start(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const target = normalizeTargetUrl(url);
    if (!target) {
      setFailure({ kind: "invalid" });
      field.current?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const { scanId } = await api.startScan(target, repo ? { repo, autoPr } : {});
      onStarted(scanId);
    } catch (err) {
      setFailure({ kind: "unreachable", detail: err instanceof Error ? err.message : "unknown error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void start(event)} className="glass rounded-card border border-hairline/15 p-3 shadow-subtle sm:p-4" aria-label="Scan a site" noValidate>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={field}
          type="text"
          inputMode="url"
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            if (failure?.kind === "invalid") setFailure(null);
          }}
          aria-invalid={failure?.kind === "invalid"}
          aria-describedby={failure ? "scan-form-error" : undefined}
          placeholder="https://your-store.com"
          aria-label="Website URL"
          autoComplete="url"
          spellCheck={false}
          className="field h-14 min-w-0 flex-1 px-6 font-mono text-body tracking-normal"
        />
        <button type="submit" disabled={busy} className="pill-cta h-14 shrink-0 px-6 text-body">
          {busy ? "Starting…" : "Scan & test"}
          {!busy && <ArrowRight size={16} />}
        </button>
      </div>

      <p className="mt-3 px-2 text-caption text-ash">Friction reads the site, picks its 10 most critical tasks and has the agent attempt each one.</p>

      {health && repos.length === 0 && (
        <p className="mt-2 px-2 text-caption text-smoke">
          To get draft pull requests for what it finds, connect a repository: set <span className="font-mono tracking-normal">GITHUB_TOKEN</span> and{" "}
          <span className="font-mono tracking-normal">GITHUB_REPO</span> for the orchestrator.
        </p>
      )}
      {repos.length > 0 && (
        <div className="mt-3 space-y-2 px-2">
          <label className="flex min-w-0 items-center gap-3 text-caption text-ash">
            <span className="shrink-0">Repository</span>
            <select
              value={repo}
              onChange={(event) => chooseRepo(event.target.value)}
              className="field h-9 min-w-0 flex-1 px-4 font-mono text-caption tracking-normal"
            >
              <option value="">None</option>
              {repos.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {repo && (
            <label className="flex items-center gap-2 text-caption text-ash">
              <input type="checkbox" checked={autoPr} onChange={(event) => setAutoPr(event.target.checked)} className="h-4 w-4 shrink-0 accent-white" />
              Open draft pull requests automatically
            </label>
          )}
          {repo && health?.githubDryRun && <p className="text-caption text-smoke">Preview only, nothing will be pushed.</p>}
        </div>
      )}

      {failure && (
        <p id="scan-form-error" role="alert" className="mt-2 px-2 text-caption text-sev-5">
          {failure.kind === "invalid" ? (
            "Enter a website URL, like https://your-store.com."
          ) : (
            <>
              Couldn't start the scan ({failure.detail}). Is the orchestrator running?{" "}
              <button type="button" onClick={onReplayGolden} className="text-white underline">
                Replay the golden run
              </button>
            </>
          )}
        </p>
      )}
    </form>
  );
}
