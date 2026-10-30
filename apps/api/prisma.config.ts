import path from 'node:path';
import { defineConfig } from 'prisma/config';

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../../.env'));
} catch {
  // No root .env (CI, production): variables come from the environment.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Migrations and seeding run as the owner role, which is not subject to row-level security.
    // The placeholder lets `prisma generate` run where no database is configured (CI typecheck).
    url: process.env.DATABASE_MIGRATE_URL ?? 'postgresql://placeholder:placeholder@localhost:5432/placeholder',
  },
});
