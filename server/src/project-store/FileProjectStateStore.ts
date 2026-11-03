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
import { atomicWriteJsonSync, trace } from '../utils/index.js';
import type { ProjectEntity, ChatSession, ChatMessage, ScratchpadMemory } from '../types/index.js';
import type { IProjectStateStore } from './IProjectStateStore.js';
import type { ProjectStateSnapshot } from './types.js';

/**
 * 轻量级 LRU 有界内存缓存：防止海量历史会话与消息长期霸占内存引发 OOM
 */
class BoundedCache<K, V> {
  private cache = new Map<K, V>();
  constructor(private readonly maxSize: number = 50) {}

  public get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  public set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, value);
  }

  public has(key: K): boolean {
    return this.cache.has(key);
  }

  public delete(key: K): boolean {
    return this.cache.delete(key);
  }

  public deletePrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (typeof key === 'string' && key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  public clear(): void {
    this.cache.clear();
  }
}

export class FileProjectStateStore implements IProjectStateStore {
  private projects = new Map<string, ProjectEntity>();
  private sessionCache = new BoundedCache<string, ChatSession>(100);
  private messageCache = new BoundedCache<string, ChatMessage[]>(100);

  constructor() {
    this.hydrateFromDisk();
  }

  private validateProjectId(projectId: string): void {
    if (!projectId || typeof projectId !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(projectId)) {
      throw new Error(`[FileProjectStateStore] 非法的 projectId: "${projectId}"，必须仅包含字母、数字、下划线或连字符`);
    }
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(projectId.trim())) {
      throw new Error(`[FileProjectStateStore] 非法的 projectId: "${projectId}"，属于操作系统保留设备名称`);
    }
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
          if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(entry.name)) {
            continue;
          }
          const projectJsonPath = path.join(projectsRoot, entry.name, 'project.json');
          if (fs.existsSync(projectJsonPath)) {
            try {
              const data = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
              // 刚性校验：彻底消灭 entry.name 隐式兜底猜测，数据契约不符时跳过加载
              if (!data.projectId || typeof data.projectId !== 'string' || !data.projectId.trim()) {
                console.warn(`[FileProjectStateStore] 项目文件 [${projectJsonPath}] 缺失合法 projectId 契约，跳过无效项目加载`);
                continue;
              }
              this.projects.set(data.projectId, data);
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

  public getProject(projectId: string): ProjectEntity | undefined {
    this.validateProjectId(projectId);
    if (this.projects.has(projectId)) {
      return this.projects.get(projectId);
    }

    const dir = this.getProjectDir(projectId);
    const targetFile = path.join(dir, 'project.json');
    if (fs.existsSync(targetFile)) {
      try {
        const raw = fs.readFileSync(targetFile, 'utf-8');
        const project = JSON.parse(raw);
        if (!project.projectId || typeof project.projectId !== 'string' || !project.projectId.trim()) {
          console.warn(`[FileProjectStateStore] 读取到的项目文件 [${targetFile}] 缺少合法 projectId`);
          return undefined;
        }
        this.projects.set(projectId, project);
        return project;
      } catch (e) {
        console.error(`[FileProjectStateStore] 读取项目 ${projectId} 失败:`, e);
      }
    }
    return undefined;
  }

  public saveProject(project: ProjectEntity): void {
    if (!project || !project.projectId || typeof project.projectId !== 'string' || !project.projectId.trim()) {
      throw new Error('[FileProjectStateStore] saveProject 失败: project.projectId 必须为非空有效字符串');
    }
    const pid = project.projectId;
    const dir = this.getProjectDir(pid);
    const filePath = path.join(dir, 'project.json');
    try {
      atomicWriteJsonSync(filePath, project);
    } catch (err) {
      console.error(`[FileProjectStateStore] 持久化项目 ${pid} 失败:`, err);
      throw err;
    }
    // 刚性保证：落盘完全成功后才更新内存黑板映射，杜绝内存与物理磁盘产生漂移
    this.projects.set(pid, project);
  }

  public deleteProject(projectId: string): void {
    this.validateProjectId(projectId);
    this.projects.delete(projectId);
    this.sessionCache.deletePrefix(`${projectId}:`);
    this.messageCache.deletePrefix(`${projectId}:`);

    const dir = this.getProjectDir(projectId);
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (e) {
        console.warn(`[FileProjectStateStore] 删除项目目录失败: ${dir}`, e);
      }
    }
  }

  public listProjects(): ProjectEntity[] {
    return Array.from(this.projects.values());
  }

  public getArtifact<T = any>(projectId: string, stage: string): T | undefined {
    this.validateProjectId(projectId);
    const project = this.getProject(projectId);
    return project?.stageArtifacts?.[stage] as T;
  }

  public setArtifact<T = any>(
    projectId: string,
    stage: string,
    artifact: T,
    meta?: { taskId?: string; skill?: string; model?: string; degraded?: boolean; paramsHash?: string }
  ): void {
    this.validateProjectId(projectId);
    if (!stage || typeof stage !== 'string' || !stage.trim()) {
      throw new Error(`[FileProjectStateStore] setArtifact 失败: stage 必须为非空字符串`);
    }

    // 防御文件名穿越与非法字符 (P2 路径穿越安全防护)
    const sanitizedStage = path.basename(stage.trim());
    if (sanitizedStage !== stage.trim() || !/^[a-zA-Z0-9_\-]+$/.test(sanitizedStage)) {
      throw new Error(`[FileProjectStateStore] setArtifact 失败: stage 包含非法字符或路径遍历风险 [${stage}]`);
    }

    const project = this.getProject(projectId);
    if (!project) {
      throw new Error(`[FileProjectStateStore] setArtifact 失败: 未找到项目 [${projectId}]`);
    }

    if (!project.stageArtifacts) project.stageArtifacts = {};
    const now = new Date().toISOString();
    const prevUpdatedAt = project.updatedAt;

    // 1. 历史版本快照归档 (按 stage.timestamp.json 存盘，不撑大主 project.json)
    const prev = project.stageArtifacts[stage];
    if (prev && typeof prev === 'object') {
      try {
        const artifactsDir = path.join(this.getProjectDir(projectId), 'artifacts');
        if (!fs.existsSync(artifactsDir)) {
          fs.mkdirSync(artifactsDir, { recursive: true });
        }
        const snapshotFile = path.join(artifactsDir, `${sanitizedStage}.${Date.now()}.json`);
        const relative = path.relative(artifactsDir, snapshotFile);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          throw new Error(`[FileProjectStateStore] 快照路径逃逸沙箱检测拦截`);
        }
        atomicWriteJsonSync(snapshotFile, prev);
      } catch (snapshotErr) {
        console.warn('[FileProjectStateStore] 产物历史快照存档警告:', snapshotErr);
      }
    }

    // 2. 注入 __meta 来源追溯信息
    if (artifact && typeof artifact === 'object') {
      if (!(artifact as any).createdAt) {
        (artifact as any).createdAt = now;
      }
      (artifact as any).updatedAt = now;
      (artifact as any).__meta = {
        ...(meta || {}),
        degraded: (artifact as any).isDegraded ?? meta?.degraded ?? false,
        updatedAt: now,
      };
    }

    project.stageArtifacts[stage] = artifact;
    project.updatedAt = now;

    try {
      this.saveProject(project);
    } catch (saveErr) {
      // 物理落盘失败时回滚内存修改，确保内存黑板与物理磁盘保持强一致性
      if (prev === undefined) {
        delete project.stageArtifacts[stage];
      } else {
        project.stageArtifacts[stage] = prev;
      }
      project.updatedAt = prevUpdatedAt;
      throw saveErr;
    }

    // 3. 产物更新可查打点
    trace(projectId, 'artifact.set', {
      stage,
      hasPrev: Boolean(prev),
      meta: (artifact as any)?.__meta,
    });
  }

  public getProjectDir(projectId: string): string {
    this.validateProjectId(projectId);
    const baseProjectsDir = path.resolve(config.paths.projects);
    const resolvedDir = path.resolve(baseProjectsDir, projectId);
    if (!resolvedDir.startsWith(baseProjectsDir + path.sep)) {
      throw new Error(`[FileProjectStateStore] 非法项目路径穿越访问: ${projectId}`);
    }
    if (!fs.existsSync(resolvedDir)) {
      fs.mkdirSync(resolvedDir, { recursive: true });
    }
    return resolvedDir;
  }

  // =================== 会话与白板统合存取 (SSOT) ===================

  private getChatDir(projectId: string, sessionId: string): string {
    this.validateProjectId(projectId);
    if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
      throw new Error(`[FileProjectStateStore] 非法的 sessionId: "${sessionId}"，必须为非空有效字符串`);
    }
    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const projectDir = this.getProjectDir(projectId);
    const chatBaseDir = path.resolve(projectDir, 'chat');
    const resolvedDir = path.resolve(chatBaseDir, safeSessionId);
    if (!resolvedDir.startsWith(chatBaseDir + path.sep)) {
      throw new Error(`[FileProjectStateStore] 非法会话路径穿越访问: ${sessionId}`);
    }
    if (!fs.existsSync(resolvedDir)) {
      fs.mkdirSync(resolvedDir, { recursive: true });
    }
    return resolvedDir;
  }

  public createSession(
    projectId: string,
    title: string = '新创作会话',
    initialStage?: string,
    customSessionId?: string
  ): ChatSession {
    this.validateProjectId(projectId);
    if (customSessionId !== undefined && (!customSessionId || typeof customSessionId !== 'string' || !customSessionId.trim())) {
      throw new Error(`[FileProjectStateStore] 非法的 customSessionId: "${customSessionId}"`);
    }

    const sessionId = customSessionId || `chat_${Date.now()}_${randomUUID().slice(0, 6)}`;
    const now = new Date().toISOString();
    const project = this.getProject(projectId);

    // 权威工序资产预热：新会话无缝继承既有故事圣经中的角色与主干，消除资产失忆
    const bible = project?.stageArtifacts?.['narrative_design'];
    let themeAndStyle = project?.meta?.style || '';
    let logline = project?.meta?.idea || project?.title || '';
    let charactersSummary = '';
    let storySpine = '';

    if (bible) {
      if (bible.title || bible.theme || bible.style) {
        themeAndStyle = `《${bible.title || '未命名'}》 | ${bible.theme || ''} | ${bible.style || ''}`;
      }
      if (bible.logline) {
        logline = bible.logline;
      }
      if (Array.isArray(bible.characters) && bible.characters.length > 0) {
        // 彻底清除 c.appearancePrompt 别名回退，统一遵循标准契约 c.appearance
        charactersSummary = bible.characters
          .map((c: any) => `* 【${c.name}】(${c.role || '角色'}): 动机: ${c.motivation || '未详'} | 骨相特征: ${c.appearance || '未详'}`)
          .join('\n');
      }
      if (Array.isArray(bible.goldenSpine) && bible.goldenSpine.length > 0) {
        storySpine = bible.goldenSpine
          .map((act: any, idx: number) => `第${idx + 1}幕 [${act.name}]: ${act.summary || ''}`)
          .join('\n');
      }
    }

    // 角色视觉定妆锚点预热：继承已确立的发型、服饰与视觉锚点
    const charArtifact = project?.stageArtifacts?.['character_design'];
    let characterVisualAnchors = '';
    if (charArtifact && Array.isArray(charArtifact.characters) && charArtifact.characters.length > 0) {
      characterVisualAnchors = charArtifact.characters
        .map((c: any) => `* 【${c.name}】(${c.imageUrl ? '✓ 定妆已锁定' : '待生成'})${c.appearance ? ` | 外貌: ${c.appearance}` : ''}${c.visualPrompt ? ` | 标志性外观: ${c.visualPrompt}` : ''}`)
        .join('\n');
    }

    // 禁忌红线无缝继承 (Project SSOT)：新会话优先继承项目元数据或前序会话中已确立的创作者禁忌要求，拒绝归零
    const existingSessions = this.listSessions(projectId);
    const existingConstraints = existingSessions.find((s) => Array.isArray(s.scratchpad?.userConstraints) && s.scratchpad.userConstraints.length > 0)
      ?.scratchpad.userConstraints || [];
    const projectConstraints = project?.meta?.userConstraints || [];
    const inheritedConstraints = Array.from(new Set([...projectConstraints, ...existingConstraints]));

    const scratchpad: ScratchpadMemory = {
      themeAndStyle,
      logline,
      charactersSummary,
      characterVisualAnchors: characterVisualAnchors || undefined,
      storySpine,
      userConstraints: inheritedConstraints,
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
    this.validateProjectId(projectId);
    if (!sessionId || typeof sessionId !== 'string') return undefined;

    const cacheKey = `${projectId}:${sessionId}`;
    const project = this.getProject(projectId);

    if (this.sessionCache.has(cacheKey)) {
      const cached = this.sessionCache.get(cacheKey)!;
      // 单一事实来源 (SSOT)：会话工序阶段始终动态跟随项目的权威阶段，彻底消灭脱节！
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
    this.validateProjectId(projectId);
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
          if (s) {
            sessions.push(s);
          }
        }
      }
    } catch (err) {
      console.warn(`[FileProjectStateStore] 遍历会话失败:`, err);
    }

    return sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  public saveSession(session: ChatSession): void {
    if (!session || !session.projectId || !session.sessionId) {
      throw new Error('[FileProjectStateStore] saveSession 失败: session 缺少合法 projectId 或 sessionId');
    }
    this.validateProjectId(session.projectId);

    const project = this.getProject(session.projectId);
    if (project?.currentStage) {
      session.currentStage = project.currentStage; // 保持 SSOT
    }
    session.updatedAt = new Date().toISOString();

    const dir = this.getChatDir(session.projectId, session.sessionId);
    const sessionFile = path.join(dir, 'session.json');
    try {
      atomicWriteJsonSync(sessionFile, session);
    } catch (err) {
      console.error(`[FileProjectStateStore] 保存会话失败: ${sessionFile}`, err);
      throw err;
    }

    const cacheKey = `${session.projectId}:${session.sessionId}`;
    this.sessionCache.set(cacheKey, session);
  }

  public getMessages(projectId: string, sessionId: string): ChatMessage[] {
    this.validateProjectId(projectId);
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
    this.validateProjectId(projectId);
    const dir = this.getChatDir(projectId, sessionId);
    const messagesFile = path.join(dir, 'messages.json');
    try {
      atomicWriteJsonSync(messagesFile, messages);
    } catch (err) {
      console.error(`[FileProjectStateStore] 保存消息流失败: ${messagesFile}`, err);
      throw err;
    }

    const cacheKey = `${projectId}:${sessionId}`;
    this.messageCache.set(cacheKey, messages);
  }

  public appendMessage(projectId: string, sessionId: string, message: ChatMessage): void {
    this.validateProjectId(projectId);
    const messages = this.getMessages(projectId, sessionId);
    messages.push(message);
    this.saveMessages(projectId, sessionId, messages);

    const session = this.getSession(projectId, sessionId);
    if (session) {
      this.saveSession(session);
    }
  }

  public getScratchpad(projectId: string, sessionId: string): ScratchpadMemory {
    this.validateProjectId(projectId);
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
    this.validateProjectId(projectId);
    const session = this.getSession(projectId, sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.scratchpad = {
      ...session.scratchpad,
      ...patch,
      lastUpdatedAt: new Date().toISOString(),
    };

    // 全局禁忌项目级沉淀 (Project SSOT)
    if (patch.userConstraints && Array.isArray(patch.userConstraints)) {
      const project = this.getProject(projectId);
      if (project) {
        if (!project.meta) (project as any).meta = {};
        (project.meta as any).userConstraints = patch.userConstraints;
        this.saveProject(project);
      }
    }

    this.saveSession(session);
    return session.scratchpad;
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
    this.sessionCache.deletePrefix(`${projectId}:`);
    this.messageCache.deletePrefix(`${projectId}:`);
  }
}
