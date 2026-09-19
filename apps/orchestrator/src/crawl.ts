/**
 * The scan's first stage: what does this site offer?
 *
 * ONE browser session reads the landing page (screenshot + pruned a11y tree),
 * then up to five same-origin pages linked from its navigation (a11y tree
 * only: the model gets one image, not six). A page that fails is skipped.
 * Never throws: a site that cannot be read at all comes back with
 * landing: null, and the task generator falls back to generic tasks.
 */
import { pickCrawlLinks, type CrawledPage } from "@friction/shared";
import { openBrowser, type BrowserHandle } from "./browser";
import type { Config } from "./config";
import { observe, readState, readTree } from "./observe";
import { NAV_LINKS } from "./pageScripts";
import { errorMessage, log, withTimeout } from "./util";

/** Accessibility-tree lines per page handed to the model. */
const LINES_PER_PAGE = 60;

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

function pathLabel(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export async function crawlSite(config: Config, url: string, onPage: CrawlProgress): Promise<CrawlResult> {
  const result: CrawlResult = { landing: null, landingImage: null, pages: [] };
  let browser: BrowserHandle | null = null;
  try {
    browser = await withTimeout(openBrowser(config, "crawl"), 120_000, "browser session");
    const { page } = browser;
    await page.goto(url, { waitUntil: "load", timeoutMs: 25_000 }).catch(() => undefined);
    const observation = await observe(page);
    if (observation.tree.lines.length === 0 && !observation.state.title) {
      log("crawl", `${url} rendered nothing readable`);
      return result;
    }
    result.landing = { url: observation.state.url, title: observation.state.title, lines: observation.tree.lines.slice(0, LINES_PER_PAGE) };
    result.landingImage = observation.forModel;

    const hrefs = await withTimeout(page.evaluate<string[]>(NAV_LINKS), 8000, "nav links").catch(() => [] as string[]);
    const links = pickCrawlLinks(observation.state.url, hrefs);
    const total = links.length + 1;
    await onPage({ url: result.landing.url, title: result.landing.title }, `Read the landing page (1/${total})`);

    for (const [index, link] of links.entries()) {
      try {
        await withTimeout(page.goto(link, { waitUntil: "load", timeoutMs: 20_000 }), 25_000, `open ${link}`);
        const state = await readState(page);
        const tree = await readTree(page);
        const reading: PageReading = { url: state.url, title: state.title, lines: tree.lines.slice(0, LINES_PER_PAGE) };
        result.pages.push(reading);
        await onPage({ url: reading.url, title: reading.title }, `Read ${pathLabel(reading.url)} (${index + 2}/${total})`);
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
