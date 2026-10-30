import { Hono } from 'hono';
import { config } from '../../config/index.js';

export const systemRoutes = new Hono();

// 系统健康检查与存活探测接口
systemRoutes.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    engine: 'FMV-Agent (TypeScript)',
    version: '1.0.0',
    mockMode: config.mockMode,
    ffmpeg: config.paths.ffmpeg,
  });
});

// 流水线任务存根接口（兼容前端 AppShell 轮询查询）
systemRoutes.get('/api/tasks', (c) => c.json({ success: true, tasks: [] }));
systemRoutes.get('/api/sandbox/tasks', (c) => c.json({ success: true, tasks: [] }));
systemRoutes.delete('/api/cache/temp', (c) => c.json({ status: 'ok', deleted: 0, freed_mb: 0 }));
