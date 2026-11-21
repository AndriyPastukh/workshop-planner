import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { conflict, forbidden } from '../lib/errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { logAudit } from '../services/auditService.js';
import {
  adjustMaterialStock,
  decorateWarehouseMaterial,
  getWarehouseMaterialById,
  listWarehouseMaterials,
  receiveMaterialStock,
} from '../services/warehouseService.js';

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

const receiptSchema = z.object({
  qty: z.number().positive('Кількість приходу має бути більшою за 0'),
  comment: z.string().trim().min(2).max(200),
});

const adjustSchema = z.object({
  deltaQty: z.number().refine((v) => v !== 0, 'deltaQty не може бути 0'),
  comment: z.string().trim().min(2).max(200),
});

const legacyAdjustSchema = z.object({
  deltaQty: z.number().refine((v) => v !== 0, 'deltaQty не може бути 0'),
  reason: z.string().trim().min(2).max(200),
});

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const warehouse = await listWarehouseMaterials();
    res.json(warehouse);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const material = await getWarehouseMaterialById(req.params.id);
    res.json({ material });
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
    res.status(201).json({ material: decorateWarehouseMaterial(material) });
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
    res.json({ material: decorateWarehouseMaterial(material) });
  })
);

router.post(
  '/:id/receipt',
  requireRole('owner', 'operator'),
  validate({ body: receiptSchema }),
  asyncHandler(async (req, res) => {
    const result = await receiveMaterialStock({
      materialId: req.params.id,
      qty: req.body.qty,
      comment: req.body.comment,
      userId: req.user.id,
    });
    res.json(result);
  })
);

router.post(
  '/:id/adjust',
  requireRole('owner'),
  validate({ body: adjustSchema }),
  asyncHandler(async (req, res) => {
    const result = await adjustMaterialStock({
      materialId: req.params.id,
      deltaQty: req.body.deltaQty,
      comment: req.body.comment,
      userId: req.user.id,
    });
    res.json(result);
  })
);

router.post(
  '/:id/adjust-stock',
  requireRole('owner', 'operator'),
  validate({ body: legacyAdjustSchema }),
  asyncHandler(async (req, res) => {
    if (req.body.deltaQty > 0) {
      const result = await receiveMaterialStock({
        materialId: req.params.id,
        qty: req.body.deltaQty,
        comment: req.body.reason,
        userId: req.user.id,
      });
      res.json(result);
      return;
    }

    if (req.user.role !== 'owner') {
      throw forbidden('Ручне зменшення або інвентаризація залишку дозволені лише власнику');
    }

    const result = await adjustMaterialStock({
      materialId: req.params.id,
      deltaQty: req.body.deltaQty,
      comment: req.body.reason,
      userId: req.user.id,
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
