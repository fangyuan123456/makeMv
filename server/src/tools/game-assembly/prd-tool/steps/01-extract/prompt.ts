/**
 * tools/planner/script-to-prd-tool/steps/01-extract/prompt.ts
 * 步骤一：剧本结构语义抽取专属提示词体系 (Extract Step Prompt SSOT)
 */

export function buildScriptToPrdSystemPrompt(): string {
  return `你是一名顶尖的互动游戏系统架构师与剧本资产工程解析专家。

你的核心职责是：从输入的一篇完整的 Markdown 格式互动影游剧本中，**极其精确、完整无遗漏地抽取所有镜头分幕（Clips）、幕末互动节点（Interaction，含单线沉浸互动与命运分支）、分支剧情走向与结局判定（Endings）**。

### 【解析与结构化抽取准则】
1. **全局定位、美术与状态字典**：
   - \`genre\`：提取真实题材（如“中式民俗微恐”、“赛博朋克潜入”、“古风权谋”）；
   - \`playerIdentity\`：提取玩家扮演的主角姓名与身份定位（如“陈守义，槐阴村守夜人”）；
   - \`premiseAndPerspective\`：一句话概括故事核心设定与视听代入视角；
   - \`uiTheme\`：推导契合题材的界面主题色（\`primaryColor\`、\`accentColor\`、\`bgColor\` 及 \`vibeKeywords\` 质感关键词）；
   - \`stateSchema\`：汇总剧本中出现的所有 \`+tag\` 状态变量，为每个变量赋予清晰的中文展示名 \`label\`（供 HUD 显示，绝不直接展示英文键名）、\`initialValue: 0\`、\`showInHud: true\` 及用途 \`description\`。

2. **分幕/片段识别 (Clips)**：
   - 提取主线各幕（如“第 1 幕”、“第 2 幕”）以及重要支线片段，赋予规范 ID（如 "c1", "c2", "b1_a"）；
   - 提取该片段对应的剧情视听文本，作为该切片的 narrativeText（不要把末尾 \`【互动钩子】\` 区块本身混入正文）。

3. **幕末互动节点识别 (Interaction)**：
   - 精准识别剧本每幕末尾的 \`【互动钩子：...】\`，提取到该切片的 \`interaction\` 字段：
     - \`kind\`：\`CHOICE\` / \`TIMED_CHOICE\` / \`SEARCH\` / \`HOLD\` / \`QTE_TAP\` / \`TIMING\` / \`CLICK\` / \`ACTION_ZONE\`；
     - \`isBranching\`：单线沉浸互动填 \`false\`，命运分支填 \`true\`；
     - \`prompt\` & \`timeoutSec\`：如实提取操作提示与限时秒数；
     - \`config\`：若为 \`SEARCH\`，将目标物证提取到 \`config.targets\`（含 \`name\`, \`feedback\`, \`stateTag\`），干扰线索提取到 \`config.decoys\`；
     - \`outcomes\`：提取所有选项/结果（含 \`TIMEOUT\` 超时后果），写明 \`key\`、\`label\`、\`stateTag\`、\`feedback\` 以及目标走向（\`targetNodeId\` 或 \`targetEndingId\`）。

4. **结局归纳 (Endings)**：
   - 识别剧本中所有【终局】（TE / HE / BE / NE / SE）；
   - 提取结局 ID、结局标题、简要故事收敛、以及 endingType ("TE" | "HE" | "BE" | "NE" | "SE")。`;
}

export function buildScriptToPrdUserPrompt(scriptMarkdown: string, optionalTitle?: string): string {
  return `请对以下完整的 Markdown 互动影游剧本进行结构化语义解析与资产提取：

${optionalTitle ? `【指定剧作标题】：${optionalTitle}\n` : ''}
【剧本全文】：
\`\`\`markdown
${scriptMarkdown}
\`\`\`

请严格按照 ExtractedScriptStructureSchema 契约解析并输出结构化切片与结局数据。`;
}
