import 'server-only';
import { sql } from './db';
import { getSessionUser } from './session';
import { getOrCreateUserOrg, getActiveOrg } from './org';
import { UnauthorizedError, ForbiddenError, ResourceNotFoundError } from './errors';

/**
 * Authorization guards — the only two patterns API routes may use for
 * org-scoped data (plan §3):
 *
 *  - requireOrgListAccess(orgId)      list routes; client supplies orgId,
 *                                     we verify membership. Wrong org → 403.
 *  - requireResourceAccess(rowOrgId)  resource routes; caller fetches the row
 *                                     FIRST and passes its org_id from the DB.
 *                                     Non-member → 404 (identical to missing,
 *                                     so existence can't be enumerated).
 *
 * Plus two conveniences for routes that operate on the caller's own workspace:
 *  - requireRole(minRole)             resolves the caller's org + role
 *  - requireSession()                 401 when enforced and signed out
 *
 * Enforcement mirrors middleware.ts: strict when AUTH_ENFORCE=true; otherwise
 * local dev gets a synthetic owner principal so the app stays explorable
 * without sign-in (same stance the /app gate has always had).
 */

export type OrgRole = 'viewer' | 'member' | 'admin' | 'owner';

const RANK: Record<OrgRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export interface AuthContext {
  userId: string;
  orgId: string;
  role: OrgRole;
}

export function authEnforced(): boolean {
  return process.env.AUTH_ENFORCE === 'true';
}

function asRole(value: unknown): OrgRole {
  return value === 'owner' || value === 'admin' || value === 'member' ? value : 'viewer';
}

async function membershipRole(orgId: string, userId: string): Promise<OrgRole | null> {
  const rows = await sql<Array<{ role: string }>>`
    SELECT role FROM organization_members
    WHERE organization_id = ${orgId} AND user_id = ${userId} LIMIT 1`;
  return rows[0] ? asRole(rows[0].role) : null;
}

async function devPrincipal(orgId?: string): Promise<AuthContext> {
  const user = await getSessionUser();
  const org = orgId ?? (await getActiveOrg())?.id ?? 'local';
  return { userId: user?.id ?? 'local-dev', orgId: org, role: 'owner' };
}

/**
 * List routes: client supplies orgId. Checks membership — cannot leak
 * cross-org data because a non-member never gets past this call (403).
 */
export async function requireOrgListAccess(
  orgId: string,
  minRole: OrgRole = 'viewer',
): Promise<AuthContext> {
  if (!authEnforced()) return devPrincipal(orgId);

  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();

  const role = await membershipRole(orgId, user.id);
  if (!role) throw new ForbiddenError('not a member of this organization');
  if (RANK[role] < RANK[minRole]) throw new ForbiddenError();

  return { userId: user.id, orgId, role };
}

/**
 * Resource routes: caller fetches the resource first and passes its org_id
 * from the DB row — the client-supplied orgId is NEVER used here. A user
 * outside the resource's org gets 404, indistinguishable from "row missing",
 * so this endpoint is not an existence oracle.
 */
export async function requireResourceAccess(
  resourceOrgId: string, // always from DB row, never from req
  minRole: OrgRole = 'viewer',
): Promise<AuthContext> {
  if (!authEnforced()) return devPrincipal(resourceOrgId);

  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();

  const role = await membershipRole(resourceOrgId, user.id);
  if (!role) throw new ResourceNotFoundError();
  if (RANK[role] < RANK[minRole]) throw new ForbiddenError();

  return { userId: user.id, orgId: resourceOrgId, role };
}

/**
 * Routes that act on the caller's own workspace org (no orgId in the request):
 * resolves the signed-in user's org (creating the personal workspace on first
 * use, matching existing behavior) and checks their role there.
 */
export async function requireRole(minRole: OrgRole = 'viewer'): Promise<AuthContext> {
  if (!authEnforced()) return devPrincipal();

  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();

  const memberships = await sql<Array<{ orgId: string; role: string }>>`
    SELECT organization_id AS "orgId", role FROM organization_members
    WHERE user_id = ${user.id} ORDER BY created_at ASC LIMIT 1`;

  let orgId: string;
  let role: OrgRole;
  if (memberships[0]) {
    orgId = memberships[0].orgId;
    role = asRole(memberships[0].role);
  } else {
    const created = await getOrCreateUserOrg(user.id, user.name);
    if (!created) throw new ForbiddenError('no organization available');
    orgId = created;
    role = 'owner';
  }

  if (RANK[role] < RANK[minRole]) throw new ForbiddenError();
  return { userId: user.id, orgId, role };
}

/**
 * User-scoped routes (conversations, chat persistence). Throws 401 when
 * enforcement is on and there is no session; in dev mode returns null so the
 * anonymous flows keep working.
 */
export async function requireSession() {
  const user = await getSessionUser();
  if (!user && authEnforced()) throw new UnauthorizedError();
  return user;
}
