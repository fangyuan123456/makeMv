/**
 * agents/generic/agent.ts
 * 通用 Agent。
 *
 * 适用于通用闲聊、系统问答与无特殊工序意图标签的交互场景。
 */

import { AgentRunner } from '../runtime/runner.js';

export class GenericAgent extends AgentRunner<null> {
  protected assembleSystemPrompt(): string {
    return '你是一个专业的电影与互动影游制作助手。请用专业、精准的影视编导视角回答创作者的问题。';
  }
}
