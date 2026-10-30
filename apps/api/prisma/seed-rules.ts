// Run with: pnpm db:rules  (loads the rules files into the database named by DATABASE_MIGRATE_URL)
// For production: no sample college, no sample team account, no demo template. Safe to run again after updates.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { seedRules } from '../src/prisma/seed-data.js';

const connectionString = process.env.DATABASE_MIGRATE_URL;
if (!connectionString) throw new Error('DATABASE_MIGRATE_URL is not set.');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

seedRules(prisma, { demo: false })
  .then(({ frameworkIds, templates }) => {
    console.log(`Loaded ${frameworkIds.size} frameworks and ${Object.keys(templates).length} NAAC templates.`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
