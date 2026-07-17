import type { NextRequest } from 'next/server';
import { runPipeline } from '@/lib/pipeline';
import { getSessionUser } from '@/server/session';
import { getOrCreateUserOrg } from '@/server/org';
import { ensureConversation, appendMessage } from '@/server/conversations';
import { LLM_MODEL } from '@/server/llm';
import { requireRole } from '@/server/auth-guard';
import { errorResponse } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Streaming chat endpoint. Runs the real retrieval→synthesis pipeline and
 * forwards every event as SSE. When the user is signed in the conversation and
 * both messages are persisted to Postgres.
 */
export async function POST(req: NextRequest) {
  let message = '';
  let conversationId: string | null = null;
  try {
    const body = await req.json();
    message = String(body.message ?? '').slice(0, 4000);
    conversationId = body.conversationId ?? null;
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 });
  }
  if (!message.trim()) return Response.json({ error: 'empty message' }, { status: 400 });

  try {
    await requireRole('viewer');
  } catch (err) {
    return errorResponse(err);
  }

  const user = await getSessionUser();
  let convId: string | null = null;
  if (user) {
    try {
      const orgId = await getOrCreateUserOrg(user.id, user.name);
      if (orgId) {
        convId = await ensureConversation(orgId, user.id, conversationId, message);
        if (convId) await appendMessage(convId, 'user', message);
      }
    } catch (e) {
      console.error('[chat] persistence (user msg) failed:', e);
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      let assistantText = '';
      try {
        if (convId) send({ type: 'conversation', conversationId: convId });
        for await (const event of runPipeline(message)) {
          if (event.type === 'text') assistantText += event.chunk;
          send(event);
        }
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'stream failed' });
      } finally {
        if (convId && assistantText.trim()) {
          appendMessage(convId, 'assistant', assistantText, { modelUsed: LLM_MODEL }).catch((e) => console.error('[chat] persistence (assistant) failed:', e));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
