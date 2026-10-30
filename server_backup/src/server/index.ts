import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import pc from 'picocolors';
import { config } from '../config/index.js';
import { mediaRoutes } from './routes/media.routes.js';
import { workflowRoutes } from './routes/workflow.routes.js';
import { configRoutes } from './routes/config.routes.js';
import { systemRoutes } from './routes/system.routes.js';

export function createServer() {
  const app = new Hono();

  // 开启跨域资源共享 (CORS)
  app.use('*', cors());

  // 挂载模块化路由处理器
  app.route('/', mediaRoutes);
  app.route('/', workflowRoutes);
  app.route('/', configRoutes);
  app.route('/', systemRoutes);

  return app;
}

export function startServer(port: number = config.port) {
  const app = createServer();
  console.log(pc.cyan(`\n🎬 [FMV-Agent] Starting TypeScript Director Server...`));
  console.log(pc.gray(`--------------------------------------------------`));
  console.log(pc.green(`✔ Server listening on: http://${config.host}:${port}`));
  console.log(pc.yellow(`✔ Mock Mode: ${config.mockMode ? 'ENABLED (Safe dry-run)' : 'DISABLED (Live API)'}`));
  console.log(pc.blue(`✔ FFmpeg Binary: ${config.paths.ffmpeg}`));
  console.log(pc.gray(`--------------------------------------------------\n`));

  const serverInstance = serve({
    fetch: app.fetch,
    port,
    hostname: config.host,
  });

  serverInstance.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(pc.red(`\n❌ [错误] 端口 ${port} 已被占用！`));
      console.error(pc.yellow(`💡 提示：上一次运行的服务进程可能未正常关闭。您可以执行：npm run clean:port 快速释放端口。\n`));
      process.exit(1);
    } else {
      console.error(err);
    }
  });

  return serverInstance;
}
