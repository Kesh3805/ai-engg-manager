import { listConversations } from '@/server/conversations';
import { requireSession } from '@/server/auth-guard';
import { errorResponse } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The signed-in user's conversation history. Empty when not signed in. */
export async function GET() {
  try {
    const user = await requireSession();
    if (!user) return Response.json({ conversations: [], authenticated: false });
    const conversations = await listConversations(user.id);
    return Response.json({ conversations, authenticated: true });
  } catch (err) {
    return errorResponse(err);
  }
}
