/**
 * Generates fixtures/golden-run.json: the demo safety net and the frontend's
 * dev fixture. Deterministic (no clock, no randomness) so re-running it gives a
 * byte-identical file.
 *
 *   pnpm golden:generate
 *
 * The story: three personas try to "find a winter jacket and add it to cart"
 * on a fictional store.
 *   impatient  FAILS. The primary button silently ignores the click when no
 *              size is chosen; two dead clicks and Riley is gone.
 *   cautious   succeeds on the third product, on the last allowed step, after
 *              two out-of-stock dead ends.
 *   keyboard   succeeds on the very last allowed step, after a focus trap.
 *
 * Every friction below is one the deterministic detectors find on their own
 * from the step data; friction.test.ts holds the fixture to that.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MOCK_LAYOUT as L,
  RunSnapshotSchema,
  stateForOutcome,
  type ActionType,
  type BBox,
  type FrictionCategory,
  type Outcome,
  type PersonaId,
  type PersonaRecord,
  type RunEvent,
  type RunSnapshot,
  type Severity,
  type StepSignals,
} from "../packages/shared/src/index";

const ORIGIN = "https://shop.northpeak.example";
const RUN_ID = "golden";
const T0 = Date.UTC(2026, 8, 19, 14, 0, 0);
const VIEWPORT = { w: 1280, h: 720 };
const CAPTURE_MS = 250;

const MODAL = "Get 10% off your first order";
const OUT_OF_STOCK = "Sorry, size M is out of stock in Black. Please choose another size or colour.";

interface FrictionSpec {
  category: FrictionCategory;
  severity: Severity;
  confidence: number;
  /** model latency before the judgement lands */
  judgeMs: number;
  summary: string;
  whyItMatters: string;
  recommendation: string;
}

interface StepSpec {
  /** planning latency before the action */
  think: number;
  /** path the action is performed on */
  at: string;
  /** path afterwards (defaults to `at`) */
  after?: string;
  action: ActionType;
  label: string;
  selector: string;
  bbox: BBox | null;
  value?: string;
  rationale: string;
  duration: number;
  domChanged: boolean;
  signals?: StepSignals;
  friction?: FrictionSpec[];
}

interface PersonaScript {
  id: PersonaId;
  /** ms after T0 at which the browser session is up */
  sessionUpMs: number;
  steps: StepSpec[];
  ending: { outcome: Outcome; message: string; summary: string };
}

const tabs = (n: number): string[] => Array.from({ length: n }, () => "Tab");

/* --------------------------------------------------------------- impatient */

