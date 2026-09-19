/**
 * Smoke test for the real browser loop. No OpenAI, no Browserbase, no keys.
 *
 *   pnpm --filter @friction/orchestrator smoke        (the Worker must be running)
 *
 * Drives a LOCAL Chromium through the real runPersona() loop (observe, act via
 * Stagehand, capture, evidence to R2, events to the Worker, detectors) against
 * the demo shop, with a scripted planner standing in for the model. Friction
 * is judged heuristically. It then asserts that the detectors found, from real
 * browser signals, the friction the shop is built to have.
 *
 * Open the printed control-room link to watch it, or replay it afterwards.
 */
import { createServer } from "node:http";
import { PERSONA_BY_ID, type PersonaId, type RunSnapshot } from "@friction/shared";
import { demoShopResponse } from "@friction/shared/demo-shop";
import { labelKey } from "../src/a11y";
import { config } from "../src/config";
import { PersonaEmitter } from "../src/emitter";
import type { Observation } from "../src/observe";
import { runPersona } from "../src/personaRunner";
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
const type = (name: string, text: string, why: string): ScriptedStep => (o) => plan("type", target(o, name), text, why);
const press = (keys: string, why: string): ScriptedStep => () => plan("press", "", keys, why);
const wait = (why: string): ScriptedStep => () => plan("wait", "", null, why);
const scroll = (why: string): ScriptedStep => () => plan("scroll", "", "down", why);
/** Tab as many times as the tab order says it takes to reach a control. */
const tabTo = (name: string, why: string): ScriptedStep => (o) => {
  const index = o.state.tabStops.findIndex((stop) => stop.toLowerCase().includes(name.toLowerCase()));
  return plan("press", name, Array.from({ length: index < 0 ? 12 : index + 1 }, () => "Tab").join(" "), why);
};

const SCRIPTS: Record<PersonaId, ScriptedStep[]> = {
  impatient: [
    click("Accept all cookies", "Cookie wall. Accept, move."),
    click("Shop the Winter Edit", "Big button says winter."),
    scroll("Just photos. Scrolling."),
    type("Search products", "winter jacket\n", "Forget it, I'll search."),
    click("Alpine Down Parka", "First result. Open it.", "link"),
    click("Add to cart", "Add to cart. Done."),
    click("Add to cart", "Nothing happened? Again."),
  ],
  cautious: [
    click("Accept all cookies", "The banner is clear enough, I'll accept."),
    click("Men", "I'd rather browse the menu than search.", "link"),
    click("Alpine Down Parka", "This sounds like a proper winter jacket.", "link"),
    wait("I'll read the product details before choosing anything."),
    click("No thanks", "I didn't ask for this pop-up; 'No thanks' seems safest."),
    click("M", "M is my usual size.", "radio"),
    click("Add to cart", "Size is chosen, so adding it should be safe."),
    click("L", "M is out of stock, so I'll try L instead.", "radio"),
    click("Add to cart", "L is selected now, adding it."),
    click("View cart", "I want to confirm it is really in the cart."),
  ],
  keyboard: [
    press("Tab Tab Tab Tab Tab Tab", "No skip link, tabbing through the header to the search field."),
    type("", "winter jacket", "Focus is in the search field, typing my query."),
    press("Enter", "Enter to submit the search."),
    tabTo("Select options", "Tabbing to the first result; it is only announced as 'Select options'."),
    press("Enter", "Assuming the first 'Select options' is the first jacket."),
    wait("Waiting for the product page."),
    press("Tab", "Trying to tab to the size options."),
    press("Escape", "Focus is stuck behind a dialog. Trying Escape."),
  ],
};

/* ---- run ---- */
const worker = new WorkerClient(config.workerUrl);
if (!(await worker.healthy())) {
  console.error(`The Worker is not answering at ${config.workerUrl}. Start it first: pnpm dev:worker`);
  process.exit(2);
}
const task = "Find a winter jacket and add it to cart";
const runId = await worker.createRun(`${shop}/`, task);
console.log(`\nrun ${runId} against ${shop}\nwatch:  http://localhost:5173/?run=${runId}\nreplay: http://localhost:5173/?run=${runId}&replay=1\n`);

