/**
 * project-store/FileProjectStateStore.ts
 * 基于物理磁盘与 project.json 的生产级状态黑板存储实现 (SSOT)
 *
 * 遵循法典：零别名冗余，单一事实来源，全链路唯一标准字段为 projectId
 */

import fs from 'fs';
import path from 'path';
import { config } from '../utils/config.js';
import type { WorkflowSession } from '../types/index.js';
import type { IProjectStateStore } from './IProjectStateStore.js';
import type { ProjectStateSnapshot } from './types.js';

export class FileProjectStateStore implements IProjectStateStore {
  private projects = new Map<string, WorkflowSession>();

  constructor() {
    this.hydrateFromDisk();
  }

  private hydrateFromDisk(): void {
    const projectsRoot = config.paths.projects;
    if (!fs.existsSync(projectsRoot)) {
      fs.mkdirSync(projectsRoot, { recursive: true });
      return;
    }

    try {
      const entries = fs.readdirSync(projectsRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const projectJsonPath = path.join(projectsRoot, entry.name, 'project.json');
          if (fs.existsSync(projectJsonPath)) {
            try {
              const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
              const pid = data.projectId || entry.name;
              data.projectId = pid;
              this.projects.set(pid, data);
            } catch (err) {
              console.warn(`[FileProjectStateStore] 无法加载项目快照: ${projectJsonPath}`, err);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[FileProjectStateStore] 遍历项目目录失败:', e);
    }
  }

  public getProject(projectId: string): WorkflowSession | undefined {
    if (this.projects.has(projectId)) {
      return this.projects.get(projectId);
    }

    const dir = path.join(config.paths.projects, projectId);
    const targetFile = path.join(dir, 'project.json');
    if (fs.existsSync(targetFile)) {
      try {
        const raw = fs.readFileSync(targetFile, 'utf-8');
        const project = JSON.parse(raw);
        this.projects.set(projectId, project);
        return project;
      } catch (e) {
        console.error(`[FileProjectStateStore] 读取项目 ${projectId} 失败:`, e);
      }
    }
    return undefined;
  }

  public saveProject(project: WorkflowSession): void {
    const pid = project.projectId;
    this.projects.set(pid, project);

    const dir = path.join(config.paths.projects, pid);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = path.join(dir, 'project.json');
    try {
      fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[FileProjectStateStore] 持久化项目 ${pid} 失败:`, err);
    }
  }

  public deleteProject(projectId: string): void {
    this.projects.delete(projectId);
    const dir = path.join(config.paths.projects, projectId);
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (e) {
        console.warn(`[FileProjectStateStore] 删除项目目录失败: ${dir}`, e);
      }
    }
  }

  public listProjects(): WorkflowSession[] {
    return Array.from(this.projects.values());
  }

  public getArtifact<T = any>(projectId: string, stage: string): T | undefined {
    const project = this.getProject(projectId);
    return project?.stageArtifacts?.[stage] as T;
  }

  public setArtifact<T = any>(projectId: string, stage: string, artifact: T): void {
    const project = this.getProject(projectId);
    if (project) {
      if (!project.stageArtifacts) project.stageArtifacts = {};
      project.stageArtifacts[stage] = artifact;
      project.updatedAt = new Date().toISOString();
      this.saveProject(project);
    }
  }

  public getProjectDir(projectId: string): string {
    const dir = path.join(config.paths.projects, projectId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  public getSnapshot(projectId: string): ProjectStateSnapshot | undefined {
    const project = this.getProject(projectId);
    if (!project) return undefined;
    return {
      project,
      projectDir: this.getProjectDir(projectId),
      updatedAt: project.updatedAt,
    };
  }

  public destroy(projectId: string): void {
    this.projects.delete(projectId);
  }
}
