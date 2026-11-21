import express from 'express';

/**
 * Create and configure the Express application instance.
 * Exported separately from server startup so tests can run against it without binding a port.
 */
export function createApp() {
  const app = express();

  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'workshop-planner-api',
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}
