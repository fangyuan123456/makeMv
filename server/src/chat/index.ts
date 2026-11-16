/**
 * server/src/chat/index.ts
 * 对话会话微内核统一总装出口 (Chat Session Subsystem SSOT)
 */

export * from './types.js';
export * from './BaseChatSession.js';
export * from './sessions/PlannerChatSession.js';
export * from './sessions/LookdevChatSession.js';
export * from './sessions/StoryboardChatSession.js';
export * from './sessions/GenericChatSession.js';

import { BaseChatSession } from './BaseChatSession.js';
import { PlannerChatSession } from './sessions/PlannerChatSession.js';
import { LookdevChatSession } from './sessions/LookdevChatSession.js';
import { StoryboardChatSession } from './sessions/StoryboardChatSession.js';
import { GenericChatSession } from './sessions/GenericChatSession.js';

export class ChatSessionFactory {
  /**
   * 按工序类型或会话标识智能创建对应的会话实例
   */
  public static create(
    typeOrSessionId: string,
    options: { projectId: string; sessionId?: string; clipId?: string }
  ): BaseChatSession {
    const sid = options.sessionId || typeOrSessionId;

    // 📖 工序 1: 故事总监机器人 (Planner Copilot)
    if (typeOrSessionId === 'planner' || sid === 'planner') {
      return new PlannerChatSession({
        projectId: options.projectId,
        sessionId: sid,
      });
    }

    // 🎨 工序 2-A: 视觉定妆空间机器人 (Lookdev Copilot)
    if (typeOrSessionId === 'lookdev' || sid === 'lookdev') {
      return new LookdevChatSession({
        projectId: options.projectId,
        sessionId: sid,
      });
    }

    // 🎬 工序 2-B: 分幕专属分镜总导演机器人 (Per-Clip Storyboard Copilot)
    if (typeOrSessionId === 'storyboard' || sid.startsWith('storyboard')) {
      return new StoryboardChatSession({
        projectId: options.projectId,
        sessionId: sid,
        clipId: options.clipId,
      });
    }

    // 默认回退到通用普通会话
    return new GenericChatSession({
      projectId: options.projectId,
      sessionId: sid,
    });
  }
}
