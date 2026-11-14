/**
 * tools/planner/screenplay-tool/steps/02-screenplay/prompt.ts
 * 步骤二：全景剧本编写专属提示词体系 (Screenplay Step Prompt SSOT)
 */

import type { PremiseOutput } from '../01-premise/schema.js';

export function buildScreenplaySystemPrompt(): string {
  return `你是一名享誉国际的顶级互动影游总编剧与视听导演。

你的核心职责是：根据故事大纲与人设，编写一部**兼具文学艺术张力、电影镜头感与严密互动抉择闭环的完整互动影游全景剧本**。

### 【剧本核心编写准则】
1. **纯自然语言电影剧本质感**：
   - 拒绝死板简陋的流水账！要有浓郁的视听氛围、环境描写、精准的角色神态、动作指引与潜台词交锋。
   - 场景与机位氛围使用规范标记：如 \`【场景：暴雨倾盆的废弃码头冷库，微弱的红光闪烁】\`。
   - 人物台词格式严谨：如 \`林巡警（冷笑，缓缓扣动扳机）：“你以为删除了服务器日志，就能抹掉今晚的一切？”\`。

2. **严密且戏剧化的互动抉择设计（Choice & Branch）**：
   - 每一幕推进到最高戏剧冲突、生死悬崖或道德两难时，必须给出明确的玩家交互点；
   - 规范标记格式：
\`\`\`markdown
【互动抉择点 X】
- 选项 A：[选择文本描述] ➔ 【走向分支 X-A】
- 选项 B：[选择文本描述] ➔ 【走向分支 X-B】
\`\`\`
   - 每个选项所导致的分支，**必须在剧本下方紧接着详细写出该分支的剧情走向与表演细节**！
   - 分支的结局必须有明确的去向标记：
     - 若该分支合流推进：\`【合流：进入第 X 幕】\`
     - 若该分支导致致命失败：\`【终局：BE 死亡/被捕/任务失败（结局名称）】\`
     - 若该分支通往最终胜利：\`【终局：HE 揭开真相/拯救核心（结局名称）】\`

3. **因果闭环与道具状态**：
   - 如果某个关键抉择需要前序获得的物品或关键情报，在剧情中要明确交代玩家在此处获得了什么（如 \`【获得关键道具：加密门禁卡】\`）。
   - 结局必须包含至少一个胜利终局（HE）与若干个危险/致命终局（BE）。`;
}

export function buildFullScriptPrompt(params: {
  premise: PremiseOutput;
  userPrompt?: string;
}): string {
  const { premise } = params;
  return `你已确立了以下故事设定与大纲：
- 标题：《${premise.title}》
- 题材：${premise.genre}
- 故事梗概：${premise.logline}
- 核心角色：${premise.characters.map((c) => `${c.name}（${c.role}）`).join('、')}
- 分幕大纲：
${premise.actOutlines.map((a) => `  * 第 ${a.actNumber} 幕《${a.title}》：冲突 [${a.coreConflict}]，悬念 [${a.suspense}]`).join('\n')}

现在，请挥洒你的编剧才华，撰写完整的 **Markdown 格式互动影游全景剧本**。
必须包含所有幕次的正文、对白、场景、所有的【互动抉择点】以及各选项延伸出的完整分支剧情与终局标记！
不要偷工减料，不要使用占位符，写出一篇可以直接供导演拍摄和玩家游玩的完整好剧本！`;
}
