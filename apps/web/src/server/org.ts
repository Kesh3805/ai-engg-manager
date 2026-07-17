import 'server-only';
import { sql } from './db';

/** Find (or create) the workspace org owned by a signed-in user. */
export async function getOrCreateUserOrg(userId: string, name: string | null): Promise<string | null> {
  if (!sql) return null;
  const existing = await sql<{ id: string }[]>`
    SELECT organization_id AS id FROM organization_members WHERE user_id = ${userId} LIMIT 1`;
  if (existing[0]) return existing[0].id;

  const slug = `u-${userId.slice(0, 8)}-${Date.now().toString(36)}`;
  const [org] = await sql<{ id: string }[]>`
    INSERT INTO organizations (name, slug) VALUES (${name ? `${name}'s workspace` : 'My workspace'}, ${slug}) RETURNING id`;
  await sql`INSERT INTO organization_members (organization_id, user_id, role) VALUES (${org!.id}, ${userId}, 'owner')`;
  return org!.id;
}

/** The org that owns the most-recently-active repo (used to scope the graph view). */
export async function getActiveOrg(): Promise<{ id: string; name: string } | null> {
  if (!sql) return null;
  const rows = await sql<{ id: string; name: string }[]>`
    SELECT o.id, o.name FROM organizations o
    LEFT JOIN repositories r ON r.org_id = o.id
    GROUP BY o.id, o.name
    ORDER BY max(r.updated_at) DESC NULLS LAST, o.created_at ASC
    LIMIT 1`;
  return rows[0] ?? null;
}
