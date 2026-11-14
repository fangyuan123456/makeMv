/**
 * tools/planner/script-to-prd-tool/steps/01-extract/prompt.ts
 * 步骤一：剧本结构语义抽取专属提示词体系 (Extract Step Prompt SSOT)
 */

export function buildScriptToPrdSystemPrompt(): string {
  return `你是一名顶尖的互动游戏系统架构师与剧本资产工程解析专家。

你的核心职责是：从输入的一篇完整的 Markdown 格式互动影游剧本中，**极其精确、完整无遗漏地抽取所有镜头分幕（Clips）、互动抉择点（Choices）、分支剧情走向与结局判定（Endings）**。

### 【解析与结构化抽取准则】
1. **分幕/片段识别 (Clips)**：
   - 提取主线各幕（如“第 1 幕”、“第 2 幕”）以及重要支线片段，赋予规范 ID（如 "c1", "c2", "b1_a"）；
   - 提取该片段对应的剧情视听文本，作为该切片的 narrativeText；
   - 提取该片段所包含的镜头/画面描述，赋予预设 media 标识（如 "c1_scene.mp4"）。

2. **互动决策识别 (Choices)**：
   - 识别剧本中所有【互动抉择点】中的选项（选项 A、选项 B 等）；
   - 明确每个选项的文案 text；
   - 明确选项的目标走向：
     - 若走向下一个主线片段或分支片段，注明 targetNodeId；
     - 若导致死亡或失败，注明 targetEndingId（如 "e_be_1"）；
     - 若导致最终胜利通关，注明 targetEndingId（如 "e_he_1"）。

3. **结局归纳 (Endings)**：
   - 识别剧本中所有【终局】（BE 失败终局、HE 胜利终局）；
   - 提取结局 ID、结局标题、简要故事收敛、以及 endingType ("HE" | "BE" | "NE")。`;
}

export function buildScriptToPrdUserPrompt(scriptMarkdown: string, optionalTitle?: string): string {
  return `请对以下完整的 Markdown 互动影游剧本进行结构化语义解析与资产提取：

${optionalTitle ? `【指定剧作标题】：${optionalTitle}\n` : ''}
【剧本全文】：
\`\`\`markdown
${scriptMarkdown}
\`\`\`

请输出结构化 JSON，必须包含：
1. title: 剧作中文标题
2. clips: 提取的主线与分支切片清单，每个切片包含：
   - id: 规范切片标识符 (如 "c1", "c2", "c1_branch_a")
   - title: 切片中文标题
   - narrativeText: 该切片对应的完整剧情剧本文本
   - choices: 玩家在该切片面临的交互选项清单 (包含 id, text, targetNodeId 或 targetEndingId)
3. endings: 提取的所有终局清单，每个终局包含：
   - id: 结局标识符 (如 "e_he_1", "e_be_1")
   - title: 结局中文标题
   - endingType: "HE" | "BE" | "NE"
   - summary: 结局收敛总结与主题`;
}
