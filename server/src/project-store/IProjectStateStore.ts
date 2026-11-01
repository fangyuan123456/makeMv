/**
 * project-store/IProjectStateStore.ts
 * 统一状态黑板接口标准 (Blackboard Store Contract SSOT)
 *
 * 核心机制：
 * 全链路统一定位概念为 projectId，100% 单一事实来源 (SSOT)。
 * 产物存取解耦业务枚举，接受通用 stage: string。
 */

import type { WorkflowSession } from '../types/index.js';
import type { ProjectStateSnapshot } from './types.js';
import type { ChatSession, ChatMessage, ScratchpadMemory } from '../chat/session/types.js';

export interface IProjectStateStore {
  // 项目生命周期存取 (统一概念: projectId)
  getProject(projectId: string): WorkflowSession | undefined;
  saveProject(project: WorkflowSession): void;
  deleteProject(projectId: string): void;
  listProjects(): WorkflowSession[];

  // 阶段产物单点存取 (Artifacts)：通用 stage 标识
  getArtifact<T = any>(projectId: string, stage: string): T | undefined;
  setArtifact<T = any>(projectId: string, stage: string, artifact: T): void;

  // 🌟 会话与白板统合存取 (Sessions & Scratchpad SSOT)
  createSession(projectId: string, title?: string, initialStage?: string): ChatSession;
  getSession(projectId: string, sessionId: string): ChatSession | undefined;
  listSessions(projectId: string): ChatSession[];
  saveSession(session: ChatSession): void;
  getMessages(projectId: string, sessionId: string): ChatMessage[];
  saveMessages(projectId: string, sessionId: string, messages: ChatMessage[]): void;
  appendMessage(projectId: string, sessionId: string, message: ChatMessage): void;
  getScratchpad(projectId: string, sessionId: string): ScratchpadMemory;
  updateScratchpad(projectId: string, sessionId: string, patch: Partial<ScratchpadMemory>): ScratchpadMemory;

  // 项目目录存取
  getProjectDir(projectId: string): string;

  // 获取完整项目快照
  getSnapshot(projectId: string): ProjectStateSnapshot | undefined;

  // 销毁释放
  destroy(projectId: string): void;
}
