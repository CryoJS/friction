/**
 * One isolated browser per persona.
 *
 * BROWSERBASE (default): a fresh Browserbase *context* per persona keeps
 * cookies and storage isolated, a session is created inside it, and Stagehand
 * attaches to that existing session over CDP (browserbaseSessionID). The live
 * view URL comes from sessions.debug().
 *
 * LOCAL (BROWSER_ENV=LOCAL): Stagehand launches a local Chromium. No live view,
 * no replay. For developing prompts without spending Browserbase minutes.
 */
import Browserbase from "@browserbasehq/sdk";
import { Stagehand } from "@browserbasehq/stagehand";
import { existsSync } from "node:fs";
import { VIEWPORT, type Config } from "./config";
import { errorMessage, log, sleep, withTimeout } from "./util";

export type StagehandPage = ReturnType<Stagehand["context"]["pages"]>[number];

export interface BrowserHandle {
  stagehand: Stagehand;
  page: StagehandPage;
  sessionId: string | null;
  liveViewUrl: string | null;
  replayUrl: string | null;
  close: () => Promise<void>;
}

const LOCAL_BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/** Stagehand wants "provider/model". OPENAI_MODEL is a bare OpenAI model id. */
function stagehandModel(config: Config): { modelName: string; apiKey: string } {
  const name = config.stagehandModel ?? "unset";
  return { modelName: name.includes("/") ? name : `openai/${name}`, apiKey: config.openaiApiKey ?? "unset" };
}

const sharedOptions = (config: Config) =>
  ({
    model: stagehandModel(config),
    // Run act/observe in this process with our key, not through Stagehand's hosted API.
    disableAPI: true,
    verbose: 0 as const,
    disablePino: true,
    selfHeal: true,
    domSettleTimeout: 3000,
    actTimeoutMs: 20_000,
  }) satisfies Partial<ConstructorParameters<typeof Stagehand>[0]>;

async function firstPage(stagehand: Stagehand): Promise<StagehandPage> {
  return stagehand.context.pages()[0] ?? (await stagehand.context.awaitActivePage(10_000));
}

async function openLocal(config: Config): Promise<BrowserHandle> {
  const executablePath = config.localBrowserPath ?? LOCAL_BROWSERS.find((path) => existsSync(path));
  const stagehand = new Stagehand({
    env: "LOCAL",
    localBrowserLaunchOptions: {
      headless: true,
      viewport: { width: VIEWPORT.w, height: VIEWPORT.h },
      ...(executablePath ? { executablePath } : {}),
    },
    ...sharedOptions(config),
  });
  await withTimeout(stagehand.init(), 45_000, "local browser launch");
  const page = await firstPage(stagehand);
  return {
    stagehand,
    page,
    sessionId: null,
    liveViewUrl: null,
    replayUrl: null,
    close: async () => {
      await withTimeout(stagehand.close(), 10_000, "browser close").catch(() => undefined);
    },
  };
}

async function openBrowserbase(config: Config, label: string): Promise<BrowserHandle> {
  const apiKey = config.browserbaseApiKey;
  const projectId = config.browserbaseProjectId;
  if (!apiKey || !projectId) throw new Error("BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID are not set");
  const bb = new Browserbase({ apiKey, maxRetries: 2, timeout: 30_000 });

  // Own context per persona: no cookie, cache or storage leaks between personas.
  const context = await bb.contexts.create({ projectId });

  // Plans cap concurrent sessions. Three personas start at once, so wait out a 429 instead of failing.
  let session: Awaited<ReturnType<typeof bb.sessions.create>> | null = null;
  for (let attempt = 1; session === null; attempt++) {
    try {
      session = await bb.sessions.create({
        projectId,
        keepAlive: false,
        api_timeout: Math.ceil(config.personaTimeoutMs / 1000) + 120,
        ...(config.browserbaseRegion ? { region: config.browserbaseRegion as "us-west-2" } : {}),
        browserSettings: {
          context: { id: context.id, persist: false },
          viewport: { width: VIEWPORT.w, height: VIEWPORT.h },
          blockAds: true,
          solveCaptchas: true,
          recordSession: true,
        },
      });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 429 || attempt >= 5) throw err;
      log(label, `Browserbase concurrency limit hit, retrying session create (attempt ${attempt})`);
      await sleep(4000 * attempt);
    }
  }
  const sessionId = session.id;

  const release = async (): Promise<void> => {
    await bb.sessions.update(sessionId, { status: "REQUEST_RELEASE", projectId }).catch(() => undefined);
    await bb.contexts.delete(context.id).catch(() => undefined);
  };

  try {
    // The embeddable live view. Not fatal if it fails: the run still works, the UI shows screenshots.
    const liveViewUrl = await bb.sessions
      .debug(sessionId)
      .then((urls) => urls.debuggerFullscreenUrl)
      .catch((err) => {
        log(label, `live view URL unavailable: ${errorMessage(err)}`);
        return null;
      });

    const stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey,
      projectId,
      browserbaseSessionID: sessionId,
      ...sharedOptions(config),
    });
    await withTimeout(stagehand.init(), 60_000, "Stagehand attach");
    const page = await firstPage(stagehand);

    return {
      stagehand,
      page,
      sessionId,
      liveViewUrl,
      replayUrl: `https://www.browserbase.com/sessions/${sessionId}`,
      close: async () => {
        await withTimeout(stagehand.close(), 10_000, "Stagehand close").catch(() => undefined);
        await release();
      },
    };
  } catch (err) {
    await release();
    throw err;
  }
}

export function openBrowser(config: Config, label: string): Promise<BrowserHandle> {
  return config.browserEnv === "LOCAL" ? openLocal(config) : openBrowserbase(config, label);
}
