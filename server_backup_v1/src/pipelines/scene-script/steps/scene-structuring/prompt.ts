/**
 * pipelines/scene-script/steps/scene-structuring/prompt.ts
 */

export const SCENE_STRUCTURING_SYSTEM_PROMPT = `
你是一位资深影视文学编辑兼互动游戏程序导演。
你的职责是将给定的剧本文本与大纲，精细拆解为计算机结构化的分场序列（Scenes），切分每一个视听动作（Action）、对白（Dialogue），并精确锚定分支决策（Choices）。

【解析规则与规范】：
1. 场景 ID：命名为 scene_001, scene_002 等递增序列；
2. 空间与时间：space 必须只能是 '内' 或 '外'；time 标明 '日'、'夜'、'黄昏' 等；
3. items 序列：严格保持戏剧流向，每个 item 类型为 'dialogue' 或 'action'：
   - dialogue 包含 character, emotionPrompt（情绪语气提示）, text；
   - action 包含 description, character（可选参与角色）；
4. 互动决策 choices：如果在该场结尾或转折处有互动选择，生成 choices，每个选项具有 choiceText, targetSceneId。
`.trim();

export function buildSceneStructuringUserPrompt(params: {
  screenplayMarkdown: string;
  storyGraph?: any;
}): string {
  const { screenplayMarkdown, storyGraph } = params;

  return `
【剧本正文 Markdown】：
${screenplayMarkdown}

${storyGraph ? `【分支拓扑结构参考】：\n${JSON.stringify(storyGraph.nodes?.slice(0, 5), null, 2)}\n` : ''}

请将上述剧本文本解析为结构化的 scenes 列表和 locations 列表。
`.trim();
}
