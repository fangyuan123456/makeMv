/**
 * tests/mastra/DirectorMemoryAndParserUpgrade.test.ts
 * AI 视听总导演微观工作记忆 (ChatMemoryManager)、流式解析鲁棒性与 SOP 挂载升级验证
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { ChatMemoryManager } from '../../src/agents/director/memory/index.js';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { StreamTagParser } from '../../src/utils/StreamTagParser.js';
import { ContextAssembler } from '../../src/project-store/context-assembler.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';
import { resolveModifySource } from '../../src/agents/director/modifier/index.js';

test('Director Upgrade - 微观工作记忆与流式解析加固测试', async (t) => {
  const store = ProjectStore.getInstance();
  const memoryManager = ChatMemoryManager.getInstance();
  const testPid = `test_upgrade_${Date.now()}`;
  const testSid = `sess_${Date.now()}`;

  // 初始化测试工程
  store.saveProject({
    projectId: testPid,
    title: '测试微观记忆项目',
    status: SessionStatus.IDLE,
    currentStage: WorkflowStage.NARRATIVE_DESIGN,
    stageArtifacts: {},
    history: [],
    meta: {
      idea: '互动悬疑电影',
      style: '写实光影',
      videoRatio: '16:9',
      videoResolution: '720P',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  store.createSession(testPid, '测试会话');

  await t.test('1. ChatMemoryManager 严格保障首条消息必为 user（修剪开头的 assistant 消息）', () => {
    // 注入一条 assistant 消息与一条 user 消息
    store.appendMessage(testPid, testSid, {
      role: 'assistant',
      content: '我是开头的助手消息',
      timestamp: new Date().toISOString(),
    } as any);
    store.appendMessage(testPid, testSid, {
      role: 'user',
      content: '第一句用户指令',
      timestamp: new Date().toISOString(),
    } as any);
    store.appendMessage(testPid, testSid, {
      role: 'assistant',
      content: '第二句助手回复',
      timestamp: new Date().toISOString(),
    } as any);

    const turns = memoryManager.getWorkingTurns(testPid, testSid, 10);
    assert.strictEqual(turns[0].role, 'user', '首条消息必须被修剪并保证为 user');
    assert.strictEqual(turns[0].content, '第一句用户指令');
    assert.strictEqual(turns.length, 2);
  });

  await t.test('2. ChatMemoryManager 严格保障相邻同角色连续消息自动合并折叠', () => {
    // 连续追加两条 user 消息
    store.appendMessage(testPid, testSid, {
      role: 'user',
      content: '补充需求 A',
      timestamp: new Date().toISOString(),
    } as any);
    store.appendMessage(testPid, testSid, {
      role: 'user',
      content: '补充需求 B',
      timestamp: new Date().toISOString(),
    } as any);

    const turns = memoryManager.getWorkingTurns(testPid, testSid, 10);
    // 预期：最后的两条 user 被平滑合并为一条 user
    const lastTurn = turns[turns.length - 1];
    assert.strictEqual(lastTurn.role, 'user');
    assert.ok(lastTurn.content.includes('补充需求 A') && lastTurn.content.includes('补充需求 B'));

    // 验证全链路严格交替
    for (let i = 0; i < turns.length - 1; i++) {
      assert.notStrictEqual(turns[i].role, turns[i + 1].role, '相邻 Turns 角色必须严格交替');
    }
  });

  await t.test('3. ChatMemoryManager 异常中断占位补录功能正常', () => {
    memoryManager.recordAssistantFallback(testPid, testSid, '网络超时测试');
    const msgs = store.getMessages(testPid, testSid);
    const lastMsg = msgs[msgs.length - 1];
    assert.strictEqual(lastMsg.role, 'assistant');
    assert.ok(lastMsg.content.includes('网络超时测试'));
  });

  await t.test('4. emitDirectorIntentTool 强类型结构化意图校验：支持实体与微调参数', async () => {
    const { emitDirectorIntentTool } = await import('../../src/agents/director/tools/emit-director-intent.tool.js');
    const res = await (emitDirectorIntentTool as any).execute({
      action: 'modify',
      skill: 'character-portrait',
      target: '阿诺（青年版）',
      content: '换成年轻人面孔',
    });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.intent.action, 'modify');
    assert.strictEqual(res.intent.target, '阿诺（青年版）');
  });

  await t.test('5. emitDirectorIntentTool 结构化枚举锁死：非法 action 刚性校验阻断', async () => {
    const { DirectorIntentSchema } = await import('../../src/agents/director/tools/emit-director-intent.tool.js');
    const invalid = DirectorIntentSchema.safeParse({ action: 'invalid_action' });
    assert.strictEqual(invalid.success, false, '非法 action 必须被 Zod 拦截');
  });

  await t.test('6. ContextAssembler 成功为当前工序注入导演 SOP 指引', () => {
    const assembler = ContextAssembler.getInstance();
    const instructions = assembler.buildSystemInstructions(testPid, testSid);

    assert.ok(instructions.includes('【当前工序阶段导演 SOP 作业指引】'), '必须挂载当前阶段 SOP');
    assert.ok(instructions.includes('故事主干') || instructions.includes('导演工作重心') || instructions.includes('核心任务'), '必须注入具体工序业务指导');
  });

  await t.test('7. ContextAssembler 在 COMPLETED 终局阶段注入禁止推进指令', () => {
    const proj = store.getProject(testPid)!;
    proj.currentStage = WorkflowStage.COMPLETED;
    store.saveProject(proj);

    const assembler = ContextAssembler.getInstance();
    const instructions = assembler.buildSystemInstructions(testPid, testSid);
    assert.ok(instructions.includes('【互动影游母带终局状态 (COMPLETED)】'));
    assert.ok(instructions.includes('绝对严禁再提议进入下一阶段'));
  });

  await t.test('8. 修改源头裁决：镜头微调回分镜文本源，已落盘关键帧进入 cascade 失效重推', () => {
    store.setArtifact(testPid, WorkflowStage.STORYBOARD, {
      shots: [{ shotId: 'shot_1', visualComposition: '测试特写' }],
    });
    store.setArtifact(testPid, WorkflowStage.KEYFRAME_REFERENCE, {
      frames: [{ shotId: 'shot_1', imagePath: '/tmp/shot_1.png' }],
    });
    const plan = resolveModifySource(testPid, {
      target: 'shot_1',
      content: '这个镜头的景别改成特写',
      currentStage: WorkflowStage.KEYFRAME_REFERENCE,
      skillHint: 'keyframe-reference',
    });
    assert.strictEqual(plan.sourceSkill, 'storyboard', '镜头定义在分镜文本，必须从分镜改起');
    assert.strictEqual(plan.basis, 'text-source');
    assert.ok(
      plan.cascadeStages.includes(WorkflowStage.KEYFRAME_REFERENCE),
      '关键帧由分镜派生，源头变更后必须失效重推'
    );
  });
});
