/**
 * Smoke test for the real browser loop. No OpenAI, no Browserbase, no keys.
 *
 *   pnpm --filter @friction/orchestrator smoke        (the Worker must be running)
 *
 * Drives a LOCAL Chromium through the real runAgent() loop (observe, act via
 * Stagehand, capture, evidence to R2, events to the Worker, detectors, dedupe)
 * against the demo shop, with a scripted planner standing in for the model.
 * Friction is judged heuristically. Two runs, one agent each:
 *
 *   pointer   clicks its way to the cart and hits the silent "Add to cart"
 *   keys      an agent that CHOOSES the keyboard (search, Tab, Enter), which
 *             is the only way keyboard_trap may fire
 *
 * It then asserts that the detectors found, from real browser signals, the
 * friction the shop is built to have, and VERIFIES two fixes for the dead
 * "Add to cart" through the real verifyFix(): a patch installed with
 * addInitScript in a fresh session, the same task re-run in the verify lane.
 *
 *   genuine  says "Please select a size" and focuses the sizes  -> verified
 *   inert    changes nothing                                     -> rejected
 *
 * Open the printed links to watch.
 */
import { createServer } from "node:http";
import { evidenceKey, type ReportResponse, type RunSnapshot } from "@friction/shared";
import { demoShopResponse } from "@friction/shared/demo-shop";
import { labelKey } from "../src/a11y";
import { runAgent, type AgentResult } from "../src/agentRunner";
import { config } from "../src/config";
import { LaneEmitter } from "../src/emitter";
import { findingForFix } from "../src/fixer";
import { FixReport } from "../src/fixReport";
import { verifyFix, type VerifyOutcome } from "../src/verify";
import type { Observation } from "../src/observe";
import { ScriptedPlanner, type PlannedAction, type ScriptedStep } from "../src/planner";
import { WorkerClient } from "../src/workerClient";

/* ---- a local copy of the demo shop ---- */
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const page = demoShopResponse(url.pathname, url.search);
  setTimeout(() => {
    res.writeHead(page.status, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page.html);
  }, page.delayMs);
});
await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
const shop = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

/* ---- scripted "model": looks elements up by accessible name, exactly like the prompt asks the model to ---- */
const plan = (actionType: PlannedAction["actionType"], targetDescription: string, value: string | null, rationale: string): PlannedAction => ({ actionType, targetDescription, value, rationale, taskComplete: false });

function target(observation: Observation, name: string, role?: string): string {
  // Exact accessible name first ("L" must not match "Black"), then a looser contains.
  const candidates = observation.tree.interactive.filter((n) => !role || n.role.toLowerCase() === role);
  const node = candidates.find((n) => labelKey(n.name) === name.toLowerCase()) ?? candidates.find((n) => labelKey(n.name).includes(name.toLowerCase()));
  // An unknown name is passed through as-is: that exercises the "target not found" path.
  return node ? `[${node.id}] ${node.role} "${node.name}"` : name;
}
const click = (name: string, why: string, role?: string): ScriptedStep => (o) => plan("click", target(o, name, role), null, why);
const typeHere = (text: string, why: string): ScriptedStep => () => plan("type", "", text, why);
const press = (keys: string, why: string): ScriptedStep => () => plan("press", "", keys, why);
const wait = (why: string): ScriptedStep => () => plan("wait", "", null, why);
const scroll = (why: string): ScriptedStep => () => plan("scroll", "", "down", why);
/** Tab as many times as the tab order says it takes to reach a control. */
const tabTo = (name: string, why: string): ScriptedStep => (o) => {
  const index = o.state.tabStops.findIndex((stop) => stop.toLowerCase().includes(name.toLowerCase()));
  return plan("press", "", Array.from({ length: index < 0 ? 12 : index + 1 }, () => "Tab").join(" "), why);
};

