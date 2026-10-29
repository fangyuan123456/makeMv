import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { WorkflowSession, WorkflowStage, SessionStatus, SessionMeta } from '../types/workflow.js';

export class SessionManager {
  private sessionsDir: string;
  private projectsDir: string;

  constructor() {
    this.sessionsDir = config.paths.sessions;
    this.projectsDir = config.paths.projects;
  }

  createSession(id: string, title: string, meta: SessionMeta): WorkflowSession {
    const now = new Date().toISOString();
    const session: WorkflowSession = {
      id,
      title,
      meta,
      currentStage: WorkflowStage.INIT,
      status: SessionStatus.IDLE,
      stageArtifacts: {},
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

    this.saveSession(session);
    this.ensureProjectDir(id);
    return session;
  }

  getSession(id: string): WorkflowSession | null {
    const file = path.join(this.sessionsDir, `${id}.json`);
    if (!fs.existsSync(file)) return null;

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
    const file = path.join(this.sessionsDir, `${session.id}.json`);
    fs.writeFileSync(file, JSON.stringify(session, null, 2), 'utf-8');
  }

  listSessions(): Array<{ id: string; title: string; currentStage: string; updatedAt: string }> {
    if (!fs.existsSync(this.sessionsDir)) return [];
    const files = fs.readdirSync(this.sessionsDir).filter((f) => f.endsWith('.json'));

    return files.map((f) => {
      const content = JSON.parse(fs.readFileSync(path.join(this.sessionsDir, f), 'utf-8'));
      return {
        id: content.id,
        title: content.title,
        currentStage: content.currentStage,
        updatedAt: content.updatedAt,
      };
    });
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
