/**
 * chat/memory/prompt.ts
 * 全局事实备忘录提取专用提示词体系 (Pure Chinese Prompt SSOT)
 */

import type { ScratchpadMemory } from '../session/types.js';

export const SCRATCHPAD_SUMMARIZER_SYSTEM_PROMPT = `你是一位顶级好莱坞电影制片厂的【制片总管与剧本会议纪要官】。
你的唯一天职是：在导演与编剧的热烈推敲与讨论中，剥离所有聊天客套、犹豫与废话，提取出**已经拍板确立的硬核事实、人设与刚性要求**，更新到《全局创作备忘录白板》上。

【提炼准则】：
1. 极简干货：只记录已经形成共识或明确指示的结论，严禁编造未讨论的内容；
2. 禁忌与偏好敏感：创作者明确指出的“不要什么”、“严禁什么”，必须列入 userConstraints；
3. 动态吸收：基于现存白板，吸收最新对话产生的新结论，若已有设定被创作者推翻则更新覆盖。`.trim();

export function buildScratchpadUpdatePrompt(
  currentScratchpad: ScratchpadMemory,
  recentMessages: Array<{ role: string; content: string }>
): string {
  const conversationText = recentMessages
    .map((m) => `${m.role === 'user' ? '【创作者】' : '【AI导演】'}: ${m.content}`)
    .join('\n\n');

  return `【当前既有备忘录白板】：
- 影调风格: ${currentScratchpad.themeAndStyle || '未确立'}
- 一句话大纲: ${currentScratchpad.logline || '未确立'}
- 核心角色摘要: ${currentScratchpad.charactersSummary || '未确立'}
- 核心冲突骨架: ${currentScratchpad.storySpine || '未确立'}
- 刚性禁忌/偏好: ${(currentScratchpad.userConstraints || []).join('； ') || '无'}

【最近发生的会议讨论】：
${conversationText}

请综合上述讨论，更新《全局创作备忘录白板》，输出纯正合规的 JSON 对象：
\`\`\`json
{
  "themeAndStyle": "提炼后的影调风格描述",
  "logline": "提炼后的一句话大纲 (若无讨论则沿用原大纲)",
  "charactersSummary": "提炼后的主要角色特征清单 (姓名、性格、职业、反差)",
  "storySpine": "提炼后的黄金核心冲突 (两难困境、主线目标)",
  "userConstraints": ["创作者明确要求的禁忌点1", "偏好点2"]
}
\`\`\``;
}
