/**
 * project-store/ProjectStore.ts
 * 全局项目运行时黑板与元数据门面
 *
 * 职责边界：
 * 1. project.json 只保存 meta 与 chat，**不再保存任何产物正文**；
 * 2. 产物正文以独立文件落在 .debug/<阶段>/<工序>/ 与 <阶段>/<工序>/，由 artifact-fs 统一管理；
 * 3. 本项目是进程内运行时黑板：setArtifact/getArtifact 接口保持不变，数据只在内存里传递，
 *    进程重启后由 ARTIFACT_PATHS 的固定 key → 文件路径映射兜底读盘（md 文本）。
 * 4. 底层统一使用 atomicWriteJsonSync 原子写盘，防断电损坏。
 */

import fs from 'fs';
import path from 'path';
import { config } from '../utils/config.js';
import { atomicWriteJsonSync, safeReadJsonSync } from '../utils/atomicFile.js';
import { ARTIFACT_PATHS, getProjectDir, readArtifactFile } from './artifact-fs.js';
import { projectLockManager } from '../workflow-engine/concurrency.js';
import type { ProjectChatMessage, ProjectData, ProjectMetadata } from './types.js';
import {
  createEmptyStudioTaskRegistry,
  mountStudioTaskSlot,
  mountStudioStageTask,
  type ProjectStudioTaskRegistry,
} from './contracts/film-production/studio-tasks.js';
import {
  formatGddPrdToMarkdown,
  formatStoryScenesToMarkdown,
} from '../tools/planner/script-to-prd-tool/steps/02-synthesize/markdown-renderer.js';

/**
 * 全局法定资产物理落盘规范 (Canonical Artifact Spec SSOT)
 * 进程重启后通过本标准规范直接原子读盘，杜绝任何下游硬编码分支与多路猜测
 */
export const CANONICAL_ARTIFACT_MAP: Record<
  string,
  { filename: string; type: 'text' | 'json'; subDir?: string }
> = {
  // 工序 1 资产
  screenplay: { filename: 'screenplay.md', type: 'text' },
  story: { filename: 'story.md', type: 'text' },
  prd: { filename: 'prd.json', type: 'json' },
  prd_markdown: { filename: 'prd.md', type: 'text' },

  // 工序 2 资产
  lookdev_entities: { filename: 'entities.json', type: 'json', subDir: 'scenes' },

  // 工序 3 资产与无限分镜画布
  storyboards: { filename: 'storyboards.json', type: 'json' },
  film_spec: { filename: 'film_spec.json', type: 'json' },
  storyboard_canvas: { filename: 'storyboard_canvas.json', type: 'json' },

  // 全局多维工序任务树
  studio_tasks: { filename: 'tasks.json', type: 'json' },
};

/** 写进 project.json 的投影：仅存全局元数据 (对话与产物已全部分离落盘) */
type ProjectDiskView = { meta: ProjectMetadata };

export class ProjectStore {
  private static instance: ProjectStore | null = null;
  private cache: Map<string, ProjectData> = new Map();

  private constructor() {}

  public static getInstance(): ProjectStore {
    if (!this.instance) {
      this.instance = new ProjectStore();
    }
    return this.instance;
  }

  /**
   * 同项目状态读-改-写异步互斥锁（store 独立命名空间，避免与执行通道锁嵌套冲突）
   */
  public withProjectLock<T>(projectId: string, fn: () => Promise<T> | T): Promise<T> {
    return projectLockManager.withLock(`store:${projectId}`, fn);
  }

  public acquireProjectLock(projectId: string): Promise<() => void> {
    return projectLockManager.acquire(`store:${projectId}`);
  }

  /**
   * 获取项目的物理存储根目录
   */
  public getProjectDir(projectId: string): string {
    return getProjectDir(projectId);
  }

  /**
   * 获取 project.json 的绝对路径
   */
  private getProjectJsonPath(projectId: string): string {
    return path.join(this.getProjectDir(projectId), 'project.json');
  }

