/**
 * project-store/MemoryProjectStateStore.ts
 * 纯内存型状态黑板实现 (针对单元测试与无磁盘依赖场景)
 */

import { randomUUID } from 'crypto';
import type { ProjectEntity, ChatSession, ChatMessage, ScratchpadMemory } from '../types/index.js';
import type { IProjectStateStore } from './IProjectStateStore.js';
import type { ProjectStateSnapshot } from './types.js';

export class MemoryProjectStateStore implements IProjectStateStore {
  private projects = new Map<string, ProjectEntity>();
  private sessions = new Map<string, ChatSession>();
  private messages = new Map<string, ChatMessage[]>();

  private validateProjectId(projectId: string): void {
    if (!projectId || typeof projectId !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(projectId)) {
      throw new Error(`[MemoryProjectStateStore] 非法的 projectId: "${projectId}"，必须仅包含字母、数字、下划线或连字符`);
    }
  }

  public getProject(projectId: string): ProjectEntity | undefined {
    this.validateProjectId(projectId);
    return this.projects.get(projectId);
  }

  public saveProject(project: ProjectEntity): void {
    if (!project?.projectId) {
      throw new Error('[MemoryProjectStateStore] saveProject 失败: 缺失 projectId');
    }
    this.projects.set(project.projectId, project);
  }

  public deleteProject(projectId: string): void {
    this.validateProjectId(projectId);
    this.projects.delete(projectId);
  }

  public listProjects(): ProjectEntity[] {
    return Array.from(this.projects.values());
  }

  public getArtifact<T = any>(projectId: string, stage: string): T | undefined {
    this.validateProjectId(projectId);
    return this.projects.get(projectId)?.stageArtifacts?.[stage] as T;
  }

  public setArtifact<T = any>(projectId: string, stage: string, artifact: T): void {
    this.validateProjectId(projectId);
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`[MemoryProjectStateStore] setArtifact 失败: 未找到项目 [${projectId}]`);
    }
    if (!project.stageArtifacts) project.stageArtifacts = {};
    project.stageArtifacts[stage] = artifact;
    project.updatedAt = new Date().toISOString();
    this.projects.set(projectId, project);
  }

  public getProjectDir(projectId: string): string {
    this.validateProjectId(projectId);
    return `/tmp/projects/${projectId}`;
  }

  public getSnapshot(projectId: string): ProjectStateSnapshot | undefined {
    this.validateProjectId(projectId);
    const project = this.getProject(projectId);
    if (!project) return undefined;
    return {
      project,
      projectDir: this.getProjectDir(projectId),
      updatedAt: project.updatedAt,
    };
  }

  public destroy(projectId: string): void {
    this.validateProjectId(projectId);
    this.projects.delete(projectId);
  }

  public createSession(
    projectId: string,
    title: string = '新创作会话',
    initialStage?: string,
    customSessionId?: string
  ): ChatSession {
    this.validateProjectId(projectId);
    const sessionId = customSessionId || `chat_${Date.now()}_${randomUUID().slice(0, 6)}`;
    const now = new Date().toISOString();
    const project = this.getProject(projectId);

    const session: ChatSession = {
      sessionId,
      projectId,
      title,
      currentStage: project?.currentStage || initialStage || 'narrative_design',
      scratchpad: { userConstraints: [], lastUpdatedAt: now },
      createdAt: now,
      updatedAt: now,
    };
    this.saveSession(session);
    return session;
  }

  public getSession(projectId: string, sessionId: string): ChatSession | undefined {
    this.validateProjectId(projectId);
    return this.sessions.get(`${projectId}:${sessionId}`);
  }

  public listSessions(projectId: string): ChatSession[] {
    this.validateProjectId(projectId);
    return Array.from(this.sessions.values()).filter((s) => s.projectId === projectId);
  }

  public saveSession(session: ChatSession): void {
    this.validateProjectId(session.projectId);
    this.sessions.set(`${session.projectId}:${session.sessionId}`, session);
  }

  public getMessages(projectId: string, sessionId: string): ChatMessage[] {
    this.validateProjectId(projectId);
    return this.messages.get(`${projectId}:${sessionId}`) || [];
  }

  public saveMessages(projectId: string, sessionId: string, messages: ChatMessage[]): void {
    this.validateProjectId(projectId);
    this.messages.set(`${projectId}:${sessionId}`, messages);
  }

  public appendMessage(projectId: string, sessionId: string, message: ChatMessage): void {
    this.validateProjectId(projectId);
    const msgs = this.getMessages(projectId, sessionId);
    msgs.push(message);
    this.saveMessages(projectId, sessionId, msgs);
  }

  public getScratchpad(projectId: string, sessionId: string): ScratchpadMemory {
    this.validateProjectId(projectId);
    const s = this.getSession(projectId, sessionId);
    return s?.scratchpad || { userConstraints: [], lastUpdatedAt: new Date().toISOString() };
  }

  public updateScratchpad(
    projectId: string,
    sessionId: string,
    patch: Partial<ScratchpadMemory>
  ): ScratchpadMemory {
    this.validateProjectId(projectId);
    const s = this.getSession(projectId, sessionId);
    if (!s) throw new Error('Session not found');
    s.scratchpad = { ...s.scratchpad, ...patch, lastUpdatedAt: new Date().toISOString() };
    return s.scratchpad;
  }
}
