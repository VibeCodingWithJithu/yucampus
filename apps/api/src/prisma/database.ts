import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { seed } from './seed-data.js';

export interface Database {
  client: PrismaClient;
  close(): Promise<void>;
}

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../prisma/migrations');

export async function openDatabase(databaseUrl: string): Promise<Database> {
  if (databaseUrl.startsWith('pglite:')) {
    return openLocalDatabase({ dataDir: databaseUrl.slice('pglite:'.length) || undefined });
  }
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  return { client, close: () => client.$disconnect() };
}

/**
 * An in-process Postgres (PGlite) for local work without Docker, and for tests. It runs the same migration
 * files as a real server, then drops to the yucampus_app role so row-level security applies exactly as it
 * does in production.
 *
 * `setup` runs once as the owner role, before the switch. By default it seeds the sample college.
 */
export async function openLocalDatabase(
  options: { dataDir?: string; setup?: (owner: PrismaClient) => Promise<void> } = {},
): Promise<Database> {
  // Loaded only here so a production server never needs these packages in memory.
  const { PGlite } = await import('@electric-sql/pglite');
  const { PrismaPGlite } = await import('pglite-prisma-adapter');

  if (options.dataDir) mkdirSync(options.dataDir, { recursive: true });
  const pglite = new PGlite(options.dataDir);

  await pglite.exec(`
    CREATE SCHEMA IF NOT EXISTS local_dev;
    CREATE TABLE IF NOT EXISTS local_dev.migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
  `);
  const applied = await pglite.query<{ name: string }>('SELECT name FROM local_dev.migrations');
  const done = new Set(applied.rows.map((row) => row.name));
  const pending = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !done.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const name of pending) {
    await pglite.transaction(async (tx) => {
      await tx.exec(readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'));
      await tx.query('INSERT INTO local_dev.migrations (name) VALUES ($1)', [name]);
    });
  }

  const client = new PrismaClient({ adapter: new PrismaPGlite(pglite) });
  await (options.setup ?? seed)(client);
  await pglite.exec('SET ROLE yucampus_app');

  return {
    client,
    close: async () => {
      await client.$disconnect();
      if (!pglite.closed) await pglite.close();
    },
  };
}
