// One Claude call for the whole list: each item → department + sub-category
// + tags, or null when it is not something a grocery store sells. Pure over
// an injected client, so the worker is testable without the network.

import type Anthropic from "@anthropic-ai/sdk";
import { llmMaxTokens, llmResultSchema, llmSystemPrompt, llmUserMessage, parseLlmResults, type ItemTag, type LlmCategoryOption, type LlmWire } from "@grosher/core";

export const MODEL = "claude-haiku-5-5";
export type Tag = ItemTag;
export type Guess = LlmWire;

export interface ClassifyRequest {
  items: string[];
  /** the store's shelf categories, id and sign name */
  categories: LlmCategoryOption[];
}

const TOOL_NAME = "classify_items";

export function buildTool(categoryIds: string[]): Anthropic.Tool {
  return {
    name: TOOL_NAME,
    description: "Report, for every item, the id of the shelf category it is found in at this store (or null), a shelf category of at most three words, and your confidence.",
    strict: true,
    input_schema: llmResultSchema(categoryIds) as unknown as Anthropic.Tool["input_schema"],
  };
}

export async function classify(client: Anthropic, req: ClassifyRequest): Promise<Guess[]> {
  const items = [...new Set(req.items.map((s) => s.trim()).filter(Boolean))].slice(0, 100);
  if (!items.length) return [];
  const categories = req.categories.filter((c) => c && c.id);
  const ids = categories.map((c) => c.id);
  const tool = buildTool(ids);
  // Haiku 5.5: adaptive thinking is on by default; classification needs little, so effort low.
  // tool_choice stays "auto" with the instruction naming the tool (the 5.5 family rejects forced tool choice).
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048 + llmMaxTokens(items.length), // thinking shares the budget
    system: llmSystemPrompt(categories),
    output_config: { effort: "low" },
    tools: [tool],
    tool_choice: { type: "auto", disable_parallel_tool_use: true },
    messages: [{ role: "user", content: `Call ${TOOL_NAME} once with every item below.\n${llmUserMessage(items)}` }],
  });
  const use = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === TOOL_NAME);
  return parseLlmResults(use?.input, items, ids);
}
