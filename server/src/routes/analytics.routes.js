import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { authenticate } from '../middleware/auth.js';
import { getAnalyticsSummary, getDashboardSummary } from '../services/analyticsService.js';

const router = Router();
router.use(authenticate);

router.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const dashboard = await getDashboardSummary();
    res.json(dashboard);
  })
);

router.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const summary = await getAnalyticsSummary();
    res.json(summary);
  })
);

export default router;
