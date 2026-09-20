/**
 * The scan's first stage: what does this site offer?
 *
 * Two passes, and the second one is earned:
 *
 *   1. FETCH. Browserbase's Fetch API reads the landing page and up to
 *      CRAWL_FETCH_MAX same-origin navigation pages for about a tenth of a
 *      cent each, with no browser session at all. Most of a site is static
 *      HTML, so most of the survey stops here.
 *   2. BROWSER. Only the pages Fetch could not honestly read -- client-
 *      rendered shells, 502s -- plus the most interactive flows get a real
 *      session, capped at CRAWL_SESSION_MAX pages. ONE session is opened and
 *      navigated to each of them, because the scan holds exactly one slot of
 *      the shared session pool.
 *
 * The landing screenshot the task generator likes only exists when the landing
 * page itself earned a session; taskGen handles its absence.
 *
 * Never throws, and never depends on Fetch: if the pre-pass fails for any
 * reason -- no Browserbase key, CRAWL_FETCH_MAX=0, an unreadable landing page,
 * an SDK error -- the crawl falls back to browserCrawl() below, which is the
 * session-based crawl exactly as it always was.
 *
 * Stagehand's goto() does not throw on DNS, connection-refused or TLS
 * failures: it resolves on Chrome's error page (chrome-error://chromewebdata/),
 * which still has a title and an a11y tree. So "readable" is judged on the
 * navigation outcome, not just on whether anything rendered: the final URL
 * must still be http(s), and an HTTP response, if one arrived, must be ok().
 * A load timeout is tolerated (whatever rendered can still be read); any
 * other goto failure is not.
 */
import { describeCrawlSurvey, pickCrawlLinks, type CrawledPage, type CrawlSurvey } from "@friction/shared";
import { openBrowser, type BrowserHandle, type StagehandPage } from "./browser";
import type { Config } from "./config";
import { canFetch, fetchPage, fetchPages, type FetchOutcome } from "./fetchPage";
import { observe, readState, readTree } from "./observe";
import { NAV_LINKS } from "./pageScripts";
import { surveyHtml, INTERACTIVE_THRESHOLD, type PageSurvey } from "./pageSurvey";
import { errorMessage, log, truncate, withTimeout, withTimeoutDisposing } from "./util";

/** Accessibility-tree lines per page handed to the model. */
const LINES_PER_PAGE = 60;
/** CrawledPageSchema's title limit (packages/shared/src/scan.ts). */
const TITLE_MAX = 300;
/** ScanPatchSchema's message limit (packages/shared/src/scan.ts). */
const MESSAGE_MAX = 500;

export interface PageReading extends CrawledPage {
  lines: string[];
}

export interface CrawlResult {
  /** Null when the landing page could not be read at all. */
  landing: PageReading | null;
  /** Downscaled landing screenshot, base64 JPEG. Null when the landing page was read over Fetch. */
  landingImage: string | null;
  /** Navigation pages that loaded, in navigation order. */
  pages: PageReading[];
  /** What the Fetch pre-pass bought. */
  survey: CrawlSurvey;
}

export type CrawlProgress = (page: CrawledPage, message: string) => Promise<void>;

type GotoResponse = Awaited<ReturnType<StagehandPage["goto"]>>;

