import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { KeyframeReferenceSkill } from '../../skills/keyframe-reference/KeyframeReferenceSkill.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { LLMRegistry } from '../../llm/LLMRegistry.js';
import { WorkflowStage, SessionStatus } from '../../types/index.js';
import type { LLMService, LLMOptions } from '../../llm/LLMService.js';

class MockKeyframeLLM implements LLMService {
  hasVisionCapability(): boolean { return true; }
  async generateText(): Promise<string> { return ''; }
  async generateTextWithImages(): Promise<string> { return ''; }
  async generateMultiTurn(): Promise<string> { return ''; }
  async generateMultiTurnStream(): Promise<string> { return ''; }

  async generateObject<T>(_prompt: string, _schema: any, _sys?: string, options?: LLMOptions): Promise<T> {
    if (options?.stage === 'keyframe_prompt_spec') {
      return {
        keyframes: [
          {
            shotId: 'shot_1',
            prompt: '黄铜怀表特写，倒转的指针闪烁着冷冽金属反光，蒸汽朋克电影质感，超清8K',
          },
          {
            shotId: 'shot_2',
            prompt: '青年工匠雷恩惊愕的特写，背景中所有齿轮疯狂逆转，高对比度影视光影',
          },
        ],
      } as T;
    }

    return {} as T;
  }
}

