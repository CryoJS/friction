export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

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

export function log(scope: string, message: string, extra?: unknown): void {
  const time = new Date().toISOString().slice(11, 23);
  if (extra === undefined) console.log(`${time} [${scope}] ${message}`);
  else console.log(`${time} [${scope}] ${message}`, extra);
}
