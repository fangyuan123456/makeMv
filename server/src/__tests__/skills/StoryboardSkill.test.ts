import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { StoryboardSkill } from '../../skills/storyboard/StoryboardSkill.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { LLMRegistry } from '../../llm/LLMRegistry.js';
import { WorkflowStage, SessionStatus } from '../../types/index.js';
import type { LLMService, LLMOptions } from '../../llm/LLMService.js';

class MockStoryboardLLM implements LLMService {
  hasVisionCapability(): boolean { return true; }
  async generateText(): Promise<string> { return ''; }
  async generateTextWithImages(): Promise<string> { return ''; }
  async generateMultiTurn(): Promise<string> { return ''; }
  async generateMultiTurnStream(): Promise<string> { return ''; }

  async generateObject<T>(_prompt: string, _schema: any, _sys?: string, options?: LLMOptions): Promise<T> {
    if (options?.stage === 'storyboard_segmentation') {
      return {
        shots: [
          {
            shotId: 'shot_1',
            nodeId: 'node_1',
            shotScale: '特写',
            cameraMovement: '缓慢推镜头',
            durationSec: 4,
            visualComposition: '黄铜怀表表面，倒转的秒针在晨光中划出道道残影，雷恩苍白的手指悬在表盖上方',
            audioPrompt: '急促清脆的金属齿轮倒转滴答声，伴随微弱的电流嗡鸣',
          },
          {
            shotId: 'shot_2',
            nodeId: 'node_1',
            shotScale: '中景',
            cameraMovement: '固定镜头',
            durationSec: 5,
            visualComposition: '雷恩猛然抬头，双眼瞪大，身后工坊密密麻麻的钟表全部开始逆时针狂转',
            audioPrompt: '满屋钟表疯狂共振轰鸣声',
          },
        ],
      } as T;
    }

    return {} as T;
  }
}

describe('StoryboardSkill 导演视听分镜头切分技能', () => {
  const store = ProjectStore.getInstance();
  const storyboardSkill = new StoryboardSkill();
  const mockLLM = new MockStoryboardLLM();
  const testProjectId = 'test_proj_storyboard';

  before(() => {
    LLMRegistry.set(mockLLM);

    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '命运齿轮',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.STORYBOARD,
      stageArtifacts: {},
      history: [],
      meta: { idea: '蒸汽朋克', style: '复古蒸汽朋克', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: now,
      updatedAt: now,
    });
  });

  it('缺少前序分场剧本数据时刚性 Fail-Fast 阻断', async () => {
    const res = await storyboardSkill.execute({
      projectId: testProjectId,
      params: {},
    });

    assert.equal(res.success, false);
    assert.match(res.error || '', /缺少前序分场剧本数据/);
  });

  it('全量拆解视听镜头表，生成景别、机位、构图与预估总时长', async () => {
    // 注入 Stage 3 SCENE_SCRIPT 资产
    store.setArtifact(testProjectId, WorkflowStage.SCENE_SCRIPT, {
      title: '命运齿轮',
      totalScenes: 1,
      scenes: [
        {
          nodeId: 'node_1',
          act: 1,
          sceneTitle: '工坊异动',
          location: '工坊',
          timeOfDay: '晨',
          actionSummary: '怀表倒转',
        },
      ],
    });

    const res = await storyboardSkill.execute({
      projectId: testProjectId,
      params: {},
    });

    assert.equal(res.success, true);
    if (res.success) {
      const artifact = res.data;
      assert.equal(artifact.totalShots, 2);
      assert.equal(artifact.shots.length, 2);
      assert.equal(artifact.shots[0].shotNumber, 1);
      assert.equal(artifact.shots[0].shotScale, '特写');
      assert.equal(artifact.shots[1].shotNumber, 2);
      assert.equal(artifact.estimatedTotalDurationSec, 9);

      // 验证状态黑板落盘
      const saved = store.getArtifact<any>(testProjectId, WorkflowStage.STORYBOARD);
      assert.ok(saved);
      assert.equal(saved.totalShots, 2);
    }
  });

  it('分块批处理推演视听镜头时，确保多批次镜头 shotId 绝对唯一连续且无重复', async () => {
    // 注入 6 场戏，触发 CHUNK_SIZE = 5 的跨批次切分
    const scenes = Array.from({ length: 6 }, (_, i) => ({
      nodeId: `node_${i + 1}`,
      act: 1,
      sceneTitle: `场次 ${i + 1}`,
      location: '工坊',
      timeOfDay: '晨',
      actionSummary: `剧情展开 ${i + 1}`,
    }));

    store.setArtifact(testProjectId, WorkflowStage.SCENE_SCRIPT, {
      title: '多批次分镜测试',
      totalScenes: scenes.length,
      scenes,
    });

    const res = await storyboardSkill.execute({
      projectId: testProjectId,
      params: {},
    });

    assert.equal(res.success, true);
    if (res.success) {
      const artifact = res.data;
      assert.equal(artifact.shots.length, 4); // 2 batches * 2 shots = 4 shots

      // 验证 shotId 严格全局连续唯一
      assert.equal(artifact.shots[0].shotId, 'shot_1');
      assert.equal(artifact.shots[1].shotId, 'shot_2');
      assert.equal(artifact.shots[2].shotId, 'shot_3');
      assert.equal(artifact.shots[3].shotId, 'shot_4');

      const uniqueIds = new Set(artifact.shots.map((s) => s.shotId));
      assert.equal(uniqueIds.size, 4);
    }
  });
});
