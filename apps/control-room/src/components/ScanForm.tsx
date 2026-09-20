import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeTargetUrl, type OrchestratorHealth } from "@friction/shared";
import { api } from "../lib/api";
import { ArrowRight } from "./icons";
import { GitHubConnect } from "./scan/GitHubConnect";

interface Props {
  onStarted: (scanId: string) => void;
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
export function ScanForm({ onStarted }: Props) {
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
  // After GitHub is connected, or its repositories re-ticked: the Repository select follows without a reload.
  const refreshHealth = useCallback(() => {
    api
      .orchestratorHealth()
      .then(setHealth)
      .catch(() => undefined);
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
    <form onSubmit={(event) => void start(event)} className="scan-form" aria-label="Scan a site" noValidate>
      <div className="scan-form-entry">
        <label className="scan-form-url">
          <span className="scan-form-url-label">URL</span>
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
          />
        </label>
        <button type="submit" disabled={busy} className="scan-form-submit">
          <span>{busy ? "Starting…" : "Scan"}</span>
          {!busy && <ArrowRight size={17} />}
        </button>
      </div>

      <div className="scan-form-caption">
        <p>
          Friction sends <strong>multiple AI personas</strong> through your live site to complete real user tasks, uncovering UX issues as they happen.
        </p>
        <p>
          Get prioritized findings with <strong>in-context annotations</strong>, then generate fixes and <strong>open PRs automatically</strong>.
        </p>
      </div>

      <GitHubConnect onChanged={refreshHealth} onOnlyRepo={chooseRepo} />

      {repos.length > 0 && (
        <div className="scan-form-options">
          <label className="scan-form-repository">
            <span>Repository</span>
            <select
              value={repo}
              onChange={(event) => chooseRepo(event.target.value)}
              className="scan-form-select"
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
            <label className="scan-form-checkbox">
              <input type="checkbox" checked={autoPr} onChange={(event) => setAutoPr(event.target.checked)} />
              Open draft PRs
            </label>
          )}
          {repo && health?.githubDryRun && <p className="scan-form-hint">Preview only, nothing will be pushed.</p>}
        </div>
      )}

      {failure && (
        <p id="scan-form-error" role="alert" className="scan-form-error">
          <span className="scan-form-error-dot" aria-hidden="true" />
          {failure.kind === "invalid" ? "Enter a website URL, like https://your-store.com." : `Couldn't start the scan (${failure.detail}). Is the orchestrator running?`}
        </p>
      )}
    </form>
  );
}