  /**
   * 加载或初始化项目数据（产物正文只存在于内存黑板，不进 project.json）
   */
  public getProject(projectId: string): ProjectData {
    if (this.cache.has(projectId)) {
      return this.cache.get(projectId)!;
    }

    const filePath = this.getProjectJsonPath(projectId);
    const disk = safeReadJsonSync<ProjectDiskView>(filePath);

    let data: ProjectData;
    if (disk?.meta) {
      data = {
        meta: disk.meta,
        artifacts: {},
      };
    } else {
      const now = new Date().toISOString();
      data = {
        meta: {
          projectId,
          title: `全新互动项目_${projectId.slice(-6)}`,
          createdAt: now,
          updatedAt: now,
          currentStage: 'gdd_planning',
        },
        artifacts: {},
      };
      atomicWriteJsonSync(filePath, { meta: data.meta });
    }

    this.cache.set(projectId, data);
    return data;
  }

  /**
   * 保存项目元数据到磁盘。产物正文由各工序自行落盘，对白归档由 chat 模块统一管理，绝不写进 project.json。
   */
  public saveProject(data: ProjectData): void {
    data.meta.updatedAt = new Date().toISOString();
    const filePath = this.getProjectJsonPath(data.meta.projectId);
    const diskView: ProjectDiskView = { meta: data.meta };
    atomicWriteJsonSync(filePath, diskView);
    this.cache.set(data.meta.projectId, data);
  }

  /**
   * 写入运行时黑板（接口保持兼容，不再落 project.json）
   */
  public setArtifact<T = any>(projectId: string, artifactKey: string, artifactData: T): void {
    const project = this.getProject(projectId);
    project.artifacts[artifactKey] = artifactData;
    this.saveProject(project);
  }

  /**
   * 原子性更新运行时黑板与落盘资产 (Atomic Mutator SSOT)
   * 即时获取最新黑板状态 ➔ 执行突变 ➔ 立即同步内存与磁盘，杜绝并发子任务读取陈旧快照全量覆写导致的数据踩踏
   */
  public mutateArtifact<T = any>(
    projectId: string,
    artifactKey: string,
    mutator: (current: T) => T | void,
    initialValue?: T
  ): T {
    let current = this.getArtifact<T>(projectId, artifactKey);
    if (current === null || current === undefined) {
      if (initialValue !== undefined) {
        current = initialValue;
      }
    }
    const result = mutator(current as T);
    const updated = result !== undefined ? result : current;
    if (updated === null || updated === undefined) {
      throw new Error(`无法更新不存在的产物: ${artifactKey}`);
    }

    this.setArtifact(projectId, artifactKey, updated);

    const spec = CANONICAL_ARTIFACT_MAP[artifactKey];
    if (spec) {
      const projectDir = this.getProjectDir(projectId);
      const baseDir = spec.subDir ? path.join(projectDir, spec.subDir) : projectDir;
      fs.mkdirSync(baseDir, { recursive: true });
      const filePath = path.join(baseDir, spec.filename);
      if (spec.type === 'json') {
        atomicWriteJsonSync(filePath, updated);
      } else {
        fs.writeFileSync(filePath, String(updated), 'utf-8');
      }
    }

    return updated;
  }

