import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { DEFAULT_CALENDAR, calculateMachineHourlyRate } from '../domain/index.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { logAudit } from '../services/auditService.js';
import { getSettings } from '../services/settingsService.js';

const machineTypeEnum = z.enum(['fdm_3d', 'resin_3d', 'laser', 'cnc_wood']);

const calendarSchema = z
  .object({
    workDays: z.array(z.number().int().min(0).max(6)).min(1),
    shiftStartHour: z.number().min(0).max(23),
    shiftEndHour: z.number().min(1).max(24),
    holidays: z.array(z.string()).default([]),
  })
  .refine((c) => c.shiftEndHour > c.shiftStartHour, {
    message: 'shiftEndHour must be greater than shiftStartHour',
  });

const createMachineSchema = z.object({
  name: z.string().trim().min(2).max(100),
  type: machineTypeEnum,
  hourlyRate: z.number().nonnegative().optional(),
  depreciationPerH: z.number().nonnegative().default(0),
  powerKw: z.number().nonnegative().default(0),
  calendar: calendarSchema.default(DEFAULT_CALENDAR),
  isActive: z.boolean().default(true),
  notes: z.string().max(500).nullable().optional(),
});

const updateMachineSchema = createMachineSchema.partial();

const maintenanceSchema = z
  .object({
    title: z.string().trim().min(2).max(150),
    start: z.string().datetime({ offset: true }).or(z.string().min(10)),
    end: z.string().datetime({ offset: true }).or(z.string().min(10)),
    notes: z.string().max(500).nullable().optional(),
  })
  .refine((w) => new Date(w.end) > new Date(w.start), {
    message: 'Час завершення обслуговування має бути пізнішим за початок',
  });

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const machines = await prisma.machine.findMany({
      include: {
        maintenanceWindows: { orderBy: { start: 'asc' } },
        _count: { select: { scheduleEntries: true } },
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });
    res.json({ machines });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const machine = await prisma.machine.findUnique({
      where: { id: req.params.id },
      include: {
        maintenanceWindows: { orderBy: { start: 'asc' } },
        scheduleEntries: { orderBy: { start: 'asc' }, take: 20 },
      },
    });
    if (!machine) {
      throw notFound('Верстат не знайдено');
    }
    res.json({ machine });
  })
);

router.post(
  '/',
  requireRole('owner'),
  validate({ body: createMachineSchema }),
  asyncHandler(async (req, res) => {
    const data = { ...req.body };
    if (data.hourlyRate === undefined) {
      const settings = await getSettings();
      data.hourlyRate = calculateMachineHourlyRate({
        depreciationPerH: data.depreciationPerH,
        powerKw: data.powerKw,
        electricityRatePerKwh: settings.electricityRatePerKwh,
      });
    }

    const machine = await prisma.machine.create({
      data,
      include: { maintenanceWindows: true },
    });

    await logAudit({
      userId: req.user.id,
      action: 'MACHINE_CREATED',
      entity: 'machine',
      entityId: machine.id,
      payload: { name: machine.name, type: machine.type },
    });

    res.status(201).json({ machine });
  })
);

router.patch(
  '/:id',
  requireRole('owner'),
  validate({ body: updateMachineSchema }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.machine.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      throw notFound('Верстат не знайдено');
    }

    const patch = { ...req.body };
    if (
      patch.hourlyRate === undefined &&
      (patch.depreciationPerH !== undefined || patch.powerKw !== undefined)
    ) {
      const settings = await getSettings();
      patch.hourlyRate = calculateMachineHourlyRate({
        depreciationPerH: patch.depreciationPerH ?? existing.depreciationPerH,
        powerKw: patch.powerKw ?? existing.powerKw,
        electricityRatePerKwh: settings.electricityRatePerKwh,
      });
    }

    const machine = await prisma.machine.update({
      where: { id: req.params.id },
      data: patch,
      include: { maintenanceWindows: { orderBy: { start: 'asc' } } },
    });

    await logAudit({
      userId: req.user.id,
      action: 'MACHINE_UPDATED',
      entity: 'machine',
      entityId: machine.id,
      payload: patch,
    });

    res.json({ machine });
  })
);

router.delete(
  '/:id',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const refs = await prisma.scheduleEntry.count({ where: { machineId: req.params.id } });
    if (refs > 0) {
      throw conflict(
        'Верстат використовується у розкладі; спершу деактивуйте його або переплануйте чергу',
        'MACHINE_IN_USE'
      );
    }

    await prisma.machine.delete({ where: { id: req.params.id } });
    await logAudit({
      userId: req.user.id,
      action: 'MACHINE_DELETED',
      entity: 'machine',
      entityId: req.params.id,
    });

    res.json({ deleted: true, id: req.params.id });
  })
);

router.post(
  '/:id/maintenance',
  requireRole('owner'),
  validate({ body: maintenanceSchema }),
  asyncHandler(async (req, res) => {
    const machine = await prisma.machine.findUnique({ where: { id: req.params.id } });
    if (!machine) {
      throw notFound('Верстат не знайдено');
    }

    const start = new Date(req.body.start);
    const end = new Date(req.body.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw badRequest('Некоректний формат дати');
    }

    const window = await prisma.maintenanceWindow.create({
      data: {
        machineId: machine.id,
        title: req.body.title,
        start,
        end,
        notes: req.body.notes ?? null,
      },
    });

    await logAudit({
      userId: req.user.id,
      action: 'MAINTENANCE_CREATED',
      entity: 'maintenance_window',
      entityId: window.id,
      payload: { machineId: machine.id, title: window.title },
    });

    res.status(201).json({ maintenanceWindow: window });
  })
);

router.delete(
  '/:id/maintenance/:windowId',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const window = await prisma.maintenanceWindow.findFirst({
      where: { id: req.params.windowId, machineId: req.params.id },
    });
    if (!window) {
      throw notFound('Вікно обслуговування не знайдено');
    }

    await prisma.maintenanceWindow.delete({ where: { id: window.id } });
    res.json({ deleted: true, id: window.id });
  })
);

export default router;
