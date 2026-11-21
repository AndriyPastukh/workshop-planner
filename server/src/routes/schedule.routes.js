import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  compareScheduleStrategies,
  getSchedule,
  rebuildSchedule,
  runWhatIfSimulation,
  updateScheduleEntry,
} from '../services/plannerService.js';

const ruleEnum = z.enum(['FIFO', 'EDD', 'SPT', 'ATCS']);

const booleanQuery = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((val) => val === true || val === 'true' || val === '1');

const rebuildQuerySchema = z.object({
  rule: ruleEnum.optional(),
  k1: z.coerce.number().positive().optional(),
  k2: z.coerce.number().positive().optional(),
  startTime: z.string().optional(),
  enableBatchSplit: booleanQuery.optional(),
});

const rebuildBodySchema = z
  .object({
    rule: ruleEnum.optional(),
    k1: z.number().positive().optional(),
    k2: z.number().positive().optional(),
    startTime: z.string().optional(),
    enableBatchSplit: z.boolean().optional(),
  })
  .optional();

const whatIfBodySchema = z.object({
  rule: ruleEnum.optional(),
  k1: z.number().positive().optional(),
  k2: z.number().positive().optional(),
  startTime: z.string().optional(),
  enableBatchSplit: z.boolean().optional(),
  ignoreLocks: z.boolean().optional(),
  extraMachines: z
    .object({
      fdm_3d: z.number().int().min(0).max(5).optional(),
      resin_3d: z.number().int().min(0).max(5).optional(),
      laser: z.number().int().min(0).max(5).optional(),
      cnc_wood: z.number().int().min(0).max(5).optional(),
    })
    .optional(),
  marginPct: z.number().min(0).max(5).optional(),
  laborRate: z.number().min(0).max(50000).optional(),
  electricityRatePerKwh: z.number().min(0).max(500).optional(),
  rushSurcharge: z.number().min(0).max(5).optional(),
});

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
        enableBatchSplit: q.enableBatchSplit ?? b.enableBatchSplit ?? false,
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

router.post(
  '/what-if',
  validate({ body: whatIfBodySchema }),
  asyncHandler(async (req, res) => {
    const result = await runWhatIfSimulation(req.body ?? {});
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
