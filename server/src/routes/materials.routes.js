import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { logAudit } from '../services/auditService.js';

const machineTypeEnum = z.enum(['fdm_3d', 'resin_3d', 'laser', 'cnc_wood']);

const createMaterialSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(120),
  machineType: machineTypeEnum,
  color: z.string().trim().max(40).nullable().optional(),
  unit: z.string().trim().min(1).max(20),
  pricePerUnit: z.number().nonnegative(),
  wastePct: z.number().min(0).max(1).default(0.1),
  stockQty: z.number().nonnegative().default(0),
  minStockQty: z.number().nonnegative().default(0),
});

const updateMaterialSchema = createMaterialSchema.partial();

const adjustStockSchema = z.object({
  deltaQty: z.number().refine((v) => v !== 0, 'deltaQty не може бути 0'),
  reason: z.string().trim().min(2).max(200),
});

const router = Router();
router.use(authenticate);

function decorateMaterial(m) {
  const availableQty = Number((m.stockQty - (m.reservedQty ?? 0)).toFixed(3));
  return {
    ...m,
    availableQty,
    isLowStock: availableQty <= m.minStockQty,
  };
}

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const materials = await prisma.material.findMany({
      orderBy: [{ machineType: 'asc' }, { name: 'asc' }],
    });
    res.json({ materials: materials.map(decorateMaterial) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const material = await prisma.material.findUnique({
      where: { id: req.params.id },
      include: {
        stockMovements: {
          include: {
            order: { select: { id: true, code: true } },
            orderItem: { select: { id: true, title: true } },
            user: { select: { id: true, name: true, role: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 25,
        },
      },
    });
    if (!material) {
      throw notFound('Матеріал не знайдено');
    }
    res.json({ material: decorateMaterial(material) });
  })
);

router.post(
  '/',
  requireRole('owner'),
  validate({ body: createMaterialSchema }),
  asyncHandler(async (req, res) => {
    const material = await prisma.material.create({ data: req.body });
    await logAudit({
      userId: req.user.id,
      action: 'MATERIAL_CREATED',
      entity: 'material',
      entityId: material.id,
      payload: { code: material.code, name: material.name },
    });
    res.status(201).json({ material: decorateMaterial(material) });
  })
);

router.patch(
  '/:id',
  requireRole('owner'),
  validate({ body: updateMaterialSchema }),
  asyncHandler(async (req, res) => {
    const material = await prisma.material.update({
      where: { id: req.params.id },
      data: req.body,
    });
    await logAudit({
      userId: req.user.id,
      action: 'MATERIAL_UPDATED',
      entity: 'material',
      entityId: material.id,
      payload: req.body,
    });
    res.json({ material: decorateMaterial(material) });
  })
);

router.post(
  '/:id/adjust-stock',
  requireRole('owner', 'operator'),
  validate({ body: adjustStockSchema }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.material.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      throw notFound('Матеріал не знайдено');
    }

    const nextQty = Number((existing.stockQty + req.body.deltaQty).toFixed(3));
    if (nextQty < 0) {
      throw badRequest('Залишок не може бути від’ємним', 'INSUFFICIENT_STOCK');
    }

    const result = await prisma.$transaction(async (tx) => {
      const material = await tx.material.update({
        where: { id: existing.id },
        data: { stockQty: nextQty },
      });
      const movement = await tx.materialStockMovement.create({
        data: {
          materialId: existing.id,
          userId: req.user.id,
          type: req.body.deltaQty > 0 ? 'receipt' : 'adjustment',
          qty: req.body.deltaQty,
          comment: req.body.reason,
        },
      });
      await logAudit(
        {
          userId: req.user.id,
          action: 'MATERIAL_STOCK_ADJUSTED',
          entity: 'material',
          entityId: material.id,
          payload: req.body,
        },
        tx
      );
      return { material: decorateMaterial(material), movement };
    });

    res.json(result);
  })
);

router.delete(
  '/:id',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const usedInItems = await prisma.orderItem.count({ where: { materialId: req.params.id } });
    if (usedInItems > 0) {
      throw conflict('Матеріал використовується в замовленнях і не може бути видалений', 'MATERIAL_IN_USE');
    }
    await prisma.material.delete({ where: { id: req.params.id } });
    await logAudit({
      userId: req.user.id,
      action: 'MATERIAL_DELETED',
      entity: 'material',
      entityId: req.params.id,
    });
    res.json({ deleted: true, id: req.params.id });
  })
);

export default router;
