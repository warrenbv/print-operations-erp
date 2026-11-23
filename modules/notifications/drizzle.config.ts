// drizzle-kit settings for `pnpm db:generate`: the `notifications` schema only, into infra/db/migrations/notifications.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/data/schema.ts',
  out: '../../infra/db/migrations/notifications',
  schemaFilter: ['notifications'],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5433/erp',
  },
});
