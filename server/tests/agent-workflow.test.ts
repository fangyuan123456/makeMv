import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { z } from 'zod';
import { GenericAgent } from '../src/agents/generic/agent.js';
import { LookdevAgent } from '../src/agents/lookdev/agent.js';
import { PlannerAgent } from '../src/agents/planner/agent.js';
import { StoryboardAgent } from '../src/agents/storyboard/agent.js';
import { mergeStreamedAndToolReply } from '../src/agents/runtime/runner.js';
import { createIntentTools } from '../src/agents/runtime/intent-tool.js';
import { JsonStreamStringExtractor } from '../src/utils/JsonStreamStringExtractor.js';
import { dispatchApprovedIntent } from '../src/agents/runtime/task-events.js';
import { taskStore, taskToolRegistry } from '../src/task-engine/index.js';
import { BaseTaskTool } from '../src/tools/base/task-tool.js';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { mergeExtractedEntities } from '../src/project-store/entity-preservation.js';
import { getProjectDir } from '../src/project-store/artifact-fs.js';
import { summaryEvents } from '../src/agents/runtime/summary-events.js';
import { applyCharacterPoseConstraint } from '../src/tools/film-production/lookdev-tool/character/prompt.js';
import { renderLookdevTarget } from '../src/tools/film-production/lookdev-tool/render.js';
import { MediaProviderFactory } from '../src/media/providers/MediaProviderFactory.js';
import { MockImageProvider } from '../src/media/providers/MockImageProvider.js';

test('summary stream replays its current text and flushes pending chunks before completion', () => {
  const received: Array<{ type: string; text?: string; offset?: number }> = [];
  const unsubscribe = summaryEvents.subscribe((event) => received.push(event));
  try {
    summaryEvents.begin('test_project', 'planner', 'test_message');
    summaryEvents.append('test_project', 'planner', 'test_message', '前半段');
    assert.equal(summaryEvents.snapshots('test_project')[0]?.text, '前半段');
    summaryEvents.finish('test_project', 'planner', 'test_message');
    assert.deepEqual(received.map((event) => event.type), ['start', 'chunk', 'done']);
    assert.equal(received[1].text, '前半段');
    assert.equal(received[1].offset, 0);
    assert.equal(summaryEvents.snapshots('test_project').length, 0);
  } finally {
    unsubscribe();
  }
});

test('session IDs cannot escape the project chat directory', () => {
  const projectId = `test_session_path_${Date.now()}`;
  assert.throws(
    () => new GenericAgent({ projectId, sessionId: '../outside' }),
    /非法会话 ID/
  );
  fs.rmSync(getProjectDir(projectId), { recursive: true, force: true });
});

class InstantTool extends BaseTaskTool<{ value: number }, { value: number }> {
  public readonly toolName = 'test.chat_workflow';
  public readonly description = '测试会话任务';

  protected buildWorkflow(): any {
    return {};
  }

  public override async execute(args: any): Promise<any> {
    await args.callbacks.onResult({ success: true, data: { value: args.input.value }, durationMs: 0 });
  }
}

class IntentTestAgent extends GenericAgent {
  protected override getIntentToolSpecs() {
    return [
      {
        toolName: 'test.chat_workflow',
        title: '测试任务',
        description: '测试会话任务',
        schema: z.object({ projectId: z.string(), value: z.number() }),
      },
    ];
  }

  public resolve(args: any): any {
    return this.resolveDirectorIntent(args);
  }
}

