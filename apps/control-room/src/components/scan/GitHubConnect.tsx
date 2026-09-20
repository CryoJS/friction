import { useCallback, useEffect, useRef, useState } from "react";
import type { GitHubConnectionStatus } from "@friction/shared";
import { api } from "../../lib/api";

interface Props {
  /** The allowed repositories changed: the scan form re-reads /health so its Repository select follows. */
  onChanged: () => void;
  /** Exactly one repository is allowed after a tick: the form selects it, so the select never sits on "None" beside it. */
  onOnlyRepo?: (slug: string) => void;
}

/** How often the orchestrator is asked whether the code has been approved yet. GitHub is polled by the orchestrator, not from here. */
const POLL_MS = 2000;
/** Ticks save themselves, once the clicking pauses. */
const SAVE_AFTER_MS = 500;
/** Longer lists get a filter. */
const FILTER_FROM = 8;

const count = (n: number): string => (n === 0 ? "no repository yet" : n === 1 ? "1 repository" : `${n} repositories`);

/**
 * GitHub, connected with a button instead of a token in .env. The orchestrator
 * runs GitHub's device flow and keeps the token; this only ever sees a code to
 * type, a login, and repository names. Renders nothing when the orchestrator
 * has no GITHUB_CLIENT_ID (or predates this): the form is then as it was.
 *
 * One quiet line once connected. Which repositories Friction may touch is
 * behind "Manage", open by itself only while nothing is allowed yet.
 */