const local = { ...config, browserEnv: "LOCAL" as const, mode: "live" as const, stagehandModel: "openai/never-called-in-smoke", openaiApiKey: "unused" };
const started = Date.now();
const outcomes = await Promise.all(
  (Object.keys(SCRIPTS) as PersonaId[]).map((id) => {
    const emitter = new PersonaEmitter(worker, runId, id, task); // no judge: heuristic judgements
    emitter.status("idle", "Queued (smoke test, local browser).");
    return runPersona({ runId, url: `${shop}/`, task, persona: PERSONA_BY_ID[id], config: local, worker, planner: new ScriptedPlanner(SCRIPTS[id]), emitter });
  }),
);
server.close();

/* ---- assert on what the detectors saw ---- */
const snapshot = (await (await fetch(`${config.workerUrl}/api/runs/${runId}`)).json()) as RunSnapshot;
const found = (id: PersonaId): string[] => snapshot.events.filter((e) => e.personaId === id && e.type === "friction").map((e) => (e.type === "friction" ? e.payload.category : ""));
const steps = snapshot.events.filter((e) => e.type === "step");

const EXPECT: Record<PersonaId, string[]> = {
  impatient: ["long_wait", "dead_click", "retry"],
  cautious: ["modal_interrupt", "error_text"],
  keyboard: ["ambiguous_label", "keyboard_trap"],
};
let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown): void => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  -> ${JSON.stringify(detail)}`}`);
};

console.log(`\nfinished in ${((Date.now() - started) / 1000).toFixed(1)}s: ${(Object.keys(SCRIPTS) as PersonaId[]).map((id, i) => `${id}=${outcomes[i]}`).join(" ")}\n`);
for (const id of Object.keys(EXPECT) as PersonaId[]) {
  for (const category of EXPECT[id]) check(`${id}: detected ${category} from real browser signals`, found(id).includes(category), found(id));
}
check("impatient abandoned after two failed attempts (outcome failure)", outcomes[0] === "failure", outcomes[0]);
const reachedCart = steps.some((e) => e.type === "step" && e.personaId === "cautious" && (e.payload.signals?.urlAfter ?? "").endsWith("/cart"));
check("cautious really got the jacket into the cart (reached /cart)", outcomes[1] === "success" && reachedCart, { outcome: outcomes[1], reachedCart });

// Regressions this smoke test once caught. Each was a false finding that would have embarrassed a demo.
check("no false dead_click: ticking a size radio counts as the page responding", !found("cautious").includes("dead_click"), found("cautious"));
check("no false ambiguous_label: two 'Men' links to the same URL are fine", !found("cautious").includes("ambiguous_label"), found("cautious"));
const labels = steps.map((e) => (e.type === "step" ? e.payload.targetLabel : ""));
check("accessible names carry no state suffix like ' [checked]'", labels.every((l) => !/\[(checked|selected|expanded)\]/.test(l)), labels.filter((l) => /\[/.test(l)));
const noAction = steps.filter((e) => e.type === "step" && e.payload.signals?.actionFailed);
check("no action failed (every scripted target was found on the page)", noAction.length === 0, noAction.map((e) => (e.type === "step" ? e.payload.signals?.actionError : "")));
check("every step has an evidence screenshot in R2", steps.every((e) => e.type === "step" && e.payload.screenshotKey !== ""), steps.filter((e) => e.type === "step" && !e.payload.screenshotKey).length);
check("click targets carry a bbox and a real accessible name", steps.filter((e) => e.type === "step" && e.payload.actionType === "click" && !e.payload.signals?.actionFailed).every((e) => e.type === "step" && e.payload.bbox !== null && e.payload.targetLabel !== ""));
check("the run completed in D1", snapshot.run.status === "completed", snapshot.run.status);
const shot = steps.find((e) => e.type === "step" && e.payload.screenshotKey);
if (shot?.type === "step") {
  const image = await fetch(`${config.workerUrl}/api/evidence/${shot.payload.screenshotKey}`);
  const bytes = new Uint8Array(await image.arrayBuffer());
  check("evidence is a real JPEG served from R2", image.headers.get("content-type") === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8, `${image.headers.get("content-type")} ${bytes.length}B`);
}

console.log(failures === 0 ? "\nSMOKE PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
