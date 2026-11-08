/**
 * project-store/MemoryProjectStateStore.ts
 * 纯内存型状态黑板实现 (针对单元测试与无磁盘依赖场景)
 */

import { randomUUID } from 'crypto';
import { applyArtifactProvenance } from '../agents/director/provenance.js';
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
    // 与 File 实现保持同一口径：身份与指纹在写入层统一补齐
    const prev = project.stageArtifacts[stage];
    applyArtifactProvenance(project.stageArtifacts, prev, stage, artifact);
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

    // C4: 限制最大 200 条并同步对齐已提炼计数
    const MAX_MESSAGES = 200;
    let trimmed = msgs;
    let removedCount = 0;
    if (msgs.length > MAX_MESSAGES) {
      removedCount = msgs.length - MAX_MESSAGES;
      trimmed = msgs.slice(-MAX_MESSAGES);
    }
    this.saveMessages(projectId, sessionId, trimmed);

    const s = this.getSession(projectId, sessionId);
    if (s) {
      if (removedCount > 0 && typeof s.scratchpad?.lastSummarizedCount === 'number') {
        s.scratchpad.lastSummarizedCount = Math.max(0, s.scratchpad.lastSummarizedCount - removedCount);
      }
      this.saveSession(s);
    }
  }

  public appendToLastTaskMessage(
    projectId: string,
    sessionId: string,
    taskId: string,
    addition: string
  ): { appended: boolean } {
    this.validateProjectId(projectId);
    const msgs = this.getMessages(projectId, sessionId);
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].taskId === taskId && msgs[i].role === 'assistant') {
        msgs[i] = {
          ...msgs[i],
          content: `${msgs[i].content}${msgs[i].content.trim() ? '\n\n' : ''}${addition}`,
        };
        this.saveMessages(projectId, sessionId, msgs);
        return { appended: true };
      }
    }
    this.appendMessage(projectId, sessionId, {
      id: `msg_s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant',
      content: addition,
      taskId,
      createdAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
    });
    return { appended: false };
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

  public repairArtifact(
    projectId: string,
    stage: string,
    repair: { type: 'RENAME_CHARACTER' | 'UPDATE_FIELD'; payload: any }
  ): { success: boolean; modifiedFields: string[]; summary: string } {
    this.validateProjectId(projectId);
    const project = this.getProject(projectId);
    if (!project) throw new Error(`未找到项目: ${projectId}`);

    if (repair.type === 'RENAME_CHARACTER') {
      const { oldName, newName } = repair.payload || {};
      if (!oldName || !newName || oldName === newName) {
        throw new Error('RENAME_CHARACTER 必须提供有效且不相同的 oldName 与 newName');
      }

      const bible = project.stageArtifacts?.['narrative_design'];
      if (!bible) {
        throw new Error('未找到故事圣经资产，无法执行角色重命名修补');
      }

      // 1. 替换角色列表中的姓名（记下稳定 id，供定妆条目按身份认人）
      const renamedIds: string[] = [];
      if (Array.isArray(bible.characters)) {
        for (const c of bible.characters) {
          if (c.name === oldName) {
            c.name = newName;
            if (typeof c.characterId === 'string') renamedIds.push(c.characterId);
          }
        }
      }
      if (Array.isArray(bible.characterNames)) {
        bible.characterNames = bible.characterNames.map((n: string) => (n === oldName ? newName : n));
      }

      // 2. 级联替换大纲与剧情节点
      const replaceRegex = new RegExp(oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      if (typeof bible.logline === 'string') {
        bible.logline = bible.logline.replace(replaceRegex, newName);
      }
      if (Array.isArray(bible.goldenSpine)) {
        for (const act of bible.goldenSpine) {
          if (act.summary) act.summary = act.summary.replace(replaceRegex, newName);
          if (act.cliffhanger) act.cliffhanger = act.cliffhanger.replace(replaceRegex, newName);
        }
      }
      if (bible.storyGraph && Array.isArray(bible.storyGraph.nodes)) {
        for (const node of bible.storyGraph.nodes) {
          if (node.title) node.title = node.title.replace(replaceRegex, newName);
          if (node.summary) node.summary = node.summary.replace(replaceRegex, newName);
          if (Array.isArray(node.characterNames)) {
            node.characterNames = node.characterNames.map((n: string) => (n === oldName ? newName : n));
          }
          if (Array.isArray(node.choices)) {
            for (const ch of node.choices) {
              if (ch.text) ch.text = ch.text.replace(replaceRegex, newName);
              if (ch.dramaticTension) ch.dramaticTension = ch.dramaticTension.replace(replaceRegex, newName);
            }
          }
        }
      }

      // 3. 定妆条目的关联键：优先按稳定 id 认人（条目名可能与圣经已不一致），
      //    老数据无 id 才退回按名字匹配。
      const charArtifact = project.stageArtifacts?.['character_design'];
      const modifiedFields: string[] = ['characters', 'characterNames', 'goldenSpine', 'storyGraph'];
      if (charArtifact && Array.isArray(charArtifact.characters)) {
        let renamed = false;
        for (const c of charArtifact.characters) {
          const sameIdentity = c.characterId && renamedIds.includes(c.characterId);
          if (sameIdentity || c.name === oldName) {
            c.name = newName;
            renamed = true;
          }
        }
        if (renamed) modifiedFields.push('character_design.characters');
      }

      this.saveProject(project);
      return {
        success: true,
        modifiedFields,
        summary: `已将角色【${oldName}】就地修补更名为【${newName}】`,
      };
    }

    return { success: false, modifiedFields: [], summary: '不支持的修补操作' };
  }
}
