import { prisma } from '../db.js';
import { calculateItemCost, calculateOrderTotals } from '../domain/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { logAudit } from './auditService.js';
import { getSettings } from './settingsService.js';
import {
  consumeOrderMaterials,
  finalizeOrderMaterials,
  releaseOrderMaterials,
  reserveOrderMaterials,
} from './warehouseService.js';

export const ORDER_TRANSITIONS = {
  draft: ['quoted', 'confirmed', 'cancelled'],
  quoted: ['confirmed', 'draft', 'cancelled'],
  confirmed: ['in_progress', 'cancelled'],
  in_progress: ['done', 'cancelled'],
  done: [],
  cancelled: [],
};

const ORDER_INCLUDE = {
  customer: true,
  items: {
    orderBy: { createdAt: 'asc' },
    include: {
      material: true,
      scheduleEntries: {
        include: { machine: true },
        orderBy: { start: 'asc' },
      },
    },
  },
  stockMovements: {
    include: {
      material: true,
      orderItem: { select: { id: true, title: true } },
      user: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  },
};

async function resolvePricingResources(items) {
  const settings = await getSettings();
  const materialIds = [...new Set(items.map((item) => item.materialId))];
  const [materials, machines] = await Promise.all([
    prisma.material.findMany({ where: { id: { in: materialIds } } }),
    prisma.machine.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } }),
  ]);

  const materialMap = new Map(materials.map((m) => [m.id, m]));
  const machineByType = new Map();
  for (const m of machines) {
    if (!machineByType.has(m.type)) {
      machineByType.set(m.type, m);
    }
  }

  return { settings, materialMap, machineByType };
}

function priceOrderItems({ items, isRush, settings, materialMap, machineByType }) {
  const computed = [];

  for (const item of items) {
    const material = materialMap.get(item.materialId);
    if (!material) {
      throw badRequest(`Матеріал ${item.materialId} не знайдено`, 'MATERIAL_NOT_FOUND');
    }

    const machineType = item.machineType ?? material.machineType;
    if (machineType !== material.machineType) {
      throw badRequest(
        `Матеріал «${material.name}» не сумісний із типом обладнання ${machineType}`,
        'MATERIAL_MACHINE_MISMATCH'
      );
    }

    const machine = machineByType.get(machineType);
    if (!machine) {
      throw badRequest(
        `Не знайдено активного верстата для типу ${machineType}`,
        'MACHINE_NOT_FOUND'
      );
    }

    const defaultSetupMin = settings.setupDefaults?.baseMinutes?.[machineType] ?? 15;
    const setupMin = item.setupMin ?? defaultSetupMin;
    const setupTimeH = item.setupTimeH ?? setupMin / 60;
    const failureRate = settings.failureRates?.[machineType] ?? 0;

    const calc = calculateItemCost(
      {
        qty: item.qty,
        usage: item.usage,
        runTimeH: item.runTimeH,
        setupTimeH,
        batchShare: item.batchShare ?? 1,
        prepH: item.prepH ?? 0,
        postProcessH: item.postProcessH ?? 0,
        isRush,
      },
      { pricePerUnit: material.pricePerUnit, wastePct: material.wastePct, unit: material.unit },
      { hourlyRate: machine.hourlyRate },
      {
        laborRate: settings.laborRate,
        failureRate,
        overheadPct: settings.overheadPct,
        marginPct: settings.marginPct,
        rushSurcharge: settings.rushSurcharge,
        taxPct: settings.taxPct,
        electricityRatePerKwh: settings.electricityRatePerKwh,
        volumeDiscounts: settings.volumeDiscounts ?? [],
      }
    );

    computed.push({
      input: item,
      material,
      machine,
      machineType,
      setupMin,
      plannedMaterialQty: Number((item.qty * item.usage * (1 + (material.wastePct ?? 0))).toFixed(3)),
      calc,
    });
  }

  const totals = calculateOrderTotals(computed.map((x) => x.calc));
  return { computed, totals };
}

function buildBreakdownSnapshot(calc) {
  return {
    ...calc.breakdown,
    raw: calc.raw,
    appliedRates: calc.appliedRates,
    inputs: calc.inputs,
  };
}

