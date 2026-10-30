// Creates the first YuCampus team account for the platform panel, and prints a one-time link to choose a password:
//   pnpm platform:create-admin "Full Name" name@yubhian.in
// Later team members are invited from the panel. Uses DATABASE_MIGRATE_URL (the owner role), like rules:import.
import { createHash, randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { emailSchema } from '@yucampus/validation';
import { loadConfig } from '../src/config.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

const [name, rawEmail] = process.argv.slice(2);
const email = emailSchema.safeParse(rawEmail ?? '');
if (!name || name.trim().length < 2 || !email.success) {
  console.error('Usage: pnpm platform:create-admin "Full Name" name@example.com');
  process.exit(1);
}
const connectionString = process.env.DATABASE_MIGRATE_URL;
if (!connectionString) {
  console.error('DATABASE_MIGRATE_URL is not set (see .env.example).');
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const config = loadConfig();

try {
  const existing = await prisma.platformAdmin.findUnique({ where: { email: email.data } });
  if (existing) {
    console.error(`${email.data} already has a team account. Send a password link from the panel instead.`);
    process.exit(1);
  }
  const admin = await prisma.platformAdmin.create({ data: { name: name.trim(), email: email.data, status: 'invited' } });
  const token = randomBytes(32).toString('base64url');
  // Same format as PlatformAuthService links: sha256 hex of the token, 3 days, one use.
  await prisma.platformPasswordLink.create({
    data: { adminId: admin.id, purpose: 'invite', tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) },
  });
  await prisma.platformAuditLog.create({ data: { action: 'admin_invite', detail: { adminId: admin.id, email: admin.email, by: 'command line' } } });
  console.log(`Created ${admin.email}. Open this link within 3 days to choose a password (it works once):`);
  console.log(`${config.platformUrl()}/set-password?token=${token}`);
} finally {
  await prisma.$disconnect();
}
