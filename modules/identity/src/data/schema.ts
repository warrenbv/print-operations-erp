// The `identity` schema. The migration generated from it is
// infra/db/migrations/identity/0000_baseline.sql. See modules/identity/README.md for what each table holds.
import { relations } from 'drizzle-orm';
import { index, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const identitySchema = pgSchema('identity');

export const users = identitySchema.table(
  'users',
  {
    id: uuid('id').primaryKey(),

    // The id the provider gives the person: the directory's objectGUID, `local:` and the name for a
    // local account, or `break-glass`. Usernames can repeat across rows and are only indexed.
    externalId: text('external_id').notNull().unique(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    email: text('email'),

    // Role names, checked against the role list in code, not by a database constraint.
    roles: text('roles').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('users_username_idx').on(table.username)],
);

export const sessions = identitySchema.table(
  'sessions',
  {
    id: uuid('id').primaryKey(),

    // SHA-256 of the token: docs/decisions/005-server-side-sessions.md.
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()

      .references(() => users.id, { onDelete: 'cascade' }),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),

    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),

    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),

    index('sessions_absolute_expires_at_idx').on(table.absoluteExpiresAt),
  ],
);

// The fixed key of the one break-glass row. Nothing in the schema stops a second key, so the adapter
// always writes this one.
export const BREAK_GLASS_SINGLETON = 'the-one';

export const breakGlass = identitySchema.table('break_glass', {
  singleton: text('singleton').primaryKey().default(BREAK_GLASS_SINGLETON),
  passwordHash: text('password_hash').notNull(),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));
