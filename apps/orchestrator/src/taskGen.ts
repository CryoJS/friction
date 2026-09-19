/**
 * The scan's second stage: ONE Structured Outputs call turns the crawl into
 * up to MAX_SCAN_TASKS tasks, most critical first. The model comes from
 * OPENAI_MODEL only.
 *
 * Degrades instead of failing: an unreadable site, a model error or an empty
 * answer all end in the same number of generic tasks, with a note saying so.
 */
import OpenAI from "openai";
import { MAX_SCAN_TASKS, parseGeneratedTasks, type GeneratedTask, type TaskSource } from "@friction/shared";
import type { Config } from "./config";
import type { CrawlResult } from "./crawl";
import { errorMessage, log } from "./util";

export interface PlannedTasks {
  tasks: GeneratedTask[];
  source: TaskSource;
  /** Shown on the root node when the tasks are not what the user might expect. */
  note: string | null;
}

const TASKS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tasks"],
  properties: {
    tasks: {
      type: "array",
      description: `Exactly ${MAX_SCAN_TASKS} tasks, most critical first.`,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "whyCritical", "successCheck"],
        properties: {
          title: { type: "string", description: "One imperative sentence, at most 14 words." },
          whyCritical: { type: "string", description: "One sentence: why this flow matters to the business or its visitors." },
          successCheck: { type: "string", description: "What the final page visibly shows when the task is done." },
        },
      },
    },
  },
};

const INSTRUCTIONS = [
  `You plan QA for a website. From what a crawler saw on its landing page and main navigation pages, choose the ${MAX_SCAN_TASKS} most critical tasks a real visitor must be able to complete, ranked most critical first.`,
  "Critical means the flows this site exists for: buying or converting, finding key information (products, pricing, policies, opening hours), and getting help.",
  "Each title is one imperative sentence of at most 14 words, specific to this site, achievable in about ten clicks from the landing page, and verifiable by looking at the final page.",
  "Cover different flows: never propose two variations of the same task.",
  "Never involve logging in, creating an account, entering personal data or paying. Adding to a cart is fine; checking out is not.",
].join("\n");

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "the site";
  }
}

/**
 * The MAX_SCAN_TASKS flows that make sense on most sites, most critical first.
 * Used when the site or the model lets us down, and in mock mode.
 */
export function fallbackScanTasks(url: string): GeneratedTask[] {
  const host = hostOf(url);
  return [
    { title: `Find the most popular product on ${host} and add it to the cart`, whyCritical: "Adding to the cart is the first step of every sale.", successCheck: "The cart shows at least one item." },
    { title: `Use search on ${host} to find a specific item and open it`, whyCritical: "Visitors who search know what they want and convert best.", successCheck: "A product or result detail page is open." },
    { title: `Find the price of the main product or plan on ${host}`, whyCritical: "Unclear pricing is a leading reason visitors leave.", successCheck: "A price is visible on the page." },
    { title: `Find how to contact support on ${host}`, whyCritical: "Stuck visitors who cannot reach help are lost.", successCheck: "A contact form, email address, phone number or chat is visible." },
    { title: `Find the return or refund policy on ${host}`, whyCritical: "Buyers check returns before committing to a purchase.", successCheck: "The return or refund policy text is visible." },
  ];
}

export async function generateTasks(config: Config, url: string, crawl: CrawlResult): Promise<PlannedTasks> {
  const generic = (note: string): PlannedTasks => ({ tasks: fallbackScanTasks(url), source: "fallback", note });
  if (!crawl.landing) return generic("Couldn't read the site, so these tasks are generic.");
  if (!config.openaiModel) return generic("OPENAI_MODEL is not set, so these tasks are generic.");

  try {
    const pages = [crawl.landing, ...crawl.pages];
    const text = pages
      .map((page, index) =>
        [`Page ${index + 1}${index === 0 ? " (landing)" : ""}: ${page.url}`, `Title: ${page.title || "(none)"}`, page.lines.join("\n")].join("\n"),
      )
      .join("\n\n");
    const content: OpenAI.Responses.ResponseInputContent[] = [{ type: "input_text", text }];
    if (crawl.landingImage) content.push({ type: "input_image", image_url: `data:image/jpeg;base64,${crawl.landingImage}`, detail: config.imageDetail });

    const client = new OpenAI({ apiKey: config.openaiApiKey ?? undefined, maxRetries: 1, timeout: 90_000 });
    const response = await client.responses.create({
      model: config.openaiModel,
      instructions: INSTRUCTIONS,
      input: [{ role: "user", content }],
      store: false,
      ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort as "low" } } : {}),
      text: { format: { type: "json_schema", name: "qa_tasks", schema: TASKS_JSON_SCHEMA, strict: true } },
    });

    const tasks = parseGeneratedTasks(JSON.parse(response.output_text));
    if (tasks.length === 0) return generic("The model returned no usable tasks, so these are generic.");
    return { tasks, source: "model", note: null };
  } catch (err) {
    log("scan", `task generation failed: ${errorMessage(err)}`);
    return generic(`Task generation failed (${errorMessage(err)}), so these tasks are generic.`);
  }
}