  /**
   * 读取运行时黑板（单一事实来源 SSOT：内存优先，缺失时依照 CANONICAL_ARTIFACT_MAP 精准原子读盘水合）
   */
  public getArtifact<T = any>(projectId: string, artifactKey: string): T | null {
    const project = this.getProject(projectId);
    const inMemory = project.artifacts[artifactKey] as T | undefined;
    if (inMemory !== undefined && inMemory !== null) return inMemory;

    // 优先从磁盘 film_spec.json 读取；若缺失才尝试从 storyboards.json 水合；并与最新 storyboards 深度合流
    if (artifactKey === 'film_spec') {
      const projectDir = this.getProjectDir(projectId);
      const specPath = path.join(projectDir, 'film_spec.json');
      const sbPath = path.join(projectDir, 'storyboards.json');
      let specObj = fs.existsSync(specPath) ? safeReadJsonSync<any>(specPath) : null;
      const sbClips = fs.existsSync(sbPath) ? safeReadJsonSync<any[]>(sbPath) : null;

      if (!specObj && Array.isArray(sbClips) && sbClips.length > 0) {
        specObj = {
          projectId,
          schemaVersion: '1.0.0',
          projectTitle: project.meta.title || '',
          clips: sbClips,
        };
      } else if (specObj && Array.isArray(sbClips)) {
        // SSOT 自动合流：将 storyboards 中实时演进的镜头媒体与版本同步到 film_spec.clips
        for (const sbClip of sbClips) {
          const targetClip = specObj.clips?.find((c: any) => c.clipId === sbClip.clipId);
          if (!targetClip) continue;
          if (Array.isArray(sbClip.shots) && Array.isArray(targetClip.shots)) {
            for (const sbShot of sbClip.shots) {
              const targetShot = targetClip.shots.find((s: any) => s.shotId === sbShot.shotId);
              if (!targetShot) continue;
              if (Array.isArray(sbShot.firstFrameVersions) && sbShot.firstFrameVersions.length > 0) {
                targetShot.firstFrameVersions = sbShot.firstFrameVersions;
              }
              if (Array.isArray(sbShot.lastFrameVersions) && sbShot.lastFrameVersions.length > 0) {
                targetShot.lastFrameVersions = sbShot.lastFrameVersions;
              }
              if (Array.isArray(sbShot.videoVersions) && sbShot.videoVersions.length > 0) {
                targetShot.videoVersions = sbShot.videoVersions;
              }
              if (sbShot.firstFrameImageUrl) targetShot.firstFrameImageUrl = sbShot.firstFrameImageUrl;
              if (sbShot.lastFrameImageUrl) targetShot.lastFrameImageUrl = sbShot.lastFrameImageUrl;
              if (sbShot.keyframeUrl) targetShot.keyframeUrl = sbShot.keyframeUrl;
              if (sbShot.videoUrl) targetShot.videoUrl = sbShot.videoUrl;
              if (sbShot.firstFramePrompt) targetShot.firstFramePrompt = sbShot.firstFramePrompt;
              if (sbShot.videoPrompt) targetShot.videoPrompt = sbShot.videoPrompt;
            }
          }
        }
      }

      if (specObj) {
        project.artifacts.film_spec = specObj;
        return specObj as unknown as T;
      }
      return null;
    }

    // 唯一规范字典查表，杜绝任何下游硬编码胶水分支
    const spec = CANONICAL_ARTIFACT_MAP[artifactKey];
    if (!spec) return null;

    const projectDir = this.getProjectDir(projectId);
    const baseDir = spec.subDir
      ? path.join(projectDir, spec.subDir)
      : projectDir;
    const filePath = path.join(baseDir, spec.filename);

    // 1. 若标准物理文件存在，直接读取并水合
    if (fs.existsSync(filePath)) {
      try {
        if (spec.type === 'json') {
          const parsed = safeReadJsonSync<T>(filePath);
          if (parsed !== null) project.artifacts[artifactKey] = parsed;
          return parsed;
        } else {
          const text = fs.readFileSync(filePath, 'utf-8');
          project.artifacts[artifactKey] = text;
          return text as unknown as T;
        }
      } catch {
        return null;
      }
    }

    // 2. 自愈通道：针对历史项目 04-prd-synthesis 规范目录进行自动回写水合 (SSOT Self-Healing)
    try {
      const legacyPrdMdPath = path.join(projectDir, '01-planner', '04-prd-synthesis', 'prd.md');
      const legacyStoryMdPath = path.join(projectDir, '01-planner', '04-prd-synthesis', 'story.md');

      if (artifactKey === 'prd') {
        if (fs.existsSync(legacyPrdMdPath)) {
          const prdText = fs.readFileSync(legacyPrdMdPath, 'utf-8');
          const jsonMatch = prdText.match(/```json\s*([\s\S]*?)\s*```/);
          if (jsonMatch && jsonMatch[1]) {
            const parsed = JSON.parse(jsonMatch[1]);
            project.artifacts[artifactKey] = parsed;
            atomicWriteJsonSync(path.join(projectDir, 'prd.json'), parsed);
            return parsed as unknown as T;
          }
        }
      }

      if (artifactKey === 'prd_markdown') {
        if (fs.existsSync(legacyPrdMdPath)) {
          const prdText = fs.readFileSync(legacyPrdMdPath, 'utf-8');
          project.artifacts[artifactKey] = prdText;
          fs.writeFileSync(path.join(projectDir, 'prd.md'), prdText, 'utf-8');
          return prdText as unknown as T;
        } else {
          const prdObj = this.getArtifact<any>(projectId, 'prd');
          if (prdObj) {
            const rendered = formatGddPrdToMarkdown(prdObj);
            project.artifacts[artifactKey] = rendered;
            fs.writeFileSync(path.join(projectDir, 'prd.md'), rendered, 'utf-8');
            return rendered as unknown as T;
          }
        }
      }

      if (artifactKey === 'story') {
        if (fs.existsSync(legacyStoryMdPath)) {
          const storyText = fs.readFileSync(legacyStoryMdPath, 'utf-8');
          project.artifacts[artifactKey] = storyText;
          fs.writeFileSync(path.join(projectDir, 'story.md'), storyText, 'utf-8');
          return storyText as unknown as T;
        } else {
          const prdObj = this.getArtifact<any>(projectId, 'prd');
          if (prdObj && Array.isArray(prdObj.clips)) {
            const renderedStory = formatStoryScenesToMarkdown(prdObj.clips);
            project.artifacts[artifactKey] = renderedStory;
            fs.writeFileSync(path.join(projectDir, 'story.md'), renderedStory, 'utf-8');
            return renderedStory as unknown as T;
          }
        }
      }

      if (artifactKey === 'screenplay') {
        const legacySpinePath = path.join(projectDir, '.debug', '01-planner', '01-write-spine-script', 'planner_spine.md');
        if (fs.existsSync(legacySpinePath)) {
          const spineText = fs.readFileSync(legacySpinePath, 'utf-8');
          project.artifacts[artifactKey] = spineText;
          fs.writeFileSync(path.join(projectDir, 'screenplay.md'), spineText, 'utf-8');
          return spineText as unknown as T;
        } else if (fs.existsSync(legacyStoryMdPath)) {
          const storyText = fs.readFileSync(legacyStoryMdPath, 'utf-8');
          project.artifacts[artifactKey] = storyText;
          fs.writeFileSync(path.join(projectDir, 'screenplay.md'), storyText, 'utf-8');
          return storyText as unknown as T;
        }
      }
    } catch (err) {
      console.warn(`[ProjectStore] 自愈水合资产 [${artifactKey}] 失败:`, err);
    }

    return null;
  }

