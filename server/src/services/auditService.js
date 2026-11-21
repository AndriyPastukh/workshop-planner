import { prisma } from '../db.js';

/**
 * Persist an immutable audit trail entry for key state mutations.
 */
export async function logAudit({ userId = null, action, entity, entityId = null, payload = null }, tx = prisma) {
  return tx.auditLog.create({
    data: {
      userId,
      action,
      entity,
      entityId,
      payload,
    },
  });
}
