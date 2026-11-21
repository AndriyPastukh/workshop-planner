import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  compareScheduleStrategies,
  getSchedule,
  rebuildSchedule,
  updateScheduleEntry,
} from '../services/plannerService.js';

const ruleEnum = z.enum(['FIFO', 'EDD', 'SPT', 'ATCS']);

const rebuildQuerySchema = z.object({
  rule: ruleEnum.optional(),
  k1: z.coerce.number().positive().optional(),
  k2: z.coerce.number().positive().optional(),
  startTime: z.string().optional(),
});

const rebuildBodySchema = z
  .object({
    rule: ruleEnum.optional(),
    k1: z.number().positive().optional(),
    k2: z.number().positive().optional(),
    startTime: z.string().optional(),
  })
  .optional();

const compareQuerySchema = z.object({
  k1: z.coerce.number().positive().optional(),
  k2: z.coerce.number().positive().optional(),
  startTime: z.string().optional(),
});

const patchEntrySchema = z
  .object({
    machineId: z.string().min(1).optional(),
    start: z.string().min(8).optional(),
    locked: z.boolean().optional(),
  })
  .refine(
    (b) => b.machineId !== undefined || b.start !== undefined || b.locked !== undefined,
    'Потрібно передати хоча б одне поле: machineId, start або locked'
  );

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const schedule = await getSchedule();
    res.json(schedule);
  })
);

router.post(
  '/rebuild',
  validate({ query: rebuildQuerySchema, body: rebuildBodySchema }),
  asyncHandler(async (req, res) => {
    const q = req.validatedQuery ?? {};
    const b = req.body ?? {};
    const result = await rebuildSchedule(
      {
        rule: q.rule ?? b.rule ?? 'ATCS',
        k1: q.k1 ?? b.k1,
        k2: q.k2 ?? b.k2,
        startTime: q.startTime ?? b.startTime,
      },
      req.user.id
    );
    res.json(result);
  })
);

router.get(
  '/compare',
  validate({ query: compareQuerySchema }),
  asyncHandler(async (req, res) => {
    const result = await compareScheduleStrategies(req.validatedQuery ?? {});
    res.json(result);
  })
);

router.patch(
  '/:id',
  validate({ body: patchEntrySchema }),
  asyncHandler(async (req, res) => {
    const entry = await updateScheduleEntry(req.params.id, req.body, req.user.id);
    res.json({ entry });
  })
);

export default router;
