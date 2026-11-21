import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { getSettings, updateSettings } from '../services/settingsService.js';

const volumeDiscountSchema = z.object({
  minQty: z.number().int().positive(),
  discountPct: z.number().min(0).lt(1),
});

const updateSettingsSchema = z.object({
  workshopName: z.string().trim().min(2).max(150).optional(),
  laborRate: z.number().nonnegative().optional(),
  electricityRatePerKwh: z.number().nonnegative().optional(),
  overheadPct: z.number().min(0).max(5).optional(),
  marginPct: z.number().min(0).max(5).optional(),
  rushSurcharge: z.number().min(0).max(2).optional(),
  taxPct: z.number().min(0).max(1).optional(),
  failureRates: z.record(z.string(), z.number().min(0).lt(1)).optional(),
  volumeDiscounts: z.array(volumeDiscountSchema).optional(),
  setupDefaults: z.record(z.string(), z.unknown()).optional(),
  atcsK1: z.number().positive().max(20).optional(),
  atcsK2: z.number().positive().max(20).optional(),
});

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const settings = await getSettings();
    res.json({ settings });
  })
);

router.patch(
  '/',
  requireRole('owner'),
  validate({ body: updateSettingsSchema }),
  asyncHandler(async (req, res) => {
    const settings = await updateSettings(req.body, req.user.id);
    res.json({ settings });
  })
);

export default router;
