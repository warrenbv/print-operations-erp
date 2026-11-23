// drizzle-kit settings that generate this module's migrations from src/data/schema.ts into
// infra/db/migrations/crm, limited to the crm schema: docs/decisions/010-orm-spike.md.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/data/schema.ts',
  out: '../../infra/db/migrations/crm',
  schemaFilter: ['crm'],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5433/erp',
  },
});
