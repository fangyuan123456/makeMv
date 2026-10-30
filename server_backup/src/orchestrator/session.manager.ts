import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { WorkflowSession, WorkflowStage, SessionStatus, SessionMeta, SessionChatMessage } from '../types/workflow.js';

export class SessionManager {
  private projectsDir: string;
  private legacySessionsDir: string;

  constructor() {
    this.projectsDir = config.paths.projects;
    this.legacySessionsDir = path.join(config.paths.data, 'sessions');
    this.migrateLegacySessions();
  }

  /**
   * One-time migration: migrate legacy server/data/sessions/*.json
   * 归档迁移至 server/data/projects/{id}/session.json 并清理陈旧目录。
   */
  private migrateLegacySessions(): void {
    if (!fs.existsSync(this.legacySessionsDir)) return;
    try {
      const files = fs.readdirSync(this.legacySessionsDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        const sessionId = file.replace(/\.json$/, '');
        const projectDir = path.join(this.projectsDir, sessionId);
        const targetSessionFile = path.join(projectDir, 'session.json');
        const legacyFile = path.join(this.legacySessionsDir, file);

        if (!fs.existsSync(projectDir)) {
          fs.mkdirSync(projectDir, { recursive: true });
        }
        if (!fs.existsSync(targetSessionFile)) {
          fs.copyFileSync(legacyFile, targetSessionFile);
          console.log(`[SessionManager] Migrated legacy session ${file} -> ${targetSessionFile}`);
        }
        try {
          fs.unlinkSync(legacyFile);
        } catch {
          // 忽略异常
        }
      }

      const remaining = fs.readdirSync(this.legacySessionsDir);
      for (const item of remaining) {
        if (item === '.gitkeep') {
          fs.unlinkSync(path.join(this.legacySessionsDir, item));
        }
      }
      const finalRemaining = fs.readdirSync(this.legacySessionsDir);
      if (finalRemaining.length === 0) {
        fs.rmdirSync(this.legacySessionsDir);
        console.log(`[SessionManager] Removed obsolete legacy sessions directory: ${this.legacySessionsDir}`);
      }
    } catch (err) {
      console.warn('[SessionManager] Note during legacy session migration:', err);
    }
  }

  getSessionFile(id: string): string {
    return path.join(this.projectsDir, id, 'session.json');
  }

  createSession(id: string, title: string, meta: SessionMeta): WorkflowSession {
    const now = new Date().toISOString();

    const initialMessages: SessionChatMessage[] = [];

    // If starting with an idea, only display the user's input bubble, zero filler messages
    if (meta.idea) {
      initialMessages.push({
        id: `msg_user_${Date.now()}`,
        sender: 'user',
        senderName: '我',
        content: meta.idea,
        timestamp: now,
      });
    } else {
      initialMessages.push({
        id: `msg_welcome_${Date.now()}`,
        sender: 'agent',
        senderName: 'AI 影游总制作人',
        content: '您好！我是您的 AI 互动短剧总制作人。请在下方输入您的故事设定或剧本创意，我将为您逐步推演并打包成可交互的影游作品！',
        timestamp: now,
      });
    }

    const session: WorkflowSession = {
      id,
      title,
      meta,
      currentStage: WorkflowStage.INIT,
      status: SessionStatus.IDLE,
      stageArtifacts: {},
      messages: initialMessages,
      history: [
        {
          timestamp: now,
          stage: WorkflowStage.INIT,
          action: 'PROJECT_CREATED',
          details: `Idea: ${meta.idea.slice(0, 50)}...`,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    this.ensureProjectDir(id);
    this.saveSession(session);
    return session;
  }

  appendMessage(sessionId: string, message: SessionChatMessage): void {
    const session = this.getSession(sessionId);
    if (!session) return;
    if (!session.messages) session.messages = [];
    session.messages.push(message);
    this.saveSession(session);
  }

  getSession(id: string): WorkflowSession | null {
    const file = this.getSessionFile(id);
    if (!fs.existsSync(file)) {
      // 兼容检查老版本遗留文件（若仍存在）
      const legacyFile = path.join(this.legacySessionsDir, `${id}.json`);
      if (fs.existsSync(legacyFile)) {
        try {
          const content = fs.readFileSync(legacyFile, 'utf-8');
          const session = JSON.parse(content) as WorkflowSession;
          this.ensureProjectDir(id);
          this.saveSession(session);
          try {
            fs.unlinkSync(legacyFile);
          } catch {}
          return session;
        } catch {
          return null;
        }
      }
      return null;
    }

    try {
      const content = fs.readFileSync(file, 'utf-8');
      return JSON.parse(content) as WorkflowSession;
    } catch (err) {
      console.error(`Failed to read session ${id}:`, err);
      return null;
    }
  }

  saveSession(session: WorkflowSession): void {
    session.updatedAt = new Date().toISOString();
    this.ensureProjectDir(session.id);
    const file = this.getSessionFile(session.id);
    fs.writeFileSync(file, JSON.stringify(session, null, 2), 'utf-8');
  }

  listSessions(): Array<{ id: string; title: string; currentStage: string; updatedAt: string }> {
    if (!fs.existsSync(this.projectsDir)) return [];
    const entries = fs.readdirSync(this.projectsDir, { withFileTypes: true });
    const list: Array<{ id: string; title: string; currentStage: string; updatedAt: string }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionFile = path.join(this.projectsDir, entry.name, 'session.json');
      if (fs.existsSync(sessionFile)) {
        try {
          const content = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
          list.push({
            id: content.id || entry.name,
            title: content.title || '未命名互动短剧',
            currentStage: content.currentStage || 'INIT',
            updatedAt: content.updatedAt || new Date().toISOString(),
          });
        } catch {
          // 忽略损坏或无效的会话 JSON 文件
        }
      }
    }

    // 按更新时间降序排序
    return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  deleteSession(id: string): boolean {
    const projectDir = path.join(this.projectsDir, id);
    let deleted = false;
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
      deleted = true;
    }
    const legacyFile = path.join(this.legacySessionsDir, `${id}.json`);
    if (fs.existsSync(legacyFile)) {
      try {
        fs.unlinkSync(legacyFile);
        deleted = true;
      } catch {}
    }
    return deleted;
  }

  ensureProjectDir(sessionId: string): string {
    const dir = path.join(this.projectsDir, sessionId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  getProjectDir(sessionId: string): string {
    return path.join(this.projectsDir, sessionId);
  }
}

export const sessionManager = new SessionManager();
