import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

describe('GET /api/health & production SPA serving', () => {
  it('returns service health status with valid ISO timestamp', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('workshop-planner-api');
    expect(typeof res.body.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });

  it('returns 404 JSON NOT_FOUND for unknown /api routes even when serving client build', async () => {
    const app = createApp({ serveClient: true });
    const res = await request(app).get('/api/nonexistent-endpoint');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('serves built SPA index.html for non-API routes when serveClient is true', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-dist-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'index.html'),
        '<!doctype html><html><head><script src="/theme-init.js"></script></head><body>SPA</body></html>'
      );

      const app = createApp({ serveClient: true, clientDistDir: tmpDir });
      const res = await request(app).get('/what-if');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('/theme-init.js');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
