/**
 * src/index.ts
 * makeMv - Mastra 官方微内核与影视工业引擎服务启动主入口 (Canonical SSOT)
 */

import http from 'http';
import { mastra } from './mastra/index.js';
import { dispatchHttpRequest } from './api/app.js';

const PORT = process.env.PORT || 4111;

async function bootstrap() {
  console.log('====================================================');
  console.log('🎬 makeMv - Mastra 动态状态图与自由对话微内核已就绪');
  console.log('====================================================');

  const directorAgent = mastra.getAgent('directorAgent');
  console.log(`[Mastra Agent] 挂载成功: id=${directorAgent.id}, name=${directorAgent.name}`);

  const workflow = mastra.getWorkflow('pipelineWorkflow');
  console.log(`[Mastra Workflow] 挂载成功: id=${workflow.id}`);

  const server = http.createServer(dispatchHttpRequest);

  server.listen(PORT, () => {
    console.log(`\n🚀 Mastra 后端服务正在监听: http://localhost:${PORT}`);
    console.log(`📡 提供核心接口:`);
    console.log(`   - POST http://localhost:${PORT}/api/chat (自由对话、SSE流式打字机与双轨记忆落盘)`);
    console.log(`   - POST http://localhost:${PORT}/api/workflow/resume (Mastra 工作流恢复与人在回路)`);
    console.log(`   - POST http://localhost:${PORT}/api/proposals/:id/approve (安全互斥批准提案)`);
    console.log(`   - POST http://localhost:${PORT}/api/proposals/:id/reject  (驳回提案)`);
    console.log(`   - GET  http://localhost:${PORT}/api/projects/:id/graph (状态图全景拓扑与阶段隔离门禁)`);
    console.log(`   - GET  http://localhost:${PORT}/api/projects (项目列表)`);
    console.log(`   - GET  http://localhost:${PORT}/media/:projectId/* (安全防穿越媒体切片托管)`);
  });

  // 优雅停机
  const handleShutdown = () => {
    console.log('\n🛑 收到停机信号，正在平滑关闭 HTTP 服务...');
    server.close(() => {
      console.log('✅ 服务已安全关闭。');
      process.exit(0);
    });
  };

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
}

bootstrap().catch((err) => {
  console.error('❌ 服务启动失败:', err);
  process.exit(1);
});
