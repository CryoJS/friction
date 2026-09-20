/**
 * Browserbase's Fetch API: one page of HTML, no browser session.
 *
 * About $1 per 1000 pages against a session's per-minute cost, so the crawl
 * can survey a whole site here and spend sessions only where one is actually
 * needed. This is Browserbase's own documented ladder: Search -> Fetch ->
 * Browsers.
 *
 * What Fetch cannot do:
 *   - It does not execute JavaScript. A client-rendered page comes back as an
 *     empty shell, and the caller has to notice (pageSurvey.ts) and open a
 *     browser instead.
 *   - There is a content limit (1 MB on some plans, 5 MB on others). Over it,
 *     the API answers 502, which is not a failure: it means "this one needs a
 *     browser", exactly as the Browserbase docs show.
 *
 * So nothing here throws. Every unhappy path -- a 502, a timeout, a refused
 * host, an SDK error -- comes back as `needsBrowser`, and the caller decides
 * whether that page is worth a session.
 *
 * Fetch is used in the crawl stage ONLY: never in verify.ts, never in the
 * agent loop, never in the bookmarklet.
 */
import Browserbase from "@browserbasehq/sdk";
import type { Config } from "./config";
import { Semaphore, errorMessage, log, withTimeout } from "./util";

/** Fetch calls in flight at once. Fetch takes no session, so this is politeness to the origin, not a concurrency cap. */
const FETCH_CONCURRENCY = 5;
/** Per-call deadline. A page worth waiting longer than this for is a page worth a browser. */
const FETCH_TIMEOUT_MS = 20_000;
/** Past this the HTML is a download, not a page. Analysis reads the head of it; nothing needs the tail. */
const MAX_HTML_CHARS = 1_000_000;

export interface FetchedPage {
  needsBrowser: false;
  /** The URL as asked for. Fetch does not report redirects, so this is not necessarily the final URL. */
  url: string;
  /** The fetched page's own HTTP status, not the Fetch API's. */
  statusCode: number;
  html: string;
  headers: Record<string, string>;
}

export interface NeedsBrowser {
  needsBrowser: true;
  url: string;
  /** Why Fetch could not answer, for the log line. */
  reason: string;
}

export type FetchOutcome = FetchedPage | NeedsBrowser;

const gate = new Semaphore(FETCH_CONCURRENCY);

/** One client per process: the SDK holds no session state, only the key. */
let client: Browserbase | null = null;
function browserbase(apiKey: string): Browserbase {
  client ??= new Browserbase({ apiKey, maxRetries: 1, timeout: FETCH_TIMEOUT_MS });
  return client;
}

/* ------------------------------------------------------------------- safety */

const PRIVATE_V4 = [
  /^0\./, // "this network"
  /^10\./, // RFC1918
  /^127\./, // loopback
  /^169\.254\./, // link-local, and the cloud metadata address 169.254.169.254
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^192\.0\.[02]\./, // IETF protocol assignments / TEST-NET-1
  /^198\.(1[89])\./, // benchmarking
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT
];

/** Hostnames that only ever mean "inside", whatever they resolve to. */
const PRIVATE_HOST = /(^|\.)(localhost|local|internal|intranet|lan|home\.arpa)$/i;
const METADATA_HOST = /(^|\.)(metadata\.google\.internal|instance-data)$/i;

/**
 * Why this URL must not be handed to Fetch, or null when it is fine.
 *
 * Fetch runs on Browserbase's network, so a private address here is either a
 * mistake or an attempt to make their fetcher probe somewhere it should not.
 * Either way it is refused rather than escalated to a browser quietly; the
 * crawl treats a refused link as "skip" and a refused entry URL as "the
 * existing session crawl handles this one", which is what a developer scanning
 * http://localhost:3000 with BROWSER_ENV=LOCAL wants.
 */
export function unsafeToFetch(target: string): string | null {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return "not a URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return `${url.protocol} is not http(s)`;
  if (url.username || url.password) return "carries credentials";

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "") return "has no host";
  if (PRIVATE_HOST.test(host) || METADATA_HOST.test(host)) return `${host} is a private hostname`;

  // IPv6, including the ::ffff:10.0.0.1 form that smuggles a v4 address through.
  if (host.includes(":")) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(host);
    if (mapped?.[1]) return PRIVATE_V4.some((range) => range.test(mapped[1]!)) ? `${host} is a private address` : null;
    if (host === "::" || host === "::1" || /^(f[cd]|fe[89ab])/i.test(host)) return `${host} is a private address`;
    return null;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && PRIVATE_V4.some((range) => range.test(host))) return `${host} is a private address`;
  // A decimal or octal literal ("2130706433", "0177.0.0.1") is never a real site's host.
  if (/^\d+$/.test(host) || /^0[0-7]/.test(host)) return `${host} is not a hostname`;
  return null;
}

/* ------------------------------------------------------------------- client */

/** Whether the Fetch pre-pass can run at all: it is a Browserbase API, and CRAWL_FETCH_MAX=0 turns it off. */
export function canFetch(config: Config): boolean {
  return config.browserEnv === "BROWSERBASE" && config.browserbaseApiKey !== null && config.crawlFetchMax > 0;
}

/** True for the "this page is too big / upstream would not answer" 502 the docs tell you to fall back on. */
function isBadGateway(err: unknown): boolean {
  return (err as { status?: number }).status === 502;
}

/**
 * Reads one page. Never throws, never opens a session, never follows a URL
 * that unsafeToFetch() refuses. allowInsecureSsl is never set: a site whose
 * certificate does not verify is not a site this crawl reads.
 */
export async function fetchPage(config: Config, url: string): Promise<FetchOutcome> {
  const unsafe = unsafeToFetch(url);
  if (unsafe) return { needsBrowser: true, url, reason: unsafe };
  const apiKey = config.browserbaseApiKey;
  if (!apiKey) return { needsBrowser: true, url, reason: "BROWSERBASE_API_KEY is not set" };

  return gate.run(async () => {
    try {
      const response = await withTimeout(
        browserbase(apiKey).fetchAPI.create({ url, format: "raw", allowRedirects: true }),
        FETCH_TIMEOUT_MS,
        `fetch ${url}`,
      );
      // `json` format answers with an object; `raw` answers with the body. Anything else is not HTML we can read.
      if (typeof response.content !== "string") return { needsBrowser: true, url, reason: `content came back as ${typeof response.content}` };
      if (response.statusCode === 502) return { needsBrowser: true, url, reason: "the page answered 502" };
      return {
        needsBrowser: false,
        url,
        statusCode: response.statusCode,
        html: response.content.slice(0, MAX_HTML_CHARS),
        headers: response.headers ?? {},
      };
    } catch (err) {
      const reason = isBadGateway(err) ? "too large for Fetch, or the origin refused it" : errorMessage(err);
      log("fetch", `${url} needs a browser: ${reason}`);
      return { needsBrowser: true, url, reason };
    }
  });
}

/** Every URL at once, in the order given, under the shared concurrency gate. */
export function fetchPages(config: Config, urls: readonly string[]): Promise<FetchOutcome[]> {
  return Promise.all(urls.map((url) => fetchPage(config, url)));
}
