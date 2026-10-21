// Cook mode's model eval: the ten dishes of test/fixtures/dishes-unseen.json (none in the dish table) through the
// local model, exactly as the app asks (the shared prompt and schema, one call per dish, Ollama's structured output),
// scored for missing core ingredients and for what validation drops or clamps. Records the raw answers, the timing
// and the model in test/fixtures/dishes-model.json, which CI's test scores without a model.
//
//   npm run eval:dishes -w @grosher/stores                       # ask the model, print the score, rewrite the recording
//   npm run eval:dishes -w @grosher/stores -- --recorded         # score the recording only
//   npm run eval:dishes -w @grosher/stores -- --concurrency 2    # dishes asked at once (the Worker's DISH_CONCURRENCY)
//
// Env: OLLAMA_URL (default http://localhost:11434), OLLAMA_MODEL (default qwen3:8b). Local model only.

import { readFileSync, writeFileSync } from "node:fs";
import { DISH_MAX_TOKENS, dishSchema, dishSystemPrompt, dishUserMessage } from "@grosher/core";
import { printScore, scoreRecording, type Recording } from "../test/dish-score.ts";

const OLLAMA_URL = (process.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/$/, "");
const MODEL = process.env.OLLAMA_MODEL ?? "qwen3:8b";
const args = process.argv.slice(2);
const concurrency = Number(args[args.indexOf("--concurrency") + 1]) || 1;
const FIXTURE = new URL("../test/fixtures/dishes-unseen.json", import.meta.url);
const RECORDING = new URL("../test/fixtures/dishes-model.json", import.meta.url);

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as { dishes: { dish: string }[] };

async function ask(dish: string): Promise<Recording["calls"][number]> {
  const t0 = performance.now();
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      think: false,
      keep_alive: "24h",
      format: dishSchema(),
      options: { temperature: 0, num_predict: DISH_MAX_TOKENS },
      messages: [
        { role: "system", content: dishSystemPrompt() },
        { role: "user", content: dishUserMessage(dish) },
      ],
    }),
  });
  const body = (await res.json()) as { message?: { content?: string }; eval_count?: number; eval_duration?: number };
  const ms = Math.round(performance.now() - t0);
  console.log(`${dish}: ${ms} ms, ${body.eval_count} output tokens`);
  return { dish, ms, outputTokens: body.eval_count ?? null, generationMs: body.eval_duration ? Math.round(body.eval_duration / 1e6) : null, content: body.message?.content ?? "" };
}

if (!args.includes("--recorded")) {
  const dishes = fixture.dishes.map((d) => d.dish);
  const calls: Recording["calls"] = [];
  const t0 = performance.now();
  for (let i = 0; i < dishes.length; i += concurrency) calls.push(...(await Promise.all(dishes.slice(i, i + concurrency).map(ask))));
  const recording: Recording = { model: MODEL, recordedAt: new Date().toLocaleDateString("sv"), concurrency, totalMs: Math.round(performance.now() - t0), calls };
  writeFileSync(RECORDING, JSON.stringify(recording, null, 1) + "\n");
}

printScore(scoreRecording(JSON.parse(readFileSync(RECORDING, "utf8")) as Recording));
