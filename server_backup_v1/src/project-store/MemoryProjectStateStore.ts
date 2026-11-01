/**
 * project-store/MemoryProjectStateStore.ts
 * 纯内存型状态黑板实现 (针对单元测试与无磁盘依赖场景)
 */

import type { WorkflowSession } from '../types/index.js';
import type { IProjectStateStore } from './IProjectStateStore.js';
import type { ProjectStateSnapshot } from './types.js';

export class MemoryProjectStateStore implements IProjectStateStore {
  private projects = new Map<string, WorkflowSession>();

  public getProject(projectId: string): WorkflowSession | undefined {
    return this.projects.get(projectId);
  }

  public saveProject(project: WorkflowSession): void {
    const pid = project.projectId;
    this.projects.set(pid, project);
  }

  public deleteProject(projectId: string): void {
    this.projects.delete(projectId);
  }

  public listProjects(): WorkflowSession[] {
    return Array.from(this.projects.values());
  }

  public getArtifact<T = any>(projectId: string, stage: string): T | undefined {
    return this.projects.get(projectId)?.stageArtifacts?.[stage] as T;
  }

  public setArtifact<T = any>(projectId: string, stage: string, artifact: T): void {
    const project = this.projects.get(projectId);
    if (project) {
      if (!project.stageArtifacts) project.stageArtifacts = {};
      project.stageArtifacts[stage] = artifact;
      project.updatedAt = new Date().toISOString();
      this.projects.set(projectId, project);
    }
  }

  public getProjectDir(projectId: string): string {
    return `/tmp/projects/${projectId}`;
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
