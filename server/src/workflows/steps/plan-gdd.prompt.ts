/**
 * workflows/steps/plan-gdd.prompt.ts
 * 步骤一策划案推演管线专属提示词 (Plan GDD Step Prompts)
 *
 * 核心设计：
 * 1. 本模块专属于 plan-gdd.step.ts 业务推演管线，包含自由推演草稿、结构化固化与拓扑校验修复三阶段 Prompt；
 * 2. 彻底从 PlannerAgent 顶层指令中解耦内聚，遵循单一职责与高内聚设计哲学。
 */

export interface PlannerContextInput {
  userPrompt?: string;
  chatHistory?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  projectId?: string;
}

/**
 * 组装对话上下文段（推演与结构化两阶段共用）
 */
export function buildContextSections(contextInput: PlannerContextInput): string {
  const { userPrompt, chatHistory = [] } = contextInput;

  let conversationSection = '';
  if (chatHistory.length > 0) {
    const formatted = chatHistory
      .map((msg) => `${msg.role === 'user' ? '👤 创作者' : '🤖 AI总控'}: ${msg.content}`)
      .join('\n\n');
    conversationSection = `【创作者近期多轮对话上下文 (必须提取并尊重其中的核心约定)】：\n${formatted}\n\n`;
  }

  const promptSection = userPrompt
    ? `【当前核心意图/最新指示】：\n${userPrompt}\n\n`
    : '【当前指示】：请结合对话上下文推演出最终完整的游戏策划案。\n\n';

  return `${conversationSection}${promptSection}`;
}

/**
 * 阶段一：自由推演（不受 Schema 约束的设计草稿）
 * 让模型先在自由文本空间里完成读题、定循环、设计机制与搭骨架，再进入结构化固化。
 */
export function buildPlannerReasoningPrompt(contextInput: PlannerContextInput): string {
  return `${buildContextSections(contextInput)}【主策划设计推演（草稿，非最终交付）】
请在下面用条理清晰的推演文字（不是 JSON）完成以下设计推演，作为下一阶段结构化固化的底稿：

一、读题与素材清点：本作的题材类型、情绪基调、核心矛盾与体验诉求是什么？列出创作者材料中的全部具象素材（物件/地点/时间/人物细节），逐条标注它将转化为什么可交互实体（物品/旗标/场景热点）。素材一个都不许丢。
二、核心玩法：玩家靠什么交互驱动体验？本作的玩法心流循环是什么？为什么这个循环只属于这个题材？（如果它是任何题材都能套的通用循环，推倒重来）
三、机制推演：本作需要哪些数值变量、门禁旗标与可交互实体（inventory）？逐个说明"为什么本作需要它"。如果不需要，明确说不需要。
四、关卡任务序列：列出每个节拍（2~8 个）——先写玩家在这一拍玩什么（具体交互动作），再写这一拍演什么（谁、什么情境、什么利害、结束发生什么变化）。互动结构先做选择：要么是纺锤形分叉（中段某个节拍的两条支路进入**不同的节拍**——不同地点/对手/信息源，各走 1~2 拍后再汇流；注意：如果分叉的两条支路都直接跳到结局，那等于玩家全程只是在看），要么是回溯循环（分支指回已历节拍、靠状态累积让每轮不同）。终局部分——有几种结局就写几个独立终局节拍，一个终局节拍只承载一个结局。
五、拓扑自检：检查每个分支的 targetBeatId 是否都已定义、每个节拍是否都有入边（无孤立节拍）、互动结构是否成立（真分叉或真循环）、终局是否收束、每个节拍是否都可玩。`;
}

/**
 * 阶段二：结构化固化（把草稿沉淀为 GDDSchema JSON）
 */
export function buildPlannerStructuredPrompt(
  contextInput: PlannerContextInput,
  reasoningDraft: string
): string {
  const draftSection = reasoningDraft.trim()
    ? `【你的设计推演草稿（必须据此固化，不得另起炉灶）】：\n${reasoningDraft}\n\n`
    : '';

  return `${buildContextSections(contextInput)}${draftSection}【结构化固化任务】：
将上述推演沉淀为符合 GDDSchema 的纯正游戏系统策划案 JSON（互动可玩性第一，剧情点到即止）：
1. 提取并锁定对话中创作者已明确表达的硬性约束，具象素材必须回收为 inventory/flags/场景热点；
2. coreLoop、机制与节拍必须与草稿推演一致，严禁偷写具体台词剧本；
3. 每个节拍必须填写 gameplayTask（玩家在此拍的具体交互动作），缺失即不合格；
4. 互动结构二选一：(a) 至少一处中段真分叉——某节拍分支指向 ≥2 个**不同的、且都不是终局的**目标节拍，两条支路各走 1~2 拍后再汇流；(b) 回溯循环——分支指回已历节拍并置 isLoopBack: true。不允许所有分支汇流到同一节拍（伪分叉）；也不允许所有分叉都直接通向结局——那样玩家在终局之前只是旁观者（哑铃形）；
5. 多结局必须拆分为多个独立 isEnding 节拍，一个终局节拍只写一个 endingTheme；
6. 所有 targetBeatId 必须指向已定义的节拍，除起始节拍外每个节拍都要有入边，终局节拍 isEnding: true 且 branchExpectations 为空。`;
}

/**
 * 阶段三：拓扑校验修复（校验失败时带错误回喂，重出一版合规 JSON）
 */
export function buildPlannerRepairPrompt(gddJson: string, errors: string[]): string {
  return `你上一版策划案 JSON 存在以下拓扑或结构缺陷，请修复后重新输出完整且唯一的 GDDSchema JSON：
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

【上一版 JSON】：\n${gddJson}

【修复要求】：
1. 只修复上述缺陷并保持其余内容不变，不得另起炉灶重写题材；
2. 所有 targetBeatId 必须指向 beatOutline 中已定义的 beatId；
3. 终局节拍 branchExpectations 必须为空数组且 isEnding: true；
4. 若缺陷涉及"伪分叉"，必须真的拆出不同的目标节拍（各自独立的场景与玩法），只改数值不算修复；
5. 若缺陷涉及"只有终局一处抉择/哑铃形"，必须在中段某个节拍处拆出两条支路，各自进入**新的非终局节拍**（不同地点/对手/信息源），各走 1~2 拍后再汇流到原主线；只把终局拆成两个解决不了这个问题；
6. 若缺陷涉及"终局承载多个结局"，必须拆成多个独立 isEnding 节拍，并从上游分支分别接线；
7. 只输出 JSON，不含任何多余文本。`;
}

/** 意图文本一次性构建用户提示词工具 */
export function buildPlannerUserPrompt(input: string | PlannerContextInput): string {
  const contextInput: PlannerContextInput = typeof input === 'string' ? { userPrompt: input } : input;

  return `${buildContextSections(contextInput)}【主策划任务】：
1. 读题先行并清点素材：从创作者材料中辨认题材、基调与核心矛盾，具象物件/地点/时间逐一回收为可交互实体；
2. 游戏性第一：设计核心玩法心流循环与按需构成的状态规则模型（数值/标记/物品），题材不需要时诚实留空；
3. 规划全剧关卡任务序列 (beatOutline)：每个节拍先写玩法任务 (gameplayTask，玩家玩什么)，再写戏剧目标（一两句点到即止），至少一处真分叉；
4. 输出符合 GDDSchema 的纯正游戏系统策划案，严禁偷写具体台词剧本。`;
}
