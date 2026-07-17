import 'server-only';
import { sql } from './db';

export interface ConversationRow {
  id: string;
  title: string | null;
  updatedAt: string;
}
export interface MessageRow {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: string;
}

export async function listConversations(userId: string): Promise<ConversationRow[]> {
  if (!sql) return [];
  return sql<ConversationRow[]>`
    SELECT id, title, updated_at AS "updatedAt" FROM conversations
    WHERE user_id = ${userId} ORDER BY updated_at DESC LIMIT 50`;
}

export async function getMessages(conversationId: string, userId: string): Promise<MessageRow[]> {
  if (!sql) return [];
  const owned = await sql<{ id: string }[]>`SELECT id FROM conversations WHERE id = ${conversationId} AND user_id = ${userId} LIMIT 1`;
  if (!owned[0]) return [];
  return sql<MessageRow[]>`
    SELECT id, role, content, created_at AS "createdAt" FROM messages
    WHERE conversation_id = ${conversationId} ORDER BY created_at ASC`;
}

/** Returns the conversation id to use, creating one (titled from the first message) if needed. */
export async function ensureConversation(orgId: string, userId: string, conversationId: string | null, firstMessage: string): Promise<string | null> {
  if (!sql) return null;
  if (conversationId) {
    const owned = await sql<{ id: string }[]>`SELECT id FROM conversations WHERE id = ${conversationId} AND user_id = ${userId} LIMIT 1`;
    if (owned[0]) return owned[0].id;
  }
  const title = firstMessage.length > 60 ? `${firstMessage.slice(0, 57)}…` : firstMessage;
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO conversations (org_id, user_id, title) VALUES (${orgId}, ${userId}, ${title}) RETURNING id`;
  return row!.id;
}

export async function appendMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  meta?: { modelUsed?: string },
): Promise<void> {
  if (!sql) return;
  await sql`
    INSERT INTO messages (conversation_id, role, content, model_used)
    VALUES (${conversationId}, ${role}, ${content}, ${meta?.modelUsed ?? null})`;
  await sql`UPDATE conversations SET updated_at = NOW() WHERE id = ${conversationId}`;
}
