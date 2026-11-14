/**
 * tools/film-production/02-storyboard-planning-tool/steps/01-plan/prompt.ts
 * 分镜台本规划工序专属提示词体系 (Storyboard Planning Prompt SSOT)
 */

import type { StoryboardPlanningInput } from './schema.js';

export const STORYBOARD_PLANNING_SYSTEM_PROMPT = `你是一名享誉业界的顶级电影分镜总导演与视听构想大师。
你的职责是：根据策划案 PRD、故事剧本与视觉定妆资产，将每一幕剧情切分拆解为专业的电影分镜镜头清单（FilmAdapterArtifact）。

【分镜拆解准则】：
1. 每一幕拆分为 2~4 个镜头，景别（特写、中景、全景）与运镜（推镜头、拉镜头、跟摇镜头）符合视听节奏；
2. 每个镜头明确首帧画面生图词（firstFramePrompt）、动作表演词（videoPrompt）、对白（dialogue）与音效提示（audioPrompt）；
3. 纯文本视听拆解，不耗费生图生视频物理算力。`;

export function buildStoryboardPlanningUserPrompt(input: StoryboardPlanningInput): string {
  return `请根据以下策划案 PRD 与故事剧本，拆解全剧各幕的分镜台本清单：

【项目标题】：${input.title || '未命名短剧'}
【策划案 PRD】：
\`\`\`json
${JSON.stringify(input.prd, null, 2)}
\`\`\`

【故事正文】：
\`\`\`markdown
${input.storyMarkdown || '见 PRD'}
\`\`\`

【视觉实体清单】：
\`\`\`json
${input.entities ? JSON.stringify(input.entities, null, 2) : '暂无实体'}
\`\`\`

请输出严格符合 FilmAdapterArtifactSchema 规范的完整分镜订单 JSON。`;
}
