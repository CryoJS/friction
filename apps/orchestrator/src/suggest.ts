/**
 * POST /suggest-tasks: a convenience, never a pipeline stage.
 *
 * Opens ONE browser session, looks at the landing page, and asks for three
 * candidate tasks via Structured Outputs. Every failure path (no keys, session
 * limit reached, slow site, model error) ends in generic suggestions, so the
 * button can never block a run. Typing a task by hand always works.
 */
import OpenAI from "openai";
import { z } from "zod";
import type { SuggestTasksResponse } from "@friction/shared";
import { openBrowser } from "./browser";
import type { Config } from "./config";
import { observe } from "./observe";
import { errorMessage, log, withTimeout } from "./util";

const SuggestionsSchema = z.object({ tasks: z.array(z.string().min(3)).min(1) });

const SUGGESTIONS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tasks"],
  properties: {
    tasks: {
      type: "array",
      description: "Exactly three tasks a first-time visitor could attempt on this site.",
      items: { type: "string" },
    },
  },
};

export function fallbackTasks(url: string): string[] {
  let host = "the site";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* keep the generic wording */
  }
  return [
    `Find the most popular product on ${host} and add it to the cart`,
    `Use search on ${host} to find something specific, then open its details`,
    `Find out how to contact support or return an item on ${host}`,
  ];
}

export async function suggestTasks(config: Config, url: string): Promise<SuggestTasksResponse> {
  if (config.mode === "mock" || !config.openaiModel) return { tasks: fallbackTasks(url), source: "fallback" };

  let close: (() => Promise<void>) | null = null;
  try {
    const browser = await withTimeout(openBrowser(config, "suggest"), 60_000, "browser session");
    close = browser.close;
    await browser.page.goto(url, { waitUntil: "load", timeoutMs: 25_000 }).catch(() => undefined);
    const observation = await observe(browser.page);

    const content: OpenAI.Responses.ResponseInputContent[] = [
      {
        type: "input_text",
        text: [
          `Landing page: ${observation.state.url}`,
          `Title: ${observation.state.title}`,
          "Accessibility tree (interactive elements and headings):",
          observation.tree.lines.slice(0, 120).join("\n"),
        ].join("\n"),
      },
    ];
    if (observation.forModel) content.push({ type: "input_image", image_url: `data:image/jpeg;base64,${observation.forModel}`, detail: config.imageDetail });

    const client = new OpenAI({ apiKey: config.openaiApiKey ?? undefined, maxRetries: 1, timeout: 30_000 });
    const response = await client.responses.create({
      model: config.openaiModel,
      instructions:
        "You design usability tests. Given a website's landing page, propose exactly three realistic tasks a first-time visitor might attempt. " +
        "Each is one imperative sentence under 14 words, achievable in about ten clicks, specific to what this site offers, and verifiable by looking at the final page. " +
        "Never involve logging in, creating an account, entering personal data or paying.",
      input: [{ role: "user", content }],
      store: false,
      text: { format: { type: "json_schema", name: "task_suggestions", schema: SUGGESTIONS_JSON_SCHEMA, strict: true } },
    });

    const tasks = SuggestionsSchema.parse(JSON.parse(response.output_text)).tasks.slice(0, 3);
    return { tasks, source: "model" };
  } catch (err) {
    log("suggest", `falling back to generic tasks: ${errorMessage(err)}`);
    return { tasks: fallbackTasks(url), source: "fallback" };
  } finally {
    await close?.().catch(() => undefined);
  }
}
