import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createOrder,
  deleteOrder,
  getOrderById,
  listOrders,
  transitionOrderStatus,
  updateOrder,
} from '../services/orderService.js';

const statusEnum = z.enum(['draft', 'quoted', 'confirmed', 'in_progress', 'done', 'cancelled']);
const machineTypeEnum = z.enum(['fdm_3d', 'resin_3d', 'laser', 'cnc_wood']);

const orderItemInputSchema = z.object({
  title: z.string().trim().min(2).max(150),
  machineType: machineTypeEnum.optional(),
  materialId: z.string().min(1),
  color: z.string().trim().max(40).nullable().optional(),
  tool: z.string().trim().max(40).nullable().optional(),
  usage: z.number().nonnegative(),
  runTimeH: z.number().nonnegative(),
  prepH: z.number().nonnegative().default(0),
  postProcessH: z.number().nonnegative().default(0),
  qty: z.number().int().positive(),
  batchShare: z.number().int().min(1).default(1),
  setupMin: z.number().nonnegative().optional(),
  setupTimeH: z.number().nonnegative().optional(),
});

const createOrderSchema = z.object({
  customerId: z.string().min(1),
  deadline: z.string().min(8),
  priority: z.number().int().min(1).max(10).optional(),
  status: z.enum(['draft', 'quoted', 'confirmed']).optional(),
  isRush: z.boolean().default(false),
  notes: z.string().max(1000).nullable().optional(),
  items: z.array(orderItemInputSchema).min(1, 'Замовлення має містити хоча б 1 позицію'),
});

const updateOrderSchema = z.object({
  deadline: z.string().min(8).optional(),
  priority: z.number().int().min(1).max(10).optional(),
  isRush: z.boolean().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

const transitionSchema = z.object({
  status: statusEnum,
});

const listQuerySchema = z.object({
  status: statusEnum.optional(),
  customerId: z.string().optional(),
  search: z.string().optional(),
  isRush: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

const router = Router();
router.use(authenticate);

router.get(
  '/',
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const orders = await listOrders(req.validatedQuery);
    res.json({ orders });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const order = await getOrderById(req.params.id);
    res.json({ order });
  })
);

router.post(
  '/',
  validate({ body: createOrderSchema }),
  asyncHandler(async (req, res) => {
    const order = await createOrder(req.body, req.user.id);
    res.status(201).json({ order });
  })
);

router.patch(
  '/:id',
  validate({ body: updateOrderSchema }),
  asyncHandler(async (req, res) => {
    const order = await updateOrder(req.params.id, req.body, req.user.id);
    res.json({ order });
  })
);

router.patch(
  '/:id/status',
  validate({ body: transitionSchema }),
  asyncHandler(async (req, res) => {
    const result = await transitionOrderStatus(req.params.id, req.body.status, req.user.id);
    res.json(result);
  })
);

router.delete(
  '/:id',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const result = await deleteOrder(req.params.id, req.user.id);
    res.json(result);
  })
);

export default router;
