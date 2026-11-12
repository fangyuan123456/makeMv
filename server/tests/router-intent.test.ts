/**
 * tests/router-intent.test.ts
 * 中枢路由意图内聚到工具、提示词纯净化与客观上下文门禁专项验证
 */

process.env.NODE_ENV = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/api/app.js';
import {
  buildRouterPrompt,
  createRouterIntentTool,
  evaluateRouterIntentFunnel,
  extractRouterIntentFromSteps,
  RouterIntentSchema,
} from '../src/agents/router/index.js';
import { LLMProvider, MockLanguageModel } from '../src/llm/index.js';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { TaskStore, runTaskRecordedStep } from '../src/workflow-engine/TaskStore.js';
import { withRunContext } from '../src/workflow-engine/run-context.js';
import { ProductionWorkflowEngine } from '../src/workflows/production.workflow.js';

test('1. 外部提示词纯净化且工具内聚实时黑板上下文与漏斗思考字段', () => {
  const pid = `test_router_prompt_${Date.now()}`;
  const prompt = buildRouterPrompt(pid);

  assert.ok(!prompt.includes('「同意」「行」'), '外部 prompt 不得硬编码同意关键词触发词表');
  assert.ok(!prompt.includes('必须选 `approve_stage`'), '外部 prompt 不得写入动作枚举抢跑规则');
  assert.ok(prompt.includes('emit_router_intent'), '外部 prompt 应将意图识别委托给工具 emit_router_intent');
  assert.ok('contextAnalysis' in RouterIntentSchema.shape, 'RouterIntentSchema 必须包含 contextAnalysis 上下文分析字段');

  const tool = createRouterIntentTool({
    projectId: pid,
    latestUserMessage: '同意',
    dialogueTurns: [{ role: 'user', content: '同意' }],
  });
  const desc = String(tool.description || '');
  assert.ok(desc.includes('阶段一 GDD=未生成(⏳)'), '工具描述应注入阶段一状态');
  assert.ok(desc.includes('尚未形成任何立项提案'), '工具描述应注入提案状态');

  // 验证动态 Schema 组合：未立项前仅暴露 approve_stage 与 propose_stage，彻底消除 modify_asset 与 chat_only 干扰
  const allowed = (tool.inputSchema as any).shape.action._def.values;
  assert.deepEqual(
    allowed,
    ['approve_stage', 'propose_stage'],
    '立项前动态 schema 必须仅暴露当前合法动作 [approve_stage, propose_stage]'
  );
});

