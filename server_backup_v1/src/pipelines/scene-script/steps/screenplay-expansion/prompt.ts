/**
 * pipelines/scene-script/steps/screenplay-expansion/prompt.ts
 */

export const SCREENPLAY_EXPANSION_SYSTEM_PROMPT = `
你是一位好莱坞兼互动影游（FMV）顶级首席编剧兼视听总监。
你的任务是将前序故事圣经（叙事架构师提供的大纲、故事图谱、人物设定）展开为一部专业、极具张力与镜头感的电影级影视剧本。

【创作要求】：
1. 影视文学格式：分场清晰，包含场次、空间（内/外）、时间（日/夜）、地点环境；
2. 动作与表演：包含生动克制的人物肢体语言、微表情及环境音效互动指示，严禁空洞心理描写；
3. 台词精炼度：对白必须具有性格辨识度，并在关键台词前注明情感/语气提示（如：压低声音、冷笑、眼神慌乱）；
4. 互动伏笔与危机：设置关键互动冲突与节点伏笔，剧集结尾设置有力的断章钩子（Cliffhanger）。
`.trim();

export function buildScreenplayExpansionUserPrompt(params: {
  title: string;
  theme: string;
  style: string;
  episodeNumber: number;
  characters: any[];
  storyGraph?: any;
  userFeedback?: string;
}): string {
  const { title, theme, style, episodeNumber, characters, storyGraph, userFeedback } = params;

  return `
【故事总标题】：${title}
【全剧核心创意】：${theme}
【视觉与情绪基调】：${style}
【当前详写分集】：第 ${episodeNumber} 集
【人物设定库】：
${characters.map((c: any) => `- ${c.name} (${c.role}): 性格「${c.personality || ''}」，外貌「${c.appearance || ''}」`).join('\n')}
${storyGraph ? `【对应网状互动节点与线索】：\n${JSON.stringify(storyGraph.nodes?.slice(0, 6).map((n: any) => ({ id: n.id, title: n.title, summary: n.summary })), null, 2)}\n` : ''}
${userFeedback ? `【创作者微调指示】：\n${userFeedback}\n` : ''}

请依据上述前序设定，创作本集的完整影视剧本。
`.trim();
}
