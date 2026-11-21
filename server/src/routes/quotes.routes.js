import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { evaluateFeasibility } from '../services/plannerService.js';

const feasibilityItemSchema = z.object({
  id: z.string().optional(),
  machineType: z.enum(['fdm_3d', 'resin_3d', 'laser', 'cnc_wood']).optional(),
  materialId: z.string().min(1).optional(),
  material: z.string().optional(),
  color: z.string().nullable().optional(),
  tool: z.string().nullable().optional(),
  processingTimeMin: z.number().positive().optional(),
  qty: z.number().int().positive().optional(),
  runTimeH: z.number().positive().optional(),
});

const feasibilityBodySchema = z.object({
  deadline: z.string().min(8),
  priority: z.number().int().min(1).max(10).default(1),
  rule: z.enum(['FIFO', 'EDD', 'SPT', 'ATCS']).default('ATCS'),
  k1: z.number().positive().optional(),
  k2: z.number().positive().optional(),
  startTime: z.string().optional(),
  items: z.array(feasibilityItemSchema).min(1),
});

const router = Router();
router.use(authenticate);

router.post(
  '/feasibility',
  validate({ body: feasibilityBodySchema }),
  asyncHandler(async (req, res) => {
    const result = await evaluateFeasibility(req.body);
    res.json(result);
  })
);

export default router;
