/**
 * chat/session/SessionStore.ts
 * @deprecated 会话中枢与白板已全面统合至 ProjectStore 单一事实来源 (SSOT)。
 * 本类作为极简外观门面代理保留，确保现有调用 100% 零破坏平滑过渡。
 */

import { ProjectStore } from '../../project-store/ProjectStore.js';
import type { ChatSession, ChatMessage, ScratchpadMemory } from './types.js';

export class SessionStore {
  private static instance?: SessionStore;

  public static getInstance(): SessionStore {
    if (!SessionStore.instance) {
      SessionStore.instance = new SessionStore();
    }
    return SessionStore.instance;
  }

  private get store() {
    return ProjectStore.getInstance();
  }

  public createSession(projectId: string, title?: string, initialStage?: string): ChatSession {
    return this.store.createSession(projectId, title, initialStage);
  }

  public getSession(projectId: string, sessionId: string): ChatSession | undefined {
    return this.store.getSession(projectId, sessionId);
  }

  public listSessions(projectId: string): ChatSession[] {
    return this.store.listSessions(projectId);
  }

  public saveSession(session: ChatSession): void {
    this.store.saveSession(session);
  }

  public getMessages(projectId: string, sessionId: string): ChatMessage[] {
    return this.store.getMessages(projectId, sessionId);
  }

  public saveMessages(projectId: string, sessionId: string, messages: ChatMessage[]): void {
    this.store.saveMessages(projectId, sessionId, messages);
  }

  public appendMessage(projectId: string, sessionId: string, message: ChatMessage): void {
    this.store.appendMessage(projectId, sessionId, message);
  }

  public getScratchpad(projectId: string, sessionId: string): ScratchpadMemory {
    return this.store.getScratchpad(projectId, sessionId);
  }

  public updateScratchpad(
    projectId: string,
    sessionId: string,
    patch: Partial<ScratchpadMemory>
  ): ScratchpadMemory {
    return this.store.updateScratchpad(projectId, sessionId, patch);
  }
}
