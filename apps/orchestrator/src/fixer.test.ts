import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FixUpsertSchema, type FixUpsert } from "@friction/shared";
import { proposeAndReport, type FindingForFix, type FixProposer, type ProposeFixInput } from "./fixer";
import type { WorkerClient } from "./workerClient";

const PATCH = 'try { document.addEventListener("click", function () {}); } catch (e) {}';
const finding: FindingForFix = {
  findingId: "f10",
  category: "dead_click",
  severity: 3,
  summary: 'Clicked "Add to wishlist" and nothing happened.',
  whyItMatters: "",
  recommendation: "",
  selector: "xpath=/html[1]/body[1]/main[1]/div[3]/div[1]/button[2]",
  targetLabel: "Add to wishlist",
  url: "https://shop.example/collections/mens",
  evidenceSeq: 9,
  hitCount: 1,
  texts: [],
};
const input: ProposeFixInput = { task: "Save a jacket to the wishlist.", finding, stepEvents: [], tree: null };

/** Records every fix the orchestrator posts, as the Worker would accept it. */
function fakeWorker() {
  const posted: FixUpsert[] = [];
  const worker = {
    postFix: async (_runId: string, upsert: FixUpsert) => {
      posted.push(FixUpsertSchema.parse(upsert));
      return { event: { seq: posted.length } };
    },
  } as unknown as WorkerClient;
  return { worker, posted };
}

describe("proposeAndReport", () => {
  it("records a finding that got no acceptable patch as a rejected fix that says so", async () => {
    const { worker, posted } = fakeWorker();
    const proposer: FixProposer = async () => ({ summary: "Does something.", patchJs: "try { fetch('/x'); } catch (e) {}" });
    assert.equal(await proposeAndReport({ worker, runId: "r_1", proposer, input }), null);
    assert.equal(posted.length, 1);
    assert.equal(posted[0]?.stage, "rejected");
    assert.equal(posted[0]?.patchJs, "");
    assert.match(posted[0]?.note ?? "", /No acceptable patch was proposed.*makes network requests/);
  });

  it("a retry re-proposes onto the same fix row, with the first patch and its rejection as feedback", async () => {
    const { worker, posted } = fakeWorker();
    const seen: ProposeFixInput[] = [];
    const proposer: FixProposer = async (given) => {
      seen.push(given);
      return { summary: given.previous ? "Second idea, a different approach." : "First idea for the fix.", patchJs: given.previous ? `${PATCH}\n// again` : PATCH };
    };
    const report = await proposeAndReport({ worker, runId: "r_1", proposer, input });
    assert.ok(report);
    const note = "dead_click still fires (2 times); the agent gave up after 7 steps, down from 14 steps and giving up.";
    await report.update({ stage: "rejected", note });

    const again = await proposeAndReport({ worker, runId: "r_1", proposer, input: { ...input, previous: { patchJs: report.state.patchJs, note } }, retryOf: report });
    assert.equal(again, report);
    assert.deepEqual(seen[1]?.previous, { patchJs: PATCH, note });
    assert.deepEqual(posted.map((fix) => `${fix.findingId} ${fix.stage}`), ["f10 proposed", "f10 rejected", "f10 proposed"]);
    assert.equal(posted[2]?.attempts, 2);
    assert.equal(posted[2]?.patchJs, `${PATCH}\n// again`);
    assert.match(posted[2]?.note ?? "", /^Second attempt\. The first fix was rejected: dead_click still fires \(2 times\)/);
  });

  it("a retry that yields no patch leaves the row rejected with its first note", async () => {
    const { worker, posted } = fakeWorker();
    let calls = 0;
    const proposer: FixProposer = async () => ({ summary: "An idea for the fix.", patchJs: (calls += 1) === 1 ? PATCH : "" });
    const report = await proposeAndReport({ worker, runId: "r_1", proposer, input });
    assert.ok(report);
    await report.update({ stage: "rejected", note: "dead_click still fires (1 time)." });
    assert.equal(await proposeAndReport({ worker, runId: "r_1", proposer, input, retryOf: report }), null);
    assert.equal(posted.length, 2);
    assert.equal(report.state.stage, "rejected");
  });
});