test('2. 客观工程门禁漏斗：无前提空同意 / 未立项改资产 / 已完成重推 / 运行中防重开', () => {
  // 2.1 空项目无前提发 approve_stage ➔ 拦截降级为 chat_only (missing_premise)
  const emptyPid = `test_gate_empty_${Date.now()}`;
  const emptyRes = evaluateRouterIntentFunnel(
    {
      projectId: emptyPid,
      latestUserMessage: '同意',
      dialogueTurns: [{ role: 'user', content: '同意' }],
    },
    {
      action: 'approve_stage',
      targetStage: 'build_text_game',
      summary: '误启动',
      payload: { userPrompt: '同意' },
    }
  );
  assert.equal(emptyRes.action, 'chat_only');
  assert.equal(emptyRes.verdict, 'missing_premise');
  assert.equal(emptyRes.intercepted, true);

  // 2.2 未立项时发 modify_asset ➔ 降级为 propose_stage 待确认提案
  const noArtPid = `test_gate_no_art_${Date.now()}`;
  const modBeforeInit = evaluateRouterIntentFunnel(
    {
      projectId: noArtPid,
      latestUserMessage: '把主角改成女黑客',
    },
    {
      action: 'modify_asset',
      summary: '修改主角设定',
      payload: { target: '主角', detail: '把主角改成女黑客' },
    }
  );
  assert.equal(modBeforeInit.action, 'propose_stage');
  assert.equal(modBeforeInit.verdict, 'downgraded_modify_to_start_pipeline');
  assert.equal(modBeforeInit.payload?.userPrompt, '把主角改成女黑客');

  // 2.3 阶段一 GDD 已落盘但无挂起审批任务 ➔ approve_stage 收口为 chat_only (no_pending_approval)
  const gddOnlyPid = `test_gate_gdd_only_${Date.now()}`;
  ProjectStore.getInstance().setArtifact(gddOnlyPid, 'gdd', { title: '孤立策划' });
  const noPendingRes = evaluateRouterIntentFunnel(
    { projectId: gddOnlyPid, latestUserMessage: '继续' },
    { action: 'approve_stage', targetStage: 'build_text_game', summary: '进入下一步' }
  );
  assert.equal(noPendingRes.action, 'chat_only');
  assert.equal(noPendingRes.verdict, 'no_pending_approval');

  // 2.4 阶段二已完成 ➔ approve_stage 收口为 chat_only (already_completed)
  const completedPid = `test_gate_done_${Date.now()}`;
  ProjectStore.getInstance().setArtifact(completedPid, 'gdd', { title: '已完成策划' });
  ProjectStore.getInstance().setArtifact(completedPid, 'text_game', { title: '已完成文游', nodes: [] });
  const doneRes = evaluateRouterIntentFunnel(
    { projectId: completedPid, latestUserMessage: '同意' },
    { action: 'approve_stage', targetStage: 'build_text_game', summary: '推进' }
  );
  assert.equal(doneRes.action, 'chat_only');
  assert.equal(doneRes.verdict, 'already_completed');

  // 2.5 存在 gdd_approval 挂起任务 ➔ 放行并锚定 build_text_game (resume_to_stage2)
  const suspendedPid = `test_gate_suspended_${Date.now()}`;
  ProjectStore.getInstance().setArtifact(suspendedPid, 'gdd', { title: '挂起待审' });
  const task = TaskStore.getInstance().createTask(suspendedPid, 'production_pipeline', '推演策划', false);
  TaskStore.getInstance().setStatus(suspendedPid, task.taskId, 'suspended', {
    result: {
      currentStage: 'plan_gdd',
      pendingApproval: { type: 'gdd_approval' },
    },
  });
  const resumeRes = evaluateRouterIntentFunnel(
    { projectId: suspendedPid, latestUserMessage: '好呀，继续吧' },
    { action: 'approve_stage', targetStage: 'plan_gdd', summary: '确认推进' }
  );
  assert.equal(resumeRes.action, 'approve_stage');
  assert.equal(resumeRes.targetStage, 'build_text_game');
  assert.equal(resumeRes.verdict, 'resume_to_stage2');

  // 2.6 extractRouterIntentFromSteps 优先消费 toolResults（chat_only 时返回 undefined）
  const extractedBlocked = extractRouterIntentFromSteps([
    {
      toolCalls: [{ toolCallId: 'c1', toolName: 'emit_router_intent', args: { action: 'approve_stage', summary: 'x' } }],
      toolResults: [{ toolCallId: 'c1', toolName: 'emit_router_intent', result: emptyRes }],
    },
  ]);
  assert.equal(extractedBlocked, undefined);
});

