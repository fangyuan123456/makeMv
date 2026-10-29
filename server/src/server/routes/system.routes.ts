import { Hono } from 'hono';
import { config } from '../../config/index.js';

export const systemRoutes = new Hono();

// Health check
systemRoutes.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    engine: 'FMV-Agent (TypeScript)',
    version: '1.0.0',
    mockMode: config.mockMode,
    ffmpeg: config.paths.ffmpeg,
  });
});

// Pipeline task stubs (compatible with AppShell queries)
systemRoutes.get('/api/tasks', (c) => c.json({ success: true, tasks: [] }));
systemRoutes.get('/api/sandbox/tasks', (c) => c.json({ success: true, tasks: [] }));
systemRoutes.delete('/api/cache/temp', (c) => c.json({ status: 'ok', deleted: 0, freed_mb: 0 }));
