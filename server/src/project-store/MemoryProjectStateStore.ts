/**
 * project-store/MemoryProjectStateStore.ts
 * 纯内存型状态黑板实现 (针对单元测试与无磁盘依赖场景)
 */

import { randomUUID } from 'crypto';
import type { WorkflowSession } from '../types/index.js';
import type { IProjectStateStore } from './IProjectStateStore.js';
import type { ProjectStateSnapshot } from './types.js';
import type { ChatSession, ChatMessage, ScratchpadMemory } from '../chat/session/types.js';

export class MemoryProjectStateStore implements IProjectStateStore {
  private projects = new Map<string, WorkflowSession>();
  private sessions = new Map<string, ChatSession>();
  private messages = new Map<string, ChatMessage[]>();

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

  public createSession(
    projectId: string,
    title: string = '新创作会话',
    initialStage?: string
  ): ChatSession {
    const sessionId = `chat_${Date.now()}_${randomUUID().slice(0, 6)}`;
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
    return this.sessions.get(`${projectId}:${sessionId}`);
  }

  public listSessions(projectId: string): ChatSession[] {
    return Array.from(this.sessions.values()).filter((s) => s.projectId === projectId);
  }

  public saveSession(session: ChatSession): void {
    this.sessions.set(`${session.projectId}:${session.sessionId}`, session);
  }

  public getMessages(projectId: string, sessionId: string): ChatMessage[] {
    return this.messages.get(`${projectId}:${sessionId}`) || [];
  }

  public saveMessages(projectId: string, sessionId: string, messages: ChatMessage[]): void {
    this.messages.set(`${projectId}:${sessionId}`, messages);
  }

  public appendMessage(projectId: string, sessionId: string, message: ChatMessage): void {
    const msgs = this.getMessages(projectId, sessionId);
    msgs.push(message);
    this.saveMessages(projectId, sessionId, msgs);
  }

  public getScratchpad(projectId: string, sessionId: string): ScratchpadMemory {
    const s = this.getSession(projectId, sessionId);
    return s?.scratchpad || { userConstraints: [], lastUpdatedAt: new Date().toISOString() };
  }

  public updateScratchpad(
    projectId: string,
    sessionId: string,
    patch: Partial<ScratchpadMemory>
  ): ScratchpadMemory {
    const s = this.getSession(projectId, sessionId);
    if (!s) throw new Error('Session not found');
    s.scratchpad = { ...s.scratchpad, ...patch, lastUpdatedAt: new Date().toISOString() };
    return s.scratchpad;
  }
}