const SCRIPTS = {
  pointer: [
    click("Accept all cookies", "A cookie banner is in the way; accepting clears it."),
    click("Men", "Jackets will be under Men.", "link"),
    click("Alpine Down Parka", "This is a winter jacket; opening it.", "link"),
    wait("The product page is still settling."),
    click("No thanks", "I don't want the newsletter."),
    click("Add to cart", "Adding the parka to my cart."),
    click("Add to cart", "Nothing happened; trying once more."),
    scroll("Looking below the button for a message."),
    click("Add to cart", "Still nothing, one more try."),
    click("M", "Maybe it needs a size. M is mine.", "radio"),
    click("Add to cart", "Size chosen, adding it now."),
    click("L", "M is out of stock, so L instead.", "radio"),
    click("Add to cart", "L is selected, adding it."),
    click("View cart", "Checking the cart to be sure."),
  ],
  keys: [
    press("Tab Tab Tab Tab Tab Tab", "Tabbing through the header to the search field."),
    typeHere("winter jacket", "Focus is in the search field, typing my query."),
    press("Enter", "Enter to submit the search."),
    tabTo("Select options", "Tabbing to the first result; it is only announced as 'Select options'."),
    press("Enter", "Assuming the first 'Select options' is the first jacket."),
    wait("Waiting for the product page."),
    press("Tab", "Trying to tab to the size options."),
    press("Escape", "Focus is stuck behind a dialog. Trying Escape."),
  ],
} satisfies Record<string, ScriptedStep[]>;
type ScriptName = keyof typeof SCRIPTS;

/* ---- run ---- */
const worker = new WorkerClient(config.workerUrl);
if (!(await worker.healthy())) {
  console.error(`The Worker is not answering at ${config.workerUrl}. Start it first: pnpm dev:worker`);
  process.exit(2);
}
const task = "Find a winter jacket and add it to cart";
const local = { ...config, browserEnv: "LOCAL" as const, mode: "live" as const, stagehandModel: "openai/never-called-in-smoke", openaiApiKey: "unused" };

async function run(name: ScriptName): Promise<{ runId: string; result: AgentResult; emitter: LaneEmitter }> {
  const runId = await worker.createRun(`${shop}/`, task);
  console.log(`${name.padEnd(8)} run ${runId}   watch http://localhost:5173/?run=${runId}`);
  const emitter = new LaneEmitter(worker, runId, "primary", task); // no judge: heuristic judgements
  emitter.status("idle", "Queued (smoke test, local browser).");
  const result = await runAgent({
    runId,
    url: `${shop}/`,
    task,
    config: local,
    worker,
    planner: new ScriptedPlanner(SCRIPTS[name]),
    emitter,
    evidenceKeyFor: (stepNumber) => evidenceKey(runId, "primary", stepNumber),
    onSession: (browser) => worker.patchRun(runId, { liveViewUrl: browser.liveViewUrl, sessionId: browser.sessionId, replayUrl: browser.replayUrl }),
  });
  return { runId, result, emitter };
}

const started = Date.now();
const [pointer, keys] = await Promise.all([run("pointer"), run("keys")]);

/* ---- assert on what the detectors saw ---- */
const load = async (runId: string): Promise<{ snapshot: RunSnapshot; report: ReportResponse }> => ({
  snapshot: (await (await fetch(`${config.workerUrl}/api/runs/${runId}`)).json()) as RunSnapshot,
  report: (await (await fetch(`${config.workerUrl}/api/runs/${runId}/report`)).json()) as ReportResponse,
});
const P = await load(pointer.runId);
const K = await load(keys.runId);
const found = (snapshot: RunSnapshot): string[] => snapshot.events.flatMap((e) => (e.type === "friction" ? [e.payload.category] : []));
const stepsOf = (snapshot: RunSnapshot) => snapshot.events.flatMap((e) => (e.type === "step" ? [e] : []));

const events = P.snapshot.events;
const clicked = events.find((e) => e.type === "step" && e.payload.actionType === "click" && e.payload.selector !== "");
const capturedAnchor = clicked?.type === "step" ? clicked.payload.anchor : undefined;
if (!capturedAnchor) throw new Error("no anchor was captured on a targeted click");
if (!capturedAnchor.role || !capturedAnchor.tag) throw new Error(`anchor is missing role/tag: ${JSON.stringify(capturedAnchor)}`);
console.log(`anchor ok: ${capturedAnchor.tag}[role=${capturedAnchor.role}] "${capturedAnchor.name}" ordinal=${capturedAnchor.ordinal}`);

const frictionWithAnchor = events.find((e) => e.type === "friction" && e.payload.anchor);
if (!frictionWithAnchor) throw new Error("no friction finding carried an anchor");
const fa = frictionWithAnchor.type === "friction" ? frictionWithAnchor.payload.anchor : undefined;
if (!fa || !fa.role || !fa.tag) throw new Error(`finding anchor is missing role/tag: ${JSON.stringify(fa)}`);
console.log(`finding anchor ok: ${fa.tag}[role=${fa.role}] "${fa.name}"`);

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown): void => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  -> ${JSON.stringify(detail)}`}`);
};

