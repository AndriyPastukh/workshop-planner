import { prisma } from '../db.js';
import {
  DEFAULT_CALENDAR,
  MIN_MS,
  advanceWorkTime,
  checkFeasibility,
  compareStrategies,
  schedule,
  setupTime,
  snapToWorkTime,
  toTimestampMs,
  workMinutesBetween,
} from '../domain/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { logAudit } from './auditService.js';
import { getSettings, getSetupRulesConfig } from './settingsService.js';

function mapOrderItemToDomainJob(item, order) {
  return {
    id: item.id,
    orderId: order.id,
    orderCode: order.code,
    machineType: item.machineType,
    material: item.material.code,
    color: item.color ?? item.material.color ?? null,
    tool: item.tool ?? null,
    processingTimeMin: Math.max(15, Math.round(item.qty * item.runTimeH * 60)),
    deadline: order.deadline.toISOString(),
    priority: order.priority,
  };
}

async function loadPlanningContext() {
  const [machines, orders, settings, rulesConfig, lockedRows] = await Promise.all([
    prisma.machine.findMany({
      where: { isActive: true },
      include: { maintenanceWindows: { orderBy: { start: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.order.findMany({
      where: { status: { in: ['confirmed', 'in_progress'] } },
      include: {
        customer: true,
        items: { include: { material: true }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: [{ deadline: 'asc' }, { createdAt: 'asc' }],
    }),
    getSettings(),
    getSetupRulesConfig(),
    prisma.scheduleEntry.findMany({
      where: { locked: true },
      orderBy: { start: 'asc' },
    }),
  ]);

  const domainMachines = machines.map((m) => ({
    id: m.id,
    name: m.name,
    type: m.type,
    calendar: m.calendar ?? DEFAULT_CALENDAR,
    maintenanceWindows: m.maintenanceWindows ?? [],
  }));

  const activeJobs = [];
  const orderCodeByOrderId = new Map();
  for (const order of orders) {
    orderCodeByOrderId.set(order.id, order.code);
    for (const item of order.items) {
      activeJobs.push(mapOrderItemToDomainJob(item, order));
    }
  }

  const activeJobIds = new Set(activeJobs.map((j) => j.id));
  const lockedWindows = lockedRows
    .filter((entry) => activeJobIds.has(entry.orderItemId))
    .map((entry) => ({
      jobId: entry.orderItemId,
      machineId: entry.machineId,
      setupStart: entry.setupStart.toISOString(),
      setupEnd: entry.setupEnd.toISOString(),
      start: entry.start.toISOString(),
      end: entry.end.toISOString(),
      setupMin: entry.setupMin,
    }));

  return {
    machines,
    domainMachines,
    activeJobs,
    orderCodeByOrderId,
    settings,
    rulesConfig,
    lockedWindows,
  };
}

function summarizePersistedSchedule(entries, machines) {
  const totalJobs = entries.length;
  const lateCount = entries.filter((e) => e.tardinessMin > 0).length;
  const totalTardinessMin = entries.reduce((sum, e) => sum + e.tardinessMin, 0);
  const maxTardinessMin = entries.reduce((max, e) => Math.max(max, e.tardinessMin), 0);
  const totalSetupMin = entries.reduce((sum, e) => sum + e.setupMin, 0);
  const totalProcessingMin = entries.reduce((sum, e) => sum + e.processingMin, 0);

  let minStartMs = Infinity;
  let maxEndMs = -Infinity;
  for (const e of entries) {
    minStartMs = Math.min(minStartMs, e.setupStart.getTime());
    maxEndMs = Math.max(maxEndMs, e.end.getTime());
  }
  const makespanMin =
    entries.length > 0 && Number.isFinite(minStartMs)
      ? Math.max(0, Math.round((maxEndMs - minStartMs) / MIN_MS))
      : 0;

  const utilizationByMachine = {};
  for (const machine of machines) {
    const machineEntries = entries.filter((e) => e.machineId === machine.id);
    if (machineEntries.length === 0) {
      utilizationByMachine[machine.id] = 0;
      continue;
    }
    const busyProcMin = machineEntries.reduce((sum, e) => sum + e.processingMin, 0);
    const horizonWorkMin = Math.max(
      workMinutesBetween(minStartMs, maxEndMs, machine.calendar),
      busyProcMin
    );
    utilizationByMachine[machine.id] =
      horizonWorkMin > 0 ? Number((busyProcMin / horizonWorkMin).toFixed(4)) : 0;
  }

  const utilValues = Object.values(utilizationByMachine);
  const avgUtilization =
    utilValues.length > 0
      ? Number((utilValues.reduce((sum, u) => sum + u, 0) / utilValues.length).toFixed(4))
      : 0;

  return {
    totalJobs,
    scheduledJobs: totalJobs,
    unscheduledJobs: 0,
    lateCount,
    totalTardinessMin,
    maxTardinessMin,
    totalSetupMin,
    totalProcessingMin,
    makespanMin,
    utilizationByMachine,
    avgUtilization,
  };
}

function getDefaultStartTimeMs(lockedWindows) {
  const nowSnap = snapToWorkTime(Date.now(), DEFAULT_CALENDAR);
  if (lockedWindows.length === 0) {
    return nowSnap;
  }
  const earliestLocked = lockedWindows.reduce(
    (min, l) => Math.min(min, toTimestampMs(l.setupStart)),
    Infinity
  );
  return Math.min(nowSnap, earliestLocked);
}

/**
 * Retrieve persisted production schedule entries hydrated with order, item, material, and machine details.
 */
export async function getSchedule() {
  const [machines, entries] = await Promise.all([
    prisma.machine.findMany({
      where: { isActive: true },
      include: { maintenanceWindows: { orderBy: { start: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.scheduleEntry.findMany({
      include: {
        machine: true,
        orderItem: {
          include: {
            material: true,
            order: { include: { customer: true } },
          },
        },
      },
      orderBy: [{ start: 'asc' }, { setupStart: 'asc' }],
    }),
  ]);

  return {
    machines,
    entries,
    metrics: summarizePersistedSchedule(entries, machines),
  };
}

/**
 * Rebuild the active production queue using a chosen dispatching rule while preserving locked entries.
 */
export async function rebuildSchedule(
  { rule = 'ATCS', k1, k2, startTime } = {},
  userId = null
) {
  const ctx = await loadPlanningContext();
  const effectiveK1 = k1 ?? ctx.settings.atcsK1 ?? 2.0;
  const effectiveK2 = k2 ?? ctx.settings.atcsK2 ?? 0.5;
  const effectiveStartMs = startTime
    ? toTimestampMs(startTime)
    : getDefaultStartTimeMs(ctx.lockedWindows);

  const plan = schedule(ctx.activeJobs, ctx.domainMachines, ctx.rulesConfig, {
    rule,
    k1: effectiveK1,
    k2: effectiveK2,
    startTime: effectiveStartMs,
    locked: ctx.lockedWindows,
  });

  const lockedJobIds = new Set(ctx.lockedWindows.map((l) => l.jobId));

  await prisma.$transaction(async (tx) => {
    // Delete all unlocked entries (and any stale locked entries whose orders are no longer active).
    await tx.scheduleEntry.deleteMany({
      where: {
        OR: [{ locked: false }, { orderItemId: { notIn: [...lockedJobIds] } }],
      },
    });

    const toCreate = plan.entries
      .filter((entry) => !lockedJobIds.has(entry.jobId))
      .map((entry) => ({
        orderItemId: entry.jobId,
        machineId: entry.machineId,
        setupStart: new Date(entry.setupStart),
        setupEnd: new Date(entry.setupEnd),
        start: new Date(entry.start),
        end: new Date(entry.end),
        setupMin: entry.setupMin,
        processingMin: entry.processingMin,
        latenessMin: entry.latenessMin,
        tardinessMin: entry.tardinessMin,
        locked: false,
        ruleUsed: rule,
      }));

    if (toCreate.length > 0) {
      await tx.scheduleEntry.createMany({ data: toCreate });
    }

    await logAudit(
      {
        userId,
        action: 'SCHEDULE_REBUILT',
        entity: 'schedule',
        payload: {
          rule,
          k1: effectiveK1,
          k2: effectiveK2,
          scheduledJobs: plan.entries.length,
          lateCount: plan.metrics.lateCount,
          totalSetupMin: plan.metrics.totalSetupMin,
        },
      },
      tx
    );
  });

  const persisted = await getSchedule();
  return {
    ...persisted,
    rule,
    unscheduled: plan.unscheduled,
  };
}

/**
 * Manually move a schedule entry to another slot/machine or toggle its locked state.
 * Rejects overlapping intervals on the target machine with 409 SCHEDULE_CONFLICT.
 */
export async function updateScheduleEntry(entryId, patch, userId = null) {
  const existing = await prisma.scheduleEntry.findUnique({
    where: { id: entryId },
    include: {
      machine: true,
      orderItem: { include: { material: true, order: true } },
    },
  });

  if (!existing) {
    throw notFound(`Запис розкладу ${entryId} не знайдено`);
  }

  let targetMachine = existing.machine;
  if (patch.machineId && patch.machineId !== existing.machineId) {
    targetMachine = await prisma.machine.findUnique({ where: { id: patch.machineId } });
    if (!targetMachine || !targetMachine.isActive) {
      throw notFound(`Верстат ${patch.machineId} не знайдено або неактивний`);
    }
    if (targetMachine.type !== existing.orderItem.machineType) {
      throw badRequest(
        `Верстат «${targetMachine.name}» (${targetMachine.type}) несумісний із позицією (${existing.orderItem.machineType})`,
        'MACHINE_TYPE_MISMATCH'
      );
    }
  }

  const updateData = {};
  if (patch.locked !== undefined) {
    updateData.locked = patch.locked;
  }

  if (patch.start !== undefined || (patch.machineId && patch.machineId !== existing.machineId)) {
    const calendar = targetMachine.calendar ?? DEFAULT_CALENDAR;
    const requestedStartMs = patch.start
      ? toTimestampMs(patch.start)
      : existing.start.getTime();
    const newStartMs = snapToWorkTime(requestedStartMs, calendar);

    const siblingEntries = await prisma.scheduleEntry.findMany({
      where: {
        machineId: targetMachine.id,
        id: { not: entryId },
      },
      include: {
        orderItem: { include: { material: true } },
      },
      orderBy: { start: 'asc' },
    });

    const prevEntry = siblingEntries.filter((e) => e.end.getTime() <= newStartMs).at(-1) ?? null;
    const rulesConfig = await getSetupRulesConfig();

    const prevJob = prevEntry
      ? {
          material: prevEntry.orderItem.material.code,
          color: prevEntry.orderItem.color ?? prevEntry.orderItem.material.color,
          tool: prevEntry.orderItem.tool,
        }
      : null;
    const currentJob = {
      material: existing.orderItem.material.code,
      color: existing.orderItem.color ?? existing.orderItem.material.color,
      tool: existing.orderItem.tool,
    };

    const newSetupMin = setupTime(prevJob, currentJob, targetMachine, rulesConfig);
    const newSetupStartMs = newStartMs - newSetupMin * MIN_MS;
    const newSetupEndMs = newStartMs;
    const newEndMs = advanceWorkTime(newStartMs, existing.processingMin, calendar);

    const overlap = siblingEntries.find(
      (other) => newSetupStartMs < other.end.getTime() && newEndMs > other.setupStart.getTime()
    );
    if (overlap) {
      throw conflict(
        'Обраний інтервал перетинається з іншою роботою на верстаті',
        'SCHEDULE_CONFLICT',
        {
          conflictingEntryId: overlap.id,
          conflictStart: overlap.setupStart.toISOString(),
          conflictEnd: overlap.end.toISOString(),
        }
      );
    }

    const dueMs = existing.orderItem.order.deadline.getTime();
    const latenessMin = Math.round((newEndMs - dueMs) / MIN_MS);
    const tardinessMin = Math.max(0, latenessMin);

    updateData.machineId = targetMachine.id;
    updateData.setupStart = new Date(newSetupStartMs);
    updateData.setupEnd = new Date(newSetupEndMs);
    updateData.start = new Date(newStartMs);
    updateData.end = new Date(newEndMs);
    updateData.setupMin = newSetupMin;
    updateData.latenessMin = latenessMin;
    updateData.tardinessMin = tardinessMin;
  }

  const updated = await prisma.scheduleEntry.update({
    where: { id: entryId },
    data: updateData,
    include: {
      machine: true,
      orderItem: {
        include: {
          material: true,
          order: { include: { customer: true } },
        },
      },
    },
  });

  await logAudit({
    userId,
    action: 'SCHEDULE_ENTRY_UPDATED',
    entity: 'schedule_entry',
    entityId: updated.id,
    payload: patch,
  });

  return updated;
}

/**
 * Compare FIFO, EDD, SPT, and ATCS on the current active DB queue without persisting changes.
 */
export async function compareScheduleStrategies({ k1, k2, startTime } = {}) {
  const ctx = await loadPlanningContext();
  const effectiveK1 = k1 ?? ctx.settings.atcsK1 ?? 2.0;
  const effectiveK2 = k2 ?? ctx.settings.atcsK2 ?? 0.5;
  const effectiveStartMs = startTime
    ? toTimestampMs(startTime)
    : getDefaultStartTimeMs(ctx.lockedWindows);

  const comparison = compareStrategies(ctx.activeJobs, ctx.domainMachines, ctx.rulesConfig, {
    k1: effectiveK1,
    k2: effectiveK2,
    startTime: effectiveStartMs,
    locked: ctx.lockedWindows,
  });

  return {
    activeJobsCount: ctx.activeJobs.length,
    strategies: comparison.strategies,
    bestByTardiness: comparison.bestByTardiness,
    bestBySetup: comparison.bestBySetup,
  };
}

/**
 * Evaluate feasibility of accepting a hypothetical new order into the live queue (read-only).
 */
export async function evaluateFeasibility({ deadline, priority, items, rule, k1, k2, startTime }) {
  const ctx = await loadPlanningContext();
  const materialIds = [...new Set(items.map((item) => item.materialId).filter(Boolean))];
  const materials =
    materialIds.length > 0
      ? await prisma.material.findMany({ where: { id: { in: materialIds } } })
      : [];
  const materialMap = new Map(materials.map((m) => [m.id, m]));

  const normalizedItems = items.map((item, idx) => {
    const mat = item.materialId ? materialMap.get(item.materialId) : null;
    if (item.materialId && !mat) {
      throw badRequest(`Матеріал ${item.materialId} не знайдено`, 'MATERIAL_NOT_FOUND');
    }

    const machineType = item.machineType ?? mat?.machineType;
    if (!machineType) {
      throw badRequest('Не вказано тип верстата або матеріал позиції', 'VALIDATION_ERROR');
    }

    const processingTimeMin =
      item.processingTimeMin ?? Math.max(15, Math.round((item.qty ?? 1) * (item.runTimeH ?? 1) * 60));

    return {
      id: item.id ?? `quote-item-${idx + 1}`,
      machineType,
      material: item.material ?? mat?.code ?? 'UNKNOWN',
      color: item.color ?? mat?.color ?? null,
      tool: item.tool ?? null,
      processingTimeMin,
    };
  });

  const effectiveK1 = k1 ?? ctx.settings.atcsK1 ?? 2.0;
  const effectiveK2 = k2 ?? ctx.settings.atcsK2 ?? 0.5;
  const effectiveStartMs = startTime
    ? toTimestampMs(startTime)
    : getDefaultStartTimeMs(ctx.lockedWindows);

  const result = checkFeasibility(
    ctx.activeJobs,
    {
      id: 'NEW_QUOTE',
      deadline: new Date(deadline).toISOString(),
      priority: priority ?? 1,
      items: normalizedItems,
    },
    ctx.domainMachines,
    ctx.rulesConfig,
    {
      rule: rule ?? 'ATCS',
      k1: effectiveK1,
      k2: effectiveK2,
      startTime: effectiveStartMs,
      locked: ctx.lockedWindows,
      baseRushSurcharge: ctx.settings.rushSurcharge ?? 0.25,
    }
  );

  const enrichOrderCode = (row) => ({
    ...row,
    orderCode: ctx.orderCodeByOrderId.get(row.orderId) ?? row.orderId,
  });

  return {
    ...result,
    shiftedOrders: result.shiftedOrders.map(enrichOrderCode),
    newlyDelayedOrders: result.newlyDelayedOrders.map(enrichOrderCode),
  };
}
