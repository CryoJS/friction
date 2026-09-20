import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_SCAN_TASKS, normalizeTargetUrl, type OrchestratorHealth } from "@friction/shared";
import { Settings as SettingsIcon } from "lucide-react";
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
const TASK_COUNT_KEY = "friction:scan-task-count";
const TASK_COUNTS = Array.from({ length: MAX_SCAN_TASKS }, (_, index) => index + 1);

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

function loadTaskCount(): number {
  try {
    const saved = Number.parseInt(window.localStorage.getItem(TASK_COUNT_KEY) ?? "", 10);
    return TASK_COUNTS.includes(saved) ? saved : MAX_SCAN_TASKS;
  } catch {
    return MAX_SCAN_TASKS;
  }
}

type Failure = { kind: "invalid" } | { kind: "unreachable"; detail: string };

/** URL form with an optional task count. Lives in the landing hero. */
export function ScanForm({ onStarted }: Props) {
  const [url, setUrl] = useState(loadUrl);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const field = useRef<HTMLInputElement>(null);
  // Null until the orchestrator answers; if it never does, the form is the URL field alone, as before.
  const [health, setHealth] = useState<OrchestratorHealth | null>(null);
  const [wantedRepo, setWantedRepo] = useState(loadRepo);
  const [autoPr, setAutoPr] = useState(true);
  const [taskCount, setTaskCount] = useState(loadTaskCount);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  function chooseTaskCount(next: number): void {
    setTaskCount(next);
    try {
      window.localStorage.setItem(TASK_COUNT_KEY, String(next));
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
      const { scanId } = await api.startScan(target, { ...(repo ? { repo, autoPr } : {}), taskCount });
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
        <div className="scan-form-url">
          <label className="scan-form-url-label" htmlFor="scan-form-url-field">URL</label>
          <input
            id="scan-form-url-field"
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
          <button
            type="button"
            className="scan-form-settings-toggle"
            aria-label="Scan settings"
            aria-expanded={settingsOpen}
            aria-controls="scan-form-settings-panel"
            title={"Run " + taskCount + " " + (taskCount === 1 ? "agent" : "agents")}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <SettingsIcon size={17} strokeWidth={1.7} />
          </button>
        </div>
        <button type="submit" disabled={busy} className="scan-form-submit">
          <span>{busy ? "Starting…" : "Scan"}</span>
          {!busy && <ArrowRight size={17} />}
        </button>
      </div>

      {settingsOpen && (
        <div id="scan-form-settings-panel" className="scan-form-settings-panel" role="dialog" aria-label="Scan settings">
          <div className="scan-form-settings-heading">
            <span>Agents per scan</span>
            <span className="scan-form-settings-current">{taskCount}</span>
          </div>
          <div className="scan-form-settings-options" role="radiogroup" aria-label="Number of agents">
            {TASK_COUNTS.map((count) => (
              <button
                key={count}
                type="button"
                role="radio"
                aria-checked={taskCount === count}
                className="scan-form-settings-option"
                data-selected={taskCount === count}
                onClick={() => chooseTaskCount(count)}
              >
                {count}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="scan-form-caption">
        <p>
          Friction sends <strong>multiple AI personas</strong> through your live site to complete real user tasks, <strong>uncover UX issues</strong>, and <strong>automatically generate fixes and open PRs</strong>.
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
