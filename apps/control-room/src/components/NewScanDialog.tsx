import { useEffect, useRef, useState, type FormEvent } from "react";
import { normalizeTargetUrl } from "@friction/shared";
import { api } from "../lib/api";
import { ArrowRight, Cross } from "./icons";

interface Props {
  open: boolean;
  onClose: () => void;
  onStarted: (scanId: string) => void;
}

const STORAGE_KEY = "friction:last-scan-url";

export function NewScanDialog({ open, onClose, onStarted }: Props) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    setUrl(loadSavedUrl());
    setFailure(null);
    const frame = window.requestAnimationFrame(() => field.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  async function start(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const target = normalizeTargetUrl(url);
    if (!target) {
      setFailure("Enter a website URL, like https://your-store.com.");
      field.current?.focus();
      return;
    }

    setBusy(true);
    setFailure(null);
    try {
      window.localStorage.setItem(STORAGE_KEY, target);
    } catch {
      /* Storage is a convenience only. */
    }

    try {
      const { scanId } = await api.startScan(target);
      onStarted(scanId);
    } catch (error) {
      setFailure(`Couldn't start the scan (${error instanceof Error ? error.message : "unknown error"}).`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="new-scan-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="new-scan-dialog" role="dialog" aria-modal="true" aria-labelledby="new-scan-title">
        <button type="button" onClick={onClose} className="new-scan-dialog-close" aria-label="Close new scan dialog">
          <Cross size={17} />
        </button>

        <div className="new-scan-dialog-header">
          <h2 id="new-scan-title" className="new-scan-dialog-title">Start a new scan</h2>
          <p className="new-scan-dialog-description">Enter a website URL to scan it for friction.</p>
        </div>

        <form onSubmit={(event) => void start(event)} className="new-scan-form" noValidate>
          <label className="new-scan-field">
            <span>Website URL</span>
            <input
              ref={field}
              type="text"
              inputMode="url"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                if (failure) setFailure(null);
              }}
              aria-invalid={failure ? "true" : undefined}
              aria-describedby={failure ? "new-scan-error" : undefined}
              placeholder="https://your-store.com"
              autoComplete="url"
              spellCheck={false}
              className="new-scan-input"
            />
          </label>

          {failure && <p id="new-scan-error" role="alert" className="new-scan-error">{failure}</p>}

          <div className="new-scan-actions">
            <button type="button" onClick={onClose} className="pill-ghost new-scan-cancel">Cancel</button>
            <button type="submit" disabled={busy} className="pill-cta new-scan-submit">
              <span>{busy ? "Starting..." : "Start scan"}</span>
              {!busy && <ArrowRight size={16} />}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function loadSavedUrl(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}
