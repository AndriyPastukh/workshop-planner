import { prisma } from '../db.js';
import { forecastMaterialShortages, roundMoney } from '../domain/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { logAudit } from './auditService.js';

export const roundQty = (value) => Number(Number(value ?? 0).toFixed(3));

function getPlannedQty(item) {
  if (item.plannedMaterialQty > 0) {
    return roundQty(item.plannedMaterialQty);
  }
  return roundQty(item.qty * item.usage * (1 + (item.material?.wastePct ?? 0)));
}

function sortItemsByMaterial(items = []) {
  return [...items].sort((a, b) => a.materialId.localeCompare(b.materialId));
}

async function lockMaterialRow(tx, materialId) {
  const rows = await tx.$queryRaw`
    SELECT id, code, name, unit, "pricePerUnit", "wastePct", "stockQty", "reservedQty", "minStockQty"
    FROM materials
    WHERE id = ${materialId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) {
    throw notFound(`Матеріал ${materialId} не знайдено`);
  }
  return row;
}

async function computeItemReservedQty(tx, orderItemId) {
  const movements = await tx.materialStockMovement.findMany({
    where: {
      orderItemId,
      type: { in: ['reserve', 'release'] },
    },
    select: { type: true, qty: true },
  });
  let net = 0;
  for (const mv of movements) {
    net += mv.type === 'reserve' ? mv.qty : -mv.qty;
  }
  return Math.max(0, roundQty(net));
}

function evaluateMaterialWarning(material, { shortageQty = 0, reason = 'consume' } = {}) {
  const availableQty = roundQty(material.stockQty - material.reservedQty);

  if (shortageQty > 0) {
    return {
      code: 'INSUFFICIENT_STOCK',
      materialId: material.id,
      materialCode: material.code,
      materialName: material.name,
      unit: material.unit,
      remainingQty: availableQty,
      shortageQty,
      minStockQty: material.minStockQty,
      message: `Нестача матеріалу «${material.name}»: не вистачає ${shortageQty.toFixed(2)} ${material.unit}`,
    };
  }

  if (availableQty < 0) {
    return {
      code: 'INSUFFICIENT_STOCK',
      materialId: material.id,
      materialCode: material.code,
      materialName: material.name,
      unit: material.unit,
      remainingQty: availableQty,
      shortageQty: roundQty(-availableQty),
      minStockQty: material.minStockQty,
      message:
        reason === 'reserve'
          ? `Дефіцит матеріалу «${material.name}» після резерву: не вистачає ${Math.abs(availableQty).toFixed(2)} ${material.unit}`
          : `Дефіцит матеріалу «${material.name}»: доступно ${availableQty.toFixed(2)} ${material.unit}`,
    };
  }

  if (availableQty <= material.minStockQty) {
    return {
      code: 'LOW_STOCK',
      materialId: material.id,
      materialCode: material.code,
      materialName: material.name,
      unit: material.unit,
      remainingQty: availableQty,
      minStockQty: material.minStockQty,
      message: `Низький залишок «${material.name}»: доступно ${availableQty.toFixed(2)} ${material.unit} (мін. ${material.minStockQty})`,
    };
  }

  return null;
}

/**
 * Reserve planned materials when an order enters or is created in `confirmed` status.
 * Non-blocking: allows reservation even when stock is insufficient and emits warnings.
 */
export async function reserveOrderMaterials(tx, order, userId = null) {
  const warnings = [];
  for (const item of sortItemsByMaterial(order.items)) {
    const planned = getPlannedQty(item);
    if (planned <= 0) {
      continue;
    }

    const alreadyReserved = await computeItemReservedQty(tx, item.id);
    if (alreadyReserved > 0) {
      continue;
    }

    const current = await lockMaterialRow(tx, item.materialId);
    const nextReserved = roundQty(current.reservedQty + planned);

    const updatedMaterial = await tx.material.update({
      where: { id: current.id },
      data: { reservedQty: nextReserved },
    });

    await tx.materialStockMovement.create({
      data: {
        materialId: current.id,
        orderId: order.id,
        orderItemId: item.id,
        userId,
        type: 'reserve',
        qty: planned,
        comment: `Резерв під підтверджене замовлення (${order.code})`,
      },
    });

    const warning = evaluateMaterialWarning(updatedMaterial, { reason: 'reserve' });
    if (warning) {
      warnings.push(warning);
    }
  }
  return warnings;
}

/**
 * Release any active reservations and atomically deduct available stock on transition to `in_progress`.
 * Row locking ensures physical stockQty can never become negative even under concurrent transitions.
 */
export async function consumeOrderMaterials(tx, order, userId = null) {
  const warnings = [];
  for (const item of sortItemsByMaterial(order.items)) {
    const planned = getPlannedQty(item);
    const current = await lockMaterialRow(tx, item.materialId);
    const itemReserved = await computeItemReservedQty(tx, item.id);

    const releaseQty = roundQty(Math.min(current.reservedQty, itemReserved));
    const nextReserved = roundQty(Math.max(0, current.reservedQty - releaseQty));
    const deductQty = roundQty(Math.min(current.stockQty, planned));
    const shortageQty = roundQty(planned - deductQty);
    const nextStockQty = roundQty(Math.max(0, current.stockQty - deductQty));

    const updatedMaterial = await tx.material.update({
      where: { id: current.id },
      data: {
        stockQty: nextStockQty,
        reservedQty: nextReserved,
      },
    });

    await tx.orderItem.update({
      where: { id: item.id },
      data: { actualMaterialQty: deductQty },
    });

    if (releaseQty > 0) {
      await tx.materialStockMovement.create({
        data: {
          materialId: current.id,
          orderId: order.id,
          orderItemId: item.id,
          userId,
          type: 'release',
          qty: releaseQty,
          comment: `Зняття резерву при запуску в роботу (${order.code})`,
        },
      });
    }

    if (deductQty > 0) {
      await tx.materialStockMovement.create({
        data: {
          materialId: current.id,
          orderId: order.id,
          orderItemId: item.id,
          userId,
          type: 'consume',
          qty: deductQty,
          comment: `Списано у виробництво (${order.code})`,
        },
      });
    }

    const warning = evaluateMaterialWarning(updatedMaterial, { shortageQty, reason: 'consume' });
    if (warning) {
      warnings.push(warning);
    }
  }
  return warnings;
}

/**
 * Release active reservations when an order is cancelled.
 */
export async function releaseOrderMaterials(tx, order, userId = null) {
  for (const item of sortItemsByMaterial(order.items)) {
    const itemReserved = await computeItemReservedQty(tx, item.id);
    if (itemReserved <= 0) {
      continue;
    }

    const current = await lockMaterialRow(tx, item.materialId);
    const releaseQty = roundQty(Math.min(current.reservedQty, itemReserved));
    if (releaseQty <= 0) {
      continue;
    }

    await tx.material.update({
      where: { id: current.id },
      data: { reservedQty: roundQty(Math.max(0, current.reservedQty - releaseQty)) },
    });

    await tx.materialStockMovement.create({
      data: {
        materialId: current.id,
        orderId: order.id,
        orderItemId: item.id,
        userId,
        type: 'release',
        qty: releaseQty,
        comment: `Зняття резерву при скасуванні (${order.code})`,
      },
    });
  }
}

/**
 * Record final actual material usage when completing an order (`done`) and log any overrun/saving as `waste`.
 */
export async function finalizeOrderMaterials(tx, order, actualUsages = [], userId = null) {
  const warnings = [];
  const usageMap = new Map(
    actualUsages.map((u) => [u.orderItemId, roundQty(u.actualMaterialQty)])
  );

  for (const item of sortItemsByMaterial(order.items)) {
    const consumedSoFar = roundQty(item.actualMaterialQty ?? getPlannedQty(item));
    const finalActual = usageMap.has(item.id) ? usageMap.get(item.id) : consumedSoFar;
    const diff = roundQty(finalActual - consumedSoFar);

    await tx.orderItem.update({
      where: { id: item.id },
      data: { actualMaterialQty: finalActual },
    });

    if (diff === 0) {
      continue;
    }

    const current = await lockMaterialRow(tx, item.materialId);

    if (diff > 0) {
      const extraDeduct = roundQty(Math.min(current.stockQty, diff));
      const shortageQty = roundQty(diff - extraDeduct);
      const nextStockQty = roundQty(Math.max(0, current.stockQty - extraDeduct));

      const updatedMaterial = await tx.material.update({
        where: { id: current.id },
        data: { stockQty: nextStockQty },
      });

      if (extraDeduct > 0) {
        await tx.materialStockMovement.create({
          data: {
            materialId: current.id,
            orderId: order.id,
            orderItemId: item.id,
            userId,
            type: 'waste',
            qty: extraDeduct,
            comment: `Технологічні відходи за фактом виконання (${order.code})`,
          },
        });
      }

      const warning = evaluateMaterialWarning(updatedMaterial, { shortageQty, reason: 'waste' });
      if (warning) {
        warnings.push(warning);
      }
    } else {
      const returnQty = roundQty(-diff);
      await tx.material.update({
        where: { id: current.id },
        data: { stockQty: roundQty(current.stockQty + returnQty) },
      });

      await tx.materialStockMovement.create({
        data: {
          materialId: current.id,
          orderId: order.id,
          orderItemId: item.id,
          userId,
          type: 'waste',
          qty: diff,
          comment: `Економія матеріалу відносно плану (${order.code})`,
        },
      });
    }
  }

  return warnings;
}

/**
 * Atomic warehouse stock receipt (operator & owner).
 */
export async function receiveMaterialStock({ materialId, qty, comment, userId = null }) {
  const safeQty = roundQty(qty);
  if (!(safeQty > 0)) {
    throw badRequest('Кількість приходу має бути додатною', 'VALIDATION_ERROR');
  }

  return prisma.$transaction(async (tx) => {
    const current = await lockMaterialRow(tx, materialId);
    const nextQty = roundQty(current.stockQty + safeQty);

    const material = await tx.material.update({
      where: { id: current.id },
      data: { stockQty: nextQty },
    });

    const movement = await tx.materialStockMovement.create({
      data: {
        materialId: current.id,
        userId,
        type: 'receipt',
        qty: safeQty,
        comment,
      },
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    });

    await logAudit(
      {
        userId,
        action: 'MATERIAL_RECEIPT',
        entity: 'material',
        entityId: material.id,
        payload: { qty: safeQty, comment, nextStockQty: nextQty },
      },
      tx
    );

    return {
      material: decorateWarehouseMaterial(material),
      movement,
    };
  });
}

/**
 * Atomic manual stock adjustment (owner-only). Prevents negative stock using FOR UPDATE row locks.
 */
export async function adjustMaterialStock({ materialId, deltaQty, comment, userId = null }) {
  const safeDelta = roundQty(deltaQty);
  if (safeDelta === 0) {
    throw badRequest('Коригування не може дорівнювати 0', 'VALIDATION_ERROR');
  }

  return prisma.$transaction(async (tx) => {
    const current = await lockMaterialRow(tx, materialId);
    const nextQty = roundQty(current.stockQty + safeDelta);

    if (nextQty < 0) {
      throw badRequest(
        `Недостатньо залишку «${current.name}»: доступно фізично ${current.stockQty} ${current.unit}`,
        'INSUFFICIENT_STOCK'
      );
    }

    const material = await tx.material.update({
      where: { id: current.id },
      data: { stockQty: nextQty },
    });

    const movement = await tx.materialStockMovement.create({
      data: {
        materialId: current.id,
        userId,
        type: 'adjustment',
        qty: safeDelta,
        comment,
      },
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    });

    await logAudit(
      {
        userId,
        action: 'MATERIAL_STOCK_ADJUSTED',
        entity: 'material',
        entityId: material.id,
        payload: { deltaQty: safeDelta, comment, nextStockQty: nextQty },
      },
      tx
    );

    return {
      material: decorateWarehouseMaterial(material),
      movement,
    };
  });
}

export function decorateWarehouseMaterial(material, inWorkQty = 0, forecast = null) {
  const availableQty = roundQty(material.stockQty - (material.reservedQty ?? 0));
  let status = 'ok';
  if (availableQty < 0 || forecast?.hasDeficit) {
    status = 'deficit';
  } else if (availableQty <= material.minStockQty) {
    status = 'low';
  }

  return {
    ...material,
    inWorkQty: roundQty(inWorkQty),
    availableQty,
    stockValue: roundMoney(material.stockQty * material.pricePerUnit),
    status,
    isLowStock: status !== 'ok',
    forecast,
  };
}

async function computeForecastAndInWork(materials) {
  const [inProgressItems, confirmedItems] = await Promise.all([
    prisma.orderItem.findMany({
      where: { order: { status: 'in_progress' } },
      select: { materialId: true, actualMaterialQty: true, plannedMaterialQty: true },
    }),
    prisma.orderItem.findMany({
      where: { order: { status: 'confirmed' } },
      include: {
        order: { select: { id: true, code: true, deadline: true } },
        scheduleEntries: { orderBy: { start: 'asc' }, take: 1 },
      },
    }),
  ]);

  const inWorkByMaterial = new Map();
  for (const item of inProgressItems) {
    const qty = item.actualMaterialQty ?? item.plannedMaterialQty ?? 0;
    inWorkByMaterial.set(
      item.materialId,
      roundQty((inWorkByMaterial.get(item.materialId) ?? 0) + qty)
    );
  }

  const plannedForForecast = confirmedItems.map((item) => ({
    materialId: item.materialId,
    orderId: item.order.id,
    orderCode: item.order.code,
    title: item.title,
    plannedMaterialQty: item.plannedMaterialQty,
    scheduledStart:
      item.scheduleEntries?.[0]?.start?.toISOString() ?? item.order.deadline.toISOString(),
    deadline: item.order.deadline.toISOString(),
  }));

  const forecast = forecastMaterialShortages(materials, plannedForForecast);
  return { inWorkByMaterial, forecast };
}

export async function listWarehouseMaterials() {
  const materials = await prisma.material.findMany({
    orderBy: [{ machineType: 'asc' }, { name: 'asc' }],
  });

  const { inWorkByMaterial, forecast } = await computeForecastAndInWork(materials);

  const decorated = materials.map((mat) =>
    decorateWarehouseMaterial(
      mat,
      inWorkByMaterial.get(mat.id) ?? 0,
      forecast.byMaterialId[mat.id] ?? null
    )
  );

  const summary = {
    totalMaterials: decorated.length,
    totalStockValue: roundMoney(decorated.reduce((s, m) => s + m.stockValue, 0)),
    lowStockCount: decorated.filter((m) => m.status === 'low').length,
    deficitCount: decorated.filter((m) => m.status === 'deficit').length,
  };

  return {
    materials: decorated,
    shortages: forecast.shortages,
    summary,
  };
}

export async function getWarehouseMaterialById(id) {
  const material = await prisma.material.findUnique({
    where: { id },
    include: {
      stockMovements: {
        include: {
          order: { select: { id: true, code: true } },
          orderItem: { select: { id: true, title: true } },
          user: { select: { id: true, name: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      },
    },
  });
  if (!material) {
    throw notFound('Матеріал не знайдено');
  }

  const { inWorkByMaterial, forecast } = await computeForecastAndInWork([material]);
  const decorated = decorateWarehouseMaterial(
    material,
    inWorkByMaterial.get(material.id) ?? 0,
    forecast.byMaterialId[material.id] ?? null
  );

  return {
    ...decorated,
    stockMovements: material.stockMovements,
  };
}