describe('KeyframeReferenceSkill 分镜头关键帧首帧渲染技能', () => {
  const store = ProjectStore.getInstance();
  const kfSkill = new KeyframeReferenceSkill();
  const mockLLM = new MockKeyframeLLM();
  const testProjectId = 'test_proj_keyframe';

  before(() => {
    LLMRegistry.set(mockLLM);

    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '命运齿轮',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.KEYFRAME_REFERENCE,
      stageArtifacts: {},
      history: [],
      meta: { idea: '蒸汽朋克', style: '复古蒸汽朋克', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: now,
      updatedAt: now,
    });
  });

  it('缺少前序分镜头数据时刚性 Fail-Fast 阻断', async () => {
    const res = await kfSkill.execute({
      projectId: testProjectId,
      params: { isMock: true },
    });

    assert.equal(res.success, false);
    assert.match(res.error || '', /缺少前序分镜数据/);
  });

  it('全量批量推演提示词并渲染关键帧首帧参考图', async () => {
    // 注入 Stage 4 STORYBOARD 资产
    store.setArtifact(testProjectId, WorkflowStage.STORYBOARD, {
      title: '命运齿轮',
      totalShots: 2,
      shots: [
        { shotId: 'shot_1', shotNumber: 1, durationSec: 4, visualComposition: '怀表特写', shotScale: '特写', cameraMovement: '推' },
        { shotId: 'shot_2', shotNumber: 2, durationSec: 5, visualComposition: '雷恩抬头', shotScale: '中景', cameraMovement: '固定' },
      ],
    });

    const res = await kfSkill.execute({
      projectId: testProjectId,
      params: { isMock: true },
    });

    assert.equal(res.success, true);
    if (res.success) {
      const artifact = res.data;
      assert.equal(artifact.totalKeyframes, 2);
      assert.equal(artifact.shots.length, 2);
      assert.equal(artifact.shots[0].shotId, 'shot_1');
      assert.ok(artifact.shots[0].imageUrl);
      assert.equal(artifact.shots[1].shotId, 'shot_2');

      // 验证状态黑板落盘
      const saved = store.getArtifact<any>(testProjectId, WorkflowStage.KEYFRAME_REFERENCE);
      assert.ok(saved);
      assert.equal(saved.totalKeyframes, 2);
    }
  });

  it('单镜靶向微调：指定 targetShotId 仅重做该镜并增量保全其他镜头', async () => {
    const res = await kfSkill.execute({
      projectId: testProjectId,
      params: {
        targetShotId: 'shot_1',
        userFeedback: '增加黄铜锈蚀质感',
        isMock: true,
      },
    });

    assert.equal(res.success, true);
    if (res.success) {
      const artifact = res.data;
      assert.equal(artifact.totalKeyframes, 2);
      const shot1 = artifact.shots.find((s) => s.shotId === 'shot_1');
      const shot2 = artifact.shots.find((s) => s.shotId === 'shot_2');

      assert.ok(shot1);
      assert.ok(shot2);
      assert.equal(shot2.shotId, 'shot_2');
    }
  });

  it('指定不存在的目标 targetShotId 时阻断报错', async () => {
    const res = await kfSkill.execute({
      projectId: testProjectId,
      params: {
        targetShotId: 'shot_999_nonexistent',
        isMock: true,
      },
    });

    assert.equal(res.success, false);
    assert.match(res.error || '', /未在既有分镜表中找到指定修改的目标镜头/);
  });

  it('多批次分块推演关键帧时，通过分块索引对齐兜底提取提示词', async () => {
    // 注入 7 个分镜头，触发 CHUNK_SIZE = 6 的第 2 批次
    const shots = Array.from({ length: 7 }, (_, i) => ({
      shotId: `shot_${i + 1}`,
      shotNumber: i + 1,
      durationSec: 4,
      visualComposition: `第 ${i + 1} 镜构图`,
      shotScale: '中景',
      cameraMovement: '推',
    }));

    store.setArtifact(testProjectId, WorkflowStage.STORYBOARD, {
      title: '多批次关键帧测试',
      totalShots: shots.length,
      shots,
    });

    const res = await kfSkill.execute({
      projectId: testProjectId,
      params: { isMock: true },
    });

    assert.equal(res.success, true);
    if (res.success) {
      assert.equal(res.data.totalKeyframes, 7);
      const shot7 = res.data.shots.find((s) => s.shotId === 'shot_7');
      assert.ok(shot7);
      assert.ok(shot7.prompt);
    }
  });

  it('大批量镜头 (50 镜) 压力与并发调度：所有 50 个镜头全部收敛交付且无截断', async () => {
    const largeShots = Array.from({ length: 50 }, (_, i) => ({
      shotId: `shot_${i + 1}`,
      shotNumber: i + 1,
      durationSec: 4,
      visualComposition: `第 ${i + 1} 镜宏大场景`,
      shotScale: i % 2 === 0 ? '特写' : '全景',
      cameraMovement: '平摇',
    }));

    store.setArtifact(testProjectId, WorkflowStage.STORYBOARD, {
      title: '大批量分镜压力测试',
      totalShots: largeShots.length,
      shots: largeShots,
    });

    const res = await kfSkill.execute({
      projectId: testProjectId,
      params: { isMock: true },
    });

    assert.equal(res.success, true);
    if (res.success) {
      assert.equal(res.data.totalKeyframes, 50, '必须完整渲染 50 个分镜头首帧');
      assert.equal(res.data.shots.length, 50);
      assert.equal(res.data.shots[49].shotId, 'shot_50');
      assert.ok(res.data.shots[49].imageUrl);
    }
  });

  it('AbortSignal 中断取消：在执行中触发取消信号，技能安全终止', async () => {
    const ac = new AbortController();
    ac.abort();

    const res = await kfSkill.execute({
      projectId: testProjectId,
      params: { isMock: true },
      abortSignal: ac.signal,
    });

    assert.equal(res.success, false);
    assert.match(res.error || '', /执行被提前取消/);
  });

  it('无既有关键帧资产时指定 targetShotId 刚性 Fail-Fast 报错', async () => {
    const emptyProjId = 'test_proj_kf_empty_artifact';
    store.saveProject({
      projectId: emptyProjId,
      title: '空关键帧资产项目',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.KEYFRAME_REFERENCE,
      stageArtifacts: {},
      history: [],
      meta: { idea: '测试', style: '写实', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    store.setArtifact(emptyProjId, WorkflowStage.STORYBOARD, {
      title: '分镜表',
      totalShots: 1,
      shots: [
        { shotId: 'shot_1', shotNumber: 1, durationSec: 4, visualComposition: '构图1', shotScale: '特写', cameraMovement: '推' },
      ],
    });

    const res = await kfSkill.execute({
      projectId: emptyProjId,
      params: {
        targetShotId: 'shot_1',
        isMock: true,
      },
    });

    assert.equal(res.success, false);
    assert.match(res.error || '', /当前项目尚无既有关键帧资产/);
  });
});