test('lookdev agent resolves a single-entity propose intent correctly', () => {
  const projectId = `test_lookdev_propose_${Date.now()}`;
  const store = ProjectStore.getInstance();
  store.setArtifact(projectId, 'lookdev_entities', {
    characters: [{ characterId: 'char_001', name: '林薇' }],
    locations: [],
    items: [],
  });
  const session = new LookdevAgent({ projectId });
  try {
    // 单实体原子工具契约：直接 targetKind + targetId 参数
    const proposal = (session as any).resolveDirectorIntent({
      action: 'propose',
      targetTool: 'film.lookdev',
      title: '角色定妆',
      description: '为指定角色生成定妆图',
      params: { targetKind: 'character', targetId: 'char_001' },
    });
    assert.equal(proposal.action, 'propose');
    assert.equal(proposal.tool, 'film.lookdev');
    assert.equal(proposal.params.targetKind, 'character');
    assert.equal(proposal.params.targetId, 'char_001');

    // 不存在的实体应被门禁拦截回退为 chat_only
    const blocked = (session as any).resolveDirectorIntent({
      action: 'propose',
      targetTool: 'film.lookdev',
      title: '不存在角色',
      description: '为指定角色生成定妆图',
      params: { targetKind: 'character', targetId: 'char_missing' },
    });
    assert.equal(blocked.action, 'chat_only');
  } finally {
    fs.rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
});

test('approval only executes the pending proposal and its saved parameters', () => {
  const projectId = `test_chat_approval_${Date.now()}`;
  const session = new IntentTestAgent({ projectId, sessionId: 'approval_test' });
  try {
    const withoutProposal = session.resolve({
      action: 'approve', targetTool: 'other.tool', params: { value: 99 },
    });
    assert.equal(withoutProposal.action, 'chat_only');

    session.appendMessage({
      role: 'assistant', content: '待批准方案。',
      proposal: { action: 'propose', tool: 'test.chat_workflow', title: '测试任务', params: { value: 7 } },
    });
    const approved = session.resolve({
      action: 'approve', targetTool: 'other.tool', params: { value: 99 },
    });
    assert.equal(approved.tool, 'test.chat_workflow');
    assert.deepEqual(approved.params, { value: 7, projectId });
  } finally {
    fs.rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
});

test('approval rejects malformed saved asset modification parameters', () => {
  const projectId = `test_invalid_saved_proposal_${Date.now()}`;
  const session = new LookdevAgent({ projectId, sessionId: 'lookdev' });
  try {
    session.appendMessage({
      role: 'assistant',
      content: '待批准方案。',
      proposal: {
        action: 'propose',
        tool: 'film.asset_manifest',
        title: '新增道具',
        params: {
          projectId,
          mode: 'modify',
          modifications: [{ operation: 'add', entityType: 'item', name: '测试道具' }, 'instruction'],
        },
      },
    });
    assert.throws(
      () => (session as any).resolveDirectorIntent({ action: 'approve' }),
      /提案参数已失效/
    );
  } finally {
    fs.rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
});

test('approving a proposal card binds its ID and is idempotent without another model decision', () => {
  const projectId = `test_chat_card_approval_${Date.now()}`;
  const session = new IntentTestAgent({ projectId, sessionId: 'card_approval_test' });
  try {
    const proposal = session.appendMessage({
      role: 'assistant', content: '待批准方案。',
      proposal: { action: 'propose', tool: 'test.chat_workflow', title: '测试任务', params: { value: 7 } },
    });
    const approved = session.approveProposal(proposal.id);
    assert.equal((approved.intent as any)?.action, 'approve');
    assert.equal((approved.intent as any)?.params.value, 7);
    assert.equal(session.getMessages().find((message) => message.id === proposal.id)?.proposalResolved, true);
    const repeated = session.approveProposal(proposal.id);
    assert.equal(repeated.messageId, approved.messageId);
    assert.equal(session.getMessages().length, 3);
  } finally {
    fs.rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
});

test('approval dispatch and completion summary belong to the server workflow', async () => {
  const projectId = `test_chat_workflow_${Date.now()}`;
  const sessionId = 'workflow_test';
  const session = new GenericAgent({ projectId, sessionId });
  const originalStream = GenericAgent.prototype.stream;
  let summaryCalls = 0;
  const streamEvents: string[] = [];
  const unsubscribe = summaryEvents.subscribe((event) => {
    if (event.projectId === projectId) streamEvents.push(event.type);
  });

  (GenericAgent.prototype as any).stream = async function (options: any) {
    assert.equal(options.isSystemTrigger, true);
    assert.ok(options.targetMessageId);
    summaryCalls++;
    options.onTextChunk?.('复盘片段');
    const message = this.getMessages().find((item: any) => item.id === options.targetMessageId);
    this.updateMessage(options.targetMessageId, {
      content: `${message.content}\n\n---\n\n任务已完成。`,
      postSummarySpeech: '任务已完成。',
      metadata: { ...message.metadata, summaryStatus: 'completed' },
    });
    return { cleanText: '任务已完成。', intent: null, messageId: options.targetMessageId };
  };

  try {
    taskToolRegistry.register(new InstantTool());
    const proposal = session.appendMessage({
      role: 'assistant',
      content: '待批准方案。',
      proposal: { action: 'propose', tool: 'test.chat_workflow', title: '测试任务', params: { value: 7 } },
    });
    // 批准入口已关闭绑定方案；派发阶段不得关闭随后出现的其他卡片。
    session.updateMessage(proposal.id, { proposalResolved: true });
    const message = session.appendMessage({ role: 'assistant', content: '已获批准。', proposalResolved: true,
      metadata: { approvedProposalId: proposal.id } });
    const laterProposal = session.appendMessage({ role: 'assistant', content: '另一份待审方案', proposalResolved: false,
      proposal: { action: 'propose', tool: 'test.chat_workflow', title: '下一任务', params: { value: 8 } } });
    const result: any = {
      cleanText: message.content,
      messageId: message.id,
      intent: {
        action: 'approve',
        tool: 'test.chat_workflow',
        title: '测试任务',
        params: { value: 7 },
      },
    };

    await dispatchApprovedIntent(session, result);
    assert.ok(result.task?.taskId);
    assert.equal(taskStore.getTask(result.task.taskId)?.input.value, 7);

    for (let attempt = 0; attempt < 50; attempt++) {
      if (session.getMessages().find((item) => item.id === message.id)?.metadata?.summaryStatus === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const saved = session.getMessages().find((item) => item.id === message.id)!;
    assert.equal(session.getMessages().find((item) => item.id === proposal.id)?.proposalResolved, true);
    assert.equal(session.getMessages().find((item) => item.id === laterProposal.id)?.proposalResolved, false);
    assert.equal(saved.taskId, result.task.taskId);
    assert.equal(saved.taskStatus, 'completed');
    assert.match(saved.content, /任务已完成/);
    assert.equal(summaryCalls, 1);
    assert.deepEqual(streamEvents, ['start', 'chunk', 'done']);

    await dispatchApprovedIntent(session, result);
    assert.equal(result.task.taskId, saved.taskId);
    assert.equal(summaryCalls, 1);
  } finally {
    GenericAgent.prototype.stream = originalStream;
    unsubscribe();
    fs.rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
});

test('mergeStreamedAndToolReply preserves tool reply even when model emits a lead-in text-delta first', () => {
  // 1. 先吐过渡开场白，再在 tool.reply 里输出完整复盘：自动合并并补推正文增量
  const leadIn = mergeStreamedAndToolReply({
    streamedOutputSource: 'text',
    fullRawText: '两步全部跑通，工序 1 收官。给你一份全景复盘。',
    streamedReplyText: '一、世界观与主线：……',
    toolReply: '一、世界观与主线：……',
  });
  assert.equal(leadIn.finalText, '两步全部跑通，工序 1 收官。给你一份全景复盘。\n\n一、世界观与主线：……');
  assert.equal(leadIn.appendChunk, '\n\n一、世界观与主线：……');

  // 2. tool.reply 以 fullRawText 开头：去重且仅补推后缀
  const prefixOverlap = mergeStreamedAndToolReply({
    streamedOutputSource: 'text',
    fullRawText: '两步全部跑通。',
    streamedReplyText: '',
    toolReply: '两步全部跑通。下面是详细复盘内容。',
  });
  assert.equal(prefixOverlap.finalText, '两步全部跑通。下面是详细复盘内容。');
  assert.equal(prefixOverlap.appendChunk, '下面是详细复盘内容。');

  // 3. 两者完全一致：不重复拼接、不补推
  const duplicate = mergeStreamedAndToolReply({
    streamedOutputSource: 'text',
    fullRawText: '已完成收官复盘。',
    streamedReplyText: '已完成收官复盘。',
    toolReply: '已完成收官复盘。',
  });
  assert.equal(duplicate.finalText, '已完成收官复盘。');
  assert.equal(duplicate.appendChunk, '');

  // 4. 纯工具流且无截断：不重复补推
  const pureTool = mergeStreamedAndToolReply({
    streamedOutputSource: 'tool',
    fullRawText: '',
    streamedReplyText: '完整方案说明',
    toolReply: '完整方案说明',
  });
  assert.equal(pureTool.finalText, '完整方案说明');
  assert.equal(pureTool.appendChunk, '');
});

test('universal intent tools are always attached so LLM can propose or chat_only', () => {
  const specs = [
    {
      toolName: 'test.chat_workflow',
      title: '测试任务',
      description: '测试',
      schema: z.object({ projectId: z.string() }),
    },
  ];
  assert.ok(createIntentTools(specs, true));
  assert.ok(createIntentTools(specs, false));
});

test('JsonStreamStringExtractor only extracts top-level target key and skips non-target string literals', () => {
  const chunks: string[] = [];
  const extractor = new JsonStreamStringExtractor({
    targetKeys: ['reply'],
    onChunk: (chunk) => chunks.push(chunk),
  });
  const payload = JSON.stringify({
    action: 'propose',
    reasoning: '不要被这里的 "reply": "假回复" 和 } 干扰',
    params: { reply: '嵌套对象里的 reply 也不能提取', instruction: 'a: "b"' },
    reply: '真正给创作者的回复\n第二行',
  });
  // 按小分片喂入，模拟流式 tool-call-delta
  for (let i = 0; i < payload.length; i += 5) {
    extractor.feed(payload.slice(i, i + 5));
  }
  assert.equal(chunks.join(''), '真正给创作者的回复\n第二行');
});

test('storyboard agent injects current clipId for single-step storyboard planning', () => {
  const projectId = `test_sb_clip_${Date.now()}`;
  const session = new StoryboardAgent({ projectId, clipId: 'c2' });
  try {
    const intent = (session as any).resolveDirectorIntent({
      action: 'propose',
      targetTool: 'film.shooting_script',
      title: '优化第二幕台本与分镜',
      description: '增加第二幕特写镜头',
      params: { instruction: '增加特写镜头' },
    });
    assert.equal(intent.action, 'propose');
    assert.equal(intent.tool, 'film.shooting_script');
    assert.equal(intent.params.clipId, 'c2');
    assert.equal(intent.params.projectId, projectId);
  } finally {
    fs.rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
});

test('single-step propose and modify validate tool input schema upfront', () => {
  const projectId = `test_single_schema_${Date.now()}`;
  const session = new IntentTestAgent({ projectId, sessionId: 'schema_test' });
  try {
    assert.throws(
      () =>
        session.resolve({
          action: 'propose',
          targetTool: 'test.chat_workflow',
          description: '测试参数完整性',
          params: {},
        }),
      /参数不完整/
    );

    session.appendMessage({
      role: 'assistant',
      content: '待审方案',
      proposal: { action: 'propose', tool: 'test.chat_workflow', title: '测试任务', params: { value: 1 } },
    });
    assert.throws(
      () =>
        session.resolve({
          action: 'modify',
          targetTool: 'test.chat_workflow',
          description: '修改测试任务参数',
          params: { value: 'not-a-number' },
        }),
      /参数不完整/
    );
  } finally {
    fs.rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
});

test('planner prompt includes funnel matrix and session state exposes pending proposals for all agents', async () => {
  const projectId = `test_state_section_${Date.now()}`;
  const planner = new PlannerAgent({ projectId });
  const lookdev = new LookdevAgent({ projectId });
  try {
    const plannerPrompt = await planner.buildFullSystemPrompt();
    assert.match(plannerPrompt, /意图决策漏斗/);

    lookdev.appendMessage({
      role: 'assistant',
      content: '定妆方案待审',
      proposal: {
        action: 'propose',
        tool: 'film.lookdev',
        title: '角色定妆 · 艾琳',
        params: { targetKind: 'character', targetId: 'char_ailin' },
      },
    });
    const stateSection = (lookdev as any).renderSessionStateSection();
    assert.match(stateSection, /角色定妆 · 艾琳/);
    assert.match(stateSection, /char_ailin/);
    assert.match(stateSection, /"tool":"film\.lookdev"/);
  } finally {
    fs.rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
});

test('createIntentTools narrows actions without pending proposal and enforces targetTool enum', () => {
  const specs = [
    {
      toolName: 'film.lookdev',
      title: '定妆',
      description: '定妆生成',
      schema: z.object({ projectId: z.string(), targetKind: z.string(), targetId: z.string() }),
    },
    {
      toolName: 'film.image_upscale',
      title: '超分',
      description: '高清超分',
      schema: z.object({ projectId: z.string(), targetKind: z.string(), targetId: z.string() }),
    },
  ];
  const noPending = createIntentTools(specs, false, false)!;
  const schema = noPending.emit_director_intent.inputSchema;

  // 无待审提案时，禁止选择 modify / approve
  assert.equal(schema.safeParse({ action: 'modify', reply: '修改' }).success, false);
  assert.equal(schema.safeParse({ action: 'approve', reply: '同意' }).success, false);
  // tool 必须命中真实枚举值
  assert.equal(
    schema.safeParse({ action: 'propose', tool: 'film.nonexistent', reply: '测试' }).success,
    false
  );
  assert.equal(schema.safeParse({ action: 'propose', tool: 'film.lookdev', params: {}, description: '角色定妆', reply: '重出定妆' }).success, true);
  assert.equal(schema.safeParse({ action: 'propose', operations: [{ tool: 'film.lookdev', title: '角色定妆', params: {} }], description: '批量定妆', reply: '开始定妆' }).success, true);

  // 存在待审提案时，开放 modify / approve
  const withPending = createIntentTools(specs, false, true)!;
  assert.equal(withPending.emit_director_intent.inputSchema.safeParse({ action: 'approve', reply: '同意' }).success, true);
  assert.equal(withPending.emit_director_intent.inputSchema.safeParse({ action: 'approve', reply: '同意', params: {} }).success, false);
});

test('AgentRunner silently repairs invalid tool call missing targetTool', async () => {
  const projectId = `test_silent_repair_${Date.now()}`;
  class RepairableAgent extends IntentTestAgent {
    public repairCalled = 0;
    protected override async repairInvalidIntentCall(): Promise<{ intent: any; reply?: string } | null> {
      this.repairCalled++;
      return {
        intent: this.resolveDirectorIntent({
          action: 'propose',
          targetTool: 'test.chat_workflow',
          title: '自愈后测试任务',
          description: '补齐测试任务参数',
          params: { value: 42 },
          reply: '已为你重新生成方案，确认后即开跑。',
        }),
        reply: '已为你重新生成方案，确认后即开跑。',
      };
    }
  }
  const session = new RepairableAgent({ projectId, sessionId: 'repair_test' });
  try {
    // 校验缺失 targetTool 确实会触发 resolveDirectorIntent 抛错，而自愈钩子可返回合法提案
    assert.throws(
      () => session.resolve({ action: 'propose', description: '测试任务', reply: '确认后即开跑。' }),
      /当前提案缺少明确的目标工具/
    );
    const repaired = await (session as any).repairInvalidIntentCall();
    assert.equal(session.repairCalled, 1);
    assert.equal(repaired.intent.action, 'propose');
    assert.equal(repaired.intent.tool, 'test.chat_workflow');
    assert.equal(repaired.intent.params.value, 42);
  } finally {
    fs.rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
});

test('mergeExtractedEntities preserves untouched categories when targetKinds is specified', () => {
  const oldEntities = {
    artStyle: '原有电影写实风格',
    characters: [{ characterId: 'char_old', name: '旧角色', imageUrl: '/media/old_char.png' }],
    locations: [{ locationId: 'loc_mid_deck', name: '中层甲板', imageUrl: '/media/loc_mid.png' }],
    items: [{ itemId: 'item_lock', name: '封锁记录', imageUrl: '/media/item_lock.png' }],
  };
  const newEntities = {
    artStyle: '新提取风格',
    characters: [{ characterId: 'char_new', name: '新角色', imageUrl: '' }],
    locations: [{ locationId: 'loc_corridor_mid', name: '中层甲板走廊', imageUrl: '' }],
    items: [{ itemId: 'item_key', name: '密钥卡', imageUrl: '' }],
  };

  const merged = mergeExtractedEntities(oldEntities, newEntities, ['character']);
  assert.equal(merged.artStyle, '原有电影写实风格');
  assert.equal(merged.characters[0].characterId, 'char_new');
  assert.deepEqual(merged.locations, oldEntities.locations);
  assert.deepEqual(merged.items, oldEntities.items);
});

test('ProjectStore hydrates film_spec from storyboards.json after memory cache reset', () => {
  const projectId = `test_film_spec_hydrate_${Date.now()}`;
  const store = ProjectStore.getInstance();
  const projectDir = getProjectDir(projectId);
  try {
    store.getProject(projectId);
    const clips = [{ clipId: 'c1', sourceNodeId: 'c1', targetDurationSec: 4, shots: [{ shotId: 'c1-01', clipId: 'c1' }] }];
    fs.writeFileSync(`${projectDir}/storyboards.json`, JSON.stringify(clips), 'utf-8');
    (store as any).cache.delete(projectId);

    const filmSpec = store.getArtifact<any>(projectId, 'film_spec');
    assert.ok(filmSpec);
    assert.equal(filmSpec.projectId, projectId);
    assert.equal(filmSpec.clips.length, 1);
    assert.equal(filmSpec.clips[0].shots[0].shotId, 'c1-01');
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('ProjectStore.mutateArtifact supports initial creation and disk flush when artifact does not pre-exist', () => {
  const projectId = `test_mutate_init_${Date.now()}`;
  const store = ProjectStore.getInstance();
  const projectDir = getProjectDir(projectId);
  try {
    store.getProject(projectId);

    // 1. 验证初次创建 film_spec：当产物不存在时，mutator 返回新对象成功落盘
    const mutatedSpec = store.mutateArtifact(projectId, 'film_spec', (current) => {
      const spec = current || { clips: [] };
      spec.clips.push({ clipId: 'c1', title: '测试分幕' });
      return spec;
    });

    assert.ok(mutatedSpec);
    assert.equal(mutatedSpec.clips.length, 1);
    assert.equal(mutatedSpec.clips[0].clipId, 'c1');

    // 磁盘验证
    const diskFile = `${projectDir}/film_spec.json`;
    assert.ok(fs.existsSync(diskFile), 'film_spec.json 应成功写盘');
    const parsed = JSON.parse(fs.readFileSync(diskFile, 'utf-8'));
    assert.equal(parsed.clips[0].clipId, 'c1');

    // 2. 验证 mutator 返回空且无 initialValue 时仍保持异常防护
    assert.throws(
      () => store.mutateArtifact(projectId, 'non_existent_key', () => {}),
      /无法更新不存在的产物: non_existent_key/
    );
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('AgentRunner resolveDirectorIntent respects explicit description and falls back to title', () => {
  const projectId = `test_intent_desc_${Date.now()}`;
  const agent = new IntentTestAgent({ projectId, sessionId: 'test_session' });
  try {
    // 1. 当未显式传递 description 时，自愈回退提取 title
    const intentFallback = (agent as any).resolveDirectorIntent({
      action: 'propose', targetTool: 'test.chat_workflow', title: '角色定妆 · 艾琳',
      params: { value: 100 }, reply: '已出具方案',
    });
    assert.equal(intentFallback.description, '角色定妆 · 艾琳');

    // 2. 当显式传递 description 时，优先使用面向创作者的 description
    const intentExplicit = (agent as any).resolveDirectorIntent({
      action: 'propose',
      targetTool: 'test.chat_workflow',
      title: '角色定妆 · 艾琳',
      description: '三视图双脚并拢硬纠偏，零缝隙贴合',
      params: { value: 100 },
      reply: '已出具方案',
    });
    assert.equal(intentExplicit.description, '三视图双脚并拢硬纠偏，零缝隙贴合');
  } finally {
    const dir = getProjectDir(projectId);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('chat persists task bindings while projecting current TaskStore state', () => {
  const projectId = `test_task_projection_${Date.now()}`;
  const session = new IntentTestAgent({ projectId, sessionId: 'projection' });
  try {
    const taskId = `task_projection_${Date.now()}`;
    taskStore.saveTask({ taskId, projectId, toolName: 'test.chat_workflow', status: 'running',
      input: {}, createdAt: Date.now(), progress: { current: 3, total: 5, percent: 60, message: '处理中' } });
    const message = session.appendMessage({ role: 'assistant', content: '开始处理', taskId,
      taskStatus: 'pending', taskProgress: { percent: 10 } });
    const file = `${getProjectDir(projectId)}/chat/projection.json`;
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))[0];
    assert.equal(saved.taskId, taskId);
    assert.equal(saved.taskStatus, undefined);
    assert.equal(saved.taskProgress, undefined);
    assert.equal(session.getMessages()[0].taskProgress?.percent, 60);
    taskStore.saveTask({ taskId, projectId, toolName: 'test.chat_workflow', status: 'completed',
      input: {}, createdAt: Date.now(), progress: { current: 5, total: 5, percent: 100, message: '完成' } });
    assert.equal(session.getMessages()[0].taskStatus, 'completed');
    assert.equal(session.getMessages()[0].taskProgress?.percent, 100);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[0].taskProgress, undefined);
    assert.equal(message.taskId, taskId);
  } finally {
    fs.rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
});

test('plan steps follow replacement tasks without rewriting chat history', () => {
  const projectId = `test_plan_projection_${Date.now()}`;
  const session = new IntentTestAgent({ projectId, sessionId: 'plan_projection' });
  try {
    const oldTaskId = `task_old_${Date.now()}`;
    const newTaskId = `task_new_${Date.now()}`;
    taskStore.saveTask({ taskId: oldTaskId, projectId, toolName: 'test.chat_workflow',
      status: 'failed', input: {}, createdAt: Date.now(), error: '旧任务失败' });
    session.appendMessage({ role: 'assistant', content: '开始处理', metadata: { summaryStatus: 'skipped' },
      planSteps: [{ stepIndex: 0, taskId: oldTaskId, tool: 'test.chat_workflow', title: '测试步骤', status: 'failed' }] });
    taskStore.saveTask({ taskId: newTaskId, projectId, toolName: 'test.chat_workflow',
      replacesTaskId: oldTaskId, status: 'running', input: {}, createdAt: Date.now() + 1 });
    const projected = session.getMessages()[0];
    assert.equal(projected.planSteps?.[0].taskId, newTaskId);
    assert.equal(projected.taskStatus, 'running');
    assert.equal(projected.metadata?.summaryStatus, 'pending');
    const saved = JSON.parse(fs.readFileSync(`${getProjectDir(projectId)}/chat/plan_projection.json`, 'utf8'))[0];
    assert.equal(saved.planSteps[0].taskId, oldTaskId);
    assert.equal(saved.planSteps[0].status, undefined);
  } finally {
    fs.rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
});

test('character pose contract applies feet_together constraint gracefully', () => {
  const prompt = applyCharacterPoseConstraint({ text: '角色正面全身站立', negative: '' },
    { stance: 'feet_together' });
  assert.match(prompt.text, /双脚严格并拢/);
  assert.match(prompt.negative, /双脚分开/);
});

test('visual edits update the selected image directly and record version history', async () => {
  const projectId = `test_visual_candidate_${Date.now()}`;
  const store = ProjectStore.getInstance();
  const originalUrl = `/media/${projectId}/assets/entities/original.png`;
  store.setArtifact(projectId, 'lookdev_entities', {
    artStyle: '写实',
    characters: [{ characterId: 'char_1', name: '角色', identity: '', appearanceSummary: '',
      promptZh: '原设定', imageUrl: originalUrl, selectedVersionId: 'v_original',
      versions: [{ versionId: 'v_original', imageUrl: originalUrl, createdAt: new Date().toISOString() }] }],
    locations: [], items: [],
  });
  MediaProviderFactory.setImageProvider(new MockImageProvider());
  try {
    const source = store.getArtifact<any>(projectId, 'lookdev_entities').characters[0];
    source.selectedVersionId = undefined;
    await assert.rejects(
      renderLookdevTarget({ projectId, targetKind: 'character', targetId: 'char_1',
        customPrompt: '换成黑色外套', force: true }, projectId, { reportProgress: () => {} } as any),
      /当前图片与选用版本不一致/,
    );
    source.selectedVersionId = 'v_original';
    const output = await renderLookdevTarget({ projectId, targetKind: 'character', targetId: 'char_1',
      customPrompt: '换成黑色外套', force: true }, projectId, { reportProgress: () => {} } as any);
    const entity = store.getArtifact<any>(projectId, 'lookdev_entities').characters[0];
    assert.equal(output.reviewStatus, 'accepted');
    assert.equal(entity.imageUrl, output.mediaUrl);
    assert.equal(entity.selectedVersionId, output.versionId);
    assert.equal(entity.promptZh, '换成黑色外套');
    assert.equal(entity.versions.at(-1).reviewStatus, 'accepted');
    assert.equal(entity.versions.at(-1).promptZh, '换成黑色外套');
  } finally {
    fs.rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
});

test('AgentRunner injects memory-only pending_proposal_context envelope into user turn when proposal is pending', () => {
  const projectId = `test_envelope_${Date.now()}`;
  const session = new LookdevAgent({ projectId });
  try {
    session.appendMessage({
      role: 'assistant',
      content: '方案待审',
      proposal: {
        action: 'propose',
        title: '角色定妆 · 艾琳',
        description: '为艾琳生成定妆图',
        params: { targetKind: 'character', targetId: 'char_ailin' },
        operations: [
          { tool: 'film.lookdev', title: '定妆 · 艾琳', params: { targetKind: 'character', targetId: 'char_ailin' } },
        ],
      },
    });

    const pending = [...session.getMessages()].reverse().find((m) => m.proposal && !m.proposalResolved);
    assert.ok(pending);
    assert.equal(pending.proposal?.title, '角色定妆 · 艾琳');

    // 落盘历史中无任何信封标签
    const diskMessages = session.getMessages();
    assert.equal(diskMessages.every((m) => !m.content.includes('<pending_proposal_context>')), true);
  } finally {
    fs.rmSync(getProjectDir(projectId), { recursive: true, force: true });
  }
});