const impatient: PersonaScript = {
  id: "impatient",
  sessionUpMs: 2800,
  steps: [
    { think: 900, at: "/", action: "navigate", label: "", selector: "", bbox: null, value: `${ORIGIN}/`, rationale: "Open the store.", duration: 1900, domChanged: true },
    { think: 1700, at: "/", action: "click", label: "Accept all cookies", selector: "xpath=/html/body/div[3]/div/div[2]/button[2]", bbox: L.cookieAccept, rationale: "Cookie wall. Accept, whatever, move.", duration: 240, domChanged: true },
    { think: 1800, at: "/", after: "/collections/winter-edit", action: "click", label: "Shop the Winter Edit", selector: "xpath=/html/body/main/section[1]/div/a", bbox: L.heroCta, rationale: "Big button says winter. That's my jacket.", duration: 2300, domChanged: true },
    { think: 1600, at: "/collections/winter-edit", action: "scroll", label: "", selector: "", bbox: null, value: "down", rationale: "No products up here, just photos. Scrolling.", duration: 420, domChanged: false },
    { think: 1500, at: "/collections/winter-edit", action: "scroll", label: "", selector: "", bbox: null, value: "down", rationale: "Still a photo essay. Where's the stuff I can buy?", duration: 410, domChanged: false },
    { think: 1900, at: "/collections/winter-edit", action: "click", label: "Search", selector: "xpath=/html/body/header/div/div[2]/button[1]", bbox: L.searchButton, rationale: "Forget this page, I'll search.", duration: 310, domChanged: true },
    { think: 1500, at: "/collections/winter-edit", action: "type", label: "Search products", selector: "xpath=/html/body/header/div/form/input", bbox: L.searchField, value: "winter jacket", rationale: "Typing what I want.", duration: 620, domChanged: true },
    { think: 1300, at: "/collections/winter-edit", after: "/search?q=winter+jacket", action: "press", label: "Search products", selector: "xpath=/html/body/header/div/form/input", bbox: L.searchField, value: "Enter", rationale: "Enter to search.", duration: 2100, domChanged: true, signals: { keysPressed: ["Enter"], focusMoved: true } },
    { think: 1900, at: "/search?q=winter+jacket", action: "click", label: "Jackets & Coats", selector: "xpath=/html/body/main/div[1]/div/button[1]", bbox: L.filterChip(0), rationale: "Narrow it to jackets, one tap.", duration: 680, domChanged: true },
    {
      think: 1700, at: "/search?q=winter+jacket", after: "/products/alpine-down-parka", action: "click", label: "Alpine Down Parka", selector: "xpath=/html/body/main/div[2]/article[1]/a", bbox: L.productName(0),
      rationale: "First result looks right. Open it.", duration: 6400, domChanged: true,
      friction: [{
        category: "long_wait", severity: 3, confidence: 0.86, judgeMs: 1300,
        summary: 'click on "Alpine Down Parka" took 6.4s to settle.',
        whyItMatters: "A shopper who has already found the product is left staring at an unresponsive page for more than six seconds. Most will assume the click failed and either click again or leave.",
        recommendation: "Get the product page interactive in under 2.5s: server-render the above-the-fold content, defer the reviews and recommendations widgets, and show a skeleton immediately on navigation.",
      }],
    },
    {
      think: 2000, at: "/products/alpine-down-parka", action: "click", label: "Add to cart", selector: "xpath=/html/body/main/div/div[2]/form/button", bbox: L.addToCart,
      rationale: "Add to cart. Done.", duration: 190, domChanged: false,
      friction: [{
        category: "dead_click", severity: 5, confidence: 0.93, judgeMs: 1400,
        summary: 'Clicked "Add to cart" and nothing happened: no navigation, no DOM change.',
        whyItMatters: "The primary conversion button silently ignores the click when no size is selected. There is no error, no highlight and no disabled state, so the shopper cannot tell what is wrong.",
        recommendation: 'Never fail silently on the primary CTA. Disable "Add to cart" with a visible "Select a size" hint until a size is chosen, or on click scroll to the size selector, outline it in red and announce "Please select a size".',
      }],
    },
    {
      think: 1500, at: "/products/alpine-down-parka", action: "click", label: "Add to cart", selector: "xpath=/html/body/main/div/div[2]/form/button", bbox: L.addToCart,
      rationale: "Nothing happened? Clicking it again.", duration: 180, domChanged: false,
      friction: [{
        category: "retry", severity: 4, confidence: 0.9, judgeMs: 1200,
        summary: 'Repeated click on "Add to cart" straight after the first attempt.',
        whyItMatters: "A second identical click confirms the user believed the first one failed. This persona abandons after two failed attempts, so this is the exact moment the sale is lost.",
        recommendation: "Give instant feedback on every press of the primary button (pressed state, spinner or inline validation) so a retry is never needed.",
      }],
    },
  ],
  ending: {
    outcome: "failure",
    message: 'Abandoned: "Add to cart" did nothing, twice.',
    summary: "Gave up after two dead clicks on Add to cart. Never learned a size was required.",
  },
};

/* ---------------------------------------------------------------- cautious */

