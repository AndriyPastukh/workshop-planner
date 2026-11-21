import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { previewPricing } from '../services/orderService.js';

const previewItemSchema = z.object({
  title: z.string().trim().max(150).optional(),
  machineType: z.enum(['fdm_3d', 'resin_3d', 'laser', 'cnc_wood']).optional(),
  materialId: z.string().min(1),
  usage: z.number().nonnegative(),
  runTimeH: z.number().nonnegative(),
  prepH: z.number().nonnegative().default(0),
  postProcessH: z.number().nonnegative().default(0),
  qty: z.number().int().positive(),
  batchShare: z.number().int().min(1).default(1),
  setupMin: z.number().nonnegative().optional(),
  setupTimeH: z.number().nonnegative().optional(),
});

const previewBodySchema = z.object({
  isRush: z.boolean().default(false),
  items: z.array(previewItemSchema).min(1),
});

const router = Router();
router.use(authenticate);

router.post(
  '/preview',
  validate({ body: previewBodySchema }),
  asyncHandler(async (req, res) => {
    const preview = await previewPricing(req.body);
    res.json(preview);
  })
);

export default router;
