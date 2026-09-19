export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Keeps a string under a Worker schema's max length instead of failing the whole PATCH. */
export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.split("\n")[0]?.slice(0, 300) ?? err.name;
  return String(err).slice(0, 300);
}

/** Runs work and reports how long it took, so one log line can account for a whole step. */
export async function timed<T>(work: Promise<T>): Promise<[T, number]> {
  const startedAt = Date.now();
  const value = await work;
  return [value, Date.now() - startedAt];
}

/** Every call that leaves this process gets a deadline. A hung SDK must not hang a run. */
export async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * withTimeout for work that OWNS a resource once it finishes.
 *
 * Promise.race abandons the loser but cannot cancel it. An `openBrowser` that
 * finishes after its deadline still created a real remote browser session, and
 * nobody is left holding it: it stays live, burning a slot in the provider's
 * concurrency cap, until the provider's own timeout reaps it. So dispose
 * whatever arrives late.
 *
 * Work that REJECTS before the deadline produced no resource; nothing to dispose.
 */
export async function withTimeoutDisposing<T>(work: Promise<T>, ms: number, label: string, dispose: (value: T) => Promise<void>): Promise<T> {
  try {
    return await withTimeout(work, ms, label);
  } catch (err) {
    // Detached on purpose: the caller already has its failure and must not wait for the cleanup.
    void work
      .then((late) => dispose(late))
      .catch((cleanupError: unknown) => log("browser", `late ${label} could not be disposed: ${errorMessage(cleanupError)}`));
    throw err;
  }
}

export async function retry<T>(attempts: number, baseDelayMs: number, work: (attempt: number) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await work(attempt);
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

/** Caps how many browser sessions are open at once, process-wide (Browserbase plans limit concurrency). Waiters are served first in, first out. */
export class Semaphore {
  private waiting: Array<() => void> = [];
  private available: number;

  constructor(slots: number) {
    this.available = slots;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.available > 0) this.available -= 1;
    else await new Promise<void>((resume) => this.waiting.push(resume));
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.available += 1;
    }
  }
}

export function log(scope: string, message: string, extra?: unknown): void {
  const time = new Date().toISOString().slice(11, 23);
  if (extra === undefined) console.log(`${time} [${scope}] ${message}`);
  else console.log(`${time} [${scope}] ${message}`, extra);
}
