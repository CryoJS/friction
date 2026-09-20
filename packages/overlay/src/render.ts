/**
 * Draws findings onto the real page: markers pinned to resolved elements,
 * per-finding cards, and a panel listing every finding regardless of whether
 * it could be pinned.
 *
 * Everything lives inside one shadow root appended to doc.body. Nothing here
 * writes to document.head, and destroy() removes every listener and observer
 * this module added to `doc`/its window, not just the root element -- this
 * runs on someone else's live site, so leaving a scroll listener behind is
 * not acceptable.
 *
 * Confidence is rendered honestly: solid/dashed/dotted rings for
 * exact/likely/guess (styles.ts), plus hedged wording here for "guess" so a
 * marker never looks more certain than resolveAnchor found it to be.
 */
import type { AnnotationFinding, AnnotationsResponse } from "@friction/shared";
import { FRICTION_LABELS, SEVERITY_LABELS, normalizeUrlForVisit } from "@friction/shared";
import type { Confidence } from "./resolve";
import { resolveAnchor } from "./resolve";
import { CSS } from "./styles";

export const OVERLAY_ROOT_ID = "__friction-root";

export interface OverlayHandle {
  destroy(): void;
  focusFinding(findingId: string): void;
}

/** A finding paired with its 1-based position in the response, used as the marker/badge number. */
interface Numbered {
  n: number;
  finding: AnnotationFinding;
}