const cautious: PersonaScript = {
  id: "cautious",
  sessionUpMs: 3400,
  steps: [
    { think: 1200, at: "/", action: "navigate", label: "", selector: "", bbox: null, value: `${ORIGIN}/`, rationale: "I'm opening the shop's home page to get my bearings.", duration: 2000, domChanged: true },
    { think: 4200, at: "/", action: "click", label: "Accept all cookies", selector: "xpath=/html/body/div[3]/div/div[2]/button[2]", bbox: L.cookieAccept, rationale: "The banner says cookies are for personalisation; 'Accept all cookies' is clear enough, so I'll accept to get it out of the way.", duration: 260, domChanged: true },
    { think: 4600, at: "/", after: "/collections/men", action: "click", label: "Men", selector: "xpath=/html/body/header/div/nav/ul/li[1]/a", bbox: L.navMen, rationale: "I'd rather browse than search, and 'Men' is the most specific menu item for a men's winter jacket.", duration: 1800, domChanged: true },
    { think: 3900, at: "/collections/men", after: "/collections/mens-jackets", action: "click", label: "Jackets & Coats", selector: "xpath=/html/body/main/div[2]/a[1]", bbox: L.categoryTile(0), rationale: "'Jackets & Coats' says exactly what I'm looking for, so I feel confident clicking it.", duration: 2100, domChanged: true },
    {
      think: 4400, at: "/collections/mens-jackets", action: "scroll", label: "", selector: "", bbox: null, value: "down",
      rationale: "I want to read through the jackets on offer before I open any of them.", duration: 520, domChanged: true,
      signals: { modalAppeared: true, modalLabel: MODAL },
      friction: [{
        category: "modal_interrupt", severity: 3, confidence: 0.84, judgeMs: 1500,
        summary: `An overlay ("${MODAL}") appeared and covered the page.`,
        whyItMatters: "A first-time visitor was interrupted twenty seconds into browsing, before seeing a single product in detail. They had to stop, read the offer and hunt for the decline link before they could carry on.",
        recommendation: "Delay the newsletter prompt until the visitor has shown intent (added to cart, or viewed two products), or use a non-blocking banner. Make the decline action a clearly labelled button, not a small text link.",
      }],
    },
    { think: 5200, at: "/collections/mens-jackets", action: "click", label: "No thanks", selector: "xpath=/html/body/div[5]/div/div/button[2]", bbox: L.modalDecline, rationale: "A pop-up is asking for my email; I didn't ask for this, and 'No thanks' seems the safest way to close it.", duration: 300, domChanged: true },
    { think: 4100, at: "/collections/mens-jackets", after: "/products/alpine-down-parka", action: "click", label: "Alpine Down Parka", selector: "xpath=/html/body/main/div[2]/article[1]/a", bbox: L.productName(0), rationale: "'Alpine Down Parka' sounds like a proper winter jacket, so I'll look at its details.", duration: 4200, domChanged: true },
    { think: 4800, at: "/products/alpine-down-parka", action: "select", label: "Size", selector: "xpath=/html/body/main/div/div[2]/form/fieldset[2]/label[3]", bbox: L.sizeOption(2), value: "M", rationale: "I'll choose my size before anything else; M is what I normally wear.", duration: 210, domChanged: true },
    {
      think: 3600, at: "/products/alpine-down-parka", action: "click", label: "Add to cart", selector: "xpath=/html/body/main/div/div[2]/form/button", bbox: L.addToCart,
      rationale: "Size is selected and the price is shown, so 'Add to cart' should be safe now.", duration: 640, domChanged: true,
      signals: { errorTexts: [OUT_OF_STOCK] },
      friction: [{
        category: "error_text", severity: 4, confidence: 0.88, judgeMs: 1400,
        summary: `Error shown after click on "Add to cart": "${OUT_OF_STOCK}"`,
        whyItMatters: "Stock status is only revealed after the shopper has picked a size and tried to buy. The size looked available, so the error reads as the site rejecting them rather than as helpful information.",
        recommendation: 'Show availability before the click: grey out or strike through sold-out sizes per colour, and offer "Notify me" in place of "Add to cart" for unavailable combinations.',
      }],
    },
    { think: 5400, at: "/products/alpine-down-parka", after: "/collections/mens-jackets", action: "click", label: "Jackets & Coats", selector: "xpath=/html/body/main/nav/ol/li[3]/a", bbox: L.breadcrumbCategory, rationale: "It says M is out of stock in Black and I'm not sure about the other colours, so I'll go back to the list and look at another jacket.", duration: 1900, domChanged: true },
    { think: 3800, at: "/collections/mens-jackets", after: "/products/summit-insulated-jacket", action: "click", label: "Summit Insulated Jacket", selector: "xpath=/html/body/main/div[2]/article[2]/a", bbox: L.productName(1), rationale: "'Insulated' suggests it's warm enough for winter, so I'll check this one.", duration: 2600, domChanged: true },
    { think: 3900, at: "/products/summit-insulated-jacket", after: "/collections/mens-jackets", action: "click", label: "Jackets & Coats", selector: "xpath=/html/body/main/nav/ol/li[3]/a", bbox: L.breadcrumbCategory, rationale: "I can see M is greyed out on this jacket too, so it's back to the list again.", duration: 1700, domChanged: true },
    {
      think: 3500, at: "/collections/mens-jackets", after: "/products/glacier-3-in-1-jacket", action: "click", label: "Glacier 3-in-1 Jacket", selector: "xpath=/html/body/main/div[2]/article[3]/a", bbox: L.productName(2),
      rationale: "Third try: '3-in-1' should cover winter, and I hope this one has my size.", duration: 2400, domChanged: true,
      friction: [{
        category: "step_budget", severity: 3, confidence: 0.78, judgeMs: 1100,
        summary: "13 steps taken without completing the task (budget: 12).",
        whyItMatters: "Adding one jacket to the cart should take a careful user six to eight steps. Needing more than twelve means the path is padded with detours: a marketing modal and two out-of-stock dead ends.",
        recommendation: "Shorten the happy path: surface size availability on the listing cards and remove interruptions before the first add-to-cart.",
      }, {
        category: "loop", severity: 4, confidence: 0.82, judgeMs: 1700,
        summary: "Landed on /collections/mens-jackets for the 3rd time.",
        whyItMatters: "The shopper is pogo-sticking between the listing and product pages because the listing does not show which jackets are available in their size. Every round trip costs two page loads and a little more confidence.",
        recommendation: 'Add a size filter and per-card availability ("M in stock") to the collection page so shoppers can rule products out without opening them.',
      }],
    },
    { think: 4300, at: "/products/glacier-3-in-1-jacket", action: "select", label: "Size", selector: "xpath=/html/body/main/div/div[2]/form/fieldset[2]/label[3]", bbox: L.sizeOption(2), value: "M", rationale: "M isn't greyed out here, so I'm selecting it.", duration: 220, domChanged: true },
    { think: 3700, at: "/products/glacier-3-in-1-jacket", action: "click", label: "Add to cart", selector: "xpath=/html/body/main/div/div[2]/form/button", bbox: L.addToCart, rationale: "Size M is selected and the colour and price look right, so I'll add it to the cart.", duration: 720, domChanged: true },
  ],
  ending: {
    outcome: "success",
    message: "Task complete: the cart shows 1 item.",
    summary: "Added the Glacier 3-in-1 Jacket (M) to the cart after two out-of-stock dead ends.",
  },
};

