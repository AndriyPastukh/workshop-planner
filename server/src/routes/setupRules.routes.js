import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { logAudit } from '../services/auditService.js';

const singleRuleSchema = z.object({
  machineType: z.enum(['fdm_3d', 'resin_3d', 'laser', 'cnc_wood']),
  fromMaterial: z.string().trim().min(1).max(40),
  toMaterial: z.string().trim().min(1).max(40),
  minutes: z.number().int().min(0).max(600),
});

const upsertBodySchema = z.union([
  singleRuleSchema,
  z.array(singleRuleSchema).min(1),
  z.object({ rules: z.array(singleRuleSchema).min(1) }),
]);

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rules = await prisma.setupRule.findMany({
      orderBy: [{ machineType: 'asc' }, { fromMaterial: 'asc' }, { toMaterial: 'asc' }],
    });
    res.json({ rules });
  })
);

router.put(
  '/',
  requireRole('owner'),
  validate({ body: upsertBodySchema }),
  asyncHandler(async (req, res) => {
    const list = Array.isArray(req.body)
      ? req.body
      : 'rules' in req.body
        ? req.body.rules
        : [req.body];

    const saved = await prisma.$transaction(async (tx) => {
      const results = [];
      for (const rule of list) {
        const row = await tx.setupRule.upsert({
          where: {
            machineType_fromMaterial_toMaterial: {
              machineType: rule.machineType,
              fromMaterial: rule.fromMaterial,
              toMaterial: rule.toMaterial,
            },
          },
          update: { minutes: rule.minutes },
          create: rule,
        });
        results.push(row);
      }

      await logAudit(
        {
          userId: req.user.id,
          action: 'SETUP_RULES_UPSERTED',
          entity: 'setup_rule',
          payload: { count: results.length },
        },
        tx
      );
      return results;
    });

    res.json({ rules: saved });
  })
);

router.delete(
  '/:id',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    await prisma.setupRule.delete({ where: { id: req.params.id } });
    res.json({ deleted: true, id: req.params.id });
  })
);

export default router;
