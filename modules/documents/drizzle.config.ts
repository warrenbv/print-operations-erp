// drizzle-kit settings for `pnpm db:generate`: the `documents` schema only, into infra/db/migrations/documents.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/data/schema.ts',
  out: '../../infra/db/migrations/documents',
  schemaFilter: ['documents'],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5433/erp',
  },
});
