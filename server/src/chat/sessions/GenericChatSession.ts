/**
 * server/src/chat/sessions/GenericChatSession.ts
 * 通用无特化意图会话 (Generic Chat Session)
 *
 * 适用于通用闲聊、系统问答与无特殊工序意图标签的交互场景。
 */

import { BaseChatSession } from '../BaseChatSession.js';

export class GenericChatSession extends BaseChatSession<null> {
  protected assembleSystemPrompt(): string {
    return '你是一个专业的电影与互动影游制作助手。请用专业、精准的影视编导视角回答创作者的问题。';
  }
}
