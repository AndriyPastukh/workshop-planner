import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { badRequest } from '../lib/errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { logAudit } from '../services/auditService.js';

const createTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  machineType: z.enum(['fdm_3d', 'resin_3d', 'laser', 'cnc_wood']),
  materialId: z.string().min(1),
  usage: z.number().nonnegative(),
  runTimeH: z.number().nonnegative(),
  prepH: z.number().nonnegative().default(0.25),
  postProcessH: z.number().nonnegative().default(0.25),
  color: z.string().trim().max(40).nullable().optional(),
  tool: z.string().trim().max(40).nullable().optional(),
  defaultQty: z.number().int().positive().default(1),
  notes: z.string().max(500).nullable().optional(),
});

const updateTemplateSchema = createTemplateSchema.partial();

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const templates = await prisma.productTemplate.findMany({
      include: { material: true },
      orderBy: { name: 'asc' },
    });
    res.json({ templates });
  })
);

router.post(
  '/',
  requireRole('owner'),
  validate({ body: createTemplateSchema }),
  asyncHandler(async (req, res) => {
    const material = await prisma.material.findUnique({ where: { id: req.body.materialId } });
    if (!material) {
      throw badRequest('Матеріал не знайдено', 'MATERIAL_NOT_FOUND');
    }
    if (material.machineType !== req.body.machineType) {
      throw badRequest('Матеріал несумісний із типом обладнання', 'MATERIAL_MACHINE_MISMATCH');
    }

    const template = await prisma.productTemplate.create({
      data: req.body,
      include: { material: true },
    });
    await logAudit({
      userId: req.user.id,
      action: 'TEMPLATE_CREATED',
      entity: 'product_template',
      entityId: template.id,
      payload: { name: template.name },
    });
    res.status(201).json({ template });
  })
);

router.patch(
  '/:id',
  requireRole('owner'),
  validate({ body: updateTemplateSchema }),
  asyncHandler(async (req, res) => {
    const template = await prisma.productTemplate.update({
      where: { id: req.params.id },
      data: req.body,
      include: { material: true },
    });
    res.json({ template });
  })
);

router.delete(
  '/:id',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    await prisma.productTemplate.delete({ where: { id: req.params.id } });
    res.json({ deleted: true, id: req.params.id });
  })
);

export default router;
