/**
 * Reading a page of HTML without a browser.
 *
 * Fetch hands back raw markup, so this turns it into the two things the crawl
 * needs: the lines the task generator reads (the same shape a11y.ts produces,
 * minus the element ids -- nothing here is clickable), and the judgement of
 * whether this page is worth a browser session.
 *
 * Two reasons a page earns one:
 *   jsShell      Fetch does not run JavaScript, so a client-rendered page is
 *                an empty div. Almost no text plus a known mount node (#root,
 *                #__next, #app) or markup that is mostly <script> means what
 *                we fetched is not what a visitor sees.
 *   interactive  forms, buttons, inputs, selects and cart/checkout/signup/
 *                search wording. These are the flows the agent will be asked
 *                to drive, so they are worth seeing rendered.
 *
 * Regexes, not a parser: this decides whether to spend a dollar's worth of
 * browser session, not what to click, and a wrong guess costs one session.
 */

/** Under this many characters of body text, a page is not really a page. */
const JS_SHELL_TEXT = 500;
/** Scripts taking more than this share of the markup means the content is coming later. */
const SCRIPT_SHARE = 0.5;
/** Interactive score at or above this is worth a session on its own. */
export const INTERACTIVE_THRESHOLD = 6;

const SCRIPT_OR_STYLE = /<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi;
const COMMENT = /<!--[\s\S]*?-->/g;
const TAG = /<[^>]+>/g;
const MOUNT_NODE = /<\w+[^>]*\sid\s*=\s*["']?(root|__next|app|__nuxt|___gatsby)["'\s>]/i;
const FLOW_WORDS = /\b(cart|basket|checkout|sign[-\s]?up|register|subscribe|search|order|book(ing)?|buy|add to bag|contact|quote|donate|apply)\b/i;

export interface PageSurvey {
  title: string;
  /** Pseudo accessibility lines, in document order. */
  lines: string[];
  /** Every href on the page, raw, in document order. */
  hrefs: string[];
  /** How much of a flow this page is. Higher is more worth rendering. */
  interactive: number;
  /** Fetch almost certainly did not see what a visitor sees. */
  jsShell: boolean;
  /** Characters of visible text. */
  textLength: number;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

function decode(text: string): string {
  return text.replace(/&(#?\w+);/g, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole);
}

function clean(text: string): string {
  return decode(text).replace(/\s+/g, " ").trim();
}

function countOf(html: string, pattern: RegExp): number {
  return html.match(pattern)?.length ?? 0;
}

/** Every attribute-quoted or bare href, in document order. */
function hrefsIn(html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/gi)) {
    const href = match[1] ?? match[2] ?? match[3];
    if (href) found.push(decode(href.trim()));
  }
  return found;
}

/** Tagged text in document order, so the model reads the page roughly as a visitor would. */
function linesIn(html: string): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  const push = (role: string, text: string): void => {
    const value = clean(text);
    if (!value) return;
    const line = `${role}: ${value.slice(0, 160)}`;
    if (seen.has(line)) return;
    seen.add(line);
    lines.push(line);
  };

  for (const match of html.matchAll(/<(h[1-6]|a|button|label|legend)\b[^>]*>([\s\S]{0,400}?)<\/\1>/gi)) {
    const tag = match[1]!.toLowerCase();
    push(tag.startsWith("h") && tag.length === 2 ? `heading${tag[1]}` : tag === "a" ? "link" : tag, (match[2] ?? "").replace(TAG, " "));
  }
  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = match[0];
    const type = /\stype\s*=\s*["']?([\w-]+)/i.exec(tag)?.[1] ?? "text";
    const label = /\s(?:aria-label|placeholder|name)\s*=\s*["']([^"']+)/i.exec(tag)?.[1] ?? "";
    if (type.toLowerCase() !== "hidden") push(`input[${type}]`, label || "(unlabelled)");
  }
  for (const match of html.matchAll(/<select\b[^>]*>/gi)) {
    push("select", /\s(?:aria-label|name)\s*=\s*["']([^"']+)/i.exec(match[0])?.[1] ?? "(unlabelled)");
  }
  return lines;
}

export function surveyHtml(html: string): PageSurvey {
  const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const hrefs = hrefsIn(html);
  const lines = linesIn(html);

  const body = html.replace(COMMENT, " ").replace(SCRIPT_OR_STYLE, " ");
  const text = clean(body.replace(TAG, " "));
  const scriptChars = (html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) ?? []).reduce((total, tag) => total + tag.length, 0);

  const forms = countOf(html, /<form\b/gi);
  const buttons = countOf(html, /<button\b/gi) + countOf(html, /<input\b[^>]*\stype\s*=\s*["']?(submit|button)\b/gi) + countOf(html, /role\s*=\s*["']button["']/gi);
  const inputs = countOf(html, /<input\b(?![^>]*\stype\s*=\s*["']?hidden)/gi) + countOf(html, /<textarea\b/gi);
  const selects = countOf(html, /<select\b/gi);
  const flowWords = [...hrefs, ...lines].filter((entry) => FLOW_WORDS.test(entry)).length;

  return {
    title,
    lines,
    hrefs,
    // Forms are the strongest signal, a keyword on its own the weakest.
    interactive: forms * 3 + buttons + inputs + selects + Math.min(flowWords, 8),
    jsShell: text.length < JS_SHELL_TEXT && (MOUNT_NODE.test(html) || (html.length > 0 && scriptChars / html.length > SCRIPT_SHARE)),
    textLength: text.length,
  };
}
