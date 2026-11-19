import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { getProjectDir } from '../src/project-store/artifact-fs.js';
import {
  computeProjectStaleMap,
  recordEntityUpdated,
  recordPrdUpdated,
  recordScreenplayUpdated,
  recordShotKeyframeUpdated,
  recordShotVideoUpdated,
  recordStoryboardUpdated,
} from '../src/project-store/freshness.js';
import {
  buildMultimodalUserContent,
  perceiveVisualContext,
  resolveVisionImages,
  _setVisionPerceiverForTest,
} from '../src/llm/vision-perception.js';
import { LookdevAgent } from '../src/agents/lookdev/agent.js';
import { StoryboardAgent } from '../src/agents/storyboard/agent.js';
import { partitionPlanWaves } from '../src/agents/runtime/task-events.js';
import { taskDispatcher, taskStore, taskToolRegistry } from '../src/task-engine/index.js';
import { BaseTaskTool } from '../src/tools/base/task-tool.js';

test('Universal Vision Perception supports multi-image observation, question-aware caching, multimodal content, and Agent hooks', async () => {
  const projectId = `test_vision_${Date.now()}`;
  const store = ProjectStore.getInstance();
  const projectDir = getProjectDir(projectId);
  const imgDir = path.join(projectDir, 'assets', 'entities');
  const kfDir = path.join(projectDir, 'keyframes');
  fs.mkdirSync(imgDir, { recursive: true });
  fs.mkdirSync(kfDir, { recursive: true });

  const charImg = path.join(imgDir, 'char_a_v1.png');
  const refImg = path.join(imgDir, 'char_a_ref.png');
  const firstKf = path.join(kfDir, 's1-first.png');
  const lastKf = path.join(kfDir, 's1-last.png');
  for (const file of [charImg, refImg, firstKf, lastKf]) {
    fs.writeFileSync(file, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]));
  }

  let invokeCount = 0;
  _setVisionPerceiverForTest(async ({ images, userMessage }) => {
    invokeCount++;
    const roles = images.map((i) => `${i.role}:${i.label}`).join('+');
    return `观察(${invokeCount}) [${roles}] 问题=${userMessage || '无'}`;
  });

  try {
    const charUrl = `/media/${projectId}/assets/entities/char_a_v1.png?t=v1`;
    const refUrl = `/media/${projectId}/assets/entities/char_a_ref.png`;
    const firstUrl = `/media/${projectId}/keyframes/s1-first.png`;
    const lastUrl = `/media/${projectId}/keyframes/s1-last.png`;

    // 1. 多图安全解析（去重 + 拦截路径穿越）
    const resolved = resolveVisionImages(projectId, [
      { mediaUrl: charUrl, label: '艾琳', role: '当前定妆实图' },
      { mediaUrl: charUrl, label: '艾琳重复', role: '重复' },
      { mediaUrl: refUrl, label: '艾琳', role: '原始参考底图' },
      { mediaUrl: `/media/${projectId}/../../etc/passwd.png`, label: '越界路径', role: '非法' },
    ]);
    assert.equal(resolved.length, 2);

    // 2. 携带创作者问题多图同看：相同问题命中缓存，换不同视觉问题重新定向观察
    const obs1 = await perceiveVisualContext({
      projectId,
      images: resolved,
      userMessage: '对比参考图，外套颜色和整体气质还原度如何？',
    });
    const obs2 = await perceiveVisualContext({
      projectId,
      images: resolved,
      userMessage: '对比参考图，外套颜色和整体气质还原度如何？',
    });
    assert.equal(obs1, obs2);
    assert.equal(invokeCount, 1);
    assert.match(obs1 || '', /当前定妆实图:艾琳\+原始参考底图:艾琳/);

    const obs3 = await perceiveVisualContext({
      projectId,
      images: resolved,
      userMessage: '她右手手里拿的是什么物件？我想换成对讲机',
    });
    assert.equal(invokeCount, 2);
    assert.match(obs3 || '', /对讲机/);

    // 3. 原生多模态通道消息组装（1 条文本 + 2 张图像 part）
    const mmContent = buildMultimodalUserContent('请分析这两张图的配色搭配', resolved);
    assert.equal(mmContent.length, 3);
    assert.equal(mmContent[0].type, 'text');
    assert.equal(mmContent[1].type, 'image');
    assert.equal(mmContent[2].type, 'image');

    // 4. LookdevAgent 返回定妆实图 + 参考底图双图；StoryboardAgent 返回首帧 + 末帧 + 出场角色定妆多图
    store.setArtifact(projectId, 'lookdev_entities', {
      characters: [{ characterId: 'char_a', name: '艾琳', imageUrl: charUrl, referenceImageUrl: refUrl }],
      locations: [],
      items: [],
    });
    store.setArtifact(projectId, 'storyboards', [
      {
        clipId: 'c1',
        shots: [
          {
            shotId: 's1',
            characters: ['char_a'],
            firstFrameImageUrl: firstUrl,
            lastFrameImageUrl: lastUrl,
          },
        ],
      },
    ]);

    const lookdevAgent = new LookdevAgent({ projectId });
    const lookdevRefs = (lookdevAgent as any).resolveFocusImages({
      location: '视觉定妆工坊 · 角色展台',
      target: { kind: 'character', id: 'char_a', label: '艾琳' },
    });
    assert.deepEqual(
      lookdevRefs.map((r: any) => r.role),
      ['当前定妆实图', '原始参考底图']
    );

    // 未点选具体卡片但用户主动发图时，依据结构化 meta.activeTab 附带当前展台候选角色实图
    const galleryCandidateRefs = (lookdevAgent as any).resolveFocusImages(
      { location: '视觉定妆工坊 · 角色展台', meta: { activeTab: 'characters' } },
      { hasAttachments: true }
    );
    assert.equal(galleryCandidateRefs.length, 1);
    assert.equal(galleryCandidateRefs[0].role, '当前展台候选角色实图');
    assert.match(galleryCandidateRefs[0].label, /艾琳\(ID: char_a\)/);

    const sbAgent = new StoryboardAgent({ projectId, clipId: 'c1' });
    const sbRefs = (sbAgent as any).resolveFocusImages({
      location: '单镜头处理页 · 末帧处理',
      target: { kind: 'shot', id: 's1', label: '镜头 01' },
      meta: { step: 'last' },
    });
    assert.deepEqual(
      sbRefs.map((r: any) => r.role),
      ['当前聚焦末帧', '同镜首帧', '出场角色定妆基准']
    );
  } finally {
    _setVisionPerceiverForTest(null);
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('Freshness lineage precisely marks stale downstream assets and clears after regeneration', async () => {
  const projectId = `test_freshness_${Date.now()}`;
  const store = ProjectStore.getInstance();
  const projectDir = getProjectDir(projectId);
  fs.mkdirSync(projectDir, { recursive: true });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  try {
    // 1. 顺序推进：剧本 -> PRD -> 分镜 -> 关键帧 -> 视频，此时全链路洁净无脏标记
    store.setArtifact(projectId, 'screenplay', '初始剧本正文'.repeat(30));
    recordScreenplayUpdated(projectId);
    await sleep(5);

    store.setArtifact(projectId, 'prd', { clips: [{ id: 'c1', title: '第1幕' }], wiring: [] });
    recordPrdUpdated(projectId);
    await sleep(5);

    store.setArtifact(projectId, 'storyboards', [
      {
        clipId: 'c1',
        shots: [
          { shotId: 's1', characters: ['char_a'], firstFrameImageUrl: '/media/s1.png', videoUrl: '/media/s1.mp4' },
          { shotId: 's2', characters: ['char_b'], firstFrameImageUrl: '/media/s2.png', videoUrl: '/media/s2.mp4' },
        ],
      },
    ]);
    recordStoryboardUpdated(projectId, ['c1']);
    recordShotKeyframeUpdated(projectId, 's1', 'first');
    recordShotKeyframeUpdated(projectId, 's2', 'first');
    await sleep(5);
    recordShotVideoUpdated(projectId, 's1');
    recordShotVideoUpdated(projectId, 's2');

    let stale = computeProjectStaleMap(projectId);
    assert.equal(stale.prd, undefined);
    assert.deepEqual(stale.clips, {});
    assert.deepEqual(stale.shotKeyframes, {});
    assert.deepEqual(stale.shotVideos, {});

    // 2. 剧本局部修订 -> 仅 PRD 标脏
    await sleep(5);
    recordScreenplayUpdated(projectId);
    stale = computeProjectStaleMap(projectId);
    assert.ok(stale.prd?.reason.includes('剧本'));

    // 3. PRD 重新拆解 -> PRD 清除脏态，c1 分镜标脏
    await sleep(5);
    recordPrdUpdated(projectId);
    stale = computeProjectStaleMap(projectId);
    assert.equal(stale.prd, undefined);
    assert.ok(stale.clips.c1?.reason.includes('PRD'));

    // 4. 仅角色 char_a 更新定妆 -> 仅引用 char_a 的 s1 关键帧标脏，s2 保持干净
    await sleep(5);
    recordEntityUpdated(projectId, { kind: 'character', id: 'char_a', label: '艾琳' });
    stale = computeProjectStaleMap(projectId);
    assert.ok(stale.shotKeyframes.s1?.reason.includes('艾琳'));
    assert.equal(stale.shotKeyframes.s2, undefined);

    // 5. s1 重绘关键帧 -> s1 关键帧脏态清除，但 s1 旧视频标脏；s2 视频仍干净
    await sleep(5);
    recordShotKeyframeUpdated(projectId, 's1', 'first');
    stale = computeProjectStaleMap(projectId);
    assert.equal(stale.shotKeyframes.s1, undefined);
    assert.ok(stale.shotVideos.s1?.reason.includes('首帧'));
    assert.equal(stale.shotVideos.s2, undefined);

    // 6. s1 重渲视频 -> s1 视频脏态清除
    await sleep(5);
    recordShotVideoUpdated(projectId, 's1');
    stale = computeProjectStaleMap(projectId);
    assert.equal(stale.shotVideos.s1, undefined);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('partitionPlanWaves groups independent same-tool steps and separates cross-tool or same-entity steps', () => {
  const waves1 = partitionPlanWaves('p1', [
    { tool: 'film.lookdev', params: { targetKind: 'character', targetId: 'c1' } },
    { tool: 'film.lookdev', params: { targetKind: 'character', targetId: 'c2' } },
    { tool: 'film.image_upscale', params: { targetKind: 'character', targetId: 'c1' } },
    { tool: 'film.image_upscale', params: { targetKind: 'character', targetId: 'c2' } },
  ]);
  assert.equal(waves1.length, 2);
  assert.deepEqual(waves1[0].map((w) => w.index), [0, 1]);
  assert.deepEqual(waves1[1].map((w) => w.index), [2, 3]);

  const waves2 = partitionPlanWaves('p1', [
    { tool: 'planner.screenplay_writer', params: { userPrompt: 'test' } },
    { tool: 'planner.script_to_prd', params: {} },
  ]);
  assert.equal(waves2.length, 2);
  assert.deepEqual(waves2[0].map((w) => w.index), [0]);
  assert.deepEqual(waves2[1].map((w) => w.index), [1]);

  const waves3 = partitionPlanWaves('p1', [
    { tool: 'film.lookdev', params: { targetKind: 'character', targetId: 'c1' } },
    { tool: 'film.lookdev', params: { targetKind: 'character', targetId: 'c1' } },
  ]);
  assert.equal(waves3.length, 2);
});

test('TaskDispatcher runs independent same-wave entity tasks concurrently and blocks dependent Wave 2 until Wave 1 finishes', async () => {
  const projectId = `test_wave_exec_${Date.now()}`;
  const projectDir = getProjectDir(projectId);
  fs.mkdirSync(projectDir, { recursive: true });

  const originalLookdev = taskToolRegistry.getTool('film.lookdev');
  const originalUpscale = taskToolRegistry.getTool('film.image_upscale');

  let activeCount = 0;
  let maxConcurrent = 0;
  const timeline: string[] = [];

  class FakeDelayTool extends BaseTaskTool<any, any> {
    public readonly toolName: string;
    public readonly description = '测试延时工具';
    constructor(name: string) {
      super();
      this.toolName = name;
    }
    public override resolveConcurrencyKey(pid: string, input?: Record<string, any>): string | null {
      const targetId = typeof input?.targetId === 'string' ? input.targetId.trim() : '';
      return targetId ? `${pid}:${input?.targetKind || 'entity'}:${targetId}` : null;
    }
    protected buildWorkflow(): any {
      return {};
    }
    public override async execute(args: any): Promise<any> {
      const tag = `${this.toolName}:${args.input.targetId}`;
      activeCount++;
      maxConcurrent = Math.max(maxConcurrent, activeCount);
      timeline.push(`start:${tag}`);
      await new Promise((r) => setTimeout(r, 80));
      timeline.push(`end:${tag}`);
      activeCount--;
      await args.callbacks.onResult({
        success: true,
        data: { targetKind: args.input.targetKind, targetId: args.input.targetId, renderedCount: 1 },
        durationMs: 80,
      });
    }
  }

  taskToolRegistry.register(new FakeDelayTool('film.lookdev'));
  taskToolRegistry.register(new FakeDelayTool('film.image_upscale'));

  try {
    // Wave 1: 两个不同实体并发
    const t1 = await taskDispatcher.dispatch({
      projectId,
      toolName: 'film.lookdev',
      input: { targetKind: 'character', targetId: 'char_1' },
    });
    const t2 = await taskDispatcher.dispatch({
      projectId,
      toolName: 'film.lookdev',
      input: { targetKind: 'character', targetId: 'char_2' },
    });
    // Wave 2: 依赖 Wave 1 全部完成
    const t3 = await taskDispatcher.dispatch({
      projectId,
      toolName: 'film.image_upscale',
      input: { targetKind: 'character', targetId: 'char_1' },
      dependsOnTaskIds: [t1.taskId, t2.taskId],
    });

    for (let i = 0; i < 60; i++) {
      const done = [t1, t2, t3].every((t) => taskStore.getTask(t.taskId)?.status === 'completed');
      if (done) break;
      await new Promise((r) => setTimeout(r, 25));
    }

    assert.equal(taskStore.getTask(t1.taskId)?.status, 'completed');
    assert.equal(taskStore.getTask(t2.taskId)?.status, 'completed');
    assert.equal(taskStore.getTask(t3.taskId)?.status, 'completed');

    // Wave 1 两个独立实体必须实现真实并发
    assert.equal(maxConcurrent >= 2, true, `预期 Wave 1 并发执行，实际最大并发=${maxConcurrent}`);

    // Wave 2 必须在 Wave 1 两个任务全部 end 之后才 start
    const wave2StartIdx = timeline.indexOf('start:film.image_upscale:char_1');
    const wave1End1Idx = timeline.indexOf('end:film.lookdev:char_1');
    const wave1End2Idx = timeline.indexOf('end:film.lookdev:char_2');
    assert.ok(wave2StartIdx > wave1End1Idx && wave2StartIdx > wave1End2Idx, `Wave 2 不得抢跑: ${timeline.join(' -> ')}`);
  } finally {
    if (originalLookdev) taskToolRegistry.register(originalLookdev);
    if (originalUpscale) taskToolRegistry.register(originalUpscale);
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('AgentRunner merges user chat image attachments ahead of viewport images and works even without viewport focus', async () => {
  const projectId = `test_chat_att_${Date.now()}`;
  const projectDir = getProjectDir(projectId);
  const chatDir = path.join(projectDir, 'assets', 'chat');
  fs.mkdirSync(chatDir, { recursive: true });
  const chatImg = path.join(chatDir, 'ref_style.png');
  fs.writeFileSync(chatImg, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 5, 6, 7, 8]));

  let capturedImages: any[] = [];
  _setVisionPerceiverForTest(async ({ images, userMessage }) => {
    capturedImages = images;
    return `看到了用户发图 ${images.map((i) => i.label).join(',')}，问题=${userMessage}`;
  });

  try {
    const agent = new LookdevAgent({ projectId });
    const attUrl = `/media/${projectId}/assets/chat/ref_style.png`;
    // 验证会话持久化严格保留图片附件
    agent.appendMessage({
      role: 'user',
      content: '参考我发的图改一下衣服',
      attachments: [{ url: attUrl, name: '服装参考图' }],
    });
    const persisted = agent.getMessages();
    assert.equal(persisted[0]?.attachments?.[0]?.url, attUrl);

    const resolved = resolveVisionImages(projectId, [
      { mediaUrl: attUrl, label: '服装参考图', role: '创作者本轮发送图片', note: `本地路径: ${attUrl}` },
    ]);
    // 即使 focus 为 undefined，renderFocusContextSection 仍能渲染出聊天附件与视觉观察
    const section = await (agent as any).renderFocusContextSection(undefined, {
      userMessage: '参考我发的图改一下衣服',
      attachments: [{ url: attUrl, name: '服装参考图' }],
      images: resolved,
    });
    assert.match(section, /创作者本轮发送了 1 张图片/);
    assert.match(section, /referenceImageUrls/);
    assert.match(section, /看到了用户发图 服装参考图/);
    assert.equal(capturedImages.length, 1);
    assert.equal(capturedImages[0].role, '创作者本轮发送图片');
  } finally {
    _setVisionPerceiverForTest(null);
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
