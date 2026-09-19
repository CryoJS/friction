import type { FrictionCategory, Severity } from "./events";

/**
 * CORS policy shared by the Worker and the orchestrator:
 * any localhost / 127.0.0.1 port, and any https *.pages.dev deployment.
 */
export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const host = url.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
  return url.protocol === "https:" && (host === "pages.dev" || host.endsWith(".pages.dev"));
}

/**
 * Turn what a human typed into a navigable URL. Returns null when it cannot be
 * one, so callers can reject it before spending a browser session on it.
 */
export function normalizeTargetUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Comparable form of a URL for loop detection: no hash, no trailing slash. */
export function normalizeUrlForVisit(input: string): string {
  try {
    const url = new URL(input);
    url.hash = "";
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
    return `${url.origin}${path}${url.search}`;
  } catch {
    return input.split("#")[0] ?? input;
  }
}

export const FRICTION_LABELS: Readonly<Record<FrictionCategory, { label: string; blurb: string }>> = {
  dead_click: { label: "Dead click", blurb: "A click produced no visible response." },
  loop: { label: "Navigation loop", blurb: "The persona kept landing on the same page." },
  retry: { label: "Retry", blurb: "The same action had to be repeated." },
  step_budget: { label: "Step budget", blurb: "The task took more steps than it should." },
  error_text: { label: "Error message", blurb: "The site showed an error or validation message." },
  modal_interrupt: { label: "Modal interrupt", blurb: "An overlay appeared and blocked the flow." },
  long_wait: { label: "Long wait", blurb: "A single action took more than five seconds." },
  keyboard_trap: { label: "Keyboard trap", blurb: "Tab was pressed and focus did not move." },
  ambiguous_label: { label: "Ambiguous label", blurb: "Several controls share the same name." },
};

export const SEVERITY_LABELS: Readonly<Record<Severity, string>> = {
  1: "Cosmetic",
  2: "Minor",
  3: "Moderate",
  4: "Major",
  5: "Blocker",
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