/* ---------------------------------------------------------------- keyboard */

const keyboard: PersonaScript = {
  id: "keyboard",
  sessionUpMs: 3100,
  steps: [
    { think: 1000, at: "/", action: "navigate", label: "", selector: "", bbox: null, value: `${ORIGIN}/`, rationale: "Loading the store; I'll start tabbing from the top.", duration: 1950, domChanged: true },
    { think: 2900, at: "/", action: "press", label: "Accept all cookies", selector: "xpath=/html/body/div[3]/div/div[2]/button[2]", bbox: L.cookieAccept, value: "Tab Enter", rationale: "Tab lands on 'Accept all cookies' first; Enter to dismiss the banner.", duration: 340, domChanged: true, signals: { keysPressed: ["Tab", "Enter"], focusMoved: true, focusLabel: "Accept all cookies" } },
    { think: 3100, at: "/", action: "press", label: "Search", selector: "xpath=/html/body/header/div/div[2]/button[1]", bbox: L.searchButton, value: tabs(6).join(" "), rationale: "There's no skip link, so I'm tabbing through the logo and the whole menu to reach Search.", duration: 760, domChanged: false, signals: { keysPressed: tabs(6), focusMoved: true, focusLabel: "Search" } },
    { think: 2400, at: "/", action: "press", label: "Search", selector: "xpath=/html/body/header/div/div[2]/button[1]", bbox: L.searchButton, value: "Enter", rationale: "Focus is on the Search button; Enter should open the search field.", duration: 330, domChanged: true, signals: { keysPressed: ["Enter"], focusMoved: true, focusLabel: "Search products" } },
    { think: 2300, at: "/", action: "type", label: "Search products", selector: "xpath=/html/body/header/div/form/input", bbox: L.searchField, value: "winter jacket", rationale: "Focus moved into the search field, so I'm typing my query.", duration: 640, domChanged: true },
    { think: 2100, at: "/", after: "/search?q=winter+jacket", action: "press", label: "Search products", selector: "xpath=/html/body/header/div/form/input", bbox: L.searchField, value: "Enter", rationale: "Enter to submit the search.", duration: 2200, domChanged: true, signals: { keysPressed: ["Enter"], focusMoved: true, focusLabel: "Northpeak home" } },
    {
      think: 3300, at: "/search?q=winter+jacket", action: "press", label: "Select options", selector: "xpath=/html/body/main/div[2]/article[1]/button", bbox: L.productSelect(0), value: tabs(9).join(" "),
      rationale: "Tabbing past the header and filters again to reach the first result; it's announced only as 'Select options'.", duration: 1100, domChanged: false,
      signals: { keysPressed: tabs(9), focusMoved: true, focusLabel: "Select options", sameLabelCount: 4 },
      friction: [{
        category: "ambiguous_label", severity: 3, confidence: 0.87, judgeMs: 1400,
        summary: '4 controls on this page share the accessible name "Select options".',
        whyItMatters: 'A keyboard or screen-reader user tabbing through the results hears "Select options" four times with no product name, so they cannot tell which jacket each button belongs to without backtracking.',
        recommendation: 'Give each control a unique accessible name, e.g. aria-label="Select options for Alpine Down Parka", or make the product title the link and drop the generic button.',
      }],
    },
    { think: 2600, at: "/search?q=winter+jacket", after: "/products/alpine-down-parka", action: "press", label: "Select options", selector: "xpath=/html/body/main/div[2]/article[1]/button", bbox: L.productSelect(0), value: "Enter", rationale: "Every card says 'Select options', so I'm assuming the first one belongs to the first jacket. Enter.", duration: 3100, domChanged: true, signals: { keysPressed: ["Enter"], focusMoved: true, focusLabel: "Northpeak home", sameLabelCount: 4 } },
    {
      think: 3000, at: "/products/alpine-down-parka", action: "press", label: "Colour: Black", selector: "xpath=/html/body/main/div/div[2]/form/fieldset[1]/label[1]", bbox: L.colourSwatch(0), value: tabs(4).join(" "),
      rationale: "Tabbing towards the size options; a dialog just appeared, but my focus didn't move into it.", duration: 820, domChanged: true,
      signals: { keysPressed: tabs(4), focusMoved: true, focusLabel: "Colour: Black", modalAppeared: true, modalLabel: MODAL },
      friction: [{
        category: "modal_interrupt", severity: 4, confidence: 0.85, judgeMs: 1300,
        summary: `An overlay ("${MODAL}") appeared and covered the page.`,
        whyItMatters: "The dialog opened on a timer without moving keyboard focus into it. A keyboard-only user is now behind an overlay they did not ask for and cannot see where their focus is.",
        recommendation: "When a dialog opens, move focus into it, keep Tab cycling inside it, and return focus to the previous element on close. Better still, do not open marketing dialogs on a timer at all.",
      }],
    },
    {
      think: 2700, at: "/products/alpine-down-parka", action: "press", label: "Colour: Black", selector: "xpath=/html/body/main/div/div[2]/form/fieldset[1]/label[1]", bbox: L.colourSwatch(0), value: "Tab",
      rationale: "Pressing Tab to get into the dialog, but focus is not moving at all; this is a keyboard trap.", duration: 260, domChanged: false,
      signals: { keysPressed: ["Tab"], focusMoved: false, focusLabel: "Colour: Black" },
      friction: [{
        category: "keyboard_trap", severity: 5, confidence: 0.95, judgeMs: 1200,
        summary: 'Pressed Tab and focus did not move (stuck on "Colour: Black").',
        whyItMatters: "With the dialog open, Tab does nothing: focus is stuck on an element hidden behind the overlay. A keyboard-only user has no way forward except guessing that Escape might work. This fails WCAG 2.1.2 (No Keyboard Trap).",
        recommendation: "Build the dialog on the native <dialog> element or a tested focus-trap: focus moves into the dialog, Tab cycles within it, and Escape closes it and restores focus.",
      }],
    },
    { think: 2500, at: "/products/alpine-down-parka", action: "press", label: MODAL, selector: "xpath=/html/body/div[5]/div", bbox: { x: 390, y: 170, w: 500, h: 380 }, value: "Escape", rationale: "Trying Escape to get rid of the dialog I can't reach.", duration: 310, domChanged: true, signals: { keysPressed: ["Escape"], focusMoved: true, focusLabel: "Northpeak home" } },
    { think: 3200, at: "/products/alpine-down-parka", action: "press", label: "Size: XS", selector: "xpath=/html/body/main/div/div[2]/form/fieldset[2]/label[1]", bbox: L.sizeOption(0), value: tabs(12).join(" "), rationale: "The dialog closed but focus was reset to the top of the page, so I'm tabbing all the way back down to Size.", duration: 1400, domChanged: false, signals: { keysPressed: tabs(12), focusMoved: true, focusLabel: "Size: XS" } },
    {
      think: 2400, at: "/products/alpine-down-parka", action: "press", label: "Size: L", selector: "xpath=/html/body/main/div/div[2]/form/fieldset[2]/label[4]", bbox: L.sizeOption(3), value: "ArrowRight ArrowRight ArrowRight",
      rationale: "Focus is on the size group; arrow keys to move from XS to L.", duration: 420, domChanged: true,
      signals: { keysPressed: ["ArrowRight", "ArrowRight", "ArrowRight"], focusMoved: true, focusLabel: "Size: L" },
      friction: [{
        category: "step_budget", severity: 3, confidence: 0.8, judgeMs: 1300,
        summary: "13 steps taken without completing the task (budget: 12).",
        whyItMatters: "With no skip link, every page load costs this user six to twelve Tab presses through the header before reaching content, and the modal forced a full restart of the tab order.",
        recommendation: 'Add a "Skip to main content" link as the first focusable element, and keep the focus position after closing overlays instead of resetting it to the top of the page.',
      }],
    },
    { think: 2600, at: "/products/alpine-down-parka", action: "press", label: "Add to cart", selector: "xpath=/html/body/main/div/div[2]/form/button", bbox: L.addToCart, value: "Tab Tab Enter", rationale: "Two Tabs to reach 'Add to cart', then Enter.", duration: 780, domChanged: true, signals: { keysPressed: ["Tab", "Tab", "Enter"], focusMoved: true, focusLabel: "View cart" } },
    { think: 2800, at: "/products/alpine-down-parka", after: "/cart", action: "press", label: "View cart", selector: "xpath=/html/body/div[7]/aside/a", bbox: L.cartDrawerView, value: "Tab Enter", rationale: "A cart panel opened and took focus; Tab to 'View cart' and Enter to confirm the jacket is in there.", duration: 1900, domChanged: true, signals: { keysPressed: ["Tab", "Enter"], focusMoved: true, focusLabel: "Northpeak home" } },
  ],
  ending: {
    outcome: "success",
    message: "Task complete: the cart shows 1 item.",
    summary: "Added the parka to the cart on the 15th and last allowed step, after escaping a focus trap.",
  },
};

