// Loads criteria templates and register definitions: pnpm rules:import rules/naac-raf-affiliated.json rules/registers/*.json
// Uses DATABASE_MIGRATE_URL (the owner role), because the app itself can only read rules.
import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { importRegister, isRegisterFile } from '../src/rules/import-register.js';
import { TemplateImportError, importTemplate } from '../src/rules/import-template.js';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: pnpm rules:import <template.json> [more.json …]');
  process.exit(1);
}
const connectionString = process.env.DATABASE_MIGRATE_URL;
if (!connectionString) {
  console.error('DATABASE_MIGRATE_URL is not set (see .env.example).');
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

let failed = false;
for (const file of files) {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (isRegisterFile(raw)) {
      const result = await importRegister(prisma, raw);
      console.log(`${file}: ${result.created ? 'added' : 'updated'} · register with ${result.fields} fields`);
    } else {
      const result = await importTemplate(prisma, raw);
      console.log(`${file}: ${result.created ? 'added' : 'updated'} · ${result.criteria} criteria · ${result.metrics} metrics`);
    }
  } catch (error) {
    failed = true;
    console.error(`${file}: ${error instanceof TemplateImportError || error instanceof SyntaxError ? error.message : String(error)}`);
  }
}
await prisma.$disconnect();
process.exit(failed ? 1 : 0);