function attachOrderPricingSummary(order) {
  if (!order) {
    return order;
  }
  const pricingSummary = calculateOrderTotals(
    (order.items ?? []).map((item) => ({
      raw: item.pricingBreakdown?.raw,
      breakdown: item.pricingBreakdown ?? { cost: item.cost, price: item.price },
    }))
  );
  return { ...order, pricingSummary };
}

/**
 * Preview live order item and total pricing without persisting anything to DB.
 */
export async function previewPricing({ items, isRush = false }) {
  const { settings, materialMap, machineByType } = await resolvePricingResources(items);
  const { computed, totals } = priceOrderItems({
    items,
    isRush,
    settings,
    materialMap,
    machineByType,
  });

  return {
    isRush,
    items: computed.map((c) => ({
      title: c.input.title ?? c.material.name,
      machineType: c.machineType,
      materialId: c.material.id,
      materialCode: c.material.code,
      materialName: c.material.name,
      unit: c.material.unit,
      qty: c.calc.qty,
      plannedMaterialQty: c.plannedMaterialQty,
      breakdown: c.calc.breakdown,
      appliedRates: c.calc.appliedRates,
      inputs: c.calc.inputs,
    })),
    totals,
  };
}

async function generateOrderCode(tx) {
  const year = new Date().getUTCFullYear();
  const prefix = `WP-${year}-`;
  const existing = await tx.order.findMany({
    where: { code: { startsWith: prefix } },
    select: { code: true },
  });

  let maxNum = 0;
  for (const row of existing) {
    const suffix = Number.parseInt(row.code.slice(prefix.length), 10);
    if (Number.isFinite(suffix) && suffix > maxNum) {
      maxNum = suffix;
    }
  }
  return `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
}

export async function listOrders({ status, customerId, search, isRush } = {}) {
  const where = {};
  if (status) {
    where.status = status;
  }
  if (customerId) {
    where.customerId = customerId;
  }
  if (typeof isRush === 'boolean') {
    where.isRush = isRush;
  }
  if (search) {
    where.OR = [
      { code: { contains: search, mode: 'insensitive' } },
      { customer: { name: { contains: search, mode: 'insensitive' } } },
      { customer: { company: { contains: search, mode: 'insensitive' } } },
      { items: { some: { title: { contains: search, mode: 'insensitive' } } } },
    ];
  }

  return prisma.order.findMany({
    where,
    include: {
      customer: true,
      items: {
        include: { material: true },
        orderBy: { createdAt: 'asc' },
      },
      _count: { select: { items: true } },
    },
    orderBy: [{ deadline: 'asc' }, { createdAt: 'desc' }],
  });
}

export async function getOrderById(id) {
  const order = await prisma.order.findUnique({
    where: { id },
    include: ORDER_INCLUDE,
  });
  if (!order) {
    throw notFound(`Замовлення ${id} не знайдено`);
  }
  return attachOrderPricingSummary(order);
}

export async function createOrder(payload, userId = null) {
  const customer = await prisma.customer.findUnique({ where: { id: payload.customerId } });
  if (!customer) {
    throw badRequest('Клієнта не знайдено', 'CUSTOMER_NOT_FOUND');
  }

  const initialStatus = payload.status ?? 'draft';
  if (!['draft', 'quoted', 'confirmed'].includes(initialStatus)) {
    throw badRequest(
      'Нове замовлення можна створити лише зі статусом draft, quoted або confirmed',
      'INVALID_INITIAL_STATUS'
    );
  }

  const { settings, materialMap, machineByType } = await resolvePricingResources(payload.items);
  const { computed, totals } = priceOrderItems({
    items: payload.items,
    isRush: payload.isRush ?? false,
    settings,
    materialMap,
    machineByType,
  });

  return prisma.$transaction(async (tx) => {
    const code = await generateOrderCode(tx);

    const created = await tx.order.create({
      data: {
        code,
        customerId: customer.id,
        deadline: new Date(payload.deadline),
        priority: payload.priority ?? (payload.isRush ? 3 : 1),
        status: initialStatus,
        isRush: payload.isRush ?? false,
        rushSurcharge: payload.isRush ? settings.rushSurcharge : 0,
        totalCost: totals.cost,
        totalPrice: totals.price,
        notes: payload.notes ?? null,
        items: {
          create: computed.map((c) => ({
            title: c.input.title,
            machineType: c.machineType,
            materialId: c.material.id,
            color: c.input.color ?? c.material.color ?? null,
            tool: c.input.tool ?? null,
            usage: c.input.usage,
            runTimeH: c.input.runTimeH,
            prepH: c.input.prepH ?? 0,
            postProcessH: c.input.postProcessH ?? 0,
            qty: c.input.qty,
            batchShare: c.input.batchShare ?? 1,
            setupMin: c.setupMin,
            plannedMaterialQty: c.plannedMaterialQty,
            cost: c.calc.breakdown.cost,
            price: c.calc.breakdown.price,
            pricingBreakdown: buildBreakdownSnapshot(c.calc),
          })),
        },
      },
      include: ORDER_INCLUDE,
    });

    if (initialStatus === 'confirmed') {
      await reserveOrderMaterials(tx, created, userId);
    }

    await logAudit(
      {
        userId,
        action: 'ORDER_CREATED',
        entity: 'order',
        entityId: created.id,
        payload: { code: created.code, status: created.status, totalPrice: created.totalPrice },
      },
      tx
    );

    if (initialStatus === 'confirmed') {
      const refreshed = await tx.order.findUnique({ where: { id: created.id }, include: ORDER_INCLUDE });
      return attachOrderPricingSummary(refreshed);
    }

    return attachOrderPricingSummary(created);
  });
}

export async function updateOrder(id, patch, userId = null) {
  const existing = await prisma.order.findUnique({
    where: { id },
    include: ORDER_INCLUDE,
  });
  if (!existing) {
    throw notFound(`Замовлення ${id} не знайдено`);
  }
  if (existing.status === 'done' || existing.status === 'cancelled') {
    throw conflict(
      `Замовлення у фінальному статусі ${existing.status} не можна редагувати`,
      'ORDER_LOCKED_BY_STATUS'
    );
  }

  const canEditItems = existing.status === 'draft' || existing.status === 'quoted';
  if (patch.items !== undefined && !canEditItems) {
    throw conflict(
      'Редагувати позиції можна лише для чернетки або прорахунку',
      'ORDER_ITEMS_LOCKED'
    );
  }

  const nextIsRush = patch.isRush !== undefined ? patch.isRush : existing.isRush;
  const shouldReprice =
    patch.items !== undefined || (patch.isRush !== undefined && canEditItems);

  let repriced = null;
  if (shouldReprice) {
    const itemsSource =
      patch.items ??
      existing.items.map((item) => ({
        id: item.id,
        title: item.title,
        machineType: item.machineType,
        materialId: item.materialId,
        color: item.color,
        tool: item.tool,
        usage: item.usage,
        runTimeH: item.runTimeH,
        prepH: item.prepH,
        postProcessH: item.postProcessH,
        qty: item.qty,
        batchShare: item.batchShare,
        setupMin: item.setupMin,
      }));
    const resources = await resolvePricingResources(itemsSource);
    const { computed, totals } = priceOrderItems({
      items: itemsSource,
      isRush: nextIsRush,
      ...resources,
    });
    repriced = { computed, totals, rushSurcharge: resources.settings.rushSurcharge };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const data = {};
    if (patch.deadline !== undefined) {
      data.deadline = new Date(patch.deadline);
    }
    if (patch.priority !== undefined) {
      data.priority = patch.priority;
    }
    if (patch.notes !== undefined) {
      data.notes = patch.notes;
    }
    if (patch.isRush !== undefined) {
      data.isRush = patch.isRush;
    }

    if (repriced) {
      data.rushSurcharge = nextIsRush ? repriced.rushSurcharge : 0;
      data.totalCost = repriced.totals.cost;
      data.totalPrice = repriced.totals.price;

      if (patch.items !== undefined) {
        await tx.orderItem.deleteMany({ where: { orderId: id } });
        data.items = {
          create: repriced.computed.map((c) => ({
            title: c.input.title,
            machineType: c.machineType,
            materialId: c.material.id,
            color: c.input.color ?? c.material.color ?? null,
            tool: c.input.tool ?? null,
            usage: c.input.usage,
            runTimeH: c.input.runTimeH,
            prepH: c.input.prepH ?? 0,
            postProcessH: c.input.postProcessH ?? 0,
            qty: c.input.qty,
            batchShare: c.input.batchShare ?? 1,
            setupMin: c.setupMin,
            plannedMaterialQty: c.plannedMaterialQty,
            cost: c.calc.breakdown.cost,
            price: c.calc.breakdown.price,
            pricingBreakdown: buildBreakdownSnapshot(c.calc),
          })),
        };
      } else {
        for (const c of repriced.computed) {
          await tx.orderItem.update({
            where: { id: c.input.id },
            data: {
              cost: c.calc.breakdown.cost,
              price: c.calc.breakdown.price,
              pricingBreakdown: buildBreakdownSnapshot(c.calc),
            },
          });
        }
      }
    }

    const order = await tx.order.update({
      where: { id },
      data,
      include: ORDER_INCLUDE,
    });

    await logAudit(
      {
        userId,
        action: 'ORDER_UPDATED',
        entity: 'order',
        entityId: order.id,
        payload: {
          ...patch,
          itemsUpdated: patch.items !== undefined,
          totalPrice: order.totalPrice,
        },
      },
      tx
    );

    return order;
  });

  return attachOrderPricingSummary(updated);
}

/**
 * Transition order status through the validated state machine inside an ACID transaction.
 * Atomically manages material reservations, consumptions, releases, waste, and non-blocking warnings.
 */
export async function transitionOrderStatus(id, nextStatus, userId = null, options = {}) {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw`
      SELECT id FROM orders WHERE id = ${id} FOR UPDATE
    `;
    if (locked.length === 0) {
      throw notFound(`Замовлення ${id} не знайдено`);
    }

    const existing = await tx.order.findUnique({
      where: { id },
      include: ORDER_INCLUDE,
    });
    const allowed = ORDER_TRANSITIONS[existing.status] ?? [];

    if (!allowed.includes(nextStatus)) {
      throw conflict(
        `Неможливий перехід статусу: ${existing.status} → ${nextStatus}`,
        'INVALID_STATUS_TRANSITION',
        { from: existing.status, to: nextStatus, allowed }
      );
    }

    const warnings = [];

    if (nextStatus === 'confirmed') {
      warnings.push(...(await reserveOrderMaterials(tx, existing, userId)));
    } else if (nextStatus === 'in_progress') {
      warnings.push(...(await consumeOrderMaterials(tx, existing, userId)));
    } else if (nextStatus === 'cancelled') {
      const itemIds = existing.items.map((item) => item.id);
      if (itemIds.length > 0) {
        await tx.scheduleEntry.deleteMany({ where: { orderItemId: { in: itemIds } } });
      }
      await releaseOrderMaterials(tx, existing, userId);
    } else if (nextStatus === 'done') {
      warnings.push(
        ...(await finalizeOrderMaterials(tx, existing, options.actualUsages ?? [], userId))
      );
    }

    const order = await tx.order.update({
      where: { id },
      data: { status: nextStatus },
      include: ORDER_INCLUDE,
    });

    await logAudit(
      {
        userId,
        action: 'ORDER_STATUS_CHANGED',
        entity: 'order',
        entityId: order.id,
        payload: { from: existing.status, to: nextStatus, warningsCount: warnings.length },
      },
      tx
    );

    return { order: attachOrderPricingSummary(order), warnings };
  });
}

export async function deleteOrder(id, userId = null) {
  const existing = await getOrderById(id);
  if (!['draft', 'cancelled'].includes(existing.status)) {
    throw conflict(
      'Можна видаляти лише замовлення у статусі draft або cancelled',
      'ORDER_DELETE_FORBIDDEN'
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.delete({ where: { id } });
    await logAudit(
      {
        userId,
        action: 'ORDER_DELETED',
        entity: 'order',
        entityId: id,
        payload: { code: existing.code },
      },
      tx
    );
  });

  return { deleted: true, id };
}