console.log(`\nfinished in ${((Date.now() - started) / 1000).toFixed(1)}s: pointer=${pointer.result.outcome} keys=${keys.result.outcome}\n`);
for (const category of ["long_wait", "modal_interrupt", "dead_click", "retry", "error_text"]) {
  check(`pointer: detected ${category} from real browser signals`, found(P.snapshot).includes(category), found(P.snapshot));
}
for (const category of ["ambiguous_label", "keyboard_trap"]) {
  check(`keys: detected ${category} from real browser signals`, found(K.snapshot).includes(category), found(K.snapshot));
}
check("keyboard_trap never fires for the agent that never pressed a key", !found(P.snapshot).includes("keyboard_trap"), found(P.snapshot));

const deadClick = P.report.findings.find((f) => f.category === "dead_click");
check("dead clicks on one selector are ONE finding, hit twice", P.report.findings.filter((f) => f.category === "dead_click").length === 1 && deadClick?.hitCount === 2, P.report.findings.map((f) => `${f.category}x${f.hitCount}`));
check("the report ranks one deduplicated finding per category + selector", new Set(P.report.findings.map((f) => f.findingKey)).size === P.report.findings.length);

const reachedCart = stepsOf(P.snapshot).some((e) => (e.payload.signals?.urlAfter ?? "").endsWith("/cart"));
check("pointer really got the jacket into the cart (reached /cart)", pointer.result.outcome === "success" && reachedCart, { outcome: pointer.result.outcome, reachedCart });

