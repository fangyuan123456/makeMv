import path from 'node:path';
import type { Request, Response } from 'express';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { safeReadJsonSync, atomicWriteJsonSync } from '../../utils/atomicFile.js';
import { sendError } from '../helpers.js';

const store = ProjectStore.getInstance();

function collectStoryboardShotMap(storyboards: any[]): Map<string, any> {
  const map = new Map<string, any>();
  for (const item of storyboards || []) {
    if (!item) continue;
    if (Array.isArray(item.shots)) {
      for (const shot of item.shots) {
        const sid = shot?.shotId || shot?.id;
        if (sid) map.set(sid, shot);
      }
      if (item.clipId && item.shots[0] && !map.has(item.clipId)) {
        map.set(item.clipId, item.shots[0]);
      }
    } else {
      const sid = item.shotId || item.id || item.clipId;
      if (sid) map.set(sid, item);
    }
  }
  return map;
}

function syncCanvasUpscaleFromStoryboards(canvasData: any, storyboards: any[]): boolean {
  if (!canvasData?.nodes || !Array.isArray(storyboards) || storyboards.length === 0) return false;
  const shotMap = collectStoryboardShotMap(storyboards);
  let changed = false;
  for (const node of Object.values<any>(canvasData.nodes)) {
    if (!node || node.type === 'lookdev_root') continue;
    const matched = (node.shotId && shotMap.get(node.shotId)) || (node.clipId && shotMap.get(node.clipId));
    if (!matched) continue;
    const nextFirst = matched.firstFrameUpscale || undefined;
    const nextLast = matched.lastFrameUpscale || undefined;
    if (JSON.stringify(node.firstFrameUpscale || null) !== JSON.stringify(nextFirst || null)) {
      if (nextFirst) node.firstFrameUpscale = nextFirst;
      else delete node.firstFrameUpscale;
      changed = true;
    }
    if (JSON.stringify(node.lastFrameUpscale || null) !== JSON.stringify(nextLast || null)) {
      if (nextLast) node.lastFrameUpscale = nextLast;
      else delete node.lastFrameUpscale;
      changed = true;
    }
  }
  return changed;
}

