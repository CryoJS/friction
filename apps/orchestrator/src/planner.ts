/**
 * PLAN: one OpenAI Responses API call per step.
 *   - image input: the downscaled viewport screenshot
 *   - function calling with Structured Outputs (strict: true), forced via
 *     tool_choice, returning { actionType, targetDescription, value,
 *     rationale, taskComplete }
 *
 * The model name comes from OPENAI_MODEL and nowhere else.
 */
import OpenAI from "openai";
import { z } from "zod";
import { ACTION_TYPES, ActionTypeSchema, type PersonaDefinition } from "@friction/shared";
import type { Config } from "./config";
import type { Observation } from "./observe";
import { retry } from "./util";

/** Strict mode has no optional keys, so an absent value is null. */
export const PlannedActionSchema = z.object({
  actionType: ActionTypeSchema,
  targetDescription: z.string(),
  value: z.string().nullable(),
  rationale: z.string(),
  taskComplete: z.boolean(),
});
export type PlannedAction = z.infer<typeof PlannedActionSchema>;

export interface HistoryEntry {
  step: number;
  action: string;
  outcome: string;
}

export interface PlanRequest {
  persona: PersonaDefinition;
  task: string;
  startUrl: string;
  step: number;
  maxSteps: number;
  observation: Observation;
  history: readonly HistoryEntry[];
  /** True for the single check after the last allowed action: only taskComplete matters. */
  finalCheck?: boolean;
}

export interface Planner {
  plan(request: PlanRequest): Promise<PlannedAction>;
}

const NEXT_ACTION_TOOL = {
  type: "function" as const,
  name: "next_action",
  description: "Decide the single next browser action this persona takes, or declare the task complete.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["actionType", "targetDescription", "value", "rationale", "taskComplete"],
    properties: {
      actionType: { type: "string", enum: [...ACTION_TYPES] },
      targetDescription: {
        type: "string",
        description: 'The element acted on, starting with its id from the accessibility tree, e.g. [0-57] button "Add to cart". Empty string for scroll, wait and navigate.',
      },
      value: {
        type: ["string", "null"],
        description: 'type: the text. select: the option text. press: space-separated keys such as "Enter" or "Tab Tab Tab". scroll: "down" or "up". navigate: an absolute URL. Otherwise null.',
      },
      rationale: { type: "string", description: "One sentence, first person, in the persona's voice. Shown live to an audience." },
      taskComplete: { type: "boolean", description: "True only if the screenshot shows the task is already accomplished." },
    },
  },
};

function rules(persona: PersonaDefinition): string {
  const keyboard = persona.inputMode === "keyboard";
  return [
    "You are operating a real web browser to attempt a task exactly as this person would. You are not an assistant trying to be efficient: behave in character, including this person's mistakes and impatience.",
    "Each turn you get a screenshot of the current viewport and the page's accessibility tree, pruned to interactive elements and headings, one per line as: [id] role: accessible name. The tree covers the whole page; the screenshot shows only what is currently visible.",
    "Decide exactly one next action by calling next_action.",
    keyboard
      ? 'You have NO pointer. The only actions available to you are "press" (keys), "type" (text goes into whatever currently has focus), "wait" and "navigate". Never choose click, select or scroll. To reach a control, press Tab the right number of times (use the tab order you are given), then Enter or Space to activate it. Use arrow keys inside radio groups, menus and listboxes. In one press action you may send up to 12 keys.'
      : 'Actions: "click" an element; "type" text into a field; "select" an option of a dropdown; "scroll" down or up; "press" keys (after typing into a search box, submit with press "Enter"); "wait" if the page is visibly still loading; "navigate" to an absolute URL only when no link will get you there.',
    "For click, type and select, targetDescription MUST begin with the [id] of an element that appears in the tree you were given. Never invent an id.",
    "If your previous action is marked as having had no visible effect, react the way this persona would.",
    "Set taskComplete to true only when what you can see proves the task is already done (for example the cart visibly contains the item). Do not set it on the step where you merely clicked the final button: look at the result first.",
    "Stay on the task. Never enter personal data, passwords or payment details, never log in, create an account, or place an order. Adding to a cart is fine; checking out is not.",
  ].join("\n");
}

