/**
 * mastra/tools/fmv-packaging/fmv-packaging.tool.ts
 * 互动影游母带装配与打包工具 (Mastra Tool SSOT)
 */

import fs from 'fs';
import path from 'path';
import { createTool } from '@mastra/core/tools';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { WorkflowStage, SessionStatus } from '../../types/index.js';
import {
  FmvPackagingParamsSchema,
  FmvPackagingToolOutputSchema,
  type FMVManifest,
  type FMVNodeAsset,
  type FMVChoice,
  type FmvPackagingArtifact,
} from './schema.js';

export const fmvPackagingTool = createTool({
  id: 'fmv-packaging-tool',
  description: '聚合全网剧情节点拓扑路由、动态视频切片与交互抉择点，编译输出交互影游母带播放清单 (Game Manifest) 与完整互动包',
  inputSchema: FmvPackagingParamsSchema,
  outputSchema: FmvPackagingToolOutputSchema,
  requireApproval: true,
  execute: async (input) => {
    const { projectId } = input;

    if (!projectId) {
      throw new Error('[fmvPackagingTool] 执行失败: projectId 不能为空');
    }

    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);

    const narrative = store.getArtifact<any>(projectId, WorkflowStage.NARRATIVE_DESIGN);
    const storyboardArtifact = store.getArtifact<any>(projectId, WorkflowStage.STORYBOARD);
    const videoArtifact = store.getArtifact<any>(projectId, WorkflowStage.VIDEO_PRODUCTION);

    const rawNodes = narrative?.storyGraph?.nodes || [];
    const clips = videoArtifact?.clips || [];

    if (rawNodes.length === 0) {
      throw new Error('缺少叙事拓扑节点，无法进行母带打包装配');
    }

    if (clips.length === 0) {
      throw new Error('未检索到已渲染完成的视频切片（clips 列表为空），无法进行影游运行清单装配，请先完成前置视频生成工序');
    }

    // 1. 分镜头 shotId -> nodeId 映射
    const shotToNodeMap = new Map<string, string>();
    for (const sh of storyboardArtifact?.shots || []) {
      const targetNodeId = sh.nodeId;
      if (targetNodeId) {
        shotToNodeMap.set(sh.shotId, targetNodeId);
      }
    }

    // 2. 建立 nodeId -> 视频切片列表关联
    const nodeClipsMap = new Map<string, any[]>();
    for (const clip of clips) {
      const nodeId = shotToNodeMap.get(clip.shotId);
      if (nodeId) {
        const list = nodeClipsMap.get(nodeId) || [];
        list.push(clip);
        nodeClipsMap.set(nodeId, list);
      }
    }

    // 3. 编译标准 FMVManifest.nodes 字典对象
    const nodesRecord: Record<string, FMVNodeAsset> = {};
    const fallbackVideoUrl = clips[0]?.videoUrl || '';
    const missingNodeIds: string[] = [];
    const usedClipIds = new Set<string>();

    for (let i = 0; i < rawNodes.length; i++) {
      const node = rawNodes[i];
      const matchedClips = nodeClipsMap.get(node.id) || [];
      const hasMatchedClip = matchedClips.length > 0;

      if (!hasMatchedClip) {
        missingNodeIds.push(node.id);
      }

      const selectedClip = hasMatchedClip ? matchedClips[0] : null;
      const videoUrl = selectedClip?.videoUrl || fallbackVideoUrl;
      const durationSec = selectedClip?.durationSec || 5;

      if (selectedClip?.clipId) {
        usedClipIds.add(selectedClip.clipId);
      }

      // 编译分支抉择选项
      const fmvChoices: FMVChoice[] = (node.choices || []).map((ch: any, idx: number) => ({
        id: `choice_${node.id}_${idx + 1}`,
        fromNodeId: node.id,
        toNodeId: ch.targetNodeId,
        choiceText: ch.text || `分支选项 ${idx + 1}`,
        timeoutSeconds: 10,
        isTimeoutDefault: idx === 0,
      }));

      const isDecisionPoint = !node.isEnding && fmvChoices.length > 0;

      nodesRecord[node.id] = {
        nodeId: node.id,
        title: node.title || `剧情节点 ${node.id}`,
        videoUrl,
        durationSec,
        decisionTimeSec: Math.max(1, durationSec - 2),
        isDecisionPoint,
        choices: isDecisionPoint ? fmvChoices : undefined,
        isMissing: !hasMatchedClip,
      };
    }

    const startNodeId = narrative?.storyGraph?.rootNodeId || rawNodes[0]?.id || 'node_1';
    const effectiveClips = clips.filter((c: any) => usedClipIds.has(c.clipId));
    const totalDurationSec = effectiveClips.length > 0
      ? effectiveClips.reduce((acc: number, c: any) => acc + (c.durationSec || 0), 0)
      : clips.reduce((acc: number, c: any) => acc + (c.durationSec || 0), 0) || 120;

    const gameTitle = project?.title || narrative?.title || '互动影游母带成片';

    const fmvManifest: FMVManifest = {
      gameTitle,
      startNodeId,
      totalDurationSec,
      nodes: nodesRecord,
    };

    // 4. 双向落盘至本地物理目录与 ProjectStore
    const projectDir = store.getProjectDir(projectId);
    const packageDir = path.join(projectDir, 'package');
    if (!fs.existsSync(packageDir)) {
      fs.mkdirSync(packageDir, { recursive: true });
    }

    const manifestFilePath = path.join(packageDir, 'game-manifest.json');
    fs.writeFileSync(manifestFilePath, JSON.stringify(fmvManifest, null, 2), 'utf-8');

    const totalEndings = rawNodes.filter((n: any) => n.isEnding).length;
    const isDegraded = missingNodeIds.length > 0;

    const artifact: FmvPackagingArtifact = {
      title: gameTitle,
      gameManifestUrl: `/media/${projectId}/package/game-manifest.json`,
      fmvManifest,
      totalNodes: rawNodes.length,
      totalClips: clips.length,
      totalEndings,
      playableDurationSec: totalDurationSec,
      isDegraded,
      degradedReason: isDegraded ? `存在 ${missingNodeIds.length} 个拓扑节点未渲染独立视频，已采用安全切片挂载` : undefined,
      missingNodeIds: isDegraded ? missingNodeIds : undefined,
      status: 'packaged',
      createdAt: new Date().toISOString(),
    };

    store.setArtifact(projectId, WorkflowStage.FMV_PACKAGING, artifact);

    // 遵循法典微内核契约：工具仅产出纯产物，生命周期推进权唯一收拢于确认编排层，严禁底层越权修改 project.currentStage

    const summary = `🎉 互动影游母带装配与打包完成！\n` +
      `成片片名：《${gameTitle}》\n` +
      `互动节点：共 ${rawNodes.length} 个节点（${totalEndings} 个结局收敛点）\n` +
      `切片装配：${clips.length} 个动态视频切片，成片总时长 ${totalDurationSec} 秒\n` +
      `母带清单：已编译并落盘至 ${manifestFilePath}\n` +
      `项目全生命周期已圆满收敛，进入最终可交互体验阶段！`;

    return {
      success: true,
      artifact,
      summary,
    };
  },
});