export const getStoryboardCanvas = (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const projectDir = store.getProjectDir(projectId);
    const storyboards =
      store.getArtifact<any[]>(projectId, 'storyboards') ||
      safeReadJsonSync<any[]>(path.join(projectDir, 'storyboards.json')) ||
      [];

    // 1. 若已有落盘画布，检查是否需要自愈补全定妆母体起点并对齐最新超分元数据
    let canvasData = store.getArtifact<any>(projectId, 'storyboard_canvas');
    if (canvasData && canvasData.nodes && Object.keys(canvasData.nodes).length > 0) {
      let canvasChanged = syncCanvasUpscaleFromStoryboards(canvasData, storyboards);
      if (!canvasData.nodes['node_lookdev_root']) {
        const entities =
          store.getArtifact<any>(projectId, 'lookdev_entities') ||
          safeReadJsonSync<any>(path.join(projectDir, 'scenes', 'entities.json')) ||
          {};
        const lookdevCharacters = (entities.characters || []).map((ch: any) => ({
          characterId: ch.characterId,
          name: ch.name,
          imageUrl: ch.imageUrl || ch.referenceImageUrl,
        }));
        const lookdevLocations = (entities.locations || []).map((loc: any) => ({
          locationId: loc.locationId,
          name: loc.name,
          imageUrl: loc.imageUrl || loc.referenceImageUrl,
        }));
        const rootNodeId = 'node_lookdev_root';
        canvasData.nodes[rootNodeId] = {
          id: rootNodeId,
          type: 'lookdev_root',
          title: '全剧视觉定妆母体',
          position: { x: 80, y: 140 },
          size: { w: 340, h: 280 },
          characters: lookdevCharacters,
          locations: lookdevLocations,
        };
        // 连线到第一个镜头
        const nonRootNodes = Object.values(canvasData.nodes).filter((n: any) => n.id !== rootNodeId) as any[];
        if (nonRootNodes.length > 0 && !canvasData.edges?.['edge_root_to_first']) {
          canvasData.edges = canvasData.edges || {};
          canvasData.edges['edge_root_to_first'] = {
            id: 'edge_root_to_first',
            fromNodeId: rootNodeId,
            toNodeId: nonRootNodes[0].id,
            choiceText: '定妆就绪 ➔ 视听推演',
          };
        }
        canvasChanged = true;
      }
      if (canvasChanged) {
        store.setArtifact(projectId, 'storyboard_canvas', canvasData);
        atomicWriteJsonSync(path.join(projectDir, 'storyboard_canvas.json'), canvasData);
      }
      return res.json(canvasData);
    }

    // 2. 首次进入画布：根据已有的视觉定妆与 PRD 分幕自动初始化排布图谱
    const entities =
      store.getArtifact<any>(projectId, 'lookdev_entities') ||
      safeReadJsonSync<any>(path.join(projectDir, 'scenes', 'entities.json')) ||
      {};

    const lookdevCharacters = (entities.characters || []).map((ch: any) => ({
      characterId: ch.characterId,
      name: ch.name,
      imageUrl: ch.imageUrl || ch.referenceImageUrl,
    }));
    const lookdevLocations = (entities.locations || []).map((loc: any) => ({
      locationId: loc.locationId,
      name: loc.name,
      imageUrl: loc.imageUrl || loc.referenceImageUrl,
    }));

    const prd =
      store.getArtifact<any>(projectId, 'prd') ||
      safeReadJsonSync<any>(path.join(projectDir, 'prd.json')) ||
      {};

    const rawClips = prd.clips || prd.scenes || [];

    const nodes: Record<string, any> = {};
    const edges: Record<string, any> = {};

    // ─── 创建起点：全剧视觉定妆母体节点 (Root Node) ───
    const rootNodeId = 'node_lookdev_root';
    nodes[rootNodeId] = {
      id: rootNodeId,
      type: 'lookdev_root',
      title: '全剧视觉定妆母体',
      position: { x: 80, y: 140 },
      size: { w: 340, h: 280 },
      characters: lookdevCharacters,
      locations: lookdevLocations,
    };

    let startX = 480;
    let startY = 140;

    rawClips.forEach((c: any, index: number) => {
      const clipId = c.id || c.clipId || `c${index + 1}`;
      const nodeId = `node_${clipId}`;

      // 尝试匹配已有的成片/关键帧资产
      const matchedSb = storyboards.find((s: any) => s.clipId === clipId || s.id === clipId);
      const primaryShot = Array.isArray(matchedSb?.shots) ? matchedSb.shots[0] : matchedSb;
      const videoUrl = primaryShot?.videoUrl || matchedSb?.videoUrl || c.videoUrl || '';
      const keyframeUrl =
        primaryShot?.firstFrameImageUrl ||
        primaryShot?.keyframeUrl ||
        matchedSb?.firstFrameImageUrl ||
        matchedSb?.keyframeUrl ||
        c.firstFrameImageUrl ||
        '';
      const lastFrameUrl = primaryShot?.lastFrameImageUrl || primaryShot?.lastFrameUrl || '';
      const taskId = primaryShot?.taskId || matchedSb?.taskId || '';

      nodes[nodeId] = {
        id: nodeId,
        type: 'shot_node',
        shotId: primaryShot?.shotId || matchedSb?.shotId || `s_${clipId}_1`,
        clipId,
        title: c.title || `第 ${index + 1} 幕`,
        // 画布节点展示镜头演绎台本；首帧提示词由下一级关键帧处理使用。
        prompt: matchedSb?.videoPrompt || matchedSb?.description || matchedSb?.promptZh || c.narrativeText || '',
        durationSec: primaryShot?.durationSec || matchedSb?.durationSec || 4.0,
        position: {
          x: startX + index * 380,
          y: startY + (index % 2 === 1 ? 60 : 0),
        },
        size: { w: 320, h: 260 },
        activeTaskId: taskId || undefined,
        candidateTaskIds: taskId ? [taskId] : [],
        videoUrl: videoUrl || undefined,
        keyframeUrl: keyframeUrl || undefined,
        lastFrameUrl: lastFrameUrl || undefined,
        firstFrameUpscale: primaryShot?.firstFrameUpscale || undefined,
        lastFrameUpscale: primaryShot?.lastFrameUpscale || undefined,
      };

      // 解析选项连线 (仅保留纯粹镜头之间的因果流，过滤抽象互动杂点)
      (c.choices || []).forEach((ch: any, chIdx: number) => {
        const rawTargetId = ch.to || ch.targetNodeId || ch.targetSceneId;
        if (rawTargetId) {
          // 智能归一化目标镜头 ID (如 S7 / scene_7 -> c7)
          let resolvedTargetId = rawTargetId;
          const matchNum = String(rawTargetId).match(/\d+/);
          if (matchNum) {
            const targetClip = rawClips.find(
              (rc: any) =>
                (rc.id || rc.clipId) === rawTargetId ||
                (rc.id || rc.clipId) === `c${matchNum[0]}`
            );
            if (targetClip) {
              resolvedTargetId = targetClip.id || targetClip.clipId;
            }
          }
          const edgeId = `edge_${clipId}_to_${resolvedTargetId}_${chIdx}`;
          edges[edgeId] = {
            id: edgeId,
            fromNodeId: nodeId,
            toNodeId: `node_${resolvedTargetId}`,
            choiceText: ch.text || ch.label || `抉择 ${chIdx + 1}`,
          };
        }
      });
    });

    // 定妆母体节点直连第一个分镜镜头
    if (rawClips.length > 0) {
      const firstClipId = rawClips[0].id || rawClips[0].clipId || 'c1';
      edges['edge_root_to_first'] = {
        id: 'edge_root_to_first',
        fromNodeId: rootNodeId,
        toNodeId: `node_${firstClipId}`,
        choiceText: '定妆就绪 ➔ 视听推演',
      };
    }

    const initialCanvas = {
      projectId,
      viewport: { x: 0, y: 0, zoom: 1.0 },
      nodes,
      edges,
    };

    // 持久化落盘并水合
    store.setArtifact(projectId, 'storyboard_canvas', initialCanvas);
    atomicWriteJsonSync(path.join(projectDir, 'storyboard_canvas.json'), initialCanvas);

    res.json(initialCanvas);
  } catch (err: any) {
    sendError(res, 500, `获取画布失败: ${err.message}`);
  }
};
export const saveStoryboardCanvas = (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const canvasPayload = req.body || {};
    const projectDir = store.getProjectDir(projectId);

    if (!canvasPayload.nodes) {
      return sendError(res, 400, '缺少有效的 nodes 数据');
    }

    const merged = {
      projectId,
      viewport: canvasPayload.viewport || { x: 0, y: 0, zoom: 1.0 },
      nodes: canvasPayload.nodes,
      edges: canvasPayload.edges || {},
    };

    store.setArtifact(projectId, 'storyboard_canvas', merged);
    atomicWriteJsonSync(path.join(projectDir, 'storyboard_canvas.json'), merged);

    res.json({ success: true, canvas: merged });
  } catch (err: any) {
    sendError(res, 500, `保存画布失败: ${err.message}`);
  }
};
export const selectStoryboardCandidate = (req: Request, res: Response) => {
  try {
    const projectId = req.params.id;
    const { nodeId, taskId } = req.body || {};
    const projectDir = store.getProjectDir(projectId);

    if (!nodeId || !taskId) {
      return sendError(res, 400, '缺少必须参数: nodeId 或 taskId');
    }

    const canvasData = store.getArtifact<any>(projectId, 'storyboard_canvas');
    if (!canvasData?.nodes?.[nodeId]) {
      return sendError(res, 404, `未在画布中找到节点 [${nodeId}]`);
    }

    const node = canvasData.nodes[nodeId];
    node.activeTaskId = taskId;

    // 查找该 task 的产物文件路径并更新 node.videoUrl
    const tasksPath = path.join(projectDir, 'tasks.json');
    const tasks = safeReadJsonSync<any[]>(tasksPath) || [];
    const targetTask = tasks.find((t) => t.taskId === taskId);

    if (targetTask?.output?.mediaUrl || targetTask?.output?.videoUrl) {
      node.videoUrl = targetTask.output.mediaUrl || targetTask.output.videoUrl;
    }

    store.setArtifact(projectId, 'storyboard_canvas', canvasData);
    atomicWriteJsonSync(path.join(projectDir, 'storyboard_canvas.json'), canvasData);

    res.json({ success: true, node });
  } catch (err: any) {
    sendError(res, 500, `切换候选失败: ${err.message}`);
  }
};
