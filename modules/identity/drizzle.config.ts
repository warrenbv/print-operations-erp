// drizzle-kit settings for `db:generate`: the identity schema only, written to
// infra/db/migrations/identity/.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/data/schema.ts',
  out: '../../infra/db/migrations/identity',
  schemaFilter: ['identity'],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5433/erp',
  },
});
