import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import analyticsRouter from './routes/analytics.routes.js';
import { createAuthRouter } from './routes/auth.routes.js';
import customersRouter from './routes/customers.routes.js';
import machinesRouter from './routes/machines.routes.js';
import materialsRouter from './routes/materials.routes.js';
import ordersRouter from './routes/orders.routes.js';
import pricingRouter from './routes/pricing.routes.js';
import quotesRouter from './routes/quotes.routes.js';
import scheduleRouter from './routes/schedule.routes.js';
import settingsRouter from './routes/settings.routes.js';
import setupRulesRouter from './routes/setupRules.routes.js';
import templatesRouter from './routes/templates.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST_DIR = path.resolve(__dirname, '../..', 'client', 'dist');

/**
 * Create and configure the Express application instance.
 * Exported separately from server startup so Supertest can exercise all routes without binding a port.
 */
export function createApp({
  enableRateLimit = process.env.NODE_ENV !== 'test',
  serveClient = process.env.NODE_ENV === 'production',
  clientDistDir = CLIENT_DIST_DIR,
} = {}) {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
          upgradeInsecureRequests: null,
        },
      },
    })
  );
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      logger.info(
        {
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Date.now() - startedAt,
        },
        'HTTP request'
      );
    });
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'workshop-planner-api',
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/auth', createAuthRouter({ enableRateLimit }));
  app.use('/api/machines', machinesRouter);
  app.use('/api/materials', materialsRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/templates', templatesRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/setup-rules', setupRulesRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/pricing', pricingRouter);
  app.use('/api/schedule', scheduleRouter);
  app.use('/api/quotes', quotesRouter);
  app.use('/api/analytics', analyticsRouter);

  const clientIndexPath = path.join(clientDistDir, 'index.html');
  if (serveClient && fs.existsSync(clientIndexPath)) {
    app.use(express.static(clientDistDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        return next();
      }
      return res.sendFile(clientIndexPath);
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
