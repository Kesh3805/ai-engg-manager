import type { NextRequest } from 'next/server';
import { getMessages } from '@/server/conversations';
import { requireSession } from '@/server/auth-guard';
import { errorResponse } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Messages for a conversation the signed-in user owns (ownership enforced in getMessages). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    if (!user) return Response.json({ messages: [] }, { status: 401 });
    const { id } = await params;
    const messages = await getMessages(id, user.id);
    return Response.json({ messages });
  } catch (err) {
    return errorResponse(err);
  }
}
