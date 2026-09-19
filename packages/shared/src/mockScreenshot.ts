/**
 * Wireframe "screenshots" for the golden fixture and for the orchestrator's
 * mock mode. Pure string -> SVG, no DOM, so the Worker, the control room and
 * Node can all render the same image from nothing but a step payload. That is
 * what lets the report show evidence with the wifi off and no binaries in git.
 *
 * The scene is inferred from the step: page template from the URL path,
 * overlays (cookie banner, newsletter modal, error, drawers) from the label
 * and signals. The target is always drawn at payload.bbox, so the overlay
 * rectangle the UI draws lands exactly on a visible element.
 *
 * Real runs never use this: they upload real JPEGs.
 */
import { DEFAULT_VIEWPORT, type BBox, type StepPayload } from "./events";

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const INK = "#0f172a";
const MUTED = "#64748b";
const LINE = "#e2e8f0";
const FILL = "#f1f5f9";
const IMG = "#e2e8f0";

const box = (x: number, y: number, w: number, h: number): BBox => ({ x, y, w, h });

/** Where things are in the wireframe. The fixture generator takes its bboxes from here. */
export const MOCK_LAYOUT = {
  navMen: box(252, 18, 52, 30),
  navWinterEdit: box(470, 18, 104, 30),
  logo: box(32, 16, 150, 34),
  searchButton: box(1088, 14, 38, 38),
  cartButton: box(1196, 14, 38, 38),
  searchField: box(320, 12, 640, 42),
  heroCta: box(96, 336, 268, 54),
  cookieAccept: box(1068, 652, 180, 42),
  cookieManage: box(872, 652, 180, 42),
  categoryTile: (index: number) => box(32 + index * 308, 150, 292, 300),
  filterChip: (index: number) => box(32 + index * 166, 150, 154, 34),
  productName: (index: number) => box(32 + index * 308, 520, 292, 24),
  productSelect: (index: number) => box(32 + index * 308, 578, 292, 38),
  breadcrumbCategory: box(146, 78, 124, 24),
  colourSwatch: (index: number) => box(680 + index * 56, 252, 44, 44),
  sizeGuideLink: box(1098, 318, 86, 24),
  sizeOption: (index: number) => box(680 + index * 72, 346, 64, 46),
  addToCart: box(680, 424, 504, 56),
  modalDecline: box(586, 488, 108, 30),
  cartDrawerView: box(840, 604, 400, 52),
} as const;

const PRODUCTS = ["Alpine Down Parka", "Summit Insulated Jacket", "Glacier 3-in-1 Jacket", "Ridgeline Shell"];
const PRICES = ["$349", "$279", "$319", "$229"];
const SIZES = ["XS", "S", "M", "L", "XL"];

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function rect(b: BBox, fill: string, extra = ""): string {
  return `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${fill}" ${extra}/>`;
}

function text(x: number, y: number, value: string, size = 14, fill = INK, extra = ""): string {
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${esc(value)}</text>`;
}

function centered(b: BBox, value: string, size = 14, fill = INK, extra = ""): string {
  return text(b.x + b.w / 2, b.y + b.h / 2 + size * 0.36, value, size, fill, `text-anchor="middle" ${extra}`);
}

function button(b: BBox, label: string, primary = false): string {
  return (
    rect(b, primary ? INK : "#ffffff", `rx="6" stroke="${primary ? INK : "#94a3b8"}"`) +
    centered(b, label, 14, primary ? "#ffffff" : INK, 'font-weight="600"')
  );
}