export function GitHubConnect({ onChanged, onOnlyRepo }: Props) {
  const [status, setStatus] = useState<GitHubConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  /** The ticks as the person sees them, ahead of the orchestrator while a save is on its way. Null: showing what is saved. */
  const [ticked, setTicked] = useState<Set<string> | null>(null);
  const [saved, setSaved] = useState(false);
  const [filter, setFilter] = useState("");
  const [copied, setCopied] = useState(false);
  const wasConnected = useRef(false);
  const saveTimer = useRef<number | null>(null);

  const run = useCallback(async (call: () => Promise<GitHubConnectionStatus>): Promise<GitHubConnectionStatus | null> => {
    setBusy(true);
    setFailure(null);
    try {
      const next = await call();
      setStatus(next);
      return next;
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let live = true;
    api
      .github()
      .then((answer) => live && setStatus(answer))
      .catch(() => undefined);
    return () => {
      live = false;
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, []);

  // While a code is waiting to be approved, ask the orchestrator how it is going.
  const pending = status?.state === "pending";
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => {
      api
        .github()
        .then(setStatus)
        .catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [pending]);

  // The moment it connects: the form re-reads its repositories, and the list opens, because nothing is allowed yet.
  const connected = status?.state === "connected";
  const nothingAllowed = (status?.allowed.length ?? 0) === 0;
  useEffect(() => {
    if (connected && !wasConnected.current) {
      onChanged();
      if (nothingAllowed) setManaging(true);
    }
    wasConnected.current = connected;
    if (!connected) {
      setTicked(null);
      setManaging(false);
    }
  }, [connected, nothingAllowed, onChanged]);

  if (!status || !status.available) return null;

  const current = ticked ?? new Set(status.allowed);

  function toggle(slug: string): void {
    const next = new Set(current);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    setTicked(next);
    setSaved(false);
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void run(() => api.githubSetAllowed([...next])).then((answer) => {
        // The orchestrator's answer is the truth: a repository it would not keep comes back unticked.
        setTicked(null);
        if (!answer) return;
        setSaved(true);
        onChanged();
        if (answer.allowed.length === 1 && answer.allowed[0]) onOnlyRepo?.(answer.allowed[0]);
      });
    }, SAVE_AFTER_MS);
  }

  function openGitHub(): void {
    // The code is on the clipboard by the time GitHub's page asks for it.
    void navigator.clipboard?.writeText(status?.userCode ?? "").then(
      () => setCopied(true),
      () => undefined,
    );
  }

  const repos = status.repos ?? [];
  const shown = repos.filter((slug) => slug.toLowerCase().includes(filter.trim().toLowerCase()));
  const problem = failure ?? status.error;

  return (
    <div className="scan-form-github" aria-live="polite">
      {status.state === "disconnected" && (
        <div className="scan-form-github-line">
          <button type="button" className="scan-form-github-action" disabled={busy} onClick={() => void run(api.githubConnect)}>
            {busy ? "Asking GitHub…" : "Connect GitHub"}
          </button>
          <span className="scan-form-github-muted">{status.source === "env" ? "or keep using GITHUB_TOKEN" : "to open draft pull requests"}</span>
        </div>
      )}

      {status.state === "pending" && status.userCode && (
        <div className="scan-form-github-line">
          <button type="button" className="scan-form-github-code" title="Copy the code" onClick={openGitHub}>
            {status.userCode}
          </button>
          <a className="scan-form-github-action" href={status.verificationUri} target="_blank" rel="noreferrer" onClick={openGitHub}>
            Enter it on GitHub
          </a>
          <span className="scan-form-github-muted scan-form-github-waiting">{copied ? "Code copied. Waiting for approval" : "Waiting for approval"}</span>
          <button type="button" className="scan-form-github-quiet" disabled={busy} onClick={() => void run(api.githubDisconnect)}>
            Cancel
          </button>
        </div>
      )}

      {status.state === "connected" && (
        <>
          <div className="scan-form-github-line">
            <span className="scan-form-github-dot" aria-hidden="true" />
            <span>
              GitHub <strong>@{status.login}</strong>
            </span>
            <span className="scan-form-github-muted">{count(current.size)}</span>
            <button type="button" className="scan-form-github-quiet scan-form-github-end scan-form-github-toggle" aria-expanded={managing} aria-controls="scan-form-github-panel" onClick={() => setManaging(!managing)}>
              {/* Both words are always there and cross-fade, so the label never jumps and the button never changes width. */}
              <span className="scan-form-github-toggle-label" aria-hidden={managing}>
                Manage
              </span>
              <span className="scan-form-github-toggle-label" aria-hidden={!managing}>
                Done
              </span>
              <svg className="scan-form-github-chevron" width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Always mounted, so opening and closing can be animated; inert while closed, so nothing inside can be tabbed to or read out. */}
          <div className="scan-form-github-reveal" data-open={managing} inert={!managing}>
            <div className="scan-form-github-clip">
            <div id="scan-form-github-panel" className="scan-form-github-panel">
              <div className="scan-form-github-panel-heading">
                <p className="scan-form-github-muted">Friction opens pull requests only in the repositories you tick.</p>
                <button type="button" className="scan-form-github-quiet" disabled={busy} onClick={() => void run(api.githubDisconnect).then(() => onChanged())}>
                  Disconnect
                </button>
              </div>
              {repos.length > FILTER_FROM && (
                <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter" aria-label="Filter repositories" className="scan-form-github-filter" />
              )}
              <ul className="scan-form-github-repos">
                {shown.map((slug) => (
                  <li key={slug}>
                    <label className="scan-form-checkbox">
                      <input type="checkbox" checked={current.has(slug)} onChange={() => toggle(slug)} />
                      {slug}
                    </label>
                  </li>
                ))}
                {shown.length === 0 && <li className="scan-form-github-muted">{repos.length > 0 ? "No repository matches." : "This account can push to no repositories."}</li>}
              </ul>
              {(ticked !== null || busy || saved) && (
                <span className="scan-form-github-muted" role="status">
                  {ticked !== null || busy ? "Saving…" : "Saved"}
                </span>
              )}
            </div>
            </div>
          </div>
        </>
      )}

      {problem && (
        <p role="alert" className="scan-form-github-error">
          {problem}
        </p>
      )}
    </div>
  );
}
