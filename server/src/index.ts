/**
 * index.ts
 * 纯服务端启动主入口 (Bootstrap & Graceful Shutdown)
 */

import { createApp } from './api/app.js';
import { config } from './utils/config.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`=======================================================`);
  console.log(`  makeMv 工业级互动影游生成引擎 (Mastra Core)`);
  console.log(`  服务已启动: http://localhost:${config.port}`);
  console.log(`  运行环境: ${config.nodeEnv} | LLM模式: ${config.llm.provider}`);
  console.log(`=======================================================`);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n正在平滑停止服务...');
  server.close(() => {
    console.log('服务已完全关闭');
    process.exit(0);
  });
});
