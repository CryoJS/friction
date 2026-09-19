/**
 * Stagehand's page.snapshot() gives the page's real accessibility tree as text:
 *
 *     [0-57] button: Add to cart
 *       [0-58] StaticText: Add to cart
 *
 * plus a map from each id to an XPath. This module prunes that tree down to
 * what a person can act on (interactive elements) and orient by (headings,
 * dialogs), which is what the planner sees. Pure: no browser, no I/O.
 */
import { findErrorTexts, type A11yTextNode } from "@friction/shared";

export interface TreeNode {
  id: string;
  depth: number;
  role: string;
  /** Accessible name as Chrome computed it. */
  name: string;
  xpath: string | null;
  /** Where a link goes, when Stagehand knows. */
  url: string | null;
}

export interface A11ySummary {
  /** Pruned tree, one "[id] role: name" per line. What the planner reads. */
  lines: string[];
  /** Interactive nodes only, by id. */
  byId: Map<string, TreeNode>;
  interactive: TreeNode[];
  /** Label of an open dialog, if the tree has one. */
  dialogLabel: string | null;
  errorTexts: string[];
  /** Lines dropped to stay inside the budget. */
  truncated: number;
}

const INTERACTIVE = new Set([
  "button", "link", "textbox", "searchbox", "combobox", "listbox", "option", "checkbox", "radio", "switch",
  "slider", "spinbutton", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "treeitem", "select",
  "textarea", "input", "popupbutton", "comboboxselect", "disclosuretriangle", "togglebutton", "datefield",
]);
const LANDMARKS = new Set(["heading", "dialog", "alertdialog"]);
const LIVE = new Set(["alert", "status", "log", "alertdialog"]);
const STATE_SUFFIX = /\s\[(selected|checked|expanded|collapsed|disabled|focused|pressed|required|invalid|busy|readonly|mixed)[^\]]*\]$/i;

const MAX_LINES = 170;
const MAX_OPTIONS_PER_LIST = 8;
const MAX_NAME = 110;

const LINE = /^(\s*)\[([^\]]+)\]\s+([^:\n]+?)(?::\s(.*))?$/;

export function parseTree(formattedTree: string, xpathMap: Record<string, string>, urlMap: Record<string, string> = {}): TreeNode[] {
  const nodes: TreeNode[] = [];
  for (const line of formattedTree.split("\n")) {
    const match = LINE.exec(line);
    if (!match) continue;
    const [, indent = "", id = "", role = "", name = ""] = match;
    nodes.push({ id, depth: Math.floor(indent.length / 2), role: role.trim(), name: name.trim(), xpath: xpathMap[id] ?? null, url: urlMap[id] ?? null });
  }
  return nodes;
}

/** The accessible name itself: the snapshot appends state markers such as " [checked]". */
export function cleanLabel(name: string): string {
  let label = name.trim();
  while (STATE_SUFFIX.test(label)) label = label.replace(STATE_SUFFIX, "");
  return label;
}

/** The key for "same accessible name". */
export function labelKey(name: string): string {
  return cleanLabel(name).toLowerCase();
}

/** Text of a node: its own name, or what its descendants say. */
function textOf(nodes: readonly TreeNode[], index: number): string {
  const node = nodes[index];
  if (!node) return "";
  if (node.name) return node.name;
  const parts: string[] = [];
  for (let i = index + 1; i < nodes.length; i++) {
    const child = nodes[i];
    if (!child || child.depth <= node.depth) break;
    if (child.name && /statictext|heading|paragraph|text/i.test(child.role)) parts.push(child.name);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function summarizeTree(formattedTree: string, xpathMap: Record<string, string>, urlMap: Record<string, string> = {}): A11ySummary {
  const nodes = parseTree(formattedTree, xpathMap, urlMap);
  const lines: string[] = [];
  const interactive: TreeNode[] = [];
  const byId = new Map<string, TreeNode>();
  const textNodes: A11yTextNode[] = [];
  let dialogLabel: string | null = null;
  let optionRun = 0;
  let truncated = 0;

  nodes.forEach((node, index) => {
    const role = node.role.toLowerCase();

    if (LIVE.has(role)) {
      const text = textOf(nodes, index);
      if (text) textNodes.push({ role, name: text });
    } else if (/statictext|paragraph/.test(role) && node.name) {
      textNodes.push({ role: "text", name: node.name });
    }

    const isInteractive = INTERACTIVE.has(role);
    if (!isInteractive && !LANDMARKS.has(role)) {
      if (role !== "statictext" && role !== "inlinetextbox") optionRun = 0;
      return;
    }

    if (role === "dialog" || role === "alertdialog") dialogLabel ??= textOf(nodes, index).slice(0, 80) || "dialog";

    // A country picker must not push the rest of the page out of the prompt.
    if (role === "option") {
      optionRun += 1;
      if (optionRun > MAX_OPTIONS_PER_LIST) {
        if (optionRun === MAX_OPTIONS_PER_LIST + 1) lines.push("      (more options not shown)");
        return;
      }
    } else {
      optionRun = 0;
    }

    const name = (node.name || (isInteractive ? "" : textOf(nodes, index))).slice(0, MAX_NAME);
    if (isInteractive) {
      interactive.push(node);
      byId.set(node.id, node);
    }
    if (lines.length >= MAX_LINES) {
      truncated += 1;
      return;
    }
    lines.push(`[${node.id}] ${node.role}${name ? `: ${name}` : " (no accessible name)"}`);
  });

  return { lines, byId, interactive, dialogLabel, errorTexts: findErrorTexts(textNodes), truncated };
}

/**
 * How many DIFFERENT things share this accessible name. 1 means unambiguous.
 * Two "Men" links to the same URL are one destination, which is fine. Four
 * "Select options" buttons are four different things with one name, which is not.
 */
export function sameLabelCount(summary: A11ySummary, name: string): number {
  const key = labelKey(name);
  if (!key) return 0;
  const twins = summary.interactive.filter((node) => labelKey(node.name) === key);
  const destinations = new Set(twins.map((node) => (node.url ? `url:${node.url}` : `node:${node.id}`)));
  return destinations.size;
}

/** The planner cites targets as "[0-57] button Add to cart". Pull the id back out. */
export function idFromDescription(description: string): string | null {
  return /\[([0-9]+-[0-9]+)\]/.exec(description)?.[1] ?? null;
}
