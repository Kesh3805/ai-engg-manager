import type { ZodType } from 'zod';
import { MODEL_IDS } from './prompts.js';

/**
 * Minimal LLM invocation for agent workers, against any OpenAI-compatible
 * endpoint (NVIDIA NIM in this deployment; OPENAI_BASE_URL + OPENAI_API_KEY).
 *
 * Model routing (plan §2.4): 'light' for classification/structured diffs
 * (Claude Haiku / Llama-8B class), 'heavy' for synthesis and architecture
 * reasoning (Claude Sonnet / Llama-70B class). Env overrides:
 *   LLM_MODEL       → heavy tier
 *   LLM_MODEL_LIGHT → light tier (falls back to LLM_MODEL)
 */

export type ModelTier = 'light' | 'heavy';

export function modelFor(tier: ModelTier): string {
  if (tier === 'heavy') return process.env.LLM_MODEL ?? MODEL_IDS.synthesis;
  return process.env.LLM_MODEL_LIGHT ?? process.env.LLM_MODEL ?? MODEL_IDS.execution;
}

export function llmConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

async function chat(system: string, user: string, tier: ModelTier): Promise<string> {
  const base = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelFor(tier),
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!response.ok) throw new Error(`LLM call failed: ${response.status} ${await response.text()}`);
  const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? '';
}

function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced ? fenced[1]! : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

/** One retry with the validation error appended — then fail loudly. */
export async function completeJson<T>(
  schema: ZodType<T>,
  system: string,
  user: string,
  tier: ModelTier,
): Promise<T> {
  const first = await chat(system, user, tier);
  try {
    return schema.parse(JSON.parse(extractJson(first)));
  } catch (err) {
    const retry = await chat(
      system,
      `${user}\n\nYour previous output failed validation (${err instanceof Error ? err.message.slice(0, 500) : 'invalid'}). Output ONLY the corrected JSON.`,
      tier,
    );
    return schema.parse(JSON.parse(extractJson(retry)));
  }
}

/** Plain-text completion (doc agent diffs). */
export async function completeText(system: string, user: string, tier: ModelTier): Promise<string> {
  return chat(system, user, tier);
}

/** Embedding via the same OpenAI-compatible endpoint (baai/bge-m3, 1024-d). */
export async function embed(text: string): Promise<number[]> {
  const base = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const response = await fetch(`${base}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: process.env.EMBED_MODEL ?? 'baai/bge-m3', input: text.slice(0, 8_000) }),
  });
  if (!response.ok) throw new Error(`embedding call failed: ${response.status}`);
  const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
  return data.data[0]?.embedding ?? [];
}
