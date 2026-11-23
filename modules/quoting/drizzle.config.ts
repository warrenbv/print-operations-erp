// drizzle-kit settings. `pnpm db:generate` writes the generated part of
// infra/db/migrations/quoting/ from modules/quoting/src/data/schema.ts, for the quoting schema
// only.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/data/schema.ts',
  out: '../../infra/db/migrations/quoting',
  schemaFilter: ['quoting'],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5433/erp',
  },
});
