/**
 * agents/registry.ts
 * 导演 Agent 的统一创建入口。
 */

export * from './runtime/types.js';
export * from './runtime/runner.js';
export * from './planner/agent.js';
export * from './lookdev/agent.js';
export * from './storyboard/agent.js';
export * from './generic/agent.js';

import { AgentRunner } from './runtime/runner.js';
import { PlannerAgent } from './planner/agent.js';
import { LookdevAgent } from './lookdev/agent.js';
import { StoryboardAgent } from './storyboard/agent.js';
import { GenericAgent } from './generic/agent.js';

export class AgentFactory {
  /**
   * 按工序类型或会话标识智能创建对应的会话实例
   */
  public static create(
    typeOrSessionId: string,
    options: { projectId: string; sessionId?: string; clipId?: string }
  ): AgentRunner {
    const sid = options.sessionId || typeOrSessionId;

    // 📖 工序 1: 故事总监机器人 (Planner Copilot)
    if (typeOrSessionId === 'planner' || sid === 'planner') {
      return new PlannerAgent({
        projectId: options.projectId,
        sessionId: sid,
      });
    }

    // 🎨 工序 2-A: 视觉定妆空间机器人 (Lookdev Copilot)
    if (typeOrSessionId === 'lookdev' || sid === 'lookdev') {
      return new LookdevAgent({
        projectId: options.projectId,
        sessionId: sid,
      });
    }

    // 🎬 工序 2-B: 分幕专属分镜总导演机器人 (Per-Clip Storyboard Copilot)
    if (typeOrSessionId === 'storyboard' || sid.startsWith('storyboard')) {
      return new StoryboardAgent({
        projectId: options.projectId,
        sessionId: sid,
        clipId: options.clipId,
      });
    }

    // 默认回退到通用普通会话
    return new GenericAgent({
      projectId: options.projectId,
      sessionId: sid,
    });
  }
}
