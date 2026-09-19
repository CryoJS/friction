import { useEffect, useRef, useState } from "react";
import { normalizeTargetUrl } from "@friction/shared";
import { api } from "../lib/api";
import { ArrowRight, Wand } from "./icons";

export interface StartedRun {
  runId: string;
  replay: boolean;
  /** Set when a fallback was used, so the UI can say what it is showing. */
  notice: string | null;
}

interface Props {
  onStarted: (run: StartedRun) => void;
}

const STORAGE_KEY = "friction:last-run-form";

function loadForm(): { url: string; task: string } {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as { url?: unknown; task?: unknown } | null;
    return { url: typeof saved?.url === "string" ? saved.url : "", task: typeof saved?.task === "string" ? saved.task : "" };
  } catch {
    return { url: "", task: "" };
  }
}

/** URL + task, the one thing Friction needs. Lives in the landing hero. */
export function RunForm({ onStarted }: Props) {
  const [form, setForm] = useState(loadForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const urlField = useRef<HTMLInputElement>(null);
  const taskField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
    } catch {
      /* private mode: not worth failing over */
    }
  }, [form]);

  const normalizedUrl = normalizeTargetUrl(form.url);

  /**
   * Orchestrator -> Worker -> bundled fixture. The button always leads to a
   * control room with something in it.
   */
  async function start(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!normalizedUrl || !form.task.trim()) {
      setError(normalizedUrl ? "Describe the task the personas should attempt." : "Enter a valid website URL.");
      (normalizedUrl ? taskField : urlField).current?.focus();
      return;
    }
    const body = { url: normalizedUrl, task: form.task.trim() };
    setBusy(true);
    setError(null);
    try {
      const { runId } = await api.startRun(body);
      onStarted({ runId, replay: false, notice: null });
    } catch (orchestratorError) {
      try {
        const { runId } = await api.createRunOnWorker(body);
        onStarted({
          runId,
          replay: false,
          notice: `Orchestrator unreachable (${message(orchestratorError)}). The run was created on the Worker, which streams the golden fixture in its place.`,
        });
      } catch {
        onStarted({ runId: "golden", replay: true, notice: "Neither the orchestrator nor the Worker answered. Playing the golden run bundled into this app." });
      }
    } finally {
      setBusy(false);
    }
  }

  /** A convenience only. Whatever happens here, typing a task by hand still works. */
  async function suggest(): Promise<void> {
    if (!normalizedUrl) {
      setSuggestNote("Enter a website URL first.");
      return;
    }
    setSuggesting(true);
    setSuggestNote(null);
    setSuggestions([]);
    try {
      const result = await api.suggestTasks(normalizedUrl);
      setSuggestions(result.tasks.slice(0, 3));
      if (result.source === "fallback") setSuggestNote("Could not read the page, so these are generic ideas.");
    } catch (err) {
      setSuggestNote(`Suggestions unavailable (${message(err)}). Type a task instead.`);
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void start(event)}
      className="glass rounded-card border border-hairline/15 p-3 sm:p-4"
      aria-label="Start a run"
      noValidate
    >
      <div className="grid gap-2">
        <input
          type="text"
          inputMode="url"
          ref={urlField}
          value={form.url}
          onChange={(event) => setForm({ ...form, url: event.target.value })}
          aria-invalid={error !== null && normalizedUrl === null}
          placeholder="https://your-store.com"
          aria-label="Website URL"
          autoComplete="url"
          spellCheck={false}
          className="field font-mono text-ui tracking-normal"
        />
        <input
          type="text"
          ref={taskField}
          value={form.task}
          onChange={(event) => setForm({ ...form, task: event.target.value })}
          aria-invalid={error !== null && normalizedUrl !== null && !form.task.trim()}
          placeholder="Task, e.g. find a winter jacket and add it to cart"
          aria-label="Task"
          maxLength={500}
          className="field"
        />
      </div>

      {suggestions.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5" aria-label="Suggested tasks">
          {suggestions.map((task) => (
            <button
              key={task}
              type="button"
              onClick={() => setForm({ ...form, task })}
              aria-pressed={form.task === task}
              className="pill-ghost h-auto min-h-8.5 justify-start rounded-[17px] py-1.5 text-left whitespace-normal"
            >
              {task}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void suggest()} disabled={suggesting} className="pill-ghost h-10 bg-void/35 text-white">
          <Wand size={16} />
          {suggesting ? "Reading the page…" : "Suggest tasks"}
        </button>
        <button type="submit" disabled={busy} className="pill-cta ml-auto">
          {busy ? "Starting…" : "Start run"}
          {!busy && <ArrowRight size={16} />}
        </button>
      </div>

      {(suggestNote || error) && (
        <p className="mt-3 px-2 text-caption" role={error ? "alert" : "status"}>
          {error ? <span className="text-sev-5">{error}</span> : <span className="text-ash">{suggestNote}</span>}
        </p>
      )}
    </form>
  );
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "unknown error";
}
