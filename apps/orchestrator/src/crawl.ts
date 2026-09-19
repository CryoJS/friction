/**
 * The scan's first stage: what does this site offer?
 *
 * ONE browser session reads the landing page (screenshot + pruned a11y tree),
 * then up to five same-origin pages linked from its navigation (a11y tree
 * only: the model gets one image, not six). A page that fails is skipped.
 * Never throws: a site that cannot be read at all comes back with
 * landing: null, and the task generator falls back to generic tasks.
 *
 * Stagehand's goto() does not throw on DNS, connection-refused or TLS
 * failures: it resolves on Chrome's error page (chrome-error://chromewebdata/),
 * which still has a title and an a11y tree. So "readable" is judged on the
 * navigation outcome, not just on whether anything rendered: the final URL
 * must still be http(s), and an HTTP response, if one arrived, must be ok().
 * A load timeout is tolerated (whatever rendered can still be read); any
 * other goto failure is not.
 */
import { pickCrawlLinks, type CrawledPage } from "@friction/shared";
import { openBrowser, type BrowserHandle, type StagehandPage } from "./browser";
import type { Config } from "./config";
import { observe, readState, readTree } from "./observe";
import { NAV_LINKS } from "./pageScripts";
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
  /** Downscaled landing screenshot, base64 JPEG. */
  landingImage: string | null;
  /** Navigation pages that loaded, in navigation order. */
  pages: PageReading[];
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

export async function crawlSite(config: Config, url: string, onPage: CrawlProgress): Promise<CrawlResult> {
  const result: CrawlResult = { landing: null, landingImage: null, pages: [] };
  let browser: BrowserHandle | null = null;
  try {
    browser = await withTimeoutDisposing(openBrowser(config, "crawl"), 120_000, "browser session", (late) => late.close());
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
