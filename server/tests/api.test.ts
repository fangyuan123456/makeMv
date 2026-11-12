/**
 * tests/api.test.ts
 * 模块化 HTTP API 接口与 Mastra 原生工作流全生命周期端到端测试
 */

process.env.NODE_ENV = 'test';

import assert from 'assert';
import http from 'http';
import { createApp } from '../src/api/app.js';
import {
  buildRouterPrompt,
  createRouterIntentTool,
  evaluateRouterIntentFunnel,
  RouterIntentSchema,
} from '../src/agents/router/index.js';
import { LLMProvider, MockLanguageModel } from '../src/llm/index.js';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { TaskStore } from '../src/workflow-engine/TaskStore.js';

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
    assert.ok(!chatText.includes('"type":"error"'), `流式返回不应包含错误事件: ${chatText}`);
    assert.ok(chatText.includes('"type":"proposal"'), '第 0 步多步路由调用必须在 SSE 中下发 proposal 事件');

    // 验证聊天记录（含导演回复与提案）已持久化落盘，可通过 GET /api/projects/:id 恢复
    const resChatProject = await fetch(`${baseUrl}/api/projects/${testChatPid}`);
    assert.strictEqual(resChatProject.status, 200);
    const chatProjectJson = (await resChatProject.json()) as any;
    assert.ok(Array.isArray(chatProjectJson.chat) && chatProjectJson.chat.length >= 2, '应落盘用户与导演两轮消息');
    assert.strictEqual(chatProjectJson.chat[0].role, 'user');
    assert.strictEqual(chatProjectJson.chat[0].content, '你好，我想设计一个谍战故事');
    assert.strictEqual(chatProjectJson.chat[1].role, 'assistant');
    assert.strictEqual(chatProjectJson.chat[1].status, 'done');
    assert.strictEqual(
      chatProjectJson.chat[1].proposal?.action,
      'propose_stage',
      '多步对话结束后必须将第 0 步提案落盘保存'
    );
    assert.strictEqual(
      chatProjectJson.chat[1].proposal?.payload?.userPrompt,
      '你好，我想设计一个谍战故事',
      '字符串化的 payload 必须经 mastra-compat 无损还原为强类型对象'
    );
    console.log('  ✅ 中枢路由流式对话、多步意图提取与会话历史落盘恢复正常\n');

    // 3B. 测试流式输出中途客户端断连（模拟刷新）➔ 后台继续 + GET /stream 无损续传
    console.log('3B. 测试流式中途断连 ➔ GET /api/chat/:projectId/stream 断线续流...');
    class SlowStreamMockModel extends MockLanguageModel {
      public async doStream() {
        const stream = new ReadableStream<any>({
          async start(controller) {
            controller.enqueue({ type: 'text-delta', textDelta: '第一段剧情设定，' });
            await new Promise((r) => setTimeout(r, 120));
            controller.enqueue({ type: 'text-delta', textDelta: '第二段高潮冲突，' });
            await new Promise((r) => setTimeout(r, 80));
            controller.enqueue({ type: 'text-delta', textDelta: '第三段收尾建议。' });
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: { promptTokens: 10, completionTokens: 20 },
            });
            controller.close();
          },
        });
        return { stream, rawCall: { rawPrompt: [], rawSettings: {} } };
      }
    }
    LLMProvider.setMockModel(new SlowStreamMockModel());
    const resumePid = `test_resume_stream_${Date.now()}`;
    const abortCtrl = new AbortController();

    try {
      const res1 = await fetch(`${baseUrl}/api/chat/${resumePid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '帮我想个大纲' }),
        signal: abortCtrl.signal,
      });
      assert.strictEqual(res1.status, 200);
      const reader1 = res1.body!.getReader();
      const decoder1 = new TextDecoder();
      let firstPart = '';
      while (true) {
        const { value, done } = await reader1.read();
        if (done) break;
        firstPart += decoder1.decode(value, { stream: true });
        if (firstPart.includes('第一段剧情设定，')) {
          abortCtrl.abort();
          break;
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') throw err;
    }

    // 模拟刷新后的新页面：检查占位记录仍在 streaming 并挂载 GET /stream 续传剩余内容
    const resMidProj = await fetch(`${baseUrl}/api/projects/${resumePid}`);
    const midProjJson = (await resMidProj.json()) as any;
    assert.strictEqual(midProjJson.chat?.[1]?.status, 'streaming', '断连后后台流应仍处于 streaming 状态');

    const res2 = await fetch(`${baseUrl}/api/chat/${resumePid}/stream`);
    assert.strictEqual(res2.status, 200);
    const streamBody2 = await res2.text();
    let resumedText = '';
    for (const line of streamBody2.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.replace(/^data:\s*/, '');
      if (payload === '[DONE]') break;
      const parsed = JSON.parse(payload);
      if (parsed.type === 'snapshot') resumedText = parsed.content || '';
      else if (parsed.type === 'text' && parsed.delta) resumedText += parsed.delta;
    }
    assert.strictEqual(
      resumedText,
      '第一段剧情设定，第二段高潮冲突，第三段收尾建议。',
      '断线续传应完整还原全部三段文本且无丢字重字'
    );

    const resFinalProj = await fetch(`${baseUrl}/api/projects/${resumePid}`);
    const finalProjJson = (await resFinalProj.json()) as any;
    assert.strictEqual(finalProjJson.chat?.[1]?.status, 'done');
    assert.strictEqual(finalProjJson.chat?.[1]?.content, '第一段剧情设定，第二段高潮冲突，第三段收尾建议。');
    LLMProvider.setMockModel(new MockLanguageModel());
    console.log('  ✅ 流式中途断连续传与落盘终态完全通过！\n');

    // 3C. 测试畸形流式 tool-call-delta（额外括号 / 裸换行 / 蛇形别名）自愈与重复历史去重
    console.log('3C. 测试 mastra-compat 流式畸形 Tool Call 自愈与对话历史严格交替...');
    let observedPromptRoles: string[] = [];
    class MalformedToolStreamMockModel extends MockLanguageModel {
      public async doStream(options: any) {
        const hasToolResult = options.prompt.some((m: any) => m.role === 'tool');
        if (!hasToolResult) {
          observedPromptRoles = options.prompt
            .filter((m: any) => m.role === 'user' || m.role === 'assistant')
            .map((m: any) => m.role);

          const brokenArgs =
            '{"action":"START_PIPELINE","target_stage":"plan_gdd","summary":"修复后的提案","payload":{"userPrompt":"深海潜艇\n密室博弈"}}}';
          const stream = new ReadableStream<any>({
            start(controller) {
              // 故意只发 tool-call-delta + finish(stop)（模拟 @ai-sdk/openai 因 isParsableJson=false 吞掉 tool-call 的真实故障）
              controller.enqueue({
                type: 'tool-call-delta',
                toolCallType: 'function',
                toolCallId: 'broken_call_1',
                toolName: 'emit_router_intent',
                argsTextDelta: brokenArgs.slice(0, 45),
              });
              controller.enqueue({
                type: 'tool-call-delta',
                toolCallType: 'function',
                toolCallId: 'broken_call_1',
                toolName: 'emit_router_intent',
                argsTextDelta: brokenArgs.slice(45),
              });
              controller.enqueue({
                type: 'finish',
                finishReason: 'stop',
                usage: { promptTokens: 10, completionTokens: 10 },
              });
              controller.close();
            },
          });
          return { stream, rawCall: { rawPrompt: [], rawSettings: {} } };
        }

        const stream = new ReadableStream<any>({
          start(controller) {
            controller.enqueue({ type: 'text-delta', textDelta: '自愈成功后的导演回复。' });
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: { promptTokens: 10, completionTokens: 10 },
            });
            controller.close();
          },
        });
        return { stream, rawCall: { rawPrompt: [], rawSettings: {} } };
      }
    }

    LLMProvider.setMockModel(new MalformedToolStreamMockModel());
    const healPid = `test_heal_intent_${Date.now()}`;
    const resHeal = await fetch(`${baseUrl}/api/chat/${healPid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '深海潜艇密室博弈',
        // 故意传入带开场空白 assistant 与重复尾部 user 的脏 history
        history: [
          { role: 'assistant', content: '' },
          { role: 'user', content: '上一轮问题' },
          { role: 'assistant', content: '上一轮回答' },
          { role: 'user', content: '深海潜艇密室博弈' },
        ],
      }),
    });
    assert.strictEqual(resHeal.status, 200);
    const healSse = await resHeal.text();
    assert.ok(healSse.includes('自愈成功后的导演回复。'), '抢救畸形 tool-call 后应顺利续出第 1 步正文');
    assert.deepStrictEqual(
      observedPromptRoles,
      ['user', 'assistant', 'user'],
      'history 中的空 assistant 与尾部重复 user 必须被清洗折叠为严格交替'
    );

    const resHealProj = await fetch(`${baseUrl}/api/projects/${healPid}`);
    const healProjJson = (await resHealProj.json()) as any;
    const repairedProposal = healProjJson.chat?.[1]?.proposal;
    assert.strictEqual(repairedProposal?.action, 'propose_stage');
    assert.strictEqual(repairedProposal?.targetStage, 'plan_gdd');
    assert.strictEqual(repairedProposal?.payload?.userPrompt, '深海潜艇\n密室博弈');
    LLMProvider.setMockModel(new MockLanguageModel());
    console.log('  ✅ mastra-compat 流式畸形 JSON 自愈与严格交替历史清洗通过！\n');

    // 3D. 测试打字发送「同意 / 生成文游」触发 approve_stage 自动立项与阶段推进
    console.log('3D. 测试对话打字输入「同意」自动识别 approve_stage 并驱动阶段一/阶段二...');
    const typedApprovePid = `test_typed_approve_${Date.now()}`;

    // 第 1 轮：提出构想 ➔ 生成 start_pipeline 待审提案
    const resIdea = await fetch(`${baseUrl}/api/chat/${typedApprovePid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '构思一个深海潜艇悬疑博弈互动文游' }),
    });
    assert.strictEqual(resIdea.status, 200);
    const ideaSse = await resIdea.text();
    assert.ok(ideaSse.includes('"type":"proposal"'), '第 1 轮应产出 start_pipeline 提案');

    // 第 2 轮：用户直接在输入框发送「同意」➔ 应自动启动阶段一并返回 type=task
    const resAgree1 = await fetch(`${baseUrl}/api/chat/${typedApprovePid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '同意',
        history: [
          { role: 'user', content: '构思一个深海潜艇悬疑博弈互动文游' },
          { role: 'assistant', content: '已为您梳理核心设定与冲突张力。' },
        ],
      }),
    });
    assert.strictEqual(resAgree1.status, 200);
    const agree1Sse = await resAgree1.text();
    assert.ok(agree1Sse.includes('"type":"task"'), '发送“同意”后 SSE 必须下发 type=task 自动开机');
    assert.ok(agree1Sse.includes('"stage":"plan_gdd"'), '阶段一启动 task.stage 必须为 plan_gdd');

    // 辅助轮询项目任务状态直到达到目标状态（避免固定 setTimeout 在慢机器上竞态）
    async function waitForTaskStageStatus(
      projectId: string,
      predicate: (tasks: any[]) => boolean,
      maxMs = 4000
    ): Promise<void> {
      const start = Date.now();
      while (Date.now() - start < maxMs) {
        const tasks = TaskStore.getInstance().listTasks(projectId);
        if (predicate(tasks)) return;
        await new Promise((r) => setTimeout(r, 30));
      }
      throw new Error(`等待项目 [${projectId}] 任务收敛超时 (${maxMs}ms)`);
    }

    // 等待 Mock 阶段一完成进入挂起状态 (gdd_approval)
    await waitForTaskStageStatus(
      typedApprovePid,
      (tasks) => tasks.some((t) => t.status === 'suspended' && t.result?.pendingApproval?.type === 'gdd_approval')
    );

    const resAfterAgree1 = await fetch(`${baseUrl}/api/projects/${typedApprovePid}`);
    const afterAgree1Json = (await resAfterAgree1.json()) as any;
    assert.strictEqual(afterAgree1Json.chat?.[1]?.proposalResolved, true, '第 1 轮待审提案应被自动标为已授权');
    assert.ok(afterAgree1Json.chat?.[3]?.taskRunId, '第 2 轮回复气泡必须持久化绑定 taskRunId');
    assert.strictEqual(afterAgree1Json.chat?.[3]?.taskStage, 'plan_gdd');

    // 第 3 轮：阶段一挂起后用户打字发送「同意，生成文游」➔ 应自动唤醒阶段二 build_text_game
    const resAgree2 = await fetch(`${baseUrl}/api/chat/${typedApprovePid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '同意，生成文游',
        history: [
          { role: 'user', content: '构思一个深海潜艇悬疑博弈互动文游' },
          { role: 'assistant', content: '已为您梳理核心设定与冲突张力。' },
          { role: 'user', content: '同意' },
          { role: 'assistant', content: '收到，即刻启动全案策划推演。' },
        ],
      }),
    });
    assert.strictEqual(resAgree2.status, 200);
    const agree2Sse = await resAgree2.text();
    assert.ok(agree2Sse.includes('"type":"task"'), '阶段一完成后发送“同意，生成文游”必须下发阶段二 task');
    assert.ok(agree2Sse.includes('"stage":"build_text_game"'), '阶段二推进 task.stage 必须为 build_text_game');

    const resAfterAgree2 = await fetch(`${baseUrl}/api/projects/${typedApprovePid}`);
    const afterAgree2Json = (await resAfterAgree2.json()) as any;
    assert.strictEqual(afterAgree2Json.chat?.[3]?.nextProposalResolved, true, '阶段一气泡下一阶段提案应标为已授权');
    await waitForTaskStageStatus(
      typedApprovePid,
      (tasks) => tasks.some((t) => t.status === 'suspended' && t.result?.pendingApproval?.type === 'playtest_approval')
    );
    console.log('  ✅ 对话打字「同意」自动识别 approve_stage 并接管阶段一/二全链路通过！\n');

    // 3E. 测试路由工具高内聚、外部提示词纯净化与多层上下文门禁漏斗（零硬编码）
    console.log('3E. 测试意图规则内聚到工具、提示词纯净化与上下文门禁漏斗...');

    // 3E-1. 验证外部 prompt 已纯净化（移除关键词表与动作规则），且工具描述动态内聚实时工程态势
    const purifiedPrompt = buildRouterPrompt(typedApprovePid);
    assert.ok(!purifiedPrompt.includes('「同意」「行」'), '外部 prompt 不得包含硬编码同意关键词触发词表');
    assert.ok(purifiedPrompt.includes('emit_router_intent'), '外部 prompt 应委托工具 emit_router_intent 执行意图识别');
    assert.ok('contextAnalysis' in RouterIntentSchema.shape, 'RouterIntentSchema 必须包含 contextAnalysis 多层漏斗思考字段');

    const emptyToolPid = `test_tool_ctx_${Date.now()}`;
    const toolWithoutPremise = createRouterIntentTool({
      projectId: emptyToolPid,
      latestUserMessage: '同意',
      dialogueTurns: [{ role: 'user', content: '同意' }],
    });
    assert.ok(
      String(toolWithoutPremise.description || '').includes('尚未形成任何立项提案'),
      '空白项目传入工具时，工具自身描述必须动态注入实时上下文态势'
    );

    // 3E-2. 空项目首句发「同意」（即便模型误发 approve_stage）➔ 客观门禁拦截降级为 chat_only，绝不产生提案或启动任务
    const emptyApprovePid = `test_empty_approve_${Date.now()}`;
    const resEmptyAgree = await fetch(`${baseUrl}/api/chat/${emptyApprovePid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '同意' }),
    });
    assert.strictEqual(resEmptyAgree.status, 200);
    const emptyAgreeSse = await resEmptyAgree.text();
    assert.ok(!emptyAgreeSse.includes('"type":"proposal"'), '空项目孤立同意不得生成提案卡片');
    assert.ok(!emptyAgreeSse.includes('"type":"task"'), '空项目孤立同意不得启动任务');
    assert.ok(
      emptyAgreeSse.includes('还没有形成任何故事构想'),
      `第 1 步回复必须依据工具 guidance 如实引导先构思题材，实际 SSE: ${emptyAgreeSse}`
    );
    const emptyProjAfter = await (await fetch(`${baseUrl}/api/projects/${emptyApprovePid}`)).json() as any;
    assert.strictEqual(emptyProjAfter.chat?.[1]?.proposal, undefined);
    assert.strictEqual(emptyProjAfter.chat?.[1]?.taskRunId, undefined);
    assert.strictEqual(TaskStore.getInstance().listTasks(emptyApprovePid).length, 0, '空项目不得创建任何 Task');

    // 3E-3. 模拟 AI 依托工具内聚上下文漏斗自主识别复合修改意图（未立项转为 start_pipeline，已立项转为 modify_asset）
    class ContextFunnelAwareMockModel extends MockLanguageModel {
      public async doStream(options: any) {
        const hasToolResult = options.prompt.some((m: any) => m.role === 'tool');
        const regularMode = options.mode?.type === 'regular' ? (options.mode as any) : undefined;
        const routerToolDef = regularMode?.tools?.find((t: any) => t?.name === 'emit_router_intent');

        if (!hasToolResult && routerToolDef) {
          const toolDesc = String(routerToolDef.description || '');
          const gddReady = toolDesc.includes('阶段一 GDD=已完成');
          let lastUserText = '';
          for (let i = options.prompt.length - 1; i >= 0; i--) {
            const msg = options.prompt[i];
            if (msg.role === 'user') {
              lastUserText =
                typeof msg.content === 'string'
                  ? msg.content
                  : Array.isArray(msg.content)
                    ? msg.content.map((p: any) => p?.text || '').join('')
                    : '';
              break;
            }
          }

          let toolArgs: Record<string, any>;
          if (lastUserText.includes('女黑客')) {
            toolArgs = {
              contextAnalysis: '用户虽以肯定开头，但明确提出主角改设定要求且 GDD 尚未生成，按 P0 应整合为 propose_stage',
              action: 'propose_stage',
              targetStage: 'plan_gdd',
              summary: '已将主角调整为女黑客并更新立项提案，等待确认启动',
              payload: JSON.stringify({ userPrompt: '构思一个深海潜艇悬疑博弈互动文游，主角调整为女黑客' }),
            };
          } else if (gddReady && lastUserText.includes('结局')) {
            toolArgs = {
              contextAnalysis: '阶段一 GDD 已落盘，用户提出结局走向调整要求，按 P0 应选 modify_asset 而非推进阶段二',
              action: 'modify_asset',
              targetStage: 'plan_gdd',
              summary: '已识别针对 GDD 结局走向的局部修改要求，等待确认微调',
              payload: JSON.stringify({ target: 'story', detail: lastUserText }),
            };
          } else if (lastUserText.trim() === '同意') {
            toolArgs = {
              contextAnalysis: '用户纯粹确认推进已形成的构想',
              action: 'approve_stage',
              targetStage: 'plan_gdd',
              summary: '确认启动阶段一全案策划推演',
            };
          } else {
            toolArgs = {
              contextAnalysis: '用户提出新创意构想，尚未批准直接开工，按 P2 提交 propose_stage 待审提案',
              action: 'propose_stage',
              targetStage: 'plan_gdd',
              summary: '已提炼核心创意构想，建议启动全案策划推演',
              payload: JSON.stringify({ userPrompt: lastUserText }),
            };
          }

          const stream = new ReadableStream<any>({
            start(controller) {
              controller.enqueue({
                type: 'tool-call',
                toolCallType: 'function',
                toolCallId: `funnel_call_${Date.now()}`,
                toolName: 'emit_router_intent',
                args: JSON.stringify(toolArgs),
              });
              controller.enqueue({
                type: 'finish',
                finishReason: 'tool-calls',
                usage: { promptTokens: 12, completionTokens: 24 },
              });
              controller.close();
            },
          });
          return { stream, rawCall: { rawPrompt: options.prompt, rawSettings: {} } };
        }

        return super.doStream(options);
      }
    }

    LLMProvider.setMockModel(new ContextFunnelAwareMockModel());
    try {
      const mixedPid = `test_funnel_mixed_${Date.now()}`;
      const resMix1 = await fetch(`${baseUrl}/api/chat/${mixedPid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '构思一个深海潜艇悬疑博弈互动文游' }),
      });
      assert.strictEqual(resMix1.status, 200);
      await resMix1.text();

      const resMix2 = await fetch(`${baseUrl}/api/chat/${mixedPid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '同意，但把主角改成女黑客',
          history: [
            { role: 'user', content: '构思一个深海潜艇悬疑博弈互动文游' },
            { role: 'assistant', content: '已为您梳理核心设定，请确认启动。' },
          ],
        }),
      });
      assert.strictEqual(resMix2.status, 200);
      const mix2Sse = await resMix2.text();
      assert.ok(mix2Sse.includes('"type":"proposal"'), '立项前混合修改应生成待确认提案而非直接开机');
      assert.ok(!mix2Sse.includes('"type":"task"'), '立项前混合修改绝不得直接启动 task');
      const mixProjAfter = await (await fetch(`${baseUrl}/api/projects/${mixedPid}`)).json() as any;
      assert.strictEqual(mixProjAfter.chat?.[3]?.proposal?.action, 'propose_stage');
      assert.ok(
        String(mixProjAfter.chat?.[3]?.proposal?.payload?.userPrompt || '').includes('女黑客'),
        '重构提案必须包含合并后的新设定'
      );

      // 阶段一落盘后发出含修改的确认 ➔ 应保持 modify_asset 而不推进阶段二
      const stage1ModPid = `test_funnel_stage1_mod_${Date.now()}`;
      await (await fetch(`${baseUrl}/api/chat/${stage1ModPid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '构思一个深海潜艇悬疑博弈互动文游' }),
      })).text();
      const resStage1Go = await fetch(`${baseUrl}/api/chat/${stage1ModPid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '同意',
          history: [
            { role: 'user', content: '构思一个深海潜艇悬疑博弈互动文游' },
            { role: 'assistant', content: '已为您梳理核心设定，请确认启动。' },
          ],
        }),
      });
      assert.ok((await resStage1Go.text()).includes('"type":"task"'));
      await waitForTaskStageStatus(
        stage1ModPid,
        (tasks) => tasks.some((t) => t.status === 'suspended' && t.result?.pendingApproval?.type === 'gdd_approval')
      );

      const resStage1Mod = await fetch(`${baseUrl}/api/chat/${stage1ModPid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '同意，不过把结局改悲剧点',
          history: [
            { role: 'user', content: '构思一个深海潜艇悬疑博弈互动文游' },
            { role: 'assistant', content: '已为您梳理核心设定，请确认启动。' },
            { role: 'user', content: '同意' },
            { role: 'assistant', content: '收到，即刻启动全案策划推演。' },
          ],
        }),
      });
      assert.strictEqual(resStage1Mod.status, 200);
      const stage1ModSse = await resStage1Mod.text();
      assert.ok(stage1ModSse.includes('"type":"proposal"'), '阶段一后附带修改应生成 modify_asset 提案');
      assert.ok(stage1ModSse.includes('"action":"modify_asset"'), '提案 action 必须为 modify_asset');
      assert.ok(!stage1ModSse.includes('"type":"task"'), '不得直接误触发阶段二 build_text_game');

      // 3E-4. 验证未立项误发 modify_asset 降级 & 阶段二已完成后 approve_stage 拦截
      const noArtifactRes = evaluateRouterIntentFunnel(
        { projectId: `test_no_art_${Date.now()}`, latestUserMessage: '把主角改成医生' },
        { action: 'modify_asset', summary: '修改主角设定', payload: { target: '主角', detail: '把主角改成医生' } }
      );
      assert.strictEqual(noArtifactRes.action, 'propose_stage');
      assert.strictEqual(noArtifactRes.verdict, 'downgraded_modify_to_propose_stage');

      const completedPid = `test_completed_gate_${Date.now()}`;
      ProjectStore.getInstance().setArtifact(completedPid, 'gdd', { title: '已完成策划' });
      ProjectStore.getInstance().setArtifact(completedPid, 'text_game', { title: '已完成文游', nodes: [] });
      const completedRes = evaluateRouterIntentFunnel(
        { projectId: completedPid, latestUserMessage: '继续' },
        { action: 'approve_stage', targetStage: 'build_text_game', summary: '推进下一阶段' }
      );
      assert.strictEqual(completedRes.action, 'chat_only');
      assert.strictEqual(completedRes.verdict, 'already_completed');
    } finally {
      LLMProvider.setMockModel(new MockLanguageModel());
    }
    console.log('  ✅ 意图规则高内聚、外部提示词纯净化与客观门禁漏斗全部通过！\n');

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
    const resStage1Proj = await fetch(`${baseUrl}/api/projects/${testPid}`);
    assert.strictEqual(resStage1Proj.status, 200);
    const stage1Proj = (await resStage1Proj.json()) as any;
    assert.ok(stage1Proj.artifacts?.gdd?.prd?.clips?.length > 0, '阶段一完成后 GET /projects/:id 必须携带结构化 prd.clips');
    assert.ok(stage1Proj.artifacts?.gdd?.prd?.interactions?.length > 0, '阶段一完成后必须携带 prd.interactions');
    assert.ok(stage1Proj.artifacts?.gdd?.prd?.wiring?.length > 0, '阶段一完成后必须携带 prd.wiring');
    assert.ok(stage1Proj.artifacts?.gdd?.spineScript, '阶段一完成后必须携带未切分剧本原文 spineScript');
    assert.ok(stage1Proj.artifacts?.gdd?.markdown, '阶段一完成后必须携带 PRD markdown');
    assert.ok(
      stage1Proj.artifacts?.gdd?.storySections?.[stage1Proj.artifacts.gdd.prd.startNodeId]?.narrativeText,
      '阶段一完成后必须携带按片段切分的 storySections 剧本正文'
    );
    console.log(`    ✅ 状态机成功挂起于阶段一终点，等待创作者审批策划案`);

    // 辅助轮询状态直到收敛
    async function waitForStatus(expectedStatus: string, maxMs = 3000): Promise<any> {
      const start = Date.now();
      let lastJson: any;
      while (Date.now() - start < maxMs) {
        const res = await fetch(`${baseUrl}/api/workflow/${testPid}/${runId}/state`);
        lastJson = (await res.json()) as any;
        if (lastJson.data?.status === expectedStatus) {
          return lastJson;
        }
        await new Promise((r) => setTimeout(r, 60));
      }
      return lastJson;
    }

    // 3.3 注入第一道审批信号 (Resume GDD Approval) 推进至阶段二
    console.log('  3.3 注入审批信号: POST /api/workflow/:projectId/:runId/resume (GDD 通过)...');
    const resResume1 = await fetch(`${baseUrl}/api/workflow/${testPid}/${runId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true }),
    });
    assert.strictEqual(resResume1.status, 200);

    // 3.4 轮询状态：必须处于挂起等待文游试玩验收
    const jsonState2 = await waitForStatus('suspended');
    assert.strictEqual(jsonState2.data?.status, 'suspended', '阶段二完成后流水线必须处于试玩挂起状态');
    assert.strictEqual(jsonState2.data?.pendingApproval?.type, 'playtest_approval');
    console.log(`    ✅ 状态机自动推进并挂起于阶段二终点，文游就绪等待试玩验收`);

    // 3.5 注入第二道试玩通过信号 (Resume Playtest Approval) 推进至阶段三
    console.log('  3.5 注入试玩通过信号: POST /api/workflow/:projectId/:runId/resume (试玩通过)...');
    const resResume2 = await fetch(`${baseUrl}/api/workflow/${testPid}/${runId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true }),
    });
    assert.strictEqual(resResume2.status, 200);

    // 3.6 轮询最终状态：必须全线成功完成 (succeeded)
    const jsonStateFinal = await waitForStatus('succeeded');
    assert.strictEqual(jsonStateFinal.data?.status, 'succeeded', '全流水线最终必须处于 succeeded 状态');
    assert.strictEqual(jsonStateFinal.data?.currentStage, 'completed');
    console.log(`    ✅ 全流水线圆满完成，影游视听分镜资产编译收敛！`);

    // 3.7 验证刷新恢复所需的任务气泡记录与跨内存磁盘产物水合
    (ProjectStore.getInstance() as any).cache.delete(testPid);
    const resRecovered = await fetch(`${baseUrl}/api/projects/${testPid}`);
    assert.strictEqual(resRecovered.status, 200);
    const recoveredProj = (await resRecovered.json()) as any;
    assert.ok(recoveredProj.artifacts?.gdd?.title, '清空内存缓存后仍应从磁盘恢复 GDD 视图');
    assert.ok(recoveredProj.artifacts?.gdd?.prd?.clips?.length > 0, '磁盘重水合 GDD 必须包含 prd.clips');
    assert.ok(recoveredProj.artifacts?.gdd?.prd?.interactions?.length > 0, '磁盘重水合 GDD 必须包含 prd.interactions');
    assert.ok(recoveredProj.artifacts?.gdd?.prd?.wiring?.length > 0, '磁盘重水合 GDD 必须包含 prd.wiring');
    assert.ok(
      recoveredProj.artifacts?.gdd?.storySections?.[recoveredProj.artifacts.gdd.prd.startNodeId]?.narrativeText,
      '磁盘重水合 GDD 必须包含 storySections 片段正文'
    );
    assert.ok(recoveredProj.artifacts?.gdd?.spineScript, '清空缓存从磁盘恢复后仍应包含未切分剧本原文 spineScript');
    assert.ok(recoveredProj.artifacts?.gdd?.markdown, '清空缓存从磁盘恢复后仍应包含 PRD markdown');
    assert.ok(recoveredProj.artifacts?.text_game?.nodes?.length > 0, '清空内存缓存后仍应从磁盘恢复 TextGame 视图');
    assert.strictEqual(recoveredProj.artifacts?.hasStandaloneGame, true, '应探测到 text-game/index.html');
    const taskMsgs = (recoveredProj.chat || []).filter((m: any) => m.taskRunId === runId);
    assert.strictEqual(taskMsgs.length, 2, '应持久化 Stage 1 与 Stage 2 两条 taskRunId 承接气泡');
    assert.strictEqual(taskMsgs[0].nextProposalResolved, true, 'Stage 1 气泡的阶段二提案应标为已授权');
    console.log('  ✅ 跨内存刷新恢复（chat + taskRunId + 磁盘 GDD/TextGame 视图）通过！');

    console.log('\n🎉 所有模块化 API 接口与工作流状态机测试 100% 全部通过！\n');
  } finally {
    server.close();
  }
}

runApiTests().catch((err) => {
  console.error('❌ API 测试失败:', err);
  process.exit(1);
});
