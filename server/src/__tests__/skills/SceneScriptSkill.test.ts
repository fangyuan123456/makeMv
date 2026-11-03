import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { SceneScriptSkill } from '../../skills/scene-script/SceneScriptSkill.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { LLMRegistry } from '../../llm/LLMRegistry.js';
import { WorkflowStage, SessionStatus } from '../../types/index.js';
import type { LLMService, LLMOptions } from '../../llm/LLMService.js';

class MockSceneScriptLLM implements LLMService {
  hasVisionCapability(): boolean { return true; }
  async generateText(): Promise<string> { return ''; }
  async generateTextWithImages(): Promise<string> { return ''; }
  async generateMultiTurn(): Promise<string> { return ''; }
  async generateMultiTurnStream(): Promise<string> { return ''; }

  async generateObject<T>(_prompt: string, _schema: any, _sys?: string, options?: LLMOptions): Promise<T> {
    if (options?.stage === 'scene_script') {
      return {
        scenes: [
          {
            nodeId: 'node_1',
            act: 1,
            sceneTitle: '工坊的异样晨光',
            location: '钟表工坊内室',
            timeOfDay: '清晨',
            actionSummary: '雷恩整理满桌的黄铜发条，突然发现老式怀表指针剧烈倒转',
            dialogues: [
              { speaker: '雷恩', line: '这不可能，主发条明明已经卸下了。' },
            ],
            interactionMoment: '选择拆解后盖还是按下侧钮',
          },
        ],
      } as T;
    }

    return {} as T;
  }
}

describe('SceneScriptSkill 分场多分支剧本扩写技能', () => {
  const store = ProjectStore.getInstance();
  const scriptSkill = new SceneScriptSkill();
  const mockLLM = new MockSceneScriptLLM();
  const testProjectId = 'test_proj_scene_script';

  before(() => {
    LLMRegistry.set(mockLLM);

    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '命运齿轮',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.SCENE_SCRIPT,
      stageArtifacts: {},
      history: [],
      meta: { idea: '蒸汽朋克', style: '复古蒸汽朋克', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: now,
      updatedAt: now,
    });
  });

  it('缺少前序故事世界观节点时刚性 Fail-Fast 阻断', async () => {
    const res = await scriptSkill.execute({
      projectId: testProjectId,
      params: {},
    });

    assert.equal(res.success, false);
    assert.match(res.error || '', /缺少前序剧情节点数据/);
  });

  it('全量编译分场多分支剧本，成功写入对白与场次情境', async () => {
    // 注入 Stage 1 NARRATIVE_DESIGN 资产
    store.setArtifact(testProjectId, WorkflowStage.NARRATIVE_DESIGN, {
      title: '命运齿轮',
      theme: '自由意志',
      characters: [{ name: '雷恩', role: '主角' }],
      storyGraph: {
        nodes: [
          { id: 'node_1', title: '工坊晨光', summary: '怀表异动', act: 1 },
        ],
      },
    });

    const res = await scriptSkill.execute({
      projectId: testProjectId,
      params: { userFeedback: '强化悬疑氛围' },
    });

    assert.equal(res.success, true);
    if (res.success) {
      const artifact = res.data;
      assert.equal(artifact.totalScenes, 1);
      assert.equal(artifact.scenes.length, 1);
      assert.equal(artifact.scenes[0].nodeId, 'node_1');
      assert.equal(artifact.scenes[0].sceneTitle, '工坊的异样晨光');
      assert.equal(artifact.scenes[0].dialogues.length, 1);
      assert.equal(artifact.scenes[0].dialogues[0].speaker, '雷恩');

      // 验证状态黑板落盘
      const saved = store.getArtifact<any>(testProjectId, WorkflowStage.SCENE_SCRIPT);
      assert.ok(saved);
      assert.equal(saved.totalScenes, 1);
    }
  });
});