// Regressions this smoke test once caught. Each was a false finding that would have embarrassed a demo.
const radioDead = stepsOf(P.snapshot).some((e) => e.payload.actionType === "click" && /^(M|L)$/.test(e.payload.targetLabel) && !e.payload.domChanged);
check("no false dead_click: ticking a size radio counts as the page responding", !radioDead);
const labels = [...stepsOf(P.snapshot), ...stepsOf(K.snapshot)].map((e) => e.payload.targetLabel);
check("accessible names carry no state suffix like ' [checked]'", labels.every((l) => !/\[(checked|selected|expanded)\]/.test(l)), labels.filter((l) => /\[/.test(l)));
const noAction = stepsOf(P.snapshot).filter((e) => e.payload.signals?.actionFailed);
check("no action failed (every scripted target was found on the page)", noAction.length === 0, noAction.map((e) => e.payload.signals?.actionError));
const all = [...stepsOf(P.snapshot), ...stepsOf(K.snapshot)];
check("every step has an evidence screenshot in R2", all.every((e) => e.payload.screenshotKey !== ""), all.filter((e) => !e.payload.screenshotKey).length);
check(
  "click targets carry a bbox and a real accessible name",
  stepsOf(P.snapshot).filter((e) => e.payload.actionType === "click" && !e.payload.signals?.actionFailed).every((e) => e.payload.bbox !== null && e.payload.targetLabel !== ""),
);
check("both runs completed in D1, with outcome and step count on the run row", [P, K].every((x) => x.snapshot.run.status === "completed" && x.snapshot.run.outcome !== null && x.snapshot.run.totalSteps !== null), [P, K].map((x) => x.snapshot.run));
check("every event is in the primary lane", [P, K].every((x) => x.snapshot.events.every((e) => e.lane === "primary")));
const shot = stepsOf(P.snapshot).find((e) => e.payload.screenshotKey);
if (shot) {
  const image = await fetch(`${config.workerUrl}/api/evidence/${shot.payload.screenshotKey}`);
  const bytes = new Uint8Array(await image.arrayBuffer());
  check("evidence is a real JPEG served from R2", image.headers.get("content-type") === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8, `${image.headers.get("content-type")} ${bytes.length}B`);
}

/* ---- verify two fixes for the dead "Add to cart" in fresh sessions ---- */
const GENUINE_PATCH = [
  "// Say what is missing when Add to cart is pressed without a size.",
  "try {",
  '  document.addEventListener("click", function (e) {',
  "    try {",
  '      var add = e.target && e.target.closest ? e.target.closest("#add") : null;',
  '      if (!add || document.querySelector("input[name=size]:checked")) return;',
  '      var err = document.getElementById("err");',
  '      if (err) err.textContent = "Please select a size.";',
  '      var first = document.querySelector("input[name=size]");',
  "      if (first) first.focus();",
  "    } catch (inner) {}",
  "  }, true);",
  "} catch (e) {}",
].join("\n");
const INERT_PATCH = "try { void 0; } catch (e) {}";

const VERIFY_SCRIPTS = {
  // With the fix, the agent is told what is missing and acts on it.
  genuine: [
    click("Accept all cookies", "A cookie banner is in the way; accepting clears it."),
    click("Men", "Jackets will be under Men.", "link"),
    click("Alpine Down Parka", "This is a winter jacket; opening it.", "link"),
    wait("The product page is still settling."),
    click("No thanks", "I don't want the newsletter."),
    click("Add to cart", "Adding the parka to my cart."),
    click("L", "It asks for a size; L it is.", "radio"),
    click("Add to cart", "Size chosen, adding it now."),
    click("View cart", "Checking the cart to be sure."),
  ],
  // An inert patch: the agent meets the same silent button as before.
  inert: SCRIPTS.pointer,
} satisfies Record<string, ScriptedStep[]>;

const deadClickPayload = pointer.emitter.findings.find((f) => f.payload?.category === "dead_click")?.payload ?? null;
const pointerSteps = pointer.emitter.events.flatMap((e) => (e.type === "step" ? [e] : []));
const finding = deadClickPayload ? findingForFix(deadClickPayload, pointerSteps) : null;
check("the pointer run has a dead_click finding to fix", finding !== null);

const verifications: Record<string, VerifyOutcome> = {};
if (finding) {
  const before = { outcome: pointer.result.outcome, steps: pointer.result.steps, durationMs: pointer.result.durationMs };
  let seqFloor = 0;
  for (const [name, patchJs] of [["genuine", GENUINE_PATCH], ["inert", INERT_PATCH]] as const) {
    // One fix per finding: the inert one stands in for a second finding id.
    const fixFinding = { ...finding, findingId: name === "genuine" ? finding.findingId : `${finding.findingId}x` };
    const report = new FixReport(worker, pointer.runId, {
      findingId: fixFinding.findingId,
      stage: "proposed",
      summary: `${name} patch`,
      patchJs,
      sourceFile: null,
      before: null,
      after: null,
      prUrl: null,
      category: "dead_click",
    });
    await report.update({});
    const outcome = await verifyFix({
      runId: pointer.runId,
      url: `${shop}/`,
      task,
      config: local,
      worker,
      report,
      finding: fixFinding,
      before,
      seqFloor,
      planner: new ScriptedPlanner(VERIFY_SCRIPTS[name]),
    });
    seqFloor = outcome.lastSeq;
    verifications[name] = outcome;
    console.log(`${name.padEnd(8)} fix: ${outcome.verdict.stage}: ${outcome.verdict.note}`);
  }

  const V = await load(pointer.runId);
  const verifyEvents = V.snapshot.events.filter((e) => e.lane === "verify");
  const fixes = (await (await fetch(`${config.workerUrl}/api/runs/${pointer.runId}/fixes`)).json()) as { fixes: Array<{ stage: string; after: unknown }> };
  check("genuine fix is VERIFIED (dead_click no longer fires)", verifications.genuine?.verdict.stage === "verified", verifications.genuine?.verdict);
  check("inert fix is REJECTED, and says the category still fires", verifications.inert?.verdict.stage === "rejected" && /still fires/.test(verifications.inert?.verdict.note ?? ""), verifications.inert?.verdict);
  check("both fixes stored with their verdict and an after result", fixes.fixes.length === 2 && fixes.fixes.every((f) => (f.stage === "verified" || f.stage === "rejected") && f.after !== null), fixes.fixes.map((f) => f.stage));
  check("every verify-lane event carries a fixId, one run per fix", verifyEvents.every((e) => typeof e.fixId === "string") && new Set(verifyEvents.map((e) => e.fixId)).size === 2);
  check("verify-lane seqs are unique (fix events and run events never collide)", new Set(verifyEvents.map((e) => e.seq)).size === verifyEvents.length);
  check("verify-lane friction never became a report finding", V.report.findings.length === P.report.findings.length, { before: P.report.findings.length, after: V.report.findings.length });
  check("the primary lane is untouched by verification", V.snapshot.events.filter((e) => e.lane === "primary").length === P.snapshot.events.length);
}
server.close();

console.log(failures === 0 ? "\nSMOKE PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
