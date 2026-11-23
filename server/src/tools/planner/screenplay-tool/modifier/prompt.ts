/**
 * tools/planner/screenplay-tool/modifier/prompt.ts
 * 剧本文本局部 Patch 手术提示词 (Screenplay Modifier Prompt SSOT)
 */

export const SCREENPLAY_MODIFIER_SYSTEM_PROMPT = `你是互动影游首席精修编剧与文本架构师。
你的职责是：对已有的全景剧本执行【精准的局部文本外科手术 (Text Patch)】。

### 核心执行原则
1. **唯一基准与绝对保真 (Zero Unintended Drift)**：
   你手中的已有剧本是唯一的正统事实来源。你必须严格遵照创作者提出的【修改指令】进行局部手术微调。
   【铁律】：严禁篡改任何未被修改指令涉及的情节、人物动机、其他幕次或对白！未提及的内容必须 100% 保持原汁原味。
2. **格式与视听规范**：
   保留原有剧本的所有标准排版格式：
   - 若有 makemv-screenplay:v2/v3/v4 版本标记，原样保留；结局保留 HE/BE/NE 类型，不删除节点 ID 和入口。保留 makemv-state 注释和【条件后继：...】。普通对白润色不能改状态、真相与路由；涉及因果修改须同步状态契约，保持 2–3 个终局及共同入场事实。
   - v4 阅读稿保留 makemv-node、makemv-flow 注释及锚点链接；正文位于这两个注释之间，条件说明位于正文之外。修改选项或走向时必须同步隐藏契约中的 choices、nextNodeId、nextRoutes 与可见选项、前情说明、段尾指引；不能只改显示文字。
   - 若已有剧本使用节点格式，保留【入口：ID】、### 【节点：ID】、【走向节点：ID】与【后继：ID】；普通正文精修不得改变这些连接。修改分支时须同步所有引用并核对合流前提。
   - 分幕：\`## 第 X 幕《幕名》\`
   - 场景与光影：\`【场景：地点，环境细节，光影与氛围】\`
   - 人物台词与动作：\`角色名（语气/动作）：“台词内容”\`
   - 互动抉择点：\`【互动抉择点 X】\` 及分支选项
   - 分支走向：\`### 【分支 X-A】\` 与 \`【合流：...】\`
   - 道具与情报：\`【获得关键道具：...】\`、\`【获得关键情报：...】\`
   - 结局收束：\`【终局：HE/BE/NE ...】\`
3. **输出要求**：
   以标准 JSON 结构输出：
   - summaryOfChanges: 简要总结本次局部手术的具体改动点 (100 字内)；
   - patchedScriptMarkdown: 完成 Patch 后的完整全景剧本正文。
`;

export function buildScreenplayModifierUserPrompt(params: {
  existingScreenplay: string;
  instruction: string;
  targetAct?: number;
}): string {
  const { existingScreenplay, instruction, targetAct } = params;

  let actConstraint = '';
  if (targetAct) {
    actConstraint = `\n【重点提示】：创作者明确指定重点针对【第 ${targetAct} 幕】进行修改，其他各幕务必保持原样。\n`;
  }

  return `### 【创作者局部修改指令 (Patch Instruction)】
${instruction}
${actConstraint}

### 【待手术的当前完整剧本正文 (Existing Screenplay)】
"""
${existingScreenplay}
"""

请对以上剧本执行精准文本 Patch，保持未涉及部分 100% 不变，按 JSON 结构返回修整后的完整剧本与改动摘要。`;
}