/* ---------------------------------------------------------------- assemble */

type Draft = Omit<RunEvent, "seq"> & { seq?: number; order: number; evidenceStep?: number };

function build(script: PersonaScript): { events: RunEvent[]; record: PersonaRecord } {
  const drafts: Draft[] = [];
  let order = 0;
  const push = (draft: Omit<Draft, "order" | "runId" | "personaId">): void => {
    drafts.push({ ...draft, runId: RUN_ID, personaId: script.id, order: order++ } as Draft);
  };

  push({ ts: T0 + 60 + order * 7, type: "status", payload: { state: "idle", currentSeq: 0, message: "Queued. Starting a Browserbase session." } });
  push({ ts: T0 + script.sessionUpMs, type: "status", payload: { state: "running", currentSeq: 0, message: "Session is up." } });

  let clock = T0 + script.sessionUpMs;
  let latest = clock;
  script.steps.forEach((step, index) => {
    clock += step.think + step.duration + CAPTURE_MS;
    latest = Math.max(latest, clock);
    const stepNumber = index + 1;
    push({
      ts: clock,
      type: "step",
      evidenceStep: stepNumber,
      payload: {
        url: `${ORIGIN}${step.at}`,
        actionType: step.action,
        targetLabel: step.label,
        selector: step.selector,
        rationale: step.rationale,
        screenshotKey: `golden/${script.id}/${String(stepNumber).padStart(2, "0")}.svg`,
        bbox: step.bbox,
        durationMs: step.duration,
        domChanged: step.domChanged,
        ...(step.value === undefined ? {} : { value: step.value }),
        viewport: VIEWPORT,
        signals: { urlAfter: `${ORIGIN}${step.after ?? step.at}`, ...step.signals },
      },
    });
    for (const friction of step.friction ?? []) {
      const ts = clock + friction.judgeMs;
      latest = Math.max(latest, ts);
      push({
        ts,
        type: "friction",
        evidenceStep: stepNumber,
        payload: {
          category: friction.category,
          severity: friction.severity,
          evidenceSeq: -1,
          recommendation: friction.recommendation,
          confidence: friction.confidence,
          summary: friction.summary,
          whyItMatters: friction.whyItMatters,
          judgedBy: "model",
        },
      });
    }
  });

  const frictionCount = script.steps.reduce((n, s) => n + (s.friction?.length ?? 0), 0);
  const state = stateForOutcome(script.ending.outcome);
  push({ ts: latest + 350, type: "status", payload: { state, currentSeq: 0, message: script.ending.message } });
  push({
    ts: latest + 450,
    type: "done",
    payload: {
      outcome: script.ending.outcome,
      totalSteps: script.steps.length,
      frictionCount,
      durationMs: latest + 450 - T0,
      summary: script.ending.summary,
    },
  });

  // seq follows emission order, which is timestamp order within a persona.
  drafts.sort((a, b) => a.ts - b.ts || a.order - b.order);
  const seqOfStep = new Map<number, number>();
  drafts.forEach((draft, index) => {
    draft.seq = index + 1;
    if (draft.type === "step" && draft.evidenceStep !== undefined) seqOfStep.set(draft.evidenceStep, draft.seq);
  });

  const events = drafts.map((draft): RunEvent => {
    const { order: _order, evidenceStep, ...event } = draft;
    if (event.type === "friction") {
      event.payload = { ...event.payload, evidenceSeq: seqOfStep.get(evidenceStep ?? -1) ?? 0 };
    } else if (event.type === "status") {
      event.payload = { ...event.payload, currentSeq: event.seq ?? 0 };
    }
    return event as RunEvent;
  });

  const record: PersonaRecord = {
    id: `${RUN_ID}:${script.id}`,
    runId: RUN_ID,
    personaId: script.id,
    state,
    stepCount: script.steps.length,
    liveViewUrl: null,
    sessionId: null,
    replayUrl: null,
  };
  return { events, record };
}

