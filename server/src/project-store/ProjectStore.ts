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

/** 写进 project.json 的投影：只有元数据与聊天记录 */
type ProjectDiskView = Pick<ProjectData, 'meta' | 'chat'>;

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
        chat: disk.chat || [],
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
        chat: [],
      };
      atomicWriteJsonSync(filePath, { meta: data.meta, chat: data.chat } as ProjectDiskView);
    }

    this.cache.set(projectId, data);
    return data;
  }

  /**
   * 保存项目元数据到磁盘。产物正文由各工序自行落盘，绝不写进 project.json。
   */
  public saveProject(data: ProjectData): void {
    data.meta.updatedAt = new Date().toISOString();
    const filePath = this.getProjectJsonPath(data.meta.projectId);
    const diskView: ProjectDiskView = { meta: data.meta, chat: data.chat || [] };
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
   * 读取运行时黑板；内存缺失时按固定 key → 文件路径映射读盘兜底。
   * md 文件读回来是文本字符串，调用方按各自既有 fallback 处理。
   */
  public getArtifact<T = any>(projectId: string, artifactKey: string): T | null {
    const project = this.getProject(projectId);
    const inMemory = project.artifacts[artifactKey] as T | undefined;
    if (inMemory !== undefined && inMemory !== null) return inMemory;

    const entry = ARTIFACT_PATHS[artifactKey];
    if (!entry) return null;

    const text = readArtifactFile(projectId, entry.scope, entry.stage, entry.step, entry.file);
    if (text === null) return null;

    if (entry.file.endsWith('.json')) {
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    }
    return text as unknown as T;
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
   * 追加聊天/提案/任务关联记录并原子写盘
   */
  public appendChatRecord(
    projectId: string,
    record: Omit<ProjectChatMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: string }
  ): ProjectChatMessage {
    const project = this.getProject(projectId);
    if (!project.chat) project.chat = [];
    const entry: ProjectChatMessage = {
      ...record,
      id: record.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: record.createdAt || new Date().toISOString(),
    };
    project.chat.push(entry);
    this.saveProject(project);
    return entry;
  }

  /**
   * 追加纯文本聊天消息
   */
  public appendChatMessage(
    projectId: string,
    role: 'user' | 'assistant' | 'system',
    content: string
  ): void {
    this.appendChatRecord(projectId, { role, content });
  }

  /**
   * 按消息 ID 原地更新聊天记录并原子写盘（用于流式输出增量刷盘与终态定稿）
   */
  public updateChatRecord(
    projectId: string,
    messageId: string,
    patch: Partial<Omit<ProjectChatMessage, 'id' | 'role' | 'createdAt'>>
  ): void {
    const project = this.getProject(projectId);
    if (!project.chat || project.chat.length === 0) return;
    const target = project.chat.find((m) => m.id === messageId);
    if (!target) return;
    Object.assign(target, patch);
    this.saveProject(project);
  }

  /**
   * 物理删除单条聊天记录（用于「意图已落到既有任务气泡」时撤销本轮多余回复气泡）
   */
  public deleteChatRecord(projectId: string, messageId: string): void {
    const project = this.getProject(projectId);
    if (!project.chat || project.chat.length === 0) return;
    const idx = project.chat.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    project.chat.splice(idx, 1);
    this.saveProject(project);
  }

  /**
   * 将尚未授权的历史提案标为已授权
   */
  public markChatProposalsResolved(projectId: string): void {
    const project = this.getProject(projectId);
    if (!project.chat || project.chat.length === 0) return;
    let changed = false;
    for (const msg of project.chat) {
      if (msg.proposal && !msg.proposalResolved) {
        msg.proposalResolved = true;
        changed = true;
      }
    }
    if (changed) this.saveProject(project);
  }

  /**
   * 标记某阶段任务气泡附带的下一阶段提案已授权
   */
  public markTaskNextProposalResolved(projectId: string, taskRunId: string): void {
    const project = this.getProject(projectId);
    if (!project.chat || project.chat.length === 0) return;
    let changed = false;
    for (const msg of project.chat) {
      if (msg.taskRunId === taskRunId && !msg.nextProposalResolved) {
        msg.nextProposalResolved = true;
        changed = true;
      }
    }
    if (changed) this.saveProject(project);
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
