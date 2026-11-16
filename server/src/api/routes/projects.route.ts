/**
 * api/routes/projects.route.ts
 * 项目工程管理与资产查询路由 (Projects Domain Route SSOT)
 */

import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { generateText } from 'ai';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { safeReadJsonSync, atomicWriteJsonSync } from '../../utils/atomicFile.js';
import { hydrateEntitiesWithDiskAssets } from '../../project-store/entity-preservation.js';
import { LLMProvider } from '../../llm/provider.js';
import { taskDispatcher } from '../../task-engine/index.js';
import { sendError } from '../helpers.js';

export const projectsRouter = Router();
const store = ProjectStore.getInstance();

/**
 * 列出所有项目元数据
 * GET /api/projects
 */
projectsRouter.get('/', (_req, res) => {
  const list = store.listProjects();
  res.json(list);
});

/**
 * 创建新项目
 * POST /api/projects
 */
projectsRouter.post('/', (req, res) => {
  try {
    const { title, genre } = req.body || {};
    const projectId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const proj = store.getProject(projectId);
    if (title) proj.meta.title = title;
    if (genre) proj.meta.genre = genre;
    store.saveProject(proj);
    res.json(proj.meta);
  } catch (err: any) {
    sendError(res, 500, err.message);
  }
});

/**
 * 获取指定项目的完整工程详情与资产
 * GET /api/projects/:id
 */
projectsRouter.get('/:id', (req, res) => {
  try {
    const projectId = req.params.id;
    const proj = store.getProject(projectId);
    const projectDir = store.getProjectDir(projectId);

    // 1. 视觉资产表 (结合物理磁盘图片自动自愈水合，确保定妆资产永不丢失)
    let rawEntities =
      store.getArtifact(projectId, 'lookdev_entities') ||
      safeReadJsonSync(path.join(projectDir, 'scenes', 'entities.json'));
    const entities = hydrateEntitiesWithDiskAssets(projectId, projectDir, rawEntities);

    // 2. 策划案 PRD (结构化数据)
    const prd = store.getArtifact(projectId, 'prd');

    // 3. 策划案 Markdown 原文 (含第 5 章界面规划与第 3 章接线 JSON)
    const prdMarkdown = store.getArtifact<string>(projectId, 'prd_markdown');

    // 4. 剧本正文与故事原文 (分幕黄金剧情与故事大纲)
    let screenplay = store.getArtifact<string>(projectId, 'screenplay');
    if (!screenplay) {
      const legacySpinePath = path.join(projectDir, '.debug', '01-planner', '01-write-spine-script', 'planner_spine.md');
      if (fs.existsSync(legacySpinePath)) {
        screenplay = fs.readFileSync(legacySpinePath, 'utf-8');
      }
    }

    // 4.1 分幕切片剧本全文 (Tool 2 产物：story.md)
    let story = store.getArtifact<string>(projectId, 'story');

    // 从分幕切片剧本或正文中提取故事分幕字典 (storySections) 并补全 clips 中的故事原文
    const storySections: Record<string, { title: string; narrativeText: string }> = {};
    const textToExtract = story || screenplay || '';
    if (textToExtract) {
      const regex = /##\s*([A-Za-z0-9_.]+)(?:[｜|]\s*([^\n]+))?\n([\s\S]*?)(?=(?:\n##\s*[A-Za-z0-9_.]|$))/g;
      let match;
      while ((match = regex.exec(textToExtract)) !== null) {
        const id = match[1].trim();
        const secTitle = (match[2] || id).trim();
        const narrativeText = match[3].trim();
        storySections[id] = { title: secTitle, narrativeText };
      }
    }

    if (prd && Array.isArray(prd.clips)) {
      prd.clips = prd.clips.map((c: any) => ({
        ...c,
        narrativeText: c.narrativeText || storySections[c.id]?.narrativeText || '',
      }));
    }

    // 5. 分镜列表 (优先 storyboards 字段，或从 film_spec.clips 中自动提取)
    let storyboards = store.getArtifact<any[]>(projectId, 'storyboards');
    if (!storyboards) {
      const filmSpec = store.getArtifact<any>(projectId, 'film_spec');
      if (filmSpec && Array.isArray(filmSpec.clips)) {
        storyboards = filmSpec.clips;
      }
    }

    // 6. 游戏站点是否已生成
    const hasStandaloneGame = fs.existsSync(path.join(projectDir, 'game-assembly', 'index.html'));

    res.json({
      ...proj,
      prd,
      prdMarkdown,
      screenplay,
      story: story || screenplay,
      storySections,
      entities,
      storyboards,
      artifacts: {
        ...proj.artifacts,
        prd,
        prdMarkdown,
        screenplay,
        story: story || screenplay,
        storySections,
        lookdev_entities: entities,
        storyboards,
        hasStandaloneGame,
      },
    });
  } catch (err: any) {
    sendError(res, 500, err.message);
  }
});

