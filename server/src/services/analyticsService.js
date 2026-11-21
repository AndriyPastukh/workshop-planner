import { prisma } from '../db.js';
import { roundMoney } from '../domain/index.js';
import { getSchedule } from './plannerService.js';

/**
 * Aggregate operational KPIs for the workshop dashboard.
 */
export async function getDashboardSummary() {
  const [statusGroups, materials, upcomingOrders, scheduleData] = await Promise.all([
    prisma.order.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.material.findMany({ orderBy: { stockQty: 'asc' } }),
    prisma.order.findMany({
      where: { status: { in: ['confirmed', 'in_progress'] } },
      include: { customer: true, _count: { select: { items: true } } },
      orderBy: { deadline: 'asc' },
      take: 5,
    }),
    getSchedule(),
  ]);

  const ordersByStatus = {
    draft: 0,
    quoted: 0,
    confirmed: 0,
    in_progress: 0,
    done: 0,
    cancelled: 0,
  };
  for (const group of statusGroups) {
    ordersByStatus[group.status] = group._count._all;
  }

  const lowStockMaterials = materials
    .map((m) => {
      const availableQty = Number((m.stockQty - m.reservedQty).toFixed(3));
      return {
        id: m.id,
        code: m.code,
        name: m.name,
        unit: m.unit,
        stockQty: m.stockQty,
        reservedQty: m.reservedQty,
        availableQty,
        minStockQty: m.minStockQty,
        isNegative: availableQty < 0,
      };
    })
    .filter((m) => m.availableQty <= m.minStockQty);

  return {
    ordersByStatus,
    activeOrdersCount: ordersByStatus.confirmed + ordersByStatus.in_progress,
    scheduleKpi: scheduleData.metrics,
    lowStockCount: lowStockMaterials.length,
    lowStockMaterials,
    upcomingDeadlines: upcomingOrders,
  };
}

/**
 * Aggregate financial, machine-type, and customer profitability analytics.
 */
export async function getAnalyticsSummary() {
  const [orders, customers] = await Promise.all([
    prisma.order.findMany({
      where: { status: { notIn: ['draft', 'cancelled'] } },
      include: {
        customer: true,
        items: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.customer.findMany({
      include: {
        orders: {
          where: { status: { notIn: ['draft', 'cancelled'] } },
          select: { totalPrice: true, totalCost: true, status: true },
        },
      },
    }),
  ]);

  let totalRevenue = 0;
  let totalCost = 0;
  const byMachineTypeMap = new Map();

  for (const order of orders) {
    totalRevenue += order.totalPrice;
    totalCost += order.totalCost;

    for (const item of order.items) {
      const current = byMachineTypeMap.get(item.machineType) ?? {
        machineType: item.machineType,
        itemsCount: 0,
        totalQty: 0,
        totalRunHours: 0,
        cost: 0,
        revenue: 0,
        profit: 0,
      };

      current.itemsCount += 1;
      current.totalQty += item.qty;
      current.totalRunHours += item.qty * item.runTimeH;
      current.cost += item.cost;
      current.revenue += item.price;
      current.profit += item.price - item.cost;

      byMachineTypeMap.set(item.machineType, current);
    }
  }

  const byMachineType = [...byMachineTypeMap.values()].map((row) => ({
    ...row,
    totalRunHours: Number(row.totalRunHours.toFixed(2)),
    cost: roundMoney(row.cost),
    revenue: roundMoney(row.revenue),
    profit: roundMoney(row.profit),
  }));

  const topCustomers = customers
    .map((c) => {
      const ordersCount = c.orders.length;
      const totalSpent = roundMoney(c.orders.reduce((s, o) => s + o.totalPrice, 0));
      const avgOrderValue = ordersCount > 0 ? roundMoney(totalSpent / ordersCount) : 0;
      return {
        id: c.id,
        name: c.name,
        company: c.company,
        ordersCount,
        totalSpent,
        avgOrderValue,
      };
    })
    .filter((c) => c.ordersCount > 0)
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 8);

  const roundedRevenue = roundMoney(totalRevenue);
  const roundedCost = roundMoney(totalCost);
  const totalProfit = roundMoney(roundedRevenue - roundedCost);

  return {
    ordersCount: orders.length,
    totalRevenue: roundedRevenue,
    totalCost: roundedCost,
    totalProfit,
    avgMarginPct: roundedCost > 0 ? Number(((totalProfit / roundedCost) * 100).toFixed(2)) : 0,
    byMachineType,
    topCustomers,
  };
}
