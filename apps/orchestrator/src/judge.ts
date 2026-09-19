/**
 * The model half of the hybrid friction pipeline: one Structured Outputs call
 * per candidate. The detectors (shared/friction.ts) already decided what
 * happened; this only asks for the judgement. If anything goes wrong here the
 * shared code substitutes the candidate's heuristic judgement.
 */
import OpenAI from "openai";
import type { StructuredCaller } from "@friction/shared";
import type { Config } from "./config";

export function openAIJudge(config: Config): StructuredCaller {
  const client = new OpenAI({ apiKey: config.openaiApiKey ?? undefined, maxRetries: 1, timeout: 30_000 });
  return async (request) => {
    const model = config.openaiModel;
    if (!model) throw new Error("OPENAI_MODEL is not set");
    const response = await client.responses.create({
      model,
      instructions: request.instructions,
      input: request.input,
      store: false,
      text: { format: { type: "json_schema", name: request.schemaName, schema: request.schema as unknown as Record<string, unknown>, strict: true } },
      ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort as "low" } } : {}),
    });
    return JSON.parse(response.output_text) as unknown;
  };
}
