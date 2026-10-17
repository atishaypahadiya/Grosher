// One Claude call for the whole list: each item → department + sub-category
// + tags, or null when it is not something a grocery store sells. Pure over
// an injected client, so the worker is testable without the network.

import type Anthropic from "@anthropic-ai/sdk";
import { LLM_SYSTEM, llmMaxTokens, llmResultSchema, llmUserMessage, parseLlmResults, type ItemTag, type LlmWire } from "@grosher/core";

export const MODEL = "claude-haiku-5-5";
export type Tag = ItemTag;
export type Guess = LlmWire;

export interface ClassifyRequest {
  items: string[];
  departments: string[];
}

const TOOL_NAME = "classify_items";

export function buildTool(departments: string[]): Anthropic.Tool {
  return {
    name: TOOL_NAME,
    description: "Report, for every item, the department id it is shelved in at this store (or null), a shelf category of at most three words, and your confidence.",
    strict: true,
    input_schema: llmResultSchema(departments) as unknown as Anthropic.Tool["input_schema"],
  };
}

export const SYSTEM = LLM_SYSTEM;

export async function classify(client: Anthropic, req: ClassifyRequest): Promise<Guess[]> {
  const items = [...new Set(req.items.map((s) => s.trim()).filter(Boolean))].slice(0, 100);
  if (!items.length) return [];
  const departments = req.departments.filter(Boolean);
  const tool = buildTool(departments);
  // Haiku 5.5: adaptive thinking is on by default; classification needs little, so effort low.
  // tool_choice stays "auto" with the instruction naming the tool (the 5.5 family rejects forced tool choice).
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048 + llmMaxTokens(items.length), // thinking shares the budget
    system: SYSTEM,
    output_config: { effort: "low" },
    tools: [tool],
    tool_choice: { type: "auto", disable_parallel_tool_use: true },
    messages: [{ role: "user", content: `Call ${TOOL_NAME} once with every item below.\n${llmUserMessage(items, departments)}` }],
  });
  const use = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === TOOL_NAME);
  return parseLlmResults(use?.input, items, departments);
}
