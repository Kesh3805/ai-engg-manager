import 'server-only';
import OpenAI from 'openai';

const apiKey = process.env.OPENAI_API_KEY ?? process.env.NVIDIA_API_KEY;
if (!apiKey) throw new Error('OPENAI_API_KEY or NVIDIA_API_KEY is required for live mode');

const baseURL = process.env.OPENAI_BASE_URL ?? 'https://integrate.api.nvidia.com/v1';

export const llm = new OpenAI({ apiKey, baseURL });

export const LLM_MODEL = process.env.LLM_MODEL ?? 'meta/llama-3.3-70b-instruct';
export const EMBED_MODEL = process.env.EMBED_MODEL ?? 'baai/bge-m3';
export const EMBED_DIM = Number(process.env.EMBED_DIM ?? 1024);

/** Embed a batch of texts. NVIDIA embed models require an `input_type`. */
export async function embed(texts: string[], inputType: 'query' | 'passage' = 'passage'): Promise<number[][]> {
  const res = await llm.embeddings.create(
    // input_type is a NVIDIA-specific extension; cast through unknown to satisfy types.
    { model: EMBED_MODEL, input: texts, ...({ input_type: inputType } as Record<string, unknown>) } as never,
  );
  return res.data.map((d) => d.embedding as number[]);
}