function pathLabel(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Null when the page can be treated as read; otherwise why not. */
function unreadable(finalUrl: string, response: GotoResponse): string | null {
  if (!/^https?:/i.test(finalUrl)) return `did not resolve to a page (ended on ${finalUrl})`;
  if (response && !response.ok()) return `responded ${response.status()} ${response.statusText()}`;
  return null;
}

/** A slow load is a finding, not a failure: whatever rendered can still be read. Anything else propagates. */
function tolerateTimeout(err: unknown): null {
  if (/timeout|timed out/i.test(errorMessage(err))) return null;
  throw err;
}

const emptySurvey = (): CrawlSurvey => ({ fetched: 0, sessionsOpened: 0, browserPages: 0, sessionsAvoided: 0 });

/* ------------------------------------------------------------ fetch pre-pass */

/** One surveyed page: what Fetch said, and what that HTML turned out to be. */
interface Candidate {
  url: string;
  outcome: FetchOutcome;
  /** Null when Fetch could not read it. */
  survey: PageSurvey | null;
  /** This page has to be seen in a browser to be worth anything. */
  mustRender: boolean;
  /** Set once a browser has read it. */
  reading: PageReading | null;
}

function toCandidate(outcome: FetchOutcome): Candidate {
  if (outcome.needsBrowser) return { url: outcome.url, outcome, survey: null, mustRender: true, reading: null };
  const survey = surveyHtml(outcome.html);
  // A 2xx page Fetch understood is readable; anything else is only a lead.
  const failed = outcome.statusCode >= 400;
  return { url: outcome.url, outcome, survey, mustRender: survey.jsShell || failed, reading: null };
}

function readingOf(candidate: Candidate): PageReading | null {
  if (candidate.reading) return candidate.reading;
  if (!candidate.survey) return null;
  return { url: candidate.url, title: truncate(candidate.survey.title, TITLE_MAX), lines: candidate.survey.lines.slice(0, LINES_PER_PAGE) };
}

/**
 * Which pages earn the session, most deserving first: the ones Fetch could not
 * honestly read, then the most interactive flows. Never more than `max`.
 */
function pickSessionTargets(candidates: readonly Candidate[], max: number): Candidate[] {
  const must = candidates.filter((candidate) => candidate.mustRender);
  const worth = candidates
    .filter((candidate) => !candidate.mustRender && (candidate.survey?.interactive ?? 0) >= INTERACTIVE_THRESHOLD)
    .sort((a, b) => (b.survey?.interactive ?? 0) - (a.survey?.interactive ?? 0));
  return [...must, ...worth].slice(0, max);
}

/**
 * Reads the picked pages in ONE browser session. Returns how many pages it
 * managed, and the landing screenshot if the landing page was among them.
 * Failing here is not fatal: the fetched readings stand on their own.
 */
async function renderTargets(config: Config, targets: readonly Candidate[], landingUrl: string): Promise<{ opened: boolean; read: number; landingImage: string | null }> {
  let browser: BrowserHandle | null = null;
  let read = 0;
  let landingImage: string | null = null;
  try {
    browser = await withTimeoutDisposing(openBrowser(config, "crawl"), 120_000, "browser session", (late) => late.close());
    const { page } = browser;
    for (const target of targets) {
      try {
        const response = await withTimeout(page.goto(target.url, { waitUntil: "load", timeoutMs: 20_000 }), 25_000, `open ${target.url}`).catch(tolerateTimeout);
        const isLanding = target.url === landingUrl;
        // The landing page is the only one the model gets a picture of.
        const observation = isLanding ? await observe(page, "model") : null;
        const state = observation?.state ?? (await readState(page));
        const rejection = unreadable(state.url, response);
        if (rejection) {
          log("crawl", `skipped ${target.url}: ${rejection}`);
          continue;
        }
        const tree = observation?.tree ?? (await readTree(page));
        target.reading = { url: state.url, title: truncate(state.title, TITLE_MAX), lines: tree.lines.slice(0, LINES_PER_PAGE) };
        if (observation) landingImage = observation.forModel;
        read += 1;
      } catch (err) {
        log("crawl", `skipped ${target.url}: ${errorMessage(err)}`);
      }
    }
    return { opened: true, read, landingImage };
  } catch (err) {
    log("crawl", `browser pass failed, keeping the fetched pages: ${errorMessage(err)}`);
    return { opened: browser !== null, read, landingImage };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/**
 * The Fetch-first crawl. Returns null when the pre-pass cannot carry the
 * crawl at all, and the caller falls back to the session crawl.
 */
async function fetchCrawl(config: Config, url: string, onPage: CrawlProgress): Promise<CrawlResult | null> {
  const landingOutcome = await fetchPage(config, url);
  if (landingOutcome.needsBrowser) {
    log("crawl", `Fetch could not read ${url} (${landingOutcome.reason}), opening a session`);
    return null;
  }

  const landing = toCandidate(landingOutcome);
  if (!landing.survey || (landing.survey.lines.length === 0 && !landing.survey.title && !landing.mustRender)) {
    log("crawl", `${url} fetched nothing readable, opening a session`);
    return null;
  }

  const links = pickCrawlLinks(url, landing.survey.hrefs, config.crawlFetchMax);
  const linked = (await fetchPages(config, links)).map(toCandidate);
  const candidates = [landing, ...linked];

  const targets = pickSessionTargets(candidates, config.crawlSessionMax);
  const rendered = targets.length > 0 ? await renderTargets(config, targets, url) : { opened: false, read: 0, landingImage: null };

  const readings = candidates.map((candidate) => ({ candidate, reading: readingOf(candidate) }));
  const usable = readings.filter((entry) => entry.reading !== null);
  const total = usable.length;
  for (const [index, entry] of usable.entries()) {
    const reading = entry.reading!;
    const how = entry.candidate.reading ? "Opened" : "Read";
    await onPage({ url: reading.url, title: reading.title }, truncate(`${how} ${pathLabel(reading.url)} (${index + 1}/${total})`, MESSAGE_MAX));
  }

  const landingReading = readingOf(landing);
  if (!landingReading) return null;

  const fetched = candidates.filter((candidate) => !candidate.outcome.needsBrowser).length;
  return {
    landing: landingReading,
    landingImage: rendered.landingImage,
    pages: usable.map((entry) => entry.reading!).filter((reading) => reading !== landingReading),
    survey: {
      fetched,
      sessionsOpened: rendered.opened ? 1 : 0,
      browserPages: rendered.read,
      sessionsAvoided: Math.max(0, fetched - rendered.read),
    },
  };
}

/* ------------------------------------------------------- session-only crawl */

/**
 * The original crawl: ONE session reads the landing page (screenshot + pruned
 * a11y tree) and up to five nav-linked pages (a11y tree only, so the model
 * gets one image and not six). Still the fallback whenever Fetch cannot do it.
 */
async function browserCrawl(config: Config, url: string, onPage: CrawlProgress): Promise<CrawlResult> {
  const result: CrawlResult = { landing: null, landingImage: null, pages: [], survey: emptySurvey() };
  let browser: BrowserHandle | null = null;
  try {
    browser = await withTimeoutDisposing(openBrowser(config, "crawl"), 120_000, "browser session", (late) => late.close());
    result.survey.sessionsOpened = 1;
    const { page } = browser;
    const response = await withTimeout(page.goto(url, { waitUntil: "load", timeoutMs: 25_000 }), 30_000, "landing page").catch(tolerateTimeout);
    const observation = await observe(page, "model");
    const rejection = unreadable(observation.state.url, response);
    if (rejection) {
      log("crawl", `${url} ${rejection}`);
      return result;
    }
    if (observation.tree.lines.length === 0 && !observation.state.title) {
      log("crawl", `${url} rendered nothing readable`);
      return result;
    }
    result.landing = { url: observation.state.url, title: truncate(observation.state.title, TITLE_MAX), lines: observation.tree.lines.slice(0, LINES_PER_PAGE) };
    result.landingImage = observation.forModel;
    result.survey.browserPages = 1;

    const hrefs = await withTimeout(page.evaluate<string[]>(NAV_LINKS), 8000, "nav links").catch(() => [] as string[]);
    const links = pickCrawlLinks(observation.state.url, hrefs);
    const total = links.length + 1;
    await onPage({ url: result.landing.url, title: result.landing.title }, truncate(`Read the landing page (1/${total})`, MESSAGE_MAX));

    for (const [index, link] of links.entries()) {
      try {
        const navResponse = await withTimeout(page.goto(link, { waitUntil: "load", timeoutMs: 20_000 }), 25_000, `open ${link}`);
        const state = await readState(page);
        const navRejection = unreadable(state.url, navResponse);
        if (navRejection) {
          log("crawl", `skipped ${link}: ${navRejection}`);
          continue;
        }
        const tree = await readTree(page);
        const reading: PageReading = { url: state.url, title: truncate(state.title, TITLE_MAX), lines: tree.lines.slice(0, LINES_PER_PAGE) };
        result.pages.push(reading);
        result.survey.browserPages += 1;
        await onPage({ url: reading.url, title: reading.title }, truncate(`Read ${pathLabel(reading.url)} (${index + 2}/${total})`, MESSAGE_MAX));
      } catch (err) {
        log("crawl", `skipped ${link}: ${errorMessage(err)}`);
      }
    }
  } catch (err) {
    log("crawl", `could not read ${url}: ${errorMessage(err)}`);
  } finally {
    await browser?.close().catch(() => undefined);
  }
  return result;
}

export async function crawlSite(config: Config, url: string, onPage: CrawlProgress): Promise<CrawlResult> {
  let result: CrawlResult | null = null;
  if (canFetch(config)) {
    try {
      result = await fetchCrawl(config, url, onPage);
    } catch (err) {
      // The crawl must never fail because Fetch failed.
      log("crawl", `Fetch pre-pass failed, falling back to a session: ${errorMessage(err)}`);
    }
  }
  result ??= await browserCrawl(config, url, onPage);
  log("crawl", `${url} ${describeCrawlSurvey(result.survey)}`);
  return result;
}
