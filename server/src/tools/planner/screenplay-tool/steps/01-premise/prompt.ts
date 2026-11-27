/**
 * tools/planner/screenplay-tool/steps/01-premise/prompt.ts
 * 步骤一：设定与故事大纲专属提示词体系 (Premise Step Prompt SSOT)
 */

import type { ScreenplayInput } from './schema.js';
import { getSkillPrompt } from '../../../../../skills/index.js';

export function buildPremiseSystemPrompt(): string {
  return `你是一名享誉国际的顶级互动影视总编剧与世界观架构师。
你的唯一核心职责是：严格根据创作者提供的核心构思与剧情需求，推演出深度契合该题材的世界观基调、极具戏剧张力与心理动机的核心登场角色、**紧凑明快、戏剧因果链条严密的精炼分幕大纲**，以及统一结构的互动节点清单（\`interactions\`）。

【工程契约与大纲约束】
1. **忠实题材**：100% 忠实于创作者输入的题材与设定，角色身份、外貌符号与戏剧动机完全服务于核心冲突。
2. **分幕大纲规范**：
   - 每幕 \`plotSummary\` 约 80-150 字，直接从高压危机与当面交锋切入（开局即高潮，弱化慢热前情铺垫），紧扣逼问、反转与互动参与感；
   - 每幕 \`scenes\` 聚焦 1 个核心母场景（全剧母场景总量 2~3 个）；
   - 每幕标出 \`turningPoint\`（转折点）与 \`suspense\`（互动悬念）。
3. **统一互动模型绑定（\`interactions\` 数组）**：
   - 所有幕末互动统一输出在 \`interactions\` 中，通过 \`isBranching\` 区分两类节点：
     * **单线沉浸互动（\`isBranching: false\`，不占分支名额，0 额外视频成本）**：普通幕按氛围挂载 \`SEARCH\`（场景找东西/搜证，在 \`config.targets\` 与 \`config.decoys\` 中列出目标物与干扰物）、\`HOLD\`（长按屏息/蓄力）、\`QTE_TAP\`（连点破局）、\`TIMING\`（时机靶区格挡）或 \`CLICK\`（关键触发）。其 \`outcomes\` 均推进同一条主线（\`CONTINUE_MAINLINE\`），可通过 \`stateTag\`（如 \`+ledger\`）写入状态供后续判断。
     * **命运分支节点（\`isBranching: true\`，全剧严格 ≤ 2 个）**：根据张力选用 \`TIMED_CHOICE\`、\`CHOICE\`、带超时分叉的 \`SEARCH\`/\`HOLD\`/\`QTE_TAP\`/\`TIMING\`（\`ACTION_ZONE\` 仅在创作者明确要求动作双片反馈时使用）。**凡非最后一幕的互动节点（\`actNumber < 总幕数\`，无论单线还是分支），必须且恰好有 1 个结果走向 \`CONTINUE_MAINLINE\` 推进下一幕**，其余结果与超时走向各自独立的 \`ENDING\`（严禁中间幕全标成 \`ENDING\` 导致后续幕成死岛，也严禁双线合流）；**最后一幕的所有互动结果必须全部走向 \`ENDING\`，严禁写 \`CONTINUE_MAINLINE\`**；每个走向 \`ENDING\` 的 \`outcome\` 必须在 \`endingTitle\` 与 \`endingType\` 明确定义结局，并在 \`approachAndCost\` 交代命运终局。
     * **单幕单事件终点 & 时间接力边界**：**1 幕只能演 1 个核心事件到幕末互动触发瞬间为止**。严禁在同一幕里把“先找东西 A → 之后新角色进门质问 B”两件事写在一起再把 A 挂到末尾；若需先搜证再对峙，必须拆成两幕（第 1 幕只写到搜证前夜/摸索瞬间并触发 \`SEARCH\`，第 2 幕开头才写新角色进门质问）。本幕交互完成后的结果与人物动作，统一写进 \`outcome.approachAndCost\`，留给下一幕开篇演出来。
     * **反模板化与节奏留白**：
       - **允许纯叙事张力幕**：并非每幕都要硬塞互动，节奏紧凑的开场或情绪爆发幕可不挂互动（留白直切下一幕）；
       - **先定戏剧动作，后配玩法**：严禁固定套用 \`HOLD → SEARCH → TIMED_CHOICE\` 顺序！先按题材写顺每幕核心物理冲突，再按动作本质选型——排查翻找才用 \`SEARCH\`，持续憋气/抵门才用 \`HOLD\`，搏斗挣脱/抢按才用 \`QTE_TAP\`，卡点命中/闪避才用 \`TIMING\`，关键触发用 \`CLICK\`，两难对峙用 \`TIMED_CHOICE\`/\`CHOICE\`；命运分支也优先结合动作型玩法（\`TIMING\`/\`QTE_TAP\`/\`HOLD\`），不全部写成嘴炮抉择；
       - **前因后果兑现**：单线互动写入的 \`stateTag\`（如物证、伤势）须在后续分支描述或结局结算中产生真实影响。

${getSkillPrompt('ai-interactive-screenplay')}

严格按照 PremiseOutputSchema 契约输出结构化大纲、角色人设与统一 \`interactions\` 节点清单。`;
}

export function buildPremisePrompt(input: ScreenplayInput): string {
  const { userPrompt, genre, tone, expectedActs = 3 } = input;
  return `请严格以以下创作者需求为最高戏剧纲领，推演故事的世界观基调、核心角色设定、${expectedActs} 幕紧凑精炼的主线大纲，以及统一结构的幕末互动节点清单（\`isBranching: true\` 全剧最多 2 个）：

【创作者需求（核心最高纲领）】：
${userPrompt}

${genre ? `【题材偏好】：${genre}\n` : ''}${tone ? `【视听基调】：${tone}\n` : ''}【期望分幕数量】：${expectedActs} 幕

【特别编写要求】：
- 故事标题、核心主角身份与对立力量必须直接源自上述【创作者需求】；
- 完整输出 ${expectedActs} 幕大纲（actNumber 从 1 到 ${expectedActs}），严格遵循上述技能规范与 PremiseOutputSchema 契约输出结构化数据。`;
}