  /**
   * 获取项目的多维工序任务树 (Multi-Dimensional Studio Task Registry SSOT)
   */
  public getStudioTasks(projectId: string): ProjectStudioTaskRegistry {
    const existing = this.getArtifact<ProjectStudioTaskRegistry>(projectId, 'studio_tasks');
    if (existing) return existing;
    const initial = createEmptyStudioTaskRegistry(projectId);
    this.setArtifact(projectId, 'studio_tasks', initial);
    return initial;
  }

  /**
   * 将具体工序的 taskId 自动挂载更新到多维任务树对应的槽位中
   */
  public updateStudioTaskSlot(
    projectId: string,
    actionType: string,
    targetId: string,
    taskId: string,
    clipId?: string
  ): ProjectStudioTaskRegistry {
    const registry = this.getStudioTasks(projectId);
    const updated = mountStudioTaskSlot(registry, actionType, targetId, taskId, clipId);
    this.setArtifact(projectId, 'studio_tasks', updated);
    return updated;
  }

  /**
   * 挂载顶层工序阶段任务 (planGddTaskId / assetExtractionTaskId / storyboardPlanningTaskId / studioMasterTaskId)
   */
  public updateStudioStageTask(
    projectId: string,
    stageKey: keyof ProjectStudioTaskRegistry['stages'],
    taskId: string
  ): ProjectStudioTaskRegistry {
    const registry = this.getStudioTasks(projectId);
    const updated = mountStudioStageTask(registry, stageKey, taskId);
    this.setArtifact(projectId, 'studio_tasks', updated);
    return updated;
  }

  /**
   * 物理删除项目工程与缓存
   */
  public deleteProject(projectId: string): void {
    this.cache.delete(projectId);
    const dir = this.getProjectDir(projectId);
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  }

  /**
   * 列出所有项目元数据
   */
  public listProjects(): ProjectMetadata[] {
    const root = config.paths.projects;
    if (!fs.existsSync(root)) return [];

    const dirs = fs.readdirSync(root);
    const list: ProjectMetadata[] = [];
    for (const dir of dirs) {
      const projPath = path.join(root, dir, 'project.json');
      const data = safeReadJsonSync<ProjectDiskView>(projPath);
      if (data?.meta) {
        list.push(data.meta);
      }
    }
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
