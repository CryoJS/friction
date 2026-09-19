/** Small, pure helpers the scan page, its nodes and its panels share. */
import {
  PERSONA_BY_ID,
  isTerminalState,
  taskVerdict,
  type PersonaId,
  type PersonaState,
  type ScanNode,
  type ScanStatus,
  type ScanTreePersona,
  type ScanTreeResponse,
  type Severity,
  type TaskVerdict,
} from "@friction/shared";
import type { Tone } from "../components/badges";

/** "Impatient power user" -> "Impatient", "Keyboard-only user" -> "Keyboard". */
export function personaShortName(id: PersonaId): string {
  return PERSONA_BY_ID[id].displayName.split(/[\s-]/)[0] ?? id;
}

/** "https://www.shop.example/x" -> "shop.example" */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Status lights follow DESIGN.md: running is the violet glow, done is white, failure is coral. */
export const SCAN_STATUS: Readonly<Record<ScanStatus, { label: string; tone: Tone }>> = {
  crawling: { label: "Crawling", tone: "glow" },
  running: { label: "Running", tone: "glow" },
  completed: { label: "Completed", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
};

export const VERDICT: Readonly<Record<TaskVerdict, { label: string; tone: Tone }>> = {
  pass: { label: "Pass", tone: "good" },
  partial: { label: "Partial", tone: "warn" },
  fail: { label: "Fail", tone: "bad" },
  pending: { label: "Pending", tone: "idle" },
};

export const VERDICT_ORDER: readonly TaskVerdict[] = ["pass", "partial", "fail", "pending"];

/** In a scan, an idle persona is waiting for a browser session: it reads as "Queued". */
export const SCAN_STATE_LABELS: Readonly<Record<PersonaState, string>> = {
  idle: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  timeout: "Timed out",
};

/** Persona runs finished vs. total. */
export function runProgress(tree: ScanTreeResponse): { done: number; total: number } {
  const personas = tree.tasks.flatMap((task) => task.personas);
  return { done: personas.filter((p) => isTerminalState(p.state)).length, total: personas.length };
}

export function totalFindings(tree: ScanTreeResponse): number {
  return tree.tasks.reduce((sum, task) => sum + task.personas.reduce((inner, p) => inner + p.findingCount, 0), 0);
}

export function worstSeverity(personas: readonly ScanTreePersona[]): Severity | null {
  return personas.reduce<Severity | null>(
    (worst, p) => (p.worstSeverity !== null && (worst === null || p.worstSeverity > worst) ? p.worstSeverity : worst),
    null,
  );
}

export function verdictCounts(tree: ScanTreeResponse): Record<TaskVerdict, number> {
  const counts: Record<TaskVerdict, number> = { pass: 0, partial: 0, fail: 0, pending: 0 };
  for (const task of tree.tasks) counts[taskVerdict(task.personas.map((p) => p.state))] += 1;
  return counts;
}

/** A node whose task does not exist (yet) is the root, as the spec says. */
export function resolveScanNode(node: ScanNode, tree: ScanTreeResponse): ScanNode {
  if (node.kind === "root") return node;
  return tree.tasks.some((task) => task.index === node.index) ? node : { kind: "root" };
}
