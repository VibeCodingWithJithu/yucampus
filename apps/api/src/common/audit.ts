import type { AuthUser } from '../auth/tokens.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { TenantClient } from '../prisma/prisma.service.js';

/**
 * Records who changed what (docs/ARCHITECTURE.md, "audit log"). Call it inside the same forTenant()
 * transaction as the change, so the entry and the change are saved together or not at all.
 */
export function audit(
  db: TenantClient,
  actor: AuthUser,
  entity: string,
  entityId: string,
  action: string,
  change: { before?: unknown; after?: unknown } = {},
) {
  return db.auditLog.create({
    data: {
      collegeId: actor.collegeId,
      userId: actor.id,
      entity,
      entityId,
      action,
      before: (change.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (change.after ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
