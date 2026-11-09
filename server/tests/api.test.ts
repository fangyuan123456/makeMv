/**
 * tests/api.test.ts
 * 模块化 HTTP API 接口与 Mastra 原生工作流全生命周期端到端测试
 */

process.env.NODE_ENV = 'test';

import assert from 'assert';
import http from 'http';
import { createApp } from '../src/api/app.js';
import { LLMProvider, MockLanguageModel } from '../src/llm/index.js';
import { ProjectStore } from '../src/project-store/ProjectStore.js';

async function runApiTests() {
  console.log('🧪 开始测试模块化 API 接口网关与工作流状态机...\n');
  LLMProvider.setMockModel(new MockLanguageModel());

  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. 测试健康检查
    console.log('1. 测试 GET /api/health...');
    const resHealth = await fetch(`${baseUrl}/api/health`);
    const jsonHealth = (await resHealth.json()) as any;
    assert.strictEqual(resHealth.status, 200);
    assert.strictEqual(jsonHealth.data.status, 'healthy');
    console.log('  ✅ 健康检查路由正常');

    // 2. 测试项目列表
    console.log('2. 测试 GET /api/projects...');
    const resProjects = await fetch(`${baseUrl}/api/projects`);
    assert.strictEqual(resProjects.status, 200);
    const jsonProjects = await resProjects.json();
    assert.ok(Array.isArray(jsonProjects));
    console.log('  ✅ 项目管理路由正常\n');

    // 3. 测试中枢路由流式对话接口 (POST /api/chat/:projectId)
    console.log('3. 测试中枢路由流式对话接口 POST /api/chat/:projectId...');
    const testChatPid = `test_chat_proj_${Date.now()}`;
    const resChat = await fetch(`${baseUrl}/api/chat/${testChatPid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '你好，我想设计一个谍战故事' }),
    });
    assert.strictEqual(resChat.status, 200);
    assert.strictEqual(resChat.headers.get('content-type')?.includes('text/event-stream'), true);
    const chatText = await resChat.text();
    assert.ok(chatText.includes('data:'), '必须包含 SSE data 流式数据');
    console.log('  ✅ 中枢路由流式对话与 SSE 响应正常\n');

    // 4. 测试标准工作流状态机全生命周期 (Start -> Suspend -> Resume -> Succeeded)
    console.log('4. 测试工作流状态机全生命周期...');
    const testPid = `test_wf_proj_${Date.now()}`;

    // 3.1 启动流水线
    console.log('  3.1 发起流水线: POST /api/workflow/:projectId/start...');
    const resStart = await fetch(`${baseUrl}/api/workflow/${testPid}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userPrompt: '设计一个赛博谍战互动影游' }),
    });
    const jsonStart = (await resStart.json()) as any;
    assert.strictEqual(resStart.status, 200);
    const runId = jsonStart.data.runId;
    assert.ok(runId, '必须返回 runId');
    console.log(`    ✅ 生产线启动成功 (runId: ${runId})`);

    // 稍候 100ms 等待阶段一完成进入挂起
    await new Promise((r) => setTimeout(r, 100));

    // 3.2 查询状态：必须处于挂起等待策划案审批
    console.log('  3.2 查询状态: GET /api/workflow/:projectId/:runId/state...');
    const resState1 = await fetch(`${baseUrl}/api/workflow/${testPid}/${runId}/state`);
    const jsonState1 = (await resState1.json()) as any;
    assert.strictEqual(resState1.status, 200);
    assert.strictEqual(jsonState1.data.status, 'suspended', '阶段一完成后流水线必须处于挂起状态');
    assert.strictEqual(jsonState1.data.pendingApproval?.type, 'gdd_approval');
    console.log(`    ✅ 状态机成功挂起于阶段一终点，等待创作者审批策划案`);

    // 3.3 注入第一道审批信号 (Resume GDD Approval) 推进至阶段二
    console.log('  3.3 注入审批信号: POST /api/workflow/:projectId/:runId/resume (GDD 通过)...');
    const resResume1 = await fetch(`${baseUrl}/api/workflow/${testPid}/${runId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true }),
    });
    assert.strictEqual(resResume1.status, 200);

    // 稍候 100ms 等待阶段二完成进入挂起
    await new Promise((r) => setTimeout(r, 100));

    // 3.4 查询状态：必须处于挂起等待文游试玩验收
    const resState2 = await fetch(`${baseUrl}/api/workflow/${testPid}/${runId}/state`);
    const jsonState2 = (await resState2.json()) as any;
    assert.strictEqual(jsonState2.data.status, 'suspended', '阶段二完成后流水线必须处于试玩挂起状态');
    assert.strictEqual(jsonState2.data.pendingApproval?.type, 'playtest_approval');
    console.log(`    ✅ 状态机自动推进并挂起于阶段二终点，文游就绪等待试玩验收`);

    // 3.5 注入第二道试玩通过信号 (Resume Playtest Approval) 推进至阶段三
    console.log('  3.5 注入试玩通过信号: POST /api/workflow/:projectId/:runId/resume (试玩通过)...');
    const resResume2 = await fetch(`${baseUrl}/api/workflow/${testPid}/${runId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true }),
    });
    assert.strictEqual(resResume2.status, 200);

    // 稍候 100ms 等待阶段三完成
    await new Promise((r) => setTimeout(r, 100));

    // 3.6 查询最终状态：必须全线成功完成 (succeeded)
    const resStateFinal = await fetch(`${baseUrl}/api/workflow/${testPid}/${runId}/state`);
    const jsonStateFinal = (await resStateFinal.json()) as any;
    assert.strictEqual(jsonStateFinal.data.status, 'succeeded', '全流水线最终必须处于 succeeded 状态');
    assert.strictEqual(jsonStateFinal.data.currentStage, 'completed');
    console.log(`    ✅ 全流水线圆满完成，影游视听分镜资产编译收敛！`);

    console.log('\n🎉 所有模块化 API 接口与工作流状态机测试 100% 全部通过！\n');
  } finally {
    server.close();
  }
}

runApiTests().catch((err) => {
  console.error('❌ API 测试失败:', err);
  process.exit(1);
});
