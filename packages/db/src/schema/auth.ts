import { pgTable, uuid, text, timestamp, boolean, uniqueIndex } from 'drizzle-orm/pg-core';
import { organizations } from './organizations';

/**
 * Better Auth managed tables (subset modelled here so org guards can query
 * membership directly). Better Auth owns migrations for these in production.
 */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const organizationMembers = pgTable(
  'organization_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'), // owner | admin | member | viewer
    invitedBy: text('invited_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    // One membership row per (org, user) — the authorization model depends on this.
    orgUserIdx: uniqueIndex('org_members_org_user_idx').on(t.organizationId, t.userId),
  }),
);

export type OrganizationMember = typeof organizationMembers.$inferSelect;
