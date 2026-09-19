import { useEffect, useState } from "react";
import { normalizeTargetUrl } from "@friction/shared";
import { api } from "../lib/api";

export interface StartedRun {
  runId: string;
  replay: boolean;
  /** Set when a fallback was used, so the UI can say what it is showing. */
  notice: string | null;
}

interface Props {
  onStarted: (run: StartedRun) => void;
  onHome: () => void;
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

export function Header({ onStarted, onHome }: Props) {
  const [form, setForm] = useState(loadForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
    } catch {
      /* private mode: not worth failing over */
    }
  }, [form]);

  const normalizedUrl = normalizeTargetUrl(form.url);
  const canStart = normalizedUrl !== null && form.task.trim().length > 0 && !busy;

  /**
   * Orchestrator -> Worker -> bundled fixture. The button always leads to a
   * control room with something in it.
   */
  async function start(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!normalizedUrl || !form.task.trim()) {
      setError(normalizedUrl ? "Describe the task the personas should attempt." : "Enter a valid website URL.");
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
    <header className="shrink-0 border-b border-slate-200 bg-white">
      <form onSubmit={(event) => void start(event)} className="flex flex-wrap items-center gap-2 px-4 py-2">
        <button type="button" onClick={onHome} className="mr-2 flex items-center gap-2" title="All runs">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-sm font-black text-white">F</span>
          <span className="text-sm font-bold tracking-tight text-slate-900">Friction</span>
        </button>

        <input
          type="text"
          inputMode="url"
          value={form.url}
          onChange={(event) => setForm({ ...form, url: event.target.value })}
          placeholder="https://your-store.com"
          aria-label="Website URL"
          spellCheck={false}
          className="h-8 w-64 min-w-0 rounded-md border border-slate-300 bg-white px-2.5 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
        <input
          type="text"
          value={form.task}
          onChange={(event) => setForm({ ...form, task: event.target.value })}
          placeholder="Task, e.g. find a winter jacket and add it to cart"
          aria-label="Task"
          maxLength={500}
          className="h-8 min-w-48 flex-1 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
        <button
          type="button"
          onClick={() => void suggest()}
          disabled={suggesting}
          className="h-8 shrink-0 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:border-slate-400 disabled:cursor-wait disabled:opacity-60"
        >
          {suggesting ? "Reading the page…" : "Suggest tasks"}
        </button>
        <button
          type="submit"
          disabled={!canStart}
          className="h-8 shrink-0 rounded-md bg-indigo-600 px-4 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {busy ? "Starting…" : "Start run"}
        </button>
      </form>

      {(suggestions.length > 0 || suggestNote || error) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 px-4 py-1.5">
          {suggestions.map((task) => (
            <button
              key={task}
              type="button"
              onClick={() => setForm({ ...form, task })}
              className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-left text-[11px] font-medium text-indigo-700 hover:border-indigo-300 hover:bg-indigo-100"
            >
              {task}
            </button>
          ))}
          {suggestNote && <span className="text-[11px] text-slate-500">{suggestNote}</span>}
          {error && <span className="text-[11px] font-medium text-red-600">{error}</span>}
        </div>
      )}
    </header>
  );
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "unknown error";
}
