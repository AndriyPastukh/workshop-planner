const roundQty = (value) => Number(Number(value ?? 0).toFixed(3));

function toTimeMs(value) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/**
 * Pure schedule-based material shortage forecast.
 * Walks chronological consumption of confirmed (unconsumed) planned work against current stock.
 */
export function forecastMaterialShortages(materials = [], plannedItems = []) {
  const groupedItems = new Map();
  for (const item of plannedItems) {
    if (!item?.materialId || !(item.plannedMaterialQty > 0)) {
      continue;
    }
    const list = groupedItems.get(item.materialId) ?? [];
    list.push(item);
    groupedItems.set(item.materialId, list);
  }

  const byMaterialId = {};
  const shortages = [];

  for (const mat of materials) {
    const matItems = [...(groupedItems.get(mat.id) ?? [])].sort(
      (a, b) => toTimeMs(a.scheduledStart ?? a.deadline) - toTimeMs(b.scheduledStart ?? b.deadline)
    );

    let balance = roundQty(mat.stockQty);
    let requiredScheduledQty = 0;
    let deficitDate = null;
    const affectedMap = new Map();

    for (const item of matItems) {
      const qty = roundQty(item.plannedMaterialQty);
      requiredScheduledQty = roundQty(requiredScheduledQty + qty);
      balance = roundQty(balance - qty);

      if (balance < 0 && deficitDate === null) {
        deficitDate = item.scheduledStart ?? item.deadline ?? null;
      }

      if (balance < 0 && item.orderId && !affectedMap.has(item.orderId)) {
        affectedMap.set(item.orderId, {
          orderId: item.orderId,
          orderCode: item.orderCode ?? item.orderId,
          title: item.title ?? '',
          date: item.scheduledStart ?? item.deadline ?? null,
        });
      }
    }

    const scheduledDeficit = balance < 0 ? roundQty(-balance) : 0;
    const reserveDeficit = roundQty(Math.max(0, (mat.reservedQty ?? 0) - mat.stockQty));
    const deficitQty = Math.max(scheduledDeficit, reserveDeficit);
    const projectedBalance = roundQty(mat.stockQty - Math.max(requiredScheduledQty, mat.reservedQty ?? 0));

    const entry = {
      materialId: mat.id,
      materialCode: mat.code,
      materialName: mat.name,
      unit: mat.unit,
      stockQty: roundQty(mat.stockQty),
      reservedQty: roundQty(mat.reservedQty ?? 0),
      requiredScheduledQty,
      projectedBalance,
      hasDeficit: deficitQty > 0,
      deficitQty,
      deficitDate: deficitQty > 0 ? deficitDate : null,
      affectedOrders: [...affectedMap.values()],
    };

    byMaterialId[mat.id] = entry;
    if (entry.hasDeficit) {
      shortages.push(entry);
    }
  }

  shortages.sort((a, b) => toTimeMs(a.deficitDate) - toTimeMs(b.deficitDate));
  return { byMaterialId, shortages };
}
