/**
 * api/controllers/ProjectController.ts
 * 项目生命周期与阶段元数据控制器 (Project Controller SSOT)
 */

import fs from 'fs';
import path from 'path';
import { Hono } from 'hono';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { CriticReviewerAgent } from '../../agents/reviewer/CriticReviewerAgent.js';
import { GateGuard } from '../../agents/reviewer/GateGuard.js';
import { STAGE_SEQUENCE, WorkflowStage, SessionStatus } from '../../types/index.js';

export const projectController = new Hono();

// 阶段元数据清单 (Stages SSOT)
const STAGES_METADATA = [
  { id: WorkflowStage.NARRATIVE_DESIGN, name: '叙事架构', order: 1, description: '网状故事圣经与黄金戏剧主干推演' },
  { id: WorkflowStage.CHARACTER_DESIGN, name: '角色定妆', order: 2, description: '全剧角色视觉锚点与定妆照多版本生成' },
  { id: WorkflowStage.SCENE_SCRIPT, name: '分场剧本', order: 3, description: '多分支逐场剧本与交互抉择点扩写' },
  { id: WorkflowStage.STORYBOARD, name: '视听分镜', order: 4, description: '导演机位视听规划与镜头构图切分' },
  { id: WorkflowStage.KEYFRAME_REFERENCE, name: '关键帧图', order: 5, description: '各镜头首帧画面与参考图高清渲染' },
  { id: WorkflowStage.VIDEO_PRODUCTION, name: '视频生成', order: 6, description: '各分支节点动态视频切片批量渲染' },
  { id: WorkflowStage.FMV_PACKAGING, name: '影游装配', order: 7, description: '工程母带混音与交互播放器 Manifest 打包' },
];

// 阶段清单接口
projectController.get('/api/stages', (c) => {
  return c.json({ success: true, stages: STAGES_METADATA });
});

