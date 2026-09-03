import { Hono } from 'hono';
import { scanLibrary, getScanStatus, getNovelsDir } from '../scanner/scanner';
import { getDb } from '../database';

export const scannerRoutes = new Hono();

/** GET /api/scanner/status */
scannerRoutes.get('/status', (c) => {
  return c.json({ ...getScanStatus(), novelsDir: getNovelsDir() });
});

/** POST /api/scanner/scan */
scannerRoutes.post('/scan', async (c) => {
  try {
    // 异步执行,立即返回;状态通过 /status 轮询
    const p = scanLibrary().catch((err) => console.error('[scanner] scan failed:', err));
    // 若调用方等待(如 CI/测试),等待完成
    if (c.req.query('wait') === '1') {
      const result = await p;
      return c.json({ started: true, result });
    }
    return c.json({ started: true });
  } catch (err: any) {
    return c.json({ started: false, error: err?.message || String(err) }, 409);
  }
});