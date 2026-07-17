/**
 * The six automated authorization tests from plan §3.5, exercised at the
 * guard layer (routes delegate all authz decisions to these functions).
 *
 * All tests run with AUTH_ENFORCE=true — the strict production semantics.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  UnauthorizedError,
  ForbiddenError,
  ResourceNotFoundError,
} from '@/server/errors';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

interface TestState {
  session: { id: string; name: string | null; email: string | null; image: string | null } | null;
  /** `${orgId}:${userId}` → role */
  memberships: Map<string, string>;
}
const state: TestState = { session: null, memberships: new Map() };

vi.mock('@/server/session', () => ({
  getSessionUser: async () => state.session,
}));

vi.mock('@/server/org', () => ({
  getOrCreateUserOrg: async () => null,
  getActiveOrg: async () => null,
}));

vi.mock('@/server/db', () => ({
  sql: async (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const query = strings.join('?');
    if (query.includes('WHERE organization_id =') && query.includes('AND user_id =')) {
      const role = state.memberships.get(`${vals[0]}:${vals[1]}`);
      return role ? [{ role }] : [];
    }
    if (query.includes('WHERE user_id =')) {
      for (const [key, role] of state.memberships) {
        const [orgId, userId] = key.split(':');
        if (userId === vals[0]) return [{ orgId, role }];
      }
      return [];
    }
    return [];
  },
}));

import {
  requireOrgListAccess,
  requireResourceAccess,
  requireRole,
} from '@/server/auth-guard';

function signInAs(userId: string, role: string, orgId: string) {
  state.session = { id: userId, name: 'Test User', email: 'test@example.com', image: null };
  state.memberships.set(`${orgId}:${userId}`, role);
}

beforeEach(() => {
  process.env.AUTH_ENFORCE = 'true';
  state.session = null;
  state.memberships.clear();
});

describe('auth-guard (AUTH_ENFORCE=true)', () => {
  it('Test 1: Org A user requesting an Org B resource (incident) gets 404 — not 403', async () => {
    signInAs('user-a', 'admin', ORG_A);
    // Route fetched the Org B incident row and passes its org_id from the DB.
    const err = await requireResourceAccess(ORG_B).catch((e) => e);
    expect(err).toBeInstanceOf(ResourceNotFoundError);
    expect(err.status).toBe(404); // identical to "row missing" — no enumeration oracle
    expect(err).not.toBeInstanceOf(ForbiddenError);
  });

  it('Test 2: Org A viewer performing a member-only action in Org A gets 403', async () => {
    signInAs('user-a', 'viewer', ORG_A);
    const resourceErr = await requireResourceAccess(ORG_A, 'member').catch((e) => e);
    expect(resourceErr).toBeInstanceOf(ForbiddenError);
    expect(resourceErr.status).toBe(403);

    const roleErr = await requireRole('member').catch((e) => e);
    expect(roleErr).toBeInstanceOf(ForbiddenError);
  });

  it('Test 3: unauthenticated caller gets 401 from every guard', async () => {
    for (const attempt of [
      () => requireOrgListAccess(ORG_A),
      () => requireResourceAccess(ORG_A),
      () => requireRole('viewer'),
    ]) {
      const err = await attempt().catch((e) => e);
      expect(err).toBeInstanceOf(UnauthorizedError);
      expect(err.status).toBe(401);
    }
  });

  it('Test 4: Org A user listing Org A data passes and gets a full auth context', async () => {
    signInAs('user-a', 'member', ORG_A);
    const ctx = await requireOrgListAccess(ORG_A, 'viewer');
    expect(ctx).toEqual({ userId: 'user-a', orgId: ORG_A, role: 'member' });
  });

  it('Test 5: Org A user listing Org B data gets 403 (org visible in URL, membership required)', async () => {
    signInAs('user-a', 'owner', ORG_A);
    const err = await requireOrgListAccess(ORG_B).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.status).toBe(403);
  });

  it('Test 6: Org A user requesting an Org B resource (ADR) gets 404, same as missing', async () => {
    signInAs('user-a', 'owner', ORG_A);
    const err = await requireResourceAccess(ORG_B, 'viewer').catch((e) => e);
    expect(err).toBeInstanceOf(ResourceNotFoundError);
    expect(err.status).toBe(404);
  });

  it('role ranking: admin passes member-gated access, viewer does not pass admin', async () => {
    signInAs('user-a', 'admin', ORG_A);
    const ctx = await requireResourceAccess(ORG_A, 'member');
    expect(ctx.role).toBe('admin');

    state.memberships.set(`${ORG_A}:user-a`, 'viewer');
    const err = await requireOrgListAccess(ORG_A, 'admin').catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
  });
});
