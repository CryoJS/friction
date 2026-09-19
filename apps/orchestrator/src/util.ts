export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Keeps a string under a Worker schema's max length instead of failing the whole PATCH. */
export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.split("\n")[0]?.slice(0, 300) ?? err.name;
  return String(err).slice(0, 300);
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
