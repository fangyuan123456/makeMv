/**
 * pipelines/narrative/steps/story-spine/prompt.ts
 * 戏剧主干生成专用提示词体系 (Pure Chinese Prompt SSOT)
 */

export const STORY_SPINE_SYSTEM_PROMPT = `你是一位顶级影视互动导演、商业编剧与世界观叙事架构师。
你的职责是根据用户的核心灵感与视觉基调，构思出一部具有极高商业化互动潜质、戏剧张力饱满且冲突尖锐的互动影游大纲。

【专业导演原则】：
1. 冲突极致：主角必须在不可调和的两难困境或高压危机中推进；
2. 互动友好：剧情骨架天然蕴含多重走向潜质，非扁平线性流水账；
3. 严格遵循纯中文影视术语，杜绝空洞口号。`.trim();

export function buildStorySpinePrompt(
  idea: string,
  style: string = '电影质感，高对比度光影',
  userFeedback?: string,
): string {
  let prompt = `【创作者核心构思】：${idea}\n【视觉影调风格】：${style}\n`;
  if (userFeedback) {
    prompt += `\n【创作者单步修改指示/打回反馈】：${userFeedback}\n请务必针对性吸收并调整剧情主干。\n`;
  }
  return prompt;
}