const built = [impatient, cautious, keyboard].map(build);
const events = built
  .flatMap((b) => b.events)
  .sort((a, b) => a.ts - b.ts || (a.personaId < b.personaId ? -1 : a.personaId > b.personaId ? 1 : a.seq - b.seq));
const lastTs = events[events.length - 1]?.ts ?? T0;

const snapshot: RunSnapshot = {
  run: {
    id: RUN_ID,
    url: `${ORIGIN}/`,
    task: "Find a winter jacket and add it to cart",
    status: "completed",
    createdAt: T0,
    completedAt: lastTs,
  },
  personas: built.map((b) => b.record),
  events,
  source: "fixture",
};

// Fail loudly here rather than in three apps at once.
const parsed = RunSnapshotSchema.parse(snapshot);

const outFile = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/golden-run.json");
writeFileSync(outFile, `${JSON.stringify(parsed, null, 2)}\n`);

const per = (id: PersonaId, type: RunEvent["type"]): number => parsed.events.filter((e) => e.personaId === id && e.type === type).length;
console.log(`wrote ${outFile}`);
console.log(`  ${parsed.events.length} events over ${((lastTs - T0) / 1000).toFixed(1)}s of run time`);
for (const b of built) {
  const id = b.record.personaId;
  const categories = parsed.events.filter((e) => e.personaId === id && e.type === "friction").map((e) => (e.type === "friction" ? e.payload.category : ""));
  console.log(`  ${id.padEnd(10)} ${b.record.state.padEnd(10)} steps=${per(id, "step")} friction=${per(id, "friction")} [${categories.join(", ")}]`);
}
