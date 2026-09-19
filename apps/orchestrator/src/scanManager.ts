/**
 * A scan: one URL -> crawl -> up to MAX_SCAN_TASKS generated tasks -> one run per task.
 *
 *   crawling   one browser session reads the landing page and up to five nav pages
 *   running    every task is a normal run (the agent, then its fix
 *              verifications); all of them queue for the shared session pool
 *              in task-rank order
 *   (still running) for a scan started with a repository and automatic
 *              pull requests: one draft PR per fixable task, one at a time,
 *              in task-rank order (scanPullRequests.ts)
 *   completed  every run is over, and so are the pull requests
 *
 * The background work never throws: whatever goes wrong ends as a `failed`
 * scan with a message, which the root node shows.
 */
import { MAX_SCAN_TASKS } from "@friction/shared";
import type { Config } from "./config";
import { crawlSite } from "./crawl";
import { summarizeTaskPullRequests } from "@friction/shared";
import type { PreparedRun, RunManager } from "./runManager";
import { openScanPullRequests } from "./scanPullRequests";
import { fallbackScanTasks, generateTasks, type PlannedTasks } from "./taskGen";
import { errorMessage, log, sleep, truncate, type Semaphore } from "./util";
import type { WorkerClient } from "./workerClient";

/** CrawledPageSchema's title limit (packages/shared/src/scan.ts). */
const TITLE_MAX = 300;
/** ScanPatchSchema's message limit (packages/shared/src/scan.ts). */
const MESSAGE_MAX = 500;

// Relative to the scanned URL, not absolute: an absolute "/products" would
// drop the scanned URL's own path prefix (".../demo-shop/" -> the host root).
const MOCK_PAGES = [
  { path: "./", title: "Home" },
  { path: "products", title: "Products" },
  { path: "help", title: "Help" },
] as const;

export interface ScanOptions {
  /** "owner/name" from the allow-list: the repository this scan's fixes are mapped to. */
  repo?: string;
  /** Open one draft pull request per fixable task once the runs are over. */
  autoPr?: boolean;
}

export class ScanManager {
  constructor(
    private readonly config: Config,
    private readonly worker: WorkerClient,
    private readonly runs: RunManager,
    private readonly sessions: Semaphore,
  ) {}

  /** Creates the scan and returns its id at once; everything else happens in the background. */
  async start(url: string, options: ScanOptions = {}): Promise<string> {
    const scanId = await this.worker.createScan(url, options);
    void this.run(scanId, url, options);
    return scanId;
  }

  private async run(scanId: string, url: string, options: ScanOptions): Promise<void> {
    const { worker, runs } = this;
    log("scan", `${scanId} started in ${this.config.mode} mode: ${url}`);

    let plan: PlannedTasks;
    try {
      plan = this.config.mode === "mock" ? await this.mockPlan(scanId, url) : await this.livePlan(scanId, url);
    } catch (err) {
      // crawlSite and generateTasks both degrade on their own; this is the belt to their braces.
      plan = { tasks: fallbackScanTasks(url), source: "fallback", note: `Couldn't read the site (${errorMessage(err)}), so these tasks are generic.` };
    }

    const prepared: PreparedRun[] = [];
    try {
      for (const [index, task] of plan.tasks.entries()) {
        prepared.push(
          await runs.create(url, task.title, {
            scan: { scanId, taskIndex: index, whyCritical: task.whyCritical, successCheck: task.successCheck },
            successCheck: task.successCheck,
            repo: options.repo,
          }),
        );
      }
    } catch (err) {
      log("scan", `${scanId} failed: ${errorMessage(err)}`);
      await worker.patchScan(scanId, { status: "failed", taskSource: plan.source, message: `Could not create the runs: ${errorMessage(err)}` });
      return;
    }

    await worker.patchScan(scanId, {
      status: "running",
      taskSource: plan.source,
      message: plan.note ?? `Testing ${plan.tasks.length} tasks.`,
    });

    // execute() enters the session pool synchronously, so calling it in rank
    // order means the most critical tasks get browsers first.
    const outcomes = await Promise.all(prepared.map((run) => runs.execute(run)));
    const succeeded = outcomes.filter((outcome) => outcome === "success").length;
    const pullRequests = options.repo && options.autoPr ? await this.pullRequests(scanId, options.repo, prepared) : "";
    await worker.patchScan(scanId, { status: "completed", message: truncate(`The agent completed ${succeeded} of ${outcomes.length} tasks.${pullRequests}`, MESSAGE_MAX) });
    log("scan", `${scanId} finished: ${succeeded}/${outcomes.length} tasks succeeded`);
  }

  /** The pull request phase. Returns what the final message adds; never throws, so the scan always completes. */
  private async pullRequests(scanId: string, repo: string, prepared: readonly PreparedRun[]): Promise<string> {
    try {
      const results = await openScanPullRequests({
        config: this.config,
        worker: this.worker,
        scanId,
        repo,
        tasks: prepared.map((run, taskIndex) => ({ taskIndex, runId: run.runId, title: run.task })),
        progress: (message) => this.worker.patchScan(scanId, { message: truncate(message, MESSAGE_MAX) }),
      });
      return ` ${summarizeTaskPullRequests(results).text}`;
    } catch (err) {
      log("scan", `${scanId} pull requests stopped: ${errorMessage(err)}`);
      return ` Pull requests could not be opened: ${errorMessage(err)}`;
    }
  }

  private async livePlan(scanId: string, url: string): Promise<PlannedTasks> {
    // The crawl may queue behind other sessions; without this, the scan sits
    // at the creation-time "Opening the site." message for the whole wait.
    await this.worker.patchScan(scanId, { message: "Waiting for a browser session." });
    const crawl = await this.sessions.run(() =>
      crawlSite(this.config, url, (page, message) =>
        this.worker.patchScan(scanId, { page: { url: page.url, title: truncate(page.title, TITLE_MAX) }, message: truncate(message, MESSAGE_MAX) }),
      ),
    );
    await this.worker.patchScan(scanId, { message: `Choosing the ${MAX_SCAN_TASKS} most critical tasks.` });
    return generateTasks(this.config, url, crawl);
  }

  /** No browser, no model: a scripted crawl so the root node still shows progress. */
  private async mockPlan(scanId: string, url: string): Promise<PlannedTasks> {
    for (const [index, page] of MOCK_PAGES.entries()) {
      await sleep(1500 / this.config.mockSpeed);
      const pageUrl = new URL(page.path, url).toString();
      const label = new URL(pageUrl).pathname || "/";
      await this.worker.patchScan(scanId, {
        page: { url: pageUrl, title: truncate(page.title, TITLE_MAX) },
        message: truncate(`Read ${label} (${index + 1}/${MOCK_PAGES.length})`, MESSAGE_MAX),
      });
    }
    return { tasks: fallbackScanTasks(url), source: "mock", note: "Mock mode: canned tasks, and every run replays the golden run." };
  }
}