function titleCase(slug: string): string {
  return slug
    .split("-")
    .map((word) => (/^\d/.test(word) || word === "in" ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ")
    .replace(/(\d) in (\d)/i, "$1-in-$2");
}

type PageKind = "home" | "lookbook" | "category" | "grid" | "product" | "cart" | "generic";

function parse(url: string): { kind: PageKind; path: string; query: string } {
  let path = "/";
  let query = "";
  try {
    const parsed = new URL(url);
    path = parsed.pathname;
    query = parsed.searchParams.get("q") ?? "";
  } catch {
    /* keep defaults */
  }
  let kind: PageKind = "generic";
  if (path === "/" || path === "") kind = "home";
  else if (path.startsWith("/collections/winter-edit")) kind = "lookbook";
  else if (path === "/collections/men") kind = "category";
  else if (path.startsWith("/collections/") || path.startsWith("/search")) kind = "grid";
  else if (path.startsWith("/products/")) kind = "product";
  else if (path.startsWith("/cart")) kind = "cart";
  return { kind, path, query };
}

function header(query: string, searchOpen: boolean): string {
  const L = MOCK_LAYOUT;
  let out = rect(box(0, 0, 1280, 66), "#ffffff") + `<line x1="0" y1="66" x2="1280" y2="66" stroke="${LINE}"/>`;
  out += text(32, 42, "NORTHPEAK", 22, INK, 'font-weight="800" letter-spacing="2"');
  if (searchOpen) {
    out += rect(L.searchField, "#ffffff", `rx="6" stroke="${INK}" stroke-width="2"`);
    out += text(L.searchField.x + 16, 39, query || "Search products", 15, query ? INK : MUTED);
  } else {
    ["Men", "Women", "Kids", "Winter Edit", "Sale"].forEach((item, index) => {
      out += text([260, 334, 420, 478, 604][index] ?? 260, 39, item, 15, INK, 'font-weight="500"');
    });
  }
  out += `<circle cx="1105" cy="31" r="9" fill="none" stroke="${INK}" stroke-width="2"/><line x1="1112" y1="38" x2="1119" y2="45" stroke="${INK}" stroke-width="2"/>`;
  out += `<circle cx="1160" cy="28" r="7" fill="none" stroke="${INK}" stroke-width="2"/><path d="M1147 47c2-10 24-10 26 0" fill="none" stroke="${INK}" stroke-width="2"/>`;
  out += `<path d="M1204 24h22l-3 18h-16z" fill="none" stroke="${INK}" stroke-width="2"/>`;
  return out;
}

function productGrid(title: string, crumb: string, identicalButtons: boolean): string {
  const L = MOCK_LAYOUT;
  let out = text(32, 96, crumb, 13, MUTED) + text(32, 134, title, 26, INK, 'font-weight="700"');
  ["Jackets & Coats", "Insulated", "Waterproof", "Under $300"].forEach((chip, index) => {
    const b = L.filterChip(index);
    out += rect(b, "#ffffff", `rx="17" stroke="#94a3b8"`) + centered(b, chip, 13);
  });
  PRODUCTS.forEach((name, index) => {
    const x = 32 + index * 308;
    out += rect(box(x, 200, 292, 304), IMG, 'rx="8"');
    out += `<path d="M${x + 96} 400l50-70 40 50 26-30 40 50z" fill="#cbd5e1"/>`;
    out += text(x, 538, name, 15, INK, 'font-weight="600"') + text(x, 562, PRICES[index] ?? "", 14, MUTED);
    out += button(L.productSelect(index), identicalButtons ? "Select options" : "Quick add");
  });
  return out;
}

function productPage(name: string, errors: readonly string[]): string {
  const L = MOCK_LAYOUT;
  let out = text(32, 96, "Home  /  Men  /", 13, MUTED) + text(150, 96, "Jackets & Coats", 13, INK, 'text-decoration="underline"');
  out += text(282, 96, `/  ${name}`, 13, MUTED);
  out += rect(box(32, 112, 600, 560), IMG, 'rx="8"');
  out += `<path d="M190 520l120-170 90 120 60-70 110 120z" fill="#cbd5e1"/>`;
  out += text(680, 160, name, 30, INK, 'font-weight="700"') + text(680, 198, "$349.00", 20, INK);
  out += text(680, 240, "Colour", 13, MUTED);
  ["#111827", "#14532d", "#1e3a8a"].forEach((colour, index) => {
    out += rect(L.colourSwatch(index), colour, `rx="22" stroke="#ffffff" stroke-width="3"`);
  });
  out += text(680, 336, "Size", 13, MUTED) + text(L.sizeGuideLink.x + 4, 335, "Size guide", 13, INK, 'text-decoration="underline"');
  SIZES.forEach((size, index) => {
    const b = L.sizeOption(index);
    out += rect(b, "#ffffff", `rx="6" stroke="#94a3b8"`) + centered(b, size, 14);
  });
  out += button(L.addToCart, "Add to cart", true);
  errors.slice(0, 2).forEach((message, index) => {
    const y = 498 + index * 44;
    out += rect(box(680, y, 504, 38), "#fef2f2", `rx="6" stroke="#fca5a5"`);
    out += text(694, y + 24, message.length > 66 ? `${message.slice(0, 64)}…` : message, 13, "#b91c1c", 'font-weight="600"');
  });
  out += text(680, 610, "Free shipping over $150  ·  30-day returns", 13, MUTED);
  return out;
}

function page(kind: PageKind, path: string, query: string, errors: readonly string[]): string {
  const L = MOCK_LAYOUT;
  switch (kind) {
    case "home": {
      let out = rect(box(0, 66, 1280, 430), "#cbd5e1");
      out += `<path d="M640 496l220-300 140 190 90-110 190 220z" fill="#94a3b8"/>`;
      out += text(96, 250, "Built for the cold.", 52, INK, 'font-weight="800"');
      out += text(96, 296, "The Winter Edit has landed: parkas, shells and layers.", 18, "#334155");
      out += button(L.heroCta, "Shop the Winter Edit", true);
      ["Men", "Women", "Kids", "Sale"].forEach((tile, index) => {
        out += rect(box(32 + index * 308, 520, 292, 170), FILL, 'rx="8"') + text(52 + index * 308, 664, tile, 18, INK, 'font-weight="700"');
      });
      return out;
    }
    case "lookbook": {
      let out = text(32, 120, "The Winter Edit", 40, INK, 'font-weight="800"');
      out += text(32, 152, "A field journal from the north ridge. Photography by our team.", 16, MUTED);
      out += rect(box(32, 180, 800, 500), IMG, 'rx="8"') + rect(box(848, 180, 400, 242), IMG, 'rx="8"') + rect(box(848, 438, 400, 242), IMG, 'rx="8"');
      out += `<path d="M120 640l240-320 170 230 110-130 170 220z" fill="#cbd5e1"/>`;
      return out;
    }
    case "category": {
      let out = text(32, 96, "Home  /  Men", 13, MUTED) + text(32, 134, "Men", 26, INK, 'font-weight="700"');
      ["Jackets & Coats", "Fleece", "Base layers", "Accessories"].forEach((tile, index) => {
        const b = L.categoryTile(index);
        out += rect(b, IMG, 'rx="8"') + text(b.x + 18, b.y + b.h - 22, tile, 18, INK, 'font-weight="700"');
      });
      return out;
    }
    case "grid":
      return path.startsWith("/search")
        ? productGrid(`Results for "${query || "winter jacket"}"`, "Home  /  Search", true)
        : productGrid("Men's Jackets & Coats", "Home  /  Men  /  Jackets & Coats", false);
    case "product":
      return productPage(titleCase(path.split("/").filter(Boolean).pop() ?? "product"), errors);
    case "cart": {
      let out = text(32, 134, "Your cart (1)", 26, INK, 'font-weight="700"');
      out += rect(box(32, 170, 820, 140), "#ffffff", `rx="8" stroke="${LINE}"`) + rect(box(48, 186, 108, 108), IMG, 'rx="6"');
      out += text(176, 222, "Alpine Down Parka", 17, INK, 'font-weight="600"') + text(176, 248, "Size L  ·  Black  ·  Qty 1", 14, MUTED) + text(780, 222, "$349", 17);
      out += rect(box(884, 170, 364, 200), FILL, 'rx="8"') + text(908, 214, "Subtotal", 15, MUTED) + text(1180, 214, "$349", 15);
      out += button(box(908, 290, 316, 52), "Checkout", true);
      return out;
    }
    default:
      return text(32, 134, path, 22, INK, 'font-weight="700"') + rect(box(32, 170, 1216, 500), FILL, 'rx="8"');
  }
}

function overlays(step: StepPayload, kind: PageKind): string {
  const L = MOCK_LAYOUT;
  const label = step.targetLabel;
  const signals = step.signals ?? {};
  let out = "";

  const cookieBanner = kind === "home" && (step.actionType === "navigate" || /cookie/i.test(label));
  if (cookieBanner) {
    out += rect(box(0, 626, 1280, 94), "#ffffff", `stroke="${LINE}"`);
    out += text(32, 668, "We use cookies to personalise content and analyse traffic.", 15) + text(32, 692, "Read our cookie policy", 13, MUTED, 'text-decoration="underline"');
    out += button(L.cookieManage, "Manage preferences") + button(L.cookieAccept, "Accept all cookies", true);
  }

  const modalOpen =
    signals.modalAppeared === true ||
    /no thanks/i.test(label) ||
    signals.focusMoved === false ||
    (signals.keysPressed ?? []).includes("Escape");
  if (modalOpen) {
    out += rect(box(0, 0, 1280, 720), "#0f172a", 'opacity="0.5"');
    out += rect(box(390, 170, 500, 380), "#ffffff", 'rx="12"');
    out += text(640, 236, signals.modalLabel ?? "Get 10% off your first order", 24, INK, 'font-weight="800" text-anchor="middle"');
    out += text(640, 270, "Join the Northpeak list for early access and offers.", 14, MUTED, 'text-anchor="middle"');
    out += rect(box(450, 310, 380, 48), "#ffffff", `rx="6" stroke="#94a3b8"`) + text(466, 340, "Email address", 14, MUTED);
    out += button(box(450, 376, 380, 52), "Sign me up", true);
    out += text(640, 508, "No thanks", 14, INK, 'text-anchor="middle" text-decoration="underline"');
    out += text(856, 206, "×", 26, MUTED, 'text-anchor="middle"');
  }

  if (/view cart/i.test(label)) {
    out += rect(box(0, 0, 1280, 720), "#0f172a", 'opacity="0.35"') + rect(box(800, 0, 480, 720), "#ffffff");
    out += text(840, 60, "Added to cart", 22, INK, 'font-weight="700"') + rect(box(840, 96, 96, 96), IMG, 'rx="6"');
    out += text(952, 130, "Alpine Down Parka", 16, INK, 'font-weight="600"') + text(952, 156, "$349", 14, MUTED);
    out += button(L.cartDrawerView, "View cart", true);
  }
  return out;
}

/**
 * Known templates already draw every element listed in MOCK_LAYOUT. On a page
 * we have no template for, draw the target at its bbox so the UI's overlay
 * rectangle still frames something real.
 */
function target(step: StepPayload, kind: PageKind): string {
  if (kind !== "generic" || !step.bbox || !step.targetLabel) return "";
  return button(step.bbox, step.targetLabel);
}

/** Render the wireframe for one step as a standalone SVG document. */
export function renderMockScreenshot(step: StepPayload): string {
  const viewport = step.viewport ?? DEFAULT_VIEWPORT;
  const { kind, path, query } = parse(step.url);
  const searchOpen = /search products/i.test(step.targetLabel) || path.startsWith("/search");
  const typed = step.actionType === "type" ? step.value ?? "" : query;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${viewport.w}" height="${viewport.h}" viewBox="0 0 1280 720" font-family="${FONT}">` +
    rect(box(0, 0, 1280, 720), "#ffffff") +
    page(kind, path, query, step.signals?.errorTexts ?? []) +
    header(typed, searchOpen) +
    overlays(step, kind) +
    target(step, kind) +
    `</svg>`
  );
}

/** Same image as a data: URI, for <img src> with no network at all. */
export function mockScreenshotDataUri(step: StepPayload): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderMockScreenshot(step))}`;
}

/** Keys under this prefix are rendered on demand instead of being read from R2. */
export const GOLDEN_EVIDENCE_PREFIX = "golden/";