/**
 * 获取指定项目的视听分镜无限画布拓扑数据
 * GET /api/projects/:id/canvas/storyboard
 */
projectsRouter.get('/:id/canvas/storyboard', (req, res) => {
  try {
    const projectId = req.params.id;
    const projectDir = store.getProjectDir(projectId);

    // 1. 若已有落盘画布，检查是否需要自愈补全定妆母体起点
    let canvasData = store.getArtifact<any>(projectId, 'storyboard_canvas');
    if (canvasData && canvasData.nodes && Object.keys(canvasData.nodes).length > 0) {
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
    const storyboards =
      store.getArtifact<any[]>(projectId, 'storyboards') ||
      safeReadJsonSync<any[]>(path.join(projectDir, 'storyboards.json')) ||
      [];

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
      const videoUrl = matchedSb?.videoUrl || c.videoUrl || '';
      const keyframeUrl = matchedSb?.firstFrameImageUrl || matchedSb?.keyframeUrl || c.firstFrameImageUrl || '';
      const taskId = matchedSb?.taskId || '';

      nodes[nodeId] = {
        id: nodeId,
        type: 'shot_node',
        shotId: matchedSb?.shotId || `s_${clipId}_1`,
        clipId,
        title: c.title || `第 ${index + 1} 幕`,
        prompt: matchedSb?.promptZh || matchedSb?.firstFramePrompt || c.narrativeText || '',
        durationSec: matchedSb?.durationSec || 4.0,
        position: {
          x: startX + index * 380,
          y: startY + (index % 2 === 1 ? 60 : 0),
        },
        size: { w: 320, h: 260 },
        activeTaskId: taskId || undefined,
        candidateTaskIds: taskId ? [taskId] : [],
        videoUrl: videoUrl || undefined,
        keyframeUrl: keyframeUrl || undefined,
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
});

/**
 * 保存/更新视听分镜画布数据 (坐标位置、连线流向、新增/复制节点)
 * POST /api/projects/:id/canvas/storyboard
 */
projectsRouter.post('/:id/canvas/storyboard', (req, res) => {
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
});

/**
 * 切换分镜节点的当前激活候选视频 (Candidate Selection)
 * POST /api/projects/:id/canvas/storyboard/select-candidate
 * Body: { nodeId: string, taskId: string }
 */
projectsRouter.post('/:id/canvas/storyboard/select-candidate', (req, res) => {
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
});

/**
 * 上传角色或场景的参考图（垫图）
 * POST /api/projects/:id/upload-reference
 * Body: { filename: string, dataUrl: string, entityType: 'character' | 'location', entityId: string }
 */
projectsRouter.post('/:id/upload-reference', (req, res) => {
  try {
    const projectId = req.params.id;
    const { filename, dataUrl, entityType, entityId } = req.body || {};

    if (!dataUrl || !entityType || !entityId) {
      return sendError(res, 400, '缺少必要参数: dataUrl, entityType, entityId');
    }

    const projectDir = store.getProjectDir(projectId);
    const refDir = path.join(projectDir, 'assets', 'references');
    if (!fs.existsSync(refDir)) {
      fs.mkdirSync(refDir, { recursive: true });
    }

    // 解析 Base64
    const matches = String(dataUrl).match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    let buffer: Buffer;
    let ext = '.png';
    if (matches && matches.length === 3) {
      const mime = matches[1];
      if (mime.includes('jpeg') || mime.includes('jpg')) ext = '.jpg';
      else if (mime.includes('webp')) ext = '.webp';
      else if (mime.includes('svg')) ext = '.svg';
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(String(dataUrl), 'base64');
    }

    const safeBaseName = (filename || `${entityId}_ref`)
      .replace(/[^a-zA-Z0-9_\-\.]/g, '_')
      .replace(/\.[^/.]+$/, '');
    const cleanFilename = `${safeBaseName}_${Date.now()}${ext}`;
    const filePath = path.join(refDir, cleanFilename);
    fs.writeFileSync(filePath, buffer);

    const mediaUrl = `/media/${encodeURIComponent(projectId)}/assets/references/${encodeURIComponent(cleanFilename)}`;

    // 同步更新实体
    const scenesDir = path.join(projectDir, 'scenes');
    const entitiesPath = path.join(scenesDir, 'entities.json');
    const entities =
      store.getArtifact<any>(projectId, 'lookdev_entities') ||
      safeReadJsonSync<any>(entitiesPath) ||
      {};

    if (entityType === 'character') {
      const char = (entities.characters || []).find((c: any) => c.characterId === entityId);
      if (char) {
        char.referenceImageUrl = mediaUrl;
      }
    } else if (entityType === 'location') {
      const loc = (entities.locations || []).find((l: any) => l.locationId === entityId);
      if (loc) {
        loc.referenceImageUrl = mediaUrl;
      }
    }

    store.setArtifact(projectId, 'lookdev_entities', entities);
    if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
    atomicWriteJsonSync(entitiesPath, entities);

    res.json({ success: true, mediaUrl });
  } catch (err: any) {
    sendError(res, 500, `上传参考图失败: ${err.message}`);
  }
});

/**
 * 实时更新实体属性 (如微调 promptZh 或清除 referenceImageUrl)
 * POST /api/projects/:id/entities/update
 * Body: { entityType: 'character' | 'location', entityId: string, updates: { promptZh?: string, referenceImageUrl?: string } }
 */
projectsRouter.post('/:id/entities/update', (req, res) => {
  try {
    const projectId = req.params.id;
    const { entityType, entityId, updates } = req.body || {};

    if (!entityType || !entityId || !updates) {
      return sendError(res, 400, '缺少必要参数');
    }

    const projectDir = store.getProjectDir(projectId);
    const scenesDir = path.join(projectDir, 'scenes');
    const entitiesPath = path.join(scenesDir, 'entities.json');
    const entities =
      store.getArtifact<any>(projectId, 'lookdev_entities') ||
      safeReadJsonSync<any>(entitiesPath) ||
      {};

    let target: any = null;
    if (entityType === 'character') {
      target = (entities.characters || []).find((c: any) => (c.characterId || c.id) === entityId);
    } else if (entityType === 'location') {
      target = (entities.locations || []).find((l: any) => (l.locationId || l.id) === entityId);
    }

    if (!target) {
      return sendError(res, 404, `未在视觉资产中找到实体 [${entityId}]`);
    }

    if (updates.promptZh !== undefined) {
      target.promptZh = updates.promptZh;
    }
    if (updates.referenceImageUrl !== undefined) {
      if (!updates.referenceImageUrl) {
        const oldRefUrl = target.referenceImageUrl;
        delete target.referenceImageUrl;
        // 同步物理清理磁盘残留文件，彻底杜绝死灰复燃
        const refDir = path.join(projectDir, 'assets', 'references');
        if (fs.existsSync(refDir)) {
          // 1. 若有明确原底图路径，直接物理删除
          if (oldRefUrl) {
            try {
              const directName = path.basename(String(oldRefUrl).split('?')[0]);
              const directFile = path.join(refDir, directName);
              if (fs.existsSync(directFile)) {
                fs.unlinkSync(directFile);
              }
            } catch (e) {
              console.warn('[DeleteReference] 清理原底图文件失败:', e);
            }
          }
          // 2. 匹配所有属于该实体的历史碎片文件并物理清理
          const files = fs.readdirSync(refDir);
          const targetId = target.characterId || target.locationId || target.id || entityId;
          const matchedFiles = files.filter(
            (f) => f.startsWith(`${targetId}_`) || f.startsWith(`${targetId}.`) || f.includes(targetId)
          );
          matchedFiles.forEach((file) => {
            try {
              fs.unlinkSync(path.join(refDir, file));
            } catch (e) {
              console.warn(`[DeleteReference] 物理清理底图文件失败: ${file}`, e);
            }
          });
        }
      } else {
        target.referenceImageUrl = updates.referenceImageUrl;
      }
    }

    store.setArtifact(projectId, 'lookdev_entities', entities);
    if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
    atomicWriteJsonSync(entitiesPath, entities);

    res.json({ success: true, entity: target });
  } catch (err: any) {
    sendError(res, 500, `更新实体失败: ${err.message}`);
  }
});

/**
 * 切换指定实体的激活版本 (Lookdev Version Switch)
 * POST /api/projects/:id/entities/select-version
 * Body: { entityType: 'character' | 'location', entityId: string, versionId: string }
 */
projectsRouter.post('/:id/entities/select-version', (req, res) => {
  try {
    const projectId = req.params.id;
    const { entityType, entityId, versionId } = req.body || {};

    if (!entityType || !entityId || !versionId) {
      return sendError(res, 400, '缺少必要参数: entityType, entityId, versionId');
    }

    const projectDir = store.getProjectDir(projectId);
    const scenesDir = path.join(projectDir, 'scenes');
    const entitiesPath = path.join(scenesDir, 'entities.json');
    const entities =
      store.getArtifact<any>(projectId, 'lookdev_entities') ||
      safeReadJsonSync<any>(entitiesPath) ||
      {};

    let target: any = null;
    if (entityType === 'character') {
      target = (entities.characters || []).find((c: any) => c.characterId === entityId);
    } else if (entityType === 'location') {
      target = (entities.locations || []).find((l: any) => l.locationId === entityId);
    }

    if (!target) {
      return sendError(res, 404, `未在视觉资产中找到实体 [${entityId}]`);
    }

    const versions = target.versions || [];
    const matchedVersion = versions.find((v: any) => v.versionId === versionId);
    if (!matchedVersion) {
      return sendError(res, 404, `未在实体历史版本中找到版本 [${versionId}]`);
    }

    // 激活该版本 (只切换立绘与提示词，绝不篡改实体的全局基准底图 target.referenceImageUrl)
    target.selectedVersionId = matchedVersion.versionId;
    target.imageUrl = matchedVersion.imageUrl;
    if (matchedVersion.promptZh) {
      target.promptZh = matchedVersion.promptZh;
    }

    store.setArtifact(projectId, 'lookdev_entities', entities);
    if (!fs.existsSync(scenesDir)) fs.mkdirSync(scenesDir, { recursive: true });
    atomicWriteJsonSync(entitiesPath, entities);

    res.json({ success: true, entity: target });
  } catch (err: any) {
    sendError(res, 500, `切换定妆版本失败: ${err.message}`);
  }
});

/**
 * 基于当前图的 AI 定向精修 (Image-to-Image / Ref2Image)
 * 严格锁定人物面容五官、体型骨骼与构图，根据自然语言指令定向修改服饰/发型/色彩并自动出图
 * POST /api/projects/:id/entities/image-refine
 * Body: { entityType: 'character' | 'location', entityId: string, instruction: string, baseImageUrl?: string }
 */
projectsRouter.post('/:id/entities/image-refine', async (req, res) => {
  try {
    const projectId = req.params.id;
    const { entityType, entityId, instruction, baseImageUrl } = req.body || {};

    if (!entityType || !entityId || !instruction || !instruction.trim()) {
      return sendError(res, 400, '缺少必要参数: entityType, entityId, instruction');
    }

    const projectDir = store.getProjectDir(projectId);
    const scenesDir = path.join(projectDir, 'scenes');
    const entitiesPath = path.join(scenesDir, 'entities.json');
    const entities =
      store.getArtifact<any>(projectId, 'lookdev_entities') ||
      safeReadJsonSync<any>(entitiesPath) ||
      {};

    let target: any = null;
    if (entityType === 'character') {
      target = (entities.characters || []).find((c: any) => c.characterId === entityId);
    } else if (entityType === 'location') {
      target = (entities.locations || []).find((l: any) => l.locationId === entityId);
    }

    if (!target) {
      return sendError(res, 404, `未在视觉资产中找到实体 [${entityId}]`);
    }

    // 确定参考底图：优先指定 baseImageUrl，其次 target.imageUrl
    const effectiveBaseImage = baseImageUrl || target.imageUrl;
    if (!effectiveBaseImage) {
      return sendError(
        res,
        400,
        `该${entityType === 'character' ? '角色' : '场景'}尚未生成首张定妆立绘，无法基于原图进行定向修改。请先生成首张定妆。`
      );
    }

    // 1. 调用大模型进行通用的多模态视听语义动态差分编译 (Dynamic Differential Multi-Modal Compilation)
    const isChar = entityType === 'character';
    let directedPrompt = '';
    let negativePrompt = '';

    try {
      const systemPrompt = `你是一位专业影视视听总导演与 AI 多模态图生图提示词架构师。
创作者基于已有参考底图（<image1>）提出了定向修改诉求。你的核心任务是依据【动态差分因果原则 (Dynamic Differential Principle)】，生成专业的高品质定向重绘提示词：

【核心架构：动态差分因果原则 (Dynamic Differential Principle)】：
1. 【零死板预设与完全自由覆盖】：
   - 严禁假定任何特定特征（如“五官发型保持一致”）绝对不变，因为创作者可能正需要修改五官、发型、肤色、年龄或神态；
   - 参考底图 <image1> 仅作为母体基准源：凡是创作者指令中要求修改的部分（无论肢体姿态、动作、视线角度、头部朝向、五官疤痕、发型肤色、服饰道具还是场景光影天气），全部以最高优先级彻底推翻重构为全新目标形态；凡是创作者指令未涉及的其余要素，才自然顺应融合继承。
2. 【正向提示词 (directedPrompt) 语法规范】：
   - 必须以 \`以 <image1> 为参考基模，定向修改为：\` 作为核心因果动宾句首，置于最前列；
   - 将创作者的修改诉求，转化为客观、具象、影视画质级别的终态画面描述；
   - 结尾附带：\`其余未涉及要素自然顺应融合。电影级写实摄影，自然光影质感，8K超高清。\`
3. 【负向提示词 (negativePrompt) 双向精准对抗】：
   - 必须精准推导出原图被推翻的旧特征形态词（例如：改并拢则负向必须含“跨步、双腿分开、迈步”；改头部端正则负向必须含“头部偏斜、歪头、侧脸、目光偏移”；改无面具则负向必须含“面具、面部遮挡”；改银发则负向必须含“原图发型、黑发”等）；
   - 结合通用画质瑕疵抑制词（低画质、低分辨率、肢体畸形、多余肢体、水印、文字等）。

【纯 JSON 输出规范（严禁任何 markdown 标记或额外解释）】：
{
  "directedPrompt": "以 <image1> 为参考基模，定向修改为：【终态具象展开】。其余未涉及要素自然顺应融合。电影级写实摄影，自然光影质感，8K超高清。",
  "negativePrompt": "【动态推导的旧特征对抗词】，低画质，低分辨率，画面模糊，变形，肢体畸形，多余肢体，错误解剖，水印，文字，噪点"
}`;

      const userPrompt = `【实体类型】：${isChar ? '角色立绘' : '场景空间'}
【原实体名称】：${target.name}
【原设定与视觉描述】：${target.promptZh || target.appearanceSummary || target.description || target.identity || ''}
【创作者修改诉求】：${instruction.trim()}

请根据动态差分因果原则，输出纯 JSON 对象：`;

      const { text } = await generateText({
        model: LLMProvider.getModel(),
        system: systemPrompt,
        prompt: userPrompt,
      });

      // 解析大模型返回的 JSON 对象
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        directedPrompt = (parsed.directedPrompt || '').trim();
        negativePrompt = (parsed.negativePrompt || '').trim();
      } else {
        directedPrompt = text.trim();
      }
    } catch (llmErr: any) {
      console.warn('[ImageRefine] 大模型通用动态差分编译降级:', llmErr);
      directedPrompt = `以 <image1> 为参考基模，定向修改为：${instruction.trim()}。其余未涉及要素自然顺应融合。电影级写实摄影，自然光影质感，8K超高清。`;
    }

    if (!directedPrompt) {
      directedPrompt = `以 <image1> 为参考基模，定向修改为：${instruction.trim()}。其余未涉及要素自然顺应融合。电影级写实摄影，自然光影质感，8K超高清。`;
    }

    // 2. 派发硬件渲染任务（带 referenceImageUrls 触发 ref2i 多模态工作流，并传入针对性负向词与原始指令）
    const toolName = isChar ? 'film.character_portrait' : 'film.scene_atmosphere';
    const taskInput = isChar
      ? {
          projectId,
          characterId: entityId,
          instruction: instruction.trim(),
          customPrompt: directedPrompt,
          customNegativePrompt: negativePrompt || undefined,
          referenceImageUrls: [effectiveBaseImage],
          force: true,
        }
      : {
          projectId,
          locationId: entityId,
          instruction: instruction.trim(),
          customPrompt: directedPrompt,
          customNegativePrompt: negativePrompt || undefined,
          referenceImageUrls: [effectiveBaseImage],
          force: true,
        };

    const task = await taskDispatcher.dispatch({
      projectId,
      toolName,
      input: taskInput,
    });

    res.json({
      success: true,
      directedPrompt,
      negativePrompt,
      baseImageUrl: effectiveBaseImage,
      task,
    });
  } catch (err: any) {
    sendError(res, 500, `基于当前图定向精修失败: ${err.message}`);
  }
});