test('3. HTTP SSE 全链路：空项目同意拦截 + AI 自主上下文漏斗识别复合修改不误开机', async () => {
  LLMProvider.setMockModel(new MockLanguageModel());
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;

  try {
    // 3.1 空项目首句发「同意」➔ 客观门禁拦截，无 proposal 无 task，回复依据 guidance
    const emptyPid = `test_http_empty_${Date.now()}`;
    const resEmpty = await fetch(`${baseUrl}/api/chat/${emptyPid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '同意' }),
    });
    assert.equal(resEmpty.status, 200);
    const emptySse = await resEmpty.text();
    assert.ok(!emptySse.includes('"type":"proposal"'), '空项目孤立同意不得生成提案卡片');
    assert.ok(!emptySse.includes('"type":"task"'), '空项目孤立同意不得启动任务');
    assert.ok(emptySse.includes('还没有形成任何故事构想'), `回复应遵循工具 guidance，实际 SSE: ${emptySse}`);
    assert.equal(TaskStore.getInstance().listTasks(emptyPid).length, 0);

    // 3.2 模拟真实 AI 依赖工具内聚上下文自主判断（非硬编码）
    class FunnelMockModel extends MockLanguageModel {
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

          const toolArgs = lastUserText.includes('女黑客')
            ? {
                contextAnalysis: 'GDD 未生成，用户虽以肯定开头但提出了修改主角的新需求，按 P0 整合为 propose_stage',
                action: 'propose_stage',
                targetStage: 'plan_gdd',
                summary: '已整合女黑客设定为最新立项提案，等待确认启动',
                payload: JSON.stringify({ userPrompt: '深海潜艇悬疑博弈互动文游，主角改为女黑客' }),
              }
            : gddReady && lastUserText.includes('结局')
              ? {
                  contextAnalysis: 'GDD 已完成且等待审批，用户提出修改结局走向，按 P0 转为 modify_asset',
                  action: 'modify_asset',
                  targetStage: 'plan_gdd',
                  summary: '已提炼针对 GDD 结局的修改意见，等待确认微调',
                  payload: JSON.stringify({ target: 'story', detail: lastUserText }),
                }
              : {
                  contextAnalysis: '用户提出新创意构想，提交 propose_stage 待确认提案',
                  action: 'propose_stage',
                  targetStage: 'plan_gdd',
                  summary: '已提炼核心创意构想，建议启动全案策划推演',
                  payload: JSON.stringify({ userPrompt: lastUserText }),
                };

          const stream = new ReadableStream<any>({
            start(controller) {
              controller.enqueue({
                type: 'tool-call',
                toolCallType: 'function',
                toolCallId: `funnel_${Date.now()}`,
                toolName: 'emit_router_intent',
                args: JSON.stringify(toolArgs),
              });
              controller.enqueue({
                type: 'finish',
                finishReason: 'tool-calls',
                usage: { promptTokens: 10, completionTokens: 20 },
              });
              controller.close();
            },
          });
          return { stream, rawCall: { rawPrompt: options.prompt, rawSettings: {} } };
        }

        return super.doStream(options);
      }
    }

    LLMProvider.setMockModel(new FunnelMockModel());

    // 未立项提出构想后回复「同意，但把主角改成女黑客」➔ 应生成新提案而不开机
    const mixPid = `test_http_mix_${Date.now()}`;
    await (
      await fetch(`${baseUrl}/api/chat/${mixPid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '构思一个深海潜艇悬疑博弈互动文游' }),
      })
    ).text();

    const resMix2 = await fetch(`${baseUrl}/api/chat/${mixPid}`, {
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
    assert.equal(resMix2.status, 200);
    const mix2Sse = await resMix2.text();
    assert.ok(mix2Sse.includes('"type":"proposal"'), '立项前附加修改必须保持提案待确认态');
    assert.ok(!mix2Sse.includes('"type":"task"'), '立项前附加修改不得直接启动 task');
    const mixProj = (await (await fetch(`${baseUrl}/api/projects/${mixPid}`)).json()) as any;
    assert.equal(mixProj.chat?.[3]?.proposal?.action, 'propose_stage');
    assert.ok(String(mixProj.chat?.[3]?.proposal?.payload?.userPrompt || '').includes('女黑客'));

    // 阶段一已完稿挂起后回复「同意，不过把结局改悲剧点」➔ 保持 modify_asset 提案，不推进阶段二
    const stage1Pid = `test_http_stage1_mod_${Date.now()}`;
    ProjectStore.getInstance().setArtifact(stage1Pid, 'gdd', { title: '深海潜艇' });
    const stage1Task = TaskStore.getInstance().createTask(stage1Pid, 'production_pipeline', '推演策划', false);
    TaskStore.getInstance().setStatus(stage1Pid, stage1Task.taskId, 'suspended', {
      result: { currentStage: 'plan_gdd', pendingApproval: { type: 'gdd_approval' } },
    });

    const resStage1Mod = await fetch(`${baseUrl}/api/chat/${stage1Pid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '同意，不过把结局改悲剧点' }),
    });
    assert.equal(resStage1Mod.status, 200);
    const stage1ModSse = await resStage1Mod.text();
    assert.ok(stage1ModSse.includes('"type":"proposal"'));
    assert.ok(stage1ModSse.includes('"action":"modify_asset"'));
    assert.ok(!stage1ModSse.includes('"type":"task"'));
  } finally {
    LLMProvider.setMockModel(new MockLanguageModel());
    server.close();
  }
});

test('4. 账本暴露已取消任务与 resume_task(taskId) 客观门禁 + Task 内聚 Step 幂等跳过', async () => {
  const pid = `test_resume_gate_${Date.now()}`;
  const taskStore = TaskStore.getInstance();
  const cancelled = taskStore.createTask(pid, 'production_pipeline', '全生命周期生产流水线', false, {
    userPrompt: '时空错位酒店悬疑短剧',
  });
  taskStore.updateProgress(pid, cancelled.taskId, {
    percent: 35,
    note: '正在切分互动节点...',
  });
  taskStore.setStatus(pid, cancelled.taskId, 'cancelled', {
    result: { currentStage: 'plan_gdd' },
    error: '创作者主动取消任务',
  });

  const prompt = buildRouterPrompt(pid);
  assert.ok(prompt.includes(cancelled.taskId), 'buildRouterPrompt 必须包含已取消任务的 taskId');
  assert.ok(prompt.includes('cancelled'), 'buildRouterPrompt 必须暴露 cancelled 状态');

  const tool = createRouterIntentTool({ projectId: pid, latestUserMessage: '继续' });
  const desc = String(tool.description || '');
  assert.ok(desc.includes(cancelled.taskId), 'emit_router_intent 描述必须暴露历史任务 taskId');
  assert.ok(desc.includes('cancelled'), 'emit_router_intent 描述必须暴露 cancelled 状态');

  const missingIdRes = evaluateRouterIntentFunnel(
    { projectId: pid, latestUserMessage: '继续' },
    { action: 'resume_task', targetStage: 'plan_gdd', summary: '恢复执行' }
  );
  assert.equal(missingIdRes.action, 'chat_only');
  assert.equal(missingIdRes.verdict, 'missing_task_id');

  const notFoundRes = evaluateRouterIntentFunnel(
    { projectId: pid, latestUserMessage: '继续' },
    { action: 'resume_task', taskId: 'task_not_exists', targetStage: 'plan_gdd', summary: '恢复' }
  );
  assert.equal(notFoundRes.action, 'chat_only');
  assert.equal(notFoundRes.verdict, 'task_not_found');

  const readyRes = evaluateRouterIntentFunnel(
    { projectId: pid, latestUserMessage: '继续' },
    { action: 'resume_task', taskId: cancelled.taskId, targetStage: 'plan_gdd', summary: '恢复任务' }
  );
  assert.equal(readyRes.action, 'resume_task');
  assert.equal(readyRes.taskId, cancelled.taskId);
  assert.equal(readyRes.targetStage, 'plan_gdd');
  assert.equal(readyRes.verdict, 'resume_task_ready');

  // 已完成任务拒绝再恢复；存在运行中任务时拦截
  const doneTask = taskStore.createTask(pid, 'production_pipeline', '已完成任务', false);
  taskStore.setStatus(pid, doneTask.taskId, 'succeeded');
  const doneRes = evaluateRouterIntentFunnel(
    { projectId: pid, latestUserMessage: '继续' },
    { action: 'resume_task', taskId: doneTask.taskId, summary: '恢复已完成任务' }
  );
  assert.equal(doneRes.action, 'chat_only');
  assert.equal(doneRes.verdict, 'task_already_succeeded');

  // Step 内部自判跳过：同 taskId 第二次走到已完成 Step1 时直接返回记录结果，不重跑 Step1
  let step1ExecCount = 0;
  let step2ExecCount = 0;
  await withRunContext({ projectId: pid, runId: cancelled.taskId, lane: 'batch' }, async () => {
    const out1 = await runTaskRecordedStep('write-spine-script', async () => {
      step1ExecCount++;
      return { title: '时空旅店', spineScript: '# 第一幕\n正文内容' };
    });
    assert.equal(out1.title, '时空旅店');
  });
  await withRunContext({ projectId: pid, runId: cancelled.taskId, lane: 'batch' }, async () => {
    const out1Again = await runTaskRecordedStep('write-spine-script', async () => {
      step1ExecCount++;
      return { title: '不应执行', spineScript: '' };
    });
    const out2 = await runTaskRecordedStep('slice-interactions', async () => {
      step2ExecCount++;
      return { title: out1Again.title, clips: [{ clipId: 'S1' }] };
    });
    assert.equal(out1Again.title, '时空旅店');
    assert.equal(out2.clips.length, 1);
  });
  assert.equal(step1ExecCount, 1, '已记录成功的 Step1 恢复走过时应直接返回，仅执行过 1 次');
  assert.equal(step2ExecCount, 1, '未完成的 Step2 应正常补执行 1 次');
});

test('5. HTTP SSE 全链路：取消任务后发「继续」，AI 从上下文看见 taskId 与状态并原地恢复原任务', async () => {
  class InspectableResumeMockModel extends MockLanguageModel {
    public observedPromptTexts: string[] = [];

    public async doStream(options: any) {
      const hasToolResult = options.prompt.some((m: any) => m.role === 'tool');
      if (!hasToolResult) {
        const joined = options.prompt
          .map((m: any) =>
            typeof m.content === 'string'
              ? m.content
              : Array.isArray(m.content)
                ? m.content.map((p: any) => p?.text || '').join('')
                : ''
          )
          .join('\n');
        this.observedPromptTexts.push(joined);
      }
      return super.doStream(options);
    }
  }

  const mockModel = new InspectableResumeMockModel();
  LLMProvider.setMockModel(mockModel);

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;

  try {
    // 5.1 阶段一运行中取消 ➔ 对话发送「继续」➔ AI 从上下文看到 taskId 与 cancelled ➔ 用原 taskId 恢复并完成 GDD
    const pid = `test_http_resume_stage1_${Date.now()}`;
    const store = ProjectStore.getInstance();
    const taskStore = TaskStore.getInstance();
    const t1 = taskStore.createTask(pid, 'production_pipeline', '互动影游全生命周期生产流水线', false, {
      userPrompt: '都市霓虹侦探推理短剧',
    });
    taskStore.recordCompletedStep(pid, t1.taskId, 'write-spine-script', {
      title: '霓虹迷局',
      spineScript: '# 第一幕\n主角推开雨夜侦探社大门。\n# 第二幕\n暗格里的旧录音带开始倒带。',
    });
    taskStore.setStatus(pid, t1.taskId, 'cancelled', {
      result: {
        currentStage: 'plan_gdd',
        completedSteps: {
          'write-spine-script': {
            title: '霓虹迷局',
            spineScript: '# 第一幕\n主角推开雨夜侦探社大门。\n# 第二幕\n暗格里的旧录音带开始倒带。',
          },
        },
      },
      error: '创作者主动取消任务',
    });
    store.appendChatRecord(pid, {
      role: 'user',
      content: '做一个侦探推理互动短剧',
    });
    const ownerMsg = store.appendChatRecord(pid, {
      role: 'assistant',
      content: '收到，开始推演全案策划案。这一阶段的进度会在这条消息里实时更新。',
      taskRunId: t1.taskId,
      taskStage: 'plan_gdd',
    });

    // 故意传空 history，验证服务端从 ProjectStore.chat + TaskStore 自动向 AI 投影 [关联任务记录]
    const res = await fetch(`${baseUrl}/api/chat/${pid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '继续', history: [] }),
    });
    assert.equal(res.status, 200);
    const sse = await res.text();

    assert.ok(sse.includes('"type":"task"'), `恢复应直接下发 task 事件，实际 SSE: ${sse}`);
    assert.ok(sse.includes(`"runId":"${t1.taskId}"`), '恢复的任务必须复用原 taskId');
    assert.ok(
      sse.includes(`"ownerMessageId":"${ownerMsg.id}"`),
      '恢复应返回 ownerMessageId 指向原任务气泡就地更新，而不产生第二个任务框'
    );
    const chatAfterResume = store.getProject(pid).chat || [];
    assert.equal(
      chatAfterResume.filter((m) => m.taskRunId === t1.taskId && m.taskStage === 'plan_gdd').length,
      1,
      '同一阶段任务在 chat 记录中只能由原气泡绑定，不能在恢复回复上再挂载第二个任务框'
    );
    assert.ok(
      mockModel.observedPromptTexts.some(
        (txt) => txt.includes(t1.taskId) && txt.includes('cancelled')
      ),
      '大模型看到的对话上下文必须包含 taskId 与 cancelled 状态'
    );

    // 等待复用原 taskId 跑完阶段一（Step1 write-spine-script 命中任务记录直接跳过）
    let snap = ProductionWorkflowEngine.getState(pid, t1.taskId);
    for (let i = 0; i < 40 && (snap.status === 'running' || snap.status === 'queued'); i++) {
      await new Promise((r) => setTimeout(r, 80));
      snap = ProductionWorkflowEngine.getState(pid, t1.taskId);
    }
    assert.equal(snap.status, 'suspended', `恢复后阶段一应成功挂起等待审批，实际=${snap.status}, error=${snap.error}`);
    assert.equal(snap.pendingApproval?.type, 'gdd_approval');
    assert.equal(store.getArtifact<any>(pid, 'planner_spine')?.title, '霓虹迷局', '应直接复用已记录的 Step1 标题');
    assert.ok(
      String(store.getArtifact<any>(pid, 'gdd')?.spineScript || '').includes('暗格里的旧录音带开始倒带'),
      '应直接复用已记录的 Step1 主干剧本正文'
    );
    const recordedAfterStage1 = (taskStore.getTask(pid, t1.taskId)?.result as any)?.completedSteps || {};
    assert.ok(recordedAfterStage1['write-spine-script'], 'Step1 应保留在 Task completedSteps 记录中');
    assert.ok(recordedAfterStage1['prd-synthesis-step'], '后续完成后 Step4 也应记录进同一 Task');

    // 5.2 阶段二取消后发「继续恢复」，且前端通过 history 传递 m.task 元数据
    const res2WaitCancel = await ProductionWorkflowEngine.resume(pid, t1.taskId, { approved: true });
    assert.equal(res2WaitCancel.currentStage, 'build_text_game');
    ProductionWorkflowEngine.cancel(pid, t1.taskId, '阶段二中途暂停测试');
    assert.equal(taskStore.getTask(pid, t1.taskId)?.status, 'cancelled');

    const resStage2Resume = await fetch(`${baseUrl}/api/chat/${pid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '恢复刚才停止的任务继续做',
        history: [
          {
            role: 'assistant',
            content: '收到，直接装配可玩的 index.html 互动文游。',
            task: { runId: t1.taskId, stage: 'build_text_game', status: 'cancelled' },
          },
        ],
      }),
    });
    assert.equal(resStage2Resume.status, 200);
    const sse2 = await resStage2Resume.text();
    assert.ok(sse2.includes(`"runId":"${t1.taskId}"`), '阶段二恢复也必须复用原 taskId');
    assert.ok(sse2.includes('"stage":"build_text_game"'), '阶段二恢复应保持在 build_text_game 阶段');

    // 清理阶段二后台任务避免退出挂起
    for (let i = 0; i < 50; i++) {
      const s2 = ProductionWorkflowEngine.getState(pid, t1.taskId);
      if (s2.status !== 'running' && s2.status !== 'queued') break;
      await new Promise((r) => setTimeout(r, 80));
    }
  } finally {
    LLMProvider.setMockModel(new MockLanguageModel());
    server.close();
  }
});

test('6. 已存在待确认立项方案时，创作者发「开始吧/启动」，approve_stage 裁决放行阶段一', () => {
  const pid = `test_confirm_start_${Date.now()}`;
  const store = ProjectStore.getInstance();

  // 模拟第一轮总导演生成的待确认立项提案卡片
  store.appendChatRecord(pid, {
    role: 'user',
    content: '我想做个雨夜山庄密室逃脱文游，主角是个侦探',
  });
  store.appendChatRecord(pid, {
    role: 'assistant',
    content: '雨夜山庄的设定非常精彩，建议开启全案策划推演。',
    proposal: {
      action: 'start_pipeline',
      summary: '已提炼雨夜山庄密室逃脱构想，建议启动全案策划',
      payload: {
        userPrompt: '雨夜山庄密室逃脱：侦探受邀赴宴，暴雨突至山庄封锁，古老宅邸暗藏家族血案。',
      },
    },
    proposalResolved: false,
  });

  // 验证工具描述注入状态：消除了带偏模型的 start_pipeline 诱导词，改为清晰的待确认立项策划方案
  const tool = createRouterIntentTool({
    projectId: pid,
    latestUserMessage: '开始吧',
    dialogueTurns: [
      { role: 'user', content: '我想做个雨夜山庄密室逃脱文游，主角是个侦探' },
      { role: 'assistant', content: '雨夜山庄的设定非常精彩，建议开启全案策划推演。' },
      { role: 'user', content: '开始吧' },
    ],
  });
  const desc = String(tool.description || '');
  assert.ok(desc.includes('已形成待确认立项策划方案'), '工具描述应客观指出已形成待确认立项策划方案');
  assert.ok(!desc.includes('存在待确认 start_pipeline 提案'), '工具描述严禁给模型植入 start_pipeline 动作名诱饵');

  // 第二轮创作者发送「开始吧」，模型源头命中 approve_stage，门禁裁决放行阶段一并继承构想
  const res = evaluateRouterIntentFunnel(
    {
      projectId: pid,
      latestUserMessage: '开始吧',
    },
    {
      action: 'approve_stage',
      targetStage: 'plan_gdd',
      summary: '已确认立项方向，立即启动阶段一全案策划推演',
    }
  );

  assert.equal(res.action, 'approve_stage');
  assert.equal(res.verdict, 'approved_to_start_stage1', '必须裁决为 approved_to_start_stage1 放行阶段一');
  assert.equal(res.targetStage, 'plan_gdd');
  assert.ok(
    String(res.payload?.userPrompt || '').includes('雨夜山庄密室逃脱'),
    '必须无缝继承前序待确认提案中的构想 prompt'
  );

  // 6.2 创作者继续补充剧情设想，命中 propose_stage 兜底动作生成推进提案
  const proposeRes = evaluateRouterIntentFunnel(
    {
      projectId: pid,
      latestUserMessage: '给侦探增加一个随身怀表道具，表盖内藏着失踪妹妹的照片',
    },
    {
      action: 'propose_stage',
      targetStage: 'plan_gdd',
      summary: '已补充怀表道具与妹妹伏笔设定，建议启动全案策划',
      payload: {
        userPrompt: '雨夜山庄密室逃脱：侦探受邀赴宴，暴雨突至山庄封锁。侦探随身怀表藏有失踪妹妹照片。',
      },
    }
  );
  assert.equal(proposeRes.action, 'propose_stage', '补充设定必须命中 propose_stage 推进提案');
  assert.equal(proposeRes.verdict, 'proposal_ready');
});
