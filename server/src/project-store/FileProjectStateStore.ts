/**
 * project-store/FileProjectStateStore.ts
 * 基于物理磁盘与 project.json 的生产级状态黑板存储实现 (SSOT)
 *
 * 遵循法典：零别名冗余，单一事实来源，全链路唯一标准字段为 projectId
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { config } from '../utils/config.js';
import type { WorkflowSession } from '../types/index.js';
import type { IProjectStateStore } from './IProjectStateStore.js';
import type { ProjectStateSnapshot } from './types.js';
import type { ChatSession, ChatMessage, ScratchpadMemory } from '../chat/session/types.js';

export class FileProjectStateStore implements IProjectStateStore {
  private projects = new Map<string, WorkflowSession>();
  private sessionCache = new Map<string, ChatSession>();
  private messageCache = new Map<string, ChatMessage[]>();

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

  // =================== 🌟 会话与白板统合存取 (SSOT) ===================

  private getChatDir(projectId: string, sessionId: string): string {
    const dir = path.join(this.getProjectDir(projectId), 'chat', sessionId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  public createSession(
    projectId: string,
    title: string = '新创作会话',
    initialStage?: string
  ): ChatSession {
    const sessionId = `chat_${Date.now()}_${randomUUID().slice(0, 6)}`;
    const now = new Date().toISOString();
    const project = this.getProject(projectId);

    const scratchpad: ScratchpadMemory = {
      themeAndStyle: project?.meta?.style || '',
      logline: project?.meta?.idea || project?.title || '',
      charactersSummary: '',
      storySpine: '',
      userConstraints: [],
      lastUpdatedAt: now,
    };

    const session: ChatSession = {
      sessionId,
      projectId,
      title,
      currentStage: project?.currentStage || initialStage || 'narrative_design',
      scratchpad,
      createdAt: now,
      updatedAt: now,
    };

    this.saveSession(session);
    this.saveMessages(projectId, sessionId, []);

    return session;
  }

  public getSession(projectId: string, sessionId: string): ChatSession | undefined {
    const cacheKey = `${projectId}:${sessionId}`;
    const project = this.getProject(projectId);

    if (this.sessionCache.has(cacheKey)) {
      const cached = this.sessionCache.get(cacheKey)!;
      // 🌟 单一事实来源 (SSOT)：会话工序阶段始终动态跟随项目的权威阶段，彻底消灭脱节！
      if (project?.currentStage) {
        cached.currentStage = project.currentStage;
      }
      return cached;
    }

    const dir = this.getChatDir(projectId, sessionId);
    const sessionFile = path.join(dir, 'session.json');
    if (fs.existsSync(sessionFile)) {
      try {
        const raw = fs.readFileSync(sessionFile, 'utf-8');
        const session = JSON.parse(raw) as ChatSession;
        if (project?.currentStage) {
          session.currentStage = project.currentStage;
        }
        this.sessionCache.set(cacheKey, session);
        return session;
      } catch (err) {
        console.warn(`[FileProjectStateStore] 读取会话快照失败: ${sessionFile}`, err);
      }
    }
    return undefined;
  }

  public listSessions(projectId: string): ChatSession[] {
    const chatBaseDir = path.join(this.getProjectDir(projectId), 'chat');
    if (!fs.existsSync(chatBaseDir)) {
      return [];
    }

    const sessions: ChatSession[] = [];
    try {
      const entries = fs.readdirSync(chatBaseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const s = this.getSession(projectId, entry.name);
          if (s) sessions.push(s);
        }
      }
    } catch (err) {
      console.warn(`[FileProjectStateStore] 遍历会话失败:`, err);
    }

    return sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  public saveSession(session: ChatSession): void {
    const cacheKey = `${session.projectId}:${session.sessionId}`;
    const project = this.getProject(session.projectId);
    if (project?.currentStage) {
      session.currentStage = project.currentStage; // 保持 SSOT
    }
    session.updatedAt = new Date().toISOString();
    this.sessionCache.set(cacheKey, session);

    const dir = this.getChatDir(session.projectId, session.sessionId);
    const sessionFile = path.join(dir, 'session.json');
    try {
      fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[FileProjectStateStore] 保存会话失败: ${sessionFile}`, err);
    }
  }

  public getMessages(projectId: string, sessionId: string): ChatMessage[] {
    const cacheKey = `${projectId}:${sessionId}`;
    if (this.messageCache.has(cacheKey)) {
      return this.messageCache.get(cacheKey)!;
    }

    const dir = this.getChatDir(projectId, sessionId);
    const messagesFile = path.join(dir, 'messages.json');
    if (fs.existsSync(messagesFile)) {
      try {
        const raw = fs.readFileSync(messagesFile, 'utf-8');
        const messages = JSON.parse(raw) as ChatMessage[];
        this.messageCache.set(cacheKey, messages);
        return messages;
      } catch (err) {
        console.warn(`[FileProjectStateStore] 读取消息流失败: ${messagesFile}`, err);
      }
    }
    return [];
  }

  public saveMessages(projectId: string, sessionId: string, messages: ChatMessage[]): void {
    const cacheKey = `${projectId}:${sessionId}`;
    this.messageCache.set(cacheKey, messages);

    const dir = this.getChatDir(projectId, sessionId);
    const messagesFile = path.join(dir, 'messages.json');
    try {
      fs.writeFileSync(messagesFile, JSON.stringify(messages, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[FileProjectStateStore] 保存消息流失败: ${messagesFile}`, err);
    }
  }

  public appendMessage(projectId: string, sessionId: string, message: ChatMessage): void {
    const messages = this.getMessages(projectId, sessionId);
    messages.push(message);
    this.saveMessages(projectId, sessionId, messages);

    const session = this.getSession(projectId, sessionId);
    if (session) {
      this.saveSession(session);
    }
  }

  public getScratchpad(projectId: string, sessionId: string): ScratchpadMemory {
    const session = this.getSession(projectId, sessionId);
    if (session) {
      return session.scratchpad;
    }
    return {
      userConstraints: [],
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  public updateScratchpad(
    projectId: string,
    sessionId: string,
    patch: Partial<ScratchpadMemory>
  ): ScratchpadMemory {
    const session = this.getSession(projectId, sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.scratchpad = {
      ...session.scratchpad,
      ...patch,
      lastUpdatedAt: new Date().toISOString(),
    };

    this.saveSession(session);
    return session.scratchpad;
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
