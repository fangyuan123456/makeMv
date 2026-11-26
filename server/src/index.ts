/**
 * index.ts
 * 纯服务端启动主入口 (Bootstrap & Graceful Shutdown)
 */

import { createApp } from './api/app.js';
import { config } from './utils/config.js';
import { taskDispatcher } from './task-engine/index.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`=======================================================`);
  console.log(`  makeMv 工业级互动影游生成引擎 (Mastra Core)`);
  console.log(`  服务已启动: http://localhost:${config.port}`);
  console.log(`  运行环境: ${config.nodeEnv} | LLM模式: ${config.llm.provider}`);
  console.log(`=======================================================`);
  // 仅在端口绑定成功、确认本进程为唯一主服务实例后才执行重启任务恢复，防止双进程抢占写盘
  taskDispatcher.startRecovery();
});

server.on('error', (err: NodeJS.ErrnoException) => {
  console.error(`[FATAL server.listen] 端口 ${config.port} 启动失败:`, err.message);
  process.exit(1);
});

// 全局异常与未捕获 Promise 兜底防护，防止服务因单次未捕获异常退出
process.on('uncaughtException', (err) => {
  console.error('[FATAL uncaughtException] 未捕获异常:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL unhandledRejection] 未处理的 Promise 拒绝:', reason);
});

// 优雅关闭（主动释放 SSE 等长连接，避免热重启期间新旧进程并发写盘）
let isShuttingDown = false;
function gracefulShutdown(signal: string): void {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n收到 ${signal}，正在平滑停止服务...`);
  const forceExitTimer = setTimeout(() => {
    console.warn('平滑关闭超时，强制退出旧进程');
    process.exit(0);
  }, 3000);
  forceExitTimer.unref();

  server.close(() => {
    clearTimeout(forceExitTimer);
    console.log('服务已完全关闭');
    process.exit(0);
  });
  // 主动断开 SSE 等常驻连接，避免 server.close 无限挂起
  server.closeAllConnections?.();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // live reload