// 获取项目列表 (同时支持标准 REST /api/projects 与 /api/project/list)
const handleListProjects = (c: any) => {
  try {
    const store = ProjectStore.getInstance();
    const projects = store.listProjects();
    return c.json({ success: true, projects });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
};
projectController.get('/api/projects', handleListProjects);

// 获取项目状态快照
projectController.get('/api/project/:projectId/status', (c) => {
  try {
    const projectId = c.req.param('projectId');
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);
    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }
    return c.json({
      success: true,
      projectId,
      status: project.status,
      currentStage: project.currentStage,
      project,
      artifacts: project.stageArtifacts || {},
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 🌟 权威阶段推进接口 (Stage Advance SSOT)：创作者确认当前阶段合格，推进至下一标准阶段 (支持幂等防连跳保护)
projectController.post('/api/project/:projectId/stage/advance', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const body = await c.req.json().catch(() => ({}));
    const fromStage = body.fromStage;

    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);
    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    // 🌟 幂等防重跳保护：若客户端指定了原阶段 fromStage，且当前权威阶段已超越该阶段（例如 TaskEngine 已跃迁），直接幂等返回，杜绝盲目连跳
    if (fromStage) {
      const fromIdx = STAGE_SEQUENCE.indexOf(fromStage as any);
      const currIdx = STAGE_SEQUENCE.indexOf(project.currentStage as any);
      if (fromIdx !== -1 && currIdx > fromIdx) {
        return c.json({
          success: true,
          previousStage: fromStage,
          currentStage: project.currentStage,
          idempotent: true,
        });
      }
    }

    if (project.currentStage === WorkflowStage.COMPLETED) {
      return c.json({
        success: true,
        currentStage: WorkflowStage.COMPLETED,
        message: '项目已全部完成，无需推进',
      });
    }

    // 🌟 门禁校验 1：当前工序必须存在实际交付产物，彻底消灭未执行技能即可空跑连跳
    const currentArtifact = store.getArtifact(projectId, project.currentStage as any);
    if (!currentArtifact || (typeof currentArtifact === 'object' && Object.keys(currentArtifact).length === 0)) {
      return c.json({
        success: false,
        error: `当前工序【${project.currentStage}】尚未生成任何实质交付产物，严禁空跑跃迁至下一阶段`,
      }, 400);
    }

    // 🌟 门禁校验 2：审查官刚性阻断 (双核博弈生效)——当前工序若有未失效的 FAIL 报告，坚决阻断跨工序推进
    const effectiveReport = CriticReviewerAgent.getInstance().getEffectiveReport(projectId, project.currentStage);
    if (effectiveReport && !effectiveReport.isStale && effectiveReport.gateStatus === 'FAIL') {
      return c.json({
        success: false,
        error: `审查官刚性阻断：当前工序【${project.currentStage}】存在重大视听缺陷，审查官评定为 FAIL。请先进行自愈优化或在对辩面板辩护通过后方可推进！`,
        gateStatus: 'FAIL',
        report: effectiveReport,
      }, 403);
    }

    const currentIndex = STAGE_SEQUENCE.indexOf(project.currentStage as any);
    if (currentIndex !== -1 && currentIndex < STAGE_SEQUENCE.length - 1) {
      const nextStage = STAGE_SEQUENCE[currentIndex + 1];
      project.currentStage = nextStage;
      store.saveProject(project);

      // 同步对齐关联 Session 的阶段
      const sessions = store.listSessions(projectId);
      for (const sess of sessions) {
        if (sess.currentStage !== nextStage) {
          sess.currentStage = nextStage;
          store.saveSession(sess);
        }
      }

      return c.json({
        success: true,
        previousStage: STAGE_SEQUENCE[currentIndex],
        currentStage: nextStage,
      });
    } else if (currentIndex === STAGE_SEQUENCE.length - 1) {
      project.currentStage = WorkflowStage.COMPLETED;
      project.status = SessionStatus.COMPLETED;
      store.saveProject(project);
      return c.json({
        success: true,
        currentStage: WorkflowStage.COMPLETED,
      });
    }

    return c.json({ success: false, error: 'Cannot advance beyond completed stage' }, 400);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 获取项目全局状态黑板指定阶段产物 (Artifact GET SSOT)
projectController.get('/api/project/:projectId/artifact/:stage', (c) => {
  try {
    const projectId = c.req.param('projectId');
    const stage = c.req.param('stage');
    const store = ProjectStore.getInstance();
    const artifact = store.getArtifact(projectId, stage);
    if (!artifact) {
      return c.json({ success: false, error: `阶段 [${stage}] 产物尚未生成` }, 404);
    }
    return c.json({ success: true, stage, artifact });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 写入项目全局状态黑板指定阶段产物 (Artifact POST - 全量覆盖 SSOT)
projectController.post('/api/project/:projectId/artifact/:stage', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const stage = c.req.param('stage');
    const body = await c.req.json().catch(() => ({}));
    const store = ProjectStore.getInstance();
    store.setArtifact(projectId, stage, body);
    return c.json({ success: true, stage, message: `阶段 [${stage}] 产物已全量更新` });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 局部更新/版本切换选择项目阶段产物 (Artifact PATCH - 增量合并与防数据清空 SSOT)
projectController.patch('/api/project/:projectId/artifact/:stage', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const stage = c.req.param('stage');
    const body = await c.req.json().catch(() => ({}));
    const store = ProjectStore.getInstance();
    const existing = store.getArtifact<any>(projectId, stage as any);

    if (!existing) {
      store.setArtifact(projectId, stage, body);
      return c.json({ success: true, stage, message: `阶段 [${stage}] 产物已创建` });
    }

    // 🌟 针对创作者版本选择 (Selections) 的结构安全合流，严禁冲毁原有角色/分镜完整产物清单
    const selections = body.selections || (typeof body === 'object' && !Array.isArray(body) && !body.characters && !body.shots ? body : undefined);

    if (selections && typeof selections === 'object') {
      let updated = false;

      // 1. 角色定妆阶段产物版本合流
      if (stage === 'character_design' && Array.isArray(existing.characters)) {
        existing.characters = existing.characters.map((char: any) => {
          const charKey = char.name || char.id;
          const chosenUrl = selections[charKey] || selections[char.id] || selections[char.name];
          if (chosenUrl && typeof chosenUrl === 'string') {
            updated = true;
            return { ...char, imageUrl: chosenUrl, selected: true };
          }
          return char;
        });
      }

      // 2. 关键帧/分镜阶段产物版本合流
      if (Array.isArray(existing.shots)) {
        existing.shots = existing.shots.map((shot: any) => {
          const shotKey = shot.shotId || shot.id;
          const chosenUrl = selections[shotKey];
          if (chosenUrl && typeof chosenUrl === 'string') {
            updated = true;
            return { ...shot, imageUrl: chosenUrl };
          }
          return shot;
        });
      }

      if (updated) {
        store.setArtifact(projectId, stage, existing);
        return c.json({ success: true, stage, artifact: existing, message: `阶段 [${stage}] 版本选择已精准合流` });
      }
    }

    // 3. 通用对象层级浅合并
    const merged = typeof existing === 'object' && !Array.isArray(existing) && typeof body === 'object' && !Array.isArray(body)
      ? { ...existing, ...body }
      : body;

    store.setArtifact(projectId, stage, merged);
    return c.json({ success: true, stage, artifact: merged, message: `阶段 [${stage}] 产物已局部合并更新` });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 🌟 上传阶段媒体图片 (通用文件落盘与阶段产物适配器更新)
projectController.post('/api/project/:projectId/artifact/:stage/upload_image', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const stage = c.req.param('stage');
    const store = ProjectStore.getInstance();

    const body = await c.req.parseBody();
    const file = body['file'];
    const itemType = (body['item_type'] as string) || 'characters';
    const itemId = (body['item_id'] as string) || `img_${Date.now()}`;

    if (!file || typeof file === 'string') {
      return c.json({ success: false, error: '缺少有效的上传文件' }, 400);
    }

    // 🌟 刚性路径穿越防御：校验 itemType 并确保目标目录在 projectDir 内部
    const sanitizedItemType = itemType.replace(/[^a-zA-Z0-9_-]/g, '') || 'characters';
    const projectDir = path.resolve(store.getProjectDir(projectId));
    const targetDir = path.resolve(projectDir, sanitizedItemType);
    if (!targetDir.startsWith(projectDir)) {
      return c.json({ success: false, error: '非法上传路径，禁止目录逃逸' }, 403);
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const safeItemId = encodeURIComponent(itemId.replace(/[^a-zA-Z0-9_-]/g, ''));
    const originalName = (file as any).name || 'upload.png';
    const rawExt = path.extname(originalName).toLowerCase();
    const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
    const ext = ALLOWED_EXTENSIONS.includes(rawExt) ? rawExt : '.png';
    const filename = `${safeItemId}_${Date.now()}${ext}`;
    const fullPath = path.join(targetDir, filename);

    // 将二进制写入本地磁盘
    const arrayBuffer = await (file as Blob).arrayBuffer();
    fs.writeFileSync(fullPath, Buffer.from(arrayBuffer));

    const localUrl = `/media/${projectId}/${sanitizedItemType}/${filename}`;

    // 🌟 统一通过适配器回写阶段资产 (OCP 开闭原则解耦，消灭侵入式硬编码)
    let artifact = store.getArtifact<any>(projectId, stage as any);
    if (artifact) {
      artifact = applyMediaToStageArtifact(artifact, stage, itemId, sanitizedItemType, localUrl);
      store.setArtifact(projectId, stage as any, artifact);
    }

    return c.json({
      success: true,
      status: 'success',
      path: localUrl,
      artifact,
      status_map: { [itemId]: 'ready' },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 获取项目详情
projectController.get('/api/project/:projectId', (c) => {
  try {
    const projectId = c.req.param('projectId');
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);
    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }
    return c.json({ success: true, project });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// 删除项目
projectController.delete('/api/project/:projectId', (c) => {
  try {
    const projectId = c.req.param('projectId');
    const store = ProjectStore.getInstance();
    store.deleteProject(projectId);
    return c.json({ success: true, message: 'Project deleted' });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

/**
 * 🌟 通用阶段产物媒体回写适配器 (开闭原则 OCP 解耦)
 */
function applyMediaToStageArtifact(
  artifact: any,
  stage: string,
  itemId: string,
  itemType: string,
  localUrl: string
): any {
  if (!artifact || typeof artifact !== 'object') return artifact;

  // 1. 角色定妆阶段
  if (stage === 'character_design' && Array.isArray(artifact.characters)) {
    return {
      ...artifact,
      characters: artifact.characters.map((char: any) => {
        if (char.name === itemId || char.id === itemId) {
          return itemType === 'reference'
            ? { ...char, referenceImageUrl: localUrl }
            : { ...char, imageUrl: localUrl, selected: true };
        }
        return char;
      }),
    };
  }

  // 2. 关键帧/分镜阶段的通用项匹配扩展
  if (Array.isArray(artifact.shots)) {
    return {
      ...artifact,
      shots: artifact.shots.map((shot: any) => {
        if (shot.shotId === itemId || shot.id === itemId) {
          return { ...shot, imageUrl: localUrl };
        }
        return shot;
      }),
    };
  }

  return artifact;
}
