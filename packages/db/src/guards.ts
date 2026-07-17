import { and, eq } from 'drizzle-orm';
import { db } from './client.js';
import { organizationMembers } from './schema/auth.js';

/** Role → permission grants. Mirrors the Better Auth organization plugin config. */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ['*'],
  admin: ['repo:*', 'integration:*', 'member:read', 'query:*'],
  member: ['repo:read', 'query:*'],
  viewer: ['repo:read', 'query:read'],
};

export class AuthorizationError extends Error {
  constructor(public code: 'UNAUTHORIZED' | 'FORBIDDEN') {
    super(code);
    this.name = 'AuthorizationError';
  }
}

function permits(grants: string[], permission: string): boolean {
  return grants.some((p) => {
    if (p === '*' || p === permission) return true;
    if (p.endsWith(':*')) return permission.startsWith(p.slice(0, -1)); // 'repo:*' → 'repo:'
    if (p.endsWith('*')) return permission.startsWith(p.slice(0, -1));
    return false;
  });
}

/**
 * Throws AuthorizationError unless `userId` is a member of `orgId` with a role
 * that grants `permission`.
 */
export async function assertOrgAccess(userId: string, orgId: string, permission: string): Promise<void> {
  const member = await db.query.organizationMembers.findFirst({
    where: and(eq(organizationMembers.userId, userId), eq(organizationMembers.organizationId, orgId)),
  });

  if (!member) throw new AuthorizationError('UNAUTHORIZED');

  const grants = ROLE_PERMISSIONS[member.role] ?? [];
  if (!permits(grants, permission)) throw new AuthorizationError('FORBIDDEN');
}
