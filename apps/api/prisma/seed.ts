// Run with: pnpm db:seed  (seeds the PostgreSQL database named by DATABASE_MIGRATE_URL)
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { SAMPLE_PASSWORD, SAMPLE_SUBDOMAIN, SAMPLE_USERS, seed } from '../src/prisma/seed-data.js';

const connectionString = process.env.DATABASE_MIGRATE_URL;
if (!connectionString) throw new Error('DATABASE_MIGRATE_URL is not set.');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

seed(prisma)
  .then(() => {
    console.log(`Seeded the "${SAMPLE_SUBDOMAIN}" college with ${SAMPLE_USERS.length} users. Password: ${SAMPLE_PASSWORD}`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
