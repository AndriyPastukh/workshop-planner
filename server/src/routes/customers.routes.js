import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { roundMoney } from '../domain/index.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { conflict, notFound } from '../lib/errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { logAudit } from '../services/auditService.js';

const createCustomerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email('Некоректний email').nullable().optional(),
  company: z.string().trim().max(120).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

const updateCustomerSchema = createCustomerSchema.partial();

const router = Router();
router.use(authenticate);

function computeCustomerMetrics(orders) {
  const validOrders = orders.filter((o) => o.status !== 'cancelled');
  const ordersCount = validOrders.length;
  const totalSpent = roundMoney(validOrders.reduce((sum, o) => sum + o.totalPrice, 0));
  const avgOrderValue = ordersCount > 0 ? roundMoney(totalSpent / ordersCount) : 0;
  return { ordersCount, totalSpent, avgOrderValue };
}

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const customers = await prisma.customer.findMany({
      include: {
        orders: {
          select: { id: true, status: true, totalPrice: true, deadline: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    const result = customers.map(({ orders, ...c }) => ({
      ...c,
      ...computeCustomerMetrics(orders),
    }));
    res.json({ customers: result });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        orders: {
          include: { _count: { select: { items: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!customer) {
      throw notFound('Клієнта не знайдено');
    }

    res.json({
      customer: {
        ...customer,
        ...computeCustomerMetrics(customer.orders),
      },
    });
  })
);

router.post(
  '/',
  validate({ body: createCustomerSchema }),
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.create({ data: req.body });
    await logAudit({
      userId: req.user.id,
      action: 'CUSTOMER_CREATED',
      entity: 'customer',
      entityId: customer.id,
      payload: { name: customer.name },
    });
    res.status(201).json({
      customer: { ...customer, ordersCount: 0, totalSpent: 0, avgOrderValue: 0 },
    });
  })
);

router.patch(
  '/:id',
  validate({ body: updateCustomerSchema }),
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.update({
      where: { id: req.params.id },
      data: req.body,
    });
    await logAudit({
      userId: req.user.id,
      action: 'CUSTOMER_UPDATED',
      entity: 'customer',
      entityId: customer.id,
      payload: req.body,
    });
    res.json({ customer });
  })
);

router.delete(
  '/:id',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const ordersCount = await prisma.order.count({ where: { customerId: req.params.id } });
    if (ordersCount > 0) {
      throw conflict('Неможливо видалити клієнта, у якого є замовлення', 'CUSTOMER_HAS_ORDERS');
    }
    await prisma.customer.delete({ where: { id: req.params.id } });
    await logAudit({
      userId: req.user.id,
      action: 'CUSTOMER_DELETED',
      entity: 'customer',
      entityId: req.params.id,
    });
    res.json({ deleted: true, id: req.params.id });
  })
);

export default router;
