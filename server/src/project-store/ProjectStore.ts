/**
 * project-store/ProjectStore.ts
 * 全局项目单一事实来源单例门面 (ProjectStore SSOT)
 *
 * 核心法则：
 * 1. 唯一单例门面，凭 projectId 存取所有阶段资产与全局会话；
 * 2. 彻底消灭控制器与执行器之间深层对象的层层透传；
 * 3. 底层统一使用 atomicWriteJsonSync 原子写盘，防断电损坏。
 */

import path from 'path';
import fs from 'fs';
import { config } from '../utils/config.js';
import { atomicWriteJsonSync, safeReadJsonSync } from '../utils/atomicFile.js';
import type { ProjectData, ProjectMetadata } from './types.js';

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
   * 获取项目的物理存储根目录
   */
  public getProjectDir(projectId: string): string {
    const dir = path.join(config.paths.projects, projectId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * 获取 project.json 的绝对路径
   */
  private getProjectJsonPath(projectId: string): string {
    return path.join(this.getProjectDir(projectId), 'project.json');
  }

  /**
   * 加载或初始化项目数据
   */
  public getProject(projectId: string): ProjectData {
    if (this.cache.has(projectId)) {
      return this.cache.get(projectId)!;
    }

    const filePath = this.getProjectJsonPath(projectId);
    let data = safeReadJsonSync<ProjectData>(filePath);

    if (!data) {
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
      atomicWriteJsonSync(filePath, data);
    }

    this.cache.set(projectId, data);
    return data;
  }

  /**
   * 保存项目数据到磁盘
   */
  public saveProject(data: ProjectData): void {
    data.meta.updatedAt = new Date().toISOString();
    const filePath = this.getProjectJsonPath(data.meta.projectId);
    atomicWriteJsonSync(filePath, data);
    this.cache.set(data.meta.projectId, data);
  }

  /**
   * 写入特定阶段的资产 (Artifact SSOT)
   */
  public setArtifact<T = any>(projectId: string, artifactKey: string, artifactData: T): void {
    const project = this.getProject(projectId);
    project.artifacts[artifactKey] = artifactData;
    this.saveProject(project);

    // 同步把核心资产作为独立 JSON 存一份在项目子目录方便直观查阅
    const artifactSubDir = path.join(this.getProjectDir(projectId), 'artifacts');
    if (!fs.existsSync(artifactSubDir)) {
      fs.mkdirSync(artifactSubDir, { recursive: true });
    }
    atomicWriteJsonSync(path.join(artifactSubDir, `${artifactKey}.json`), artifactData);
  }

  /**
   * 读取特定阶段的资产
   */
  public getArtifact<T = any>(projectId: string, artifactKey: string): T | null {
    const project = this.getProject(projectId);
    return (project.artifacts[artifactKey] as T) || null;
  }

  /**
   * 追加聊天消息
   */
  public appendChatMessage(
    projectId: string,
    role: 'user' | 'assistant' | 'system',
    content: string
  ): void {
    const project = this.getProject(projectId);
    if (!project.chat) project.chat = [];
    project.chat.push({
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role,
      content,
      createdAt: new Date().toISOString(),
    });
    this.saveProject(project);
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
      const data = safeReadJsonSync<ProjectData>(projPath);
      if (data?.meta) {
        list.push(data.meta);
      }
    }
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
