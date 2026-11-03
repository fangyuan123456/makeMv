import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { FmvPackagingSkill } from '../../skills/fmv-packaging/FmvPackagingSkill.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { WorkflowStage, SessionStatus } from '../../types/index.js';

describe('FmvPackagingSkill 影游母带装配与打包技能', () => {
  const store = ProjectStore.getInstance();
  const packagingSkill = new FmvPackagingSkill();
  const testProjectId = 'test_proj_fmv_packaging';

  before(() => {
    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '时空裂隙',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.FMV_PACKAGING,
      stageArtifacts: {},
      history: [],
      meta: { idea: '科幻互动', style: '赛博', videoRatio: '16:9', videoResolution: '720P' },
      createdAt: now,
      updatedAt: now,
    });
  });

  it('缺少前序剧情拓扑节点时刚性报错拦截', async () => {
    store.setArtifact(testProjectId, WorkflowStage.NARRATIVE_DESIGN, {
      storyGraph: { nodes: [] },
    });

    const res = await packagingSkill.execute({
      projectId: testProjectId,
      params: {},
    });

    assert.equal(res.success, false);
    if (!res.success) {
      assert.match(res.error, /缺少叙事拓扑节点/);
    }
  });

  it('全量编译装配 FMVManifest 与多分支交互路由字典', async () => {
    // 注入叙事网络
    store.setArtifact(testProjectId, WorkflowStage.NARRATIVE_DESIGN, {
      title: '时空裂隙',
      storyGraph: {
        rootNodeId: 'node_1',
        endingsCount: 2,
        nodes: [
          {
            id: 'node_1',
            act: 1,
            title: '启程选择',
            choices: [
              { targetNodeId: 'node_2', text: '前往实验室' },
              { targetNodeId: 'node_3', text: '前往控制室' },
            ],
            isEnding: false,
          },
          {
            id: 'node_2',
            act: 2,
            title: '结局A',
            choices: [],
            isEnding: true,
          },
          {
            id: 'node_3',
            act: 2,
            title: '结局B',
            choices: [],
            isEnding: true,
          },
        ],
      },
    });

    // 注入分镜
    store.setArtifact(testProjectId, WorkflowStage.STORYBOARD, {
      shots: [
        { shotId: 'shot_1', nodeId: 'node_1', shotNumber: 1, durationSec: 5 },
        { shotId: 'shot_2', nodeId: 'node_2', shotNumber: 2, durationSec: 6 },
        { shotId: 'shot_3', nodeId: 'node_3', shotNumber: 3, durationSec: 6 },
      ],
    });

    // 注入视频切片
    store.setArtifact(testProjectId, WorkflowStage.VIDEO_PRODUCTION, {
      clips: [
        { clipId: 'clip_1', shotId: 'shot_1', videoUrl: '/media/test/clip_1.mp4', durationSec: 5, resolution: '720P', ratio: '16:9', status: 'rendered' },
        { clipId: 'clip_2', shotId: 'shot_2', videoUrl: '/media/test/clip_2.mp4', durationSec: 6, resolution: '720P', ratio: '16:9', status: 'rendered' },
        { clipId: 'clip_3', shotId: 'shot_3', videoUrl: '/media/test/clip_3.mp4', durationSec: 6, resolution: '720P', ratio: '16:9', status: 'rendered' },
      ],
    });

    const res = await packagingSkill.execute({
      projectId: testProjectId,
      params: {},
    });

    assert.equal(res.success, true);
    if (res.success) {
      const artifact = res.data;
      assert.equal(artifact.status, 'packaged');
      assert.equal(artifact.totalNodes, 3);
      assert.equal(artifact.totalClips, 3);
      assert.equal(artifact.totalEndings, 2);

      // 验证 FMVManifest 实体
      const manifest = artifact.fmvManifest;
      assert.equal(manifest.gameTitle, '时空裂隙');
      assert.equal(manifest.startNodeId, 'node_1');
      assert.ok(manifest.nodes['node_1']);
      assert.equal(manifest.nodes['node_1'].isDecisionPoint, true);
      assert.equal(manifest.nodes['node_1'].choices?.length, 2);
      assert.equal(manifest.nodes['node_1'].choices?.[0].toNodeId, 'node_2');
      assert.equal(manifest.nodes['node_1'].choices?.[0].choiceText, '前往实验室');

      // 验证结局节点不是决策点
      assert.equal(manifest.nodes['node_2'].isDecisionPoint, false);
      assert.equal(manifest.nodes['node_2'].choices, undefined);

      // 🌟 P0-2 权能纯化验证：技能仅负责母带清单打包装配，严禁越权修改 project.status (状态流转由创作者确认推进统一管控)
      const proj = store.getProject(testProjectId);
      assert.equal(proj?.status, SessionStatus.IDLE);
    }
  });

  it('未检索到已渲染的视频切片 (clips 为空) 时刚性 Fail-Fast 报错拦截', async () => {
    store.setArtifact(testProjectId, WorkflowStage.VIDEO_PRODUCTION, {
      clips: [],
    });

    const res = await packagingSkill.execute({
      projectId: testProjectId,
      params: {},
    });

    assert.equal(res.success, false);
    if (!res.success) {
      assert.match(res.error, /未检索到已渲染完成的视频切片/);
    }
  });

  it('部分剧情节点缺失专属切片时产出降级母带产物 (isDegraded: true) 并记录缺失节点', async () => {
    // 恢复剧情拓扑
    store.setArtifact(testProjectId, WorkflowStage.NARRATIVE_DESIGN, {
      title: '时空裂隙',
      storyGraph: {
        rootNodeId: 'node_1',
        endingsCount: 2,
        nodes: [
          {
            id: 'node_1',
            act: 1,
            title: '启程选择',
            choices: [{ targetNodeId: 'node_2', text: '前往实验室' }],
            isEnding: false,
          },
          {
            id: 'node_2',
            act: 2,
            title: '结局A',
            choices: [],
            isEnding: true,
          },
        ],
      },
    });

    // 仅提供 node_1 的分镜与切片，缺失 node_2 的专属视频切片
    store.setArtifact(testProjectId, WorkflowStage.STORYBOARD, {
      shots: [
        { shotId: 'shot_1', nodeId: 'node_1', shotNumber: 1, durationSec: 5 },
      ],
    });
    store.setArtifact(testProjectId, WorkflowStage.VIDEO_PRODUCTION, {
      clips: [
        { clipId: 'clip_1', shotId: 'shot_1', videoUrl: '/media/test/clip_1.mp4', durationSec: 5, resolution: '720P', ratio: '16:9', status: 'rendered' },
      ],
    });

    const res = await packagingSkill.execute({
      projectId: testProjectId,
      params: {},
    });

    assert.equal(res.success, true);
    if (res.success) {
      assert.equal(res.data.isDegraded, true);
      assert.deepEqual(res.data.missingNodeIds, ['node_2']);
      assert.match(res.data.degradedReason || '', /缺失节点: node_2/);
      assert.equal(res.data.fmvManifest.nodes['node_2'].isMissing, true);
      assert.equal(res.data.status, 'packaged');
    }
  });
});