function userText(request: PlanRequest): string {
  const { observation, persona } = request;
  const { state, tree } = observation;
  const lines: string[] = [
    `Task: ${request.task}`,
    request.finalCheck
      ? "You have used every step you are allowed. Do not plan another action. Only judge from the screenshot whether the task is complete, and set taskComplete accordingly."
      : `This is step ${request.step} of at most ${request.maxSteps}.`,
    `Current URL: ${state.url}`,
    `Page title: ${state.title || "(none)"}`,
    `Scroll position: ${state.scrollY}px of ${state.scrollMax}px`,
  ];
  if (state.overlay) lines.push(`A dialog or overlay is covering the page: "${state.overlay.label}"`);
  if (tree.errorTexts.length > 0) lines.push(`Error messages currently visible: ${tree.errorTexts.map((t) => `"${t}"`).join("; ")}`);
  if (persona.inputMode === "keyboard") {
    lines.push(`Keyboard focus is on: ${state.focus.label ? `${state.focus.tag} "${state.focus.label}"` : "nothing (the page body)"}`);
    lines.push(state.tabStops.length > 0 ? `Pressing Tab repeatedly would visit, in order: ${state.tabStops.map((stop, i) => `${i + 1}. ${stop}`).join("  ")}` : "No further tab stops were found after the current focus.");
  }
  lines.push("", "What you have done so far:");
  if (request.history.length === 0) lines.push("  (nothing yet)");
  for (const entry of request.history.slice(-8)) lines.push(`  ${entry.step}. ${entry.action} -> ${entry.outcome}`);
  lines.push("", "Accessibility tree (interactive elements and headings):");
  lines.push(tree.lines.length > 0 ? tree.lines.join("\n") : "(the tree is empty: the page may still be loading)");
  if (tree.truncated > 0) lines.push(`(${tree.truncated} more elements further down the page were omitted)`);
  return lines.join("\n");
}

export class OpenAIPlanner implements Planner {
  private readonly client: OpenAI;

  constructor(private readonly config: Config) {
    this.client = new OpenAI({ apiKey: config.openaiApiKey ?? undefined, maxRetries: 2, timeout: 60_000 });
  }

  async plan(request: PlanRequest): Promise<PlannedAction> {
    const model = this.config.openaiModel;
    if (!model) throw new Error("OPENAI_MODEL is not set");

    const content: OpenAI.Responses.ResponseInputContent[] = [{ type: "input_text", text: userText(request) }];
    if (request.observation.forModel) {
      content.push({ type: "input_image", image_url: `data:image/jpeg;base64,${request.observation.forModel}`, detail: this.config.imageDetail });
    }

    // A malformed or missing tool call is worth exactly one more try.
    return retry(2, 500, async () => {
      const response = await this.client.responses.create({
        model,
        instructions: `${request.persona.systemPrompt}\n\n${rules(request.persona)}`,
        input: [{ role: "user", content }],
        tools: [NEXT_ACTION_TOOL],
        tool_choice: { type: "function", name: NEXT_ACTION_TOOL.name },
        parallel_tool_calls: false,
        store: false,
        ...(this.config.reasoningEffort ? { reasoning: { effort: this.config.reasoningEffort as "low" } } : {}),
      });

      const call = response.output.find((item) => item.type === "function_call" && item.name === NEXT_ACTION_TOOL.name);
      if (!call || call.type !== "function_call") throw new Error("the model did not call next_action");
      return PlannedActionSchema.parse(JSON.parse(call.arguments));
    });
  }
}

/**
 * A planner that follows a fixed script. No model, no key: drives the real
 * browser pipeline in scripts/smoke-local.ts. Each entry gets the live
 * observation so it can look ids up by accessible name, like the model does.
 */
export type ScriptedStep = (observation: Observation) => PlannedAction;

export class ScriptedPlanner implements Planner {
  private index = 0;
  constructor(private readonly script: readonly ScriptedStep[]) {}

  async plan(request: PlanRequest): Promise<PlannedAction> {
    const next = this.script[this.index];
    this.index += 1;
    if (!next || request.finalCheck) return { actionType: "wait", targetDescription: "", value: null, rationale: "Nothing left to do.", taskComplete: true };
    return next(request.observation);
  }
}