/** A finding that resolved to a real element on this page. */
interface MarkerEntry {
  n: number;
  finding: AnnotationFinding;
  el: Element;
  confidence: Confidence;
  markerEl: HTMLElement;
  cardEl: HTMLElement;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function labelledRowText(item: Numbered): string {
  return `${FRICTION_LABELS[item.finding.category].label} — ${item.finding.summary}`;
}

/** The card content for one finding. Built once per located finding, toggled open/closed by the marker and its own close button. */
function buildCard(doc: Document, finding: AnnotationFinding, n: number, confidence: Confidence): HTMLElement {
  const card = el(doc, "div", `card sev-${finding.severity}`);
  card.hidden = true;

  const head = el(doc, "div", "card-head");
  const badge = el(doc, "span", `badge sev-${finding.severity}`, String(n));
  head.appendChild(badge);

  // Requirement 6: for a guess, the header says so instead of stating the
  // category as fact. The category label is never lost -- it moves to the
  // meta line just below.
  const title = el(doc, "strong", undefined, confidence === "guess" ? "We think this is the element" : FRICTION_LABELS[finding.category].label);
  head.appendChild(title);

  const closeBtn = el(doc, "button", "close", "×");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.addEventListener("click", () => {
    card.hidden = true;
    card.classList.remove("open");
  });
  head.appendChild(closeBtn);
  card.appendChild(head);

  const meta = el(doc, "div", "meta", `${FRICTION_LABELS[finding.category].label} · ${SEVERITY_LABELS[finding.severity]} (severity ${finding.severity})`);
  card.appendChild(meta);

  const summary = el(doc, "p", "summary", finding.summary);
  card.appendChild(summary);

  const why = el(doc, "p");
  why.appendChild(el(doc, "strong", undefined, "Why it matters: "));
  why.appendChild(doc.createTextNode(finding.whyItMatters));
  card.appendChild(why);

  const rec = el(doc, "p");
  rec.appendChild(el(doc, "strong", undefined, "Recommendation: "));
  rec.appendChild(doc.createTextNode(finding.recommendation));
  card.appendChild(rec);

  if (finding.evidenceUrl) {
    const img = el(doc, "img");
    img.loading = "lazy";
    img.src = finding.evidenceUrl;
    img.alt = "Evidence screenshot";
    card.appendChild(img);
  }

  // Advisory only, per the global constraint: patchJs was never executed or
  // tested, and this label says so in the exact words the brief specifies.
  if (finding.patchJs) {
    const details = el(doc, "details");
    details.appendChild(el(doc, "summary", undefined, "Suggested fix"));
    details.appendChild(el(doc, "p", "patch-label", "Suggested — not executed and not tested"));
    const pre = el(doc, "pre");
    pre.appendChild(el(doc, "code", undefined, finding.patchJs));
    details.appendChild(pre);
    card.appendChild(details);
  }

  return card;
}

export function mountOverlay(response: AnnotationsResponse, doc: Document): OverlayHandle {
  const win = doc.defaultView;

  const root = doc.createElement("div");
  root.id = OVERLAY_ROOT_ID;
  const shadow = root.attachShadow({ mode: "open" });

  const styleEl = doc.createElement("style");
  styleEl.textContent = CSS;
  shadow.appendChild(styleEl);

  const layer = el(doc, "div", "layer");
  shadow.appendChild(layer);

  const panelEl = el(doc, "div", "panel");
  shadow.appendChild(panelEl);

  doc.body.appendChild(root);

  // Step 2: resolve every finding, partitioned by whether it belongs to the
  // page currently loaded. A finding recorded on a *different* page is never
  // fed through resolveAnchor here -- doing so could accidentally match a
  // similarly-named element on this page and pin someone else's finding onto
  // the wrong page's control. Findings with no recorded url ("") are treated
  // as belonging here, since that "" means the url was never captured, not
  // that it is known to be elsewhere.
  const currentUrl = normalizeUrlForVisit(doc.location?.href ?? "");
  const entries: MarkerEntry[] = [];
  const unlocatedHere: Numbered[] = [];
  const elsewhere = new Map<string, Numbered[]>();

  response.findings.forEach((finding, i) => {
    const item: Numbered = { n: i + 1, finding };
    const belongsHere = finding.url === "" || normalizeUrlForVisit(finding.url) === currentUrl;
    if (!belongsHere) {
      const list = elsewhere.get(finding.url) ?? [];
      list.push(item);
      elsewhere.set(finding.url, list);
      return;
    }
    const resolution = finding.anchor ? resolveAnchor(finding.anchor, doc) : { el: null, confidence: null };
    if (resolution.el && resolution.confidence) {
      const markerEl = el(doc, "div", `marker marker--${resolution.confidence} sev-${finding.severity}`, String(item.n));
      markerEl.setAttribute("role", "button");
      markerEl.tabIndex = 0;
      markerEl.setAttribute("aria-label", `Finding ${item.n}: ${FRICTION_LABELS[finding.category].label}`);

      const cardEl = buildCard(doc, finding, item.n, resolution.confidence);

      const entry: MarkerEntry = { n: item.n, finding, el: resolution.el, confidence: resolution.confidence, markerEl, cardEl };
      entries.push(entry);

      const toggle = () => {
        const opening = cardEl.hidden === true;
        cardEl.hidden = !opening;
        cardEl.classList.toggle("open", opening);
        if (opening) positionCard(entry);
      };
      markerEl.addEventListener("click", toggle);
      markerEl.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          toggle();
        }
      });

      layer.appendChild(markerEl);
      layer.appendChild(cardEl);
    } else {
      unlocatedHere.push(item);
    }
  });

  // Steps 3 & 4: position markers from the resolved element's bounding rect,
  // plus scroll offsets, and keep them attached through scroll/resize/layout
  // shift -- throttled to one recompute per animation frame.
  function positionMarker(entry: MarkerEntry): void {
    const rect = entry.el.getBoundingClientRect();
    const x = rect.left + (win?.scrollX ?? 0);
    const y = rect.top + (win?.scrollY ?? 0);
    entry.markerEl.style.left = `${x}px`;
    entry.markerEl.style.top = `${y}px`;
  }

  function positionCard(entry: MarkerEntry): void {
    const rect = entry.el.getBoundingClientRect();
    entry.cardEl.style.left = `${rect.left + (win?.scrollX ?? 0)}px`;
    entry.cardEl.style.top = `${rect.bottom + (win?.scrollY ?? 0) + 8}px`;
  }

  function updatePositions(): void {
    for (const entry of entries) {
      positionMarker(entry);
      if (!entry.cardEl.hidden) positionCard(entry);
    }
  }
  updatePositions();

  let rafId: number | null = null;
  function scheduleUpdate(): void {
    if (!win) {
      updatePositions();
      return;
    }
    if (rafId !== null) return;
    rafId = win.requestAnimationFrame(() => {
      rafId = null;
      updatePositions();
    });
  }

  doc.addEventListener("scroll", scheduleUpdate, true);
  win?.addEventListener("resize", scheduleUpdate);

  let resizeObserver: ResizeObserver | undefined;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(doc.body);
  }

  function focusEntry(entry: MarkerEntry): void {
    entry.el.scrollIntoView({ behavior: "smooth", block: "center" });
    entry.cardEl.hidden = false;
    entry.cardEl.classList.add("open");
    positionCard(entry);
  }

  // Step 7: the panel. Always renders, and never silently drops a finding --
  // this is the "never render an empty overlay" guarantee: even a scan where
  // every anchor failed to resolve still lists every finding here, under the
  // unlocated heading.
  function renderPanel(): void {
    panelEl.replaceChildren();

    const head = el(doc, "div", "panel-head");
    const total = response.findings.length;
    head.appendChild(el(doc, "span", undefined, `Friction overlay — ${total} finding${total === 1 ? "" : "s"}`));
    const toggleBtn = el(doc, "button", "panel-toggle", "–");
    toggleBtn.type = "button";
    toggleBtn.setAttribute("aria-label", "Collapse panel");
    toggleBtn.addEventListener("click", () => {
      const collapsed = panelEl.classList.toggle("collapsed");
      toggleBtn.textContent = collapsed ? "+" : "–";
      toggleBtn.setAttribute("aria-label", collapsed ? "Expand panel" : "Collapse panel");
    });
    head.appendChild(toggleBtn);
    panelEl.appendChild(head);

    const body = el(doc, "div", "panel-body");
    panelEl.appendChild(body);

    if (total === 0) {
      body.appendChild(el(doc, "p", "empty-note", "No findings were recorded for this scan."));
      return;
    }

    const section = el(doc, "section", "panel-section");
    section.appendChild(el(doc, "h3", undefined, `This page (${entries.length} located, ${unlocatedHere.length} unlocated)`));

    const rows = el(doc, "ol", "rows");
    for (const entry of entries) {
      const li = doc.createElement("li");
      const btn = el(doc, "button", "row");
      btn.type = "button";
      btn.appendChild(el(doc, "span", `badge sev-${entry.finding.severity}`, String(entry.n)));
      btn.appendChild(doc.createTextNode(labelledRowText(entry)));
      btn.addEventListener("click", () => focusEntry(entry));
      li.appendChild(btn);
      rows.appendChild(li);
    }
    section.appendChild(rows);

    if (unlocatedHere.length > 0) {
      section.appendChild(el(doc, "h4", undefined, "Could not be found on this page"));
      const unlocatedRows = el(doc, "ol", "rows rows--unlocated");
      for (const item of unlocatedHere) {
        const li = doc.createElement("li");
        li.appendChild(el(doc, "span", `badge sev-${item.finding.severity}`, String(item.n)));
        li.appendChild(doc.createTextNode(labelledRowText(item)));
        unlocatedRows.appendChild(li);
      }
      section.appendChild(unlocatedRows);
    }
    body.appendChild(section);

    for (const [url, items] of elsewhere) {
      const sec = el(doc, "section", "panel-section");
      sec.appendChild(el(doc, "h3", undefined, url || "Unknown page"));
      const ol = el(doc, "ol", "rows");
      for (const item of items) {
        const li = doc.createElement("li");
        const a = el(doc, "a");
        a.href = url || "#";
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.appendChild(el(doc, "span", `badge sev-${item.finding.severity}`, String(item.n)));
        a.appendChild(doc.createTextNode(labelledRowText(item)));
        li.appendChild(a);
        ol.appendChild(li);
      }
      sec.appendChild(ol);
      body.appendChild(sec);
    }
  }
  renderPanel();

  return {
    destroy(): void {
      doc.removeEventListener("scroll", scheduleUpdate, true);
      win?.removeEventListener("resize", scheduleUpdate);
      if (rafId !== null) win?.cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      root.remove();
    },
    focusFinding(findingId: string): void {
      const entry = entries.find((e) => e.finding.findingId === findingId);
      if (entry) focusEntry(entry);
    },
  };
}
