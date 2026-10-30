/**
 * agents/archetype/expose.ts
 * 智能体对外暴露门面契约实现 (Agent Expose SSOT)
 */

import type { AgentExpose } from '../../agent-runtime/index.js';

export class ArchetypeExpose implements AgentExpose {
  public readonly name = 'archetype';

  /**
   * 向同伴智能体 (LLM) 提供本领域资产的消费与使用说明
   */
  public getGuide(): string {
    return `### 💡 Archetype 交付物消费指南：
1. 包含核心要素定义 (elements)，下游阶段可根据 id 获取对应名称与描述；
2. 包含全局主题与风格基调 (analysis.theme)，应与后续视觉分镜保持一致。`;
  }

  public getMetadata(): Record<string, unknown> {
    return {
      version: '1.0.0',
      description: '通用智能体底座参考原型',
    };
  }
}
