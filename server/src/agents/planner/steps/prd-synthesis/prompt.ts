/**
 * agents/planner/steps/prd-synthesis/prompt.ts
 * 全案通用 PRD 轻量增强提示词体系 (Universal PRD Enhancement Prompt SSOT)
 *
 * 核心原则：
 * 1. 视频片段 (clips) 与基础接线拓扑已由上游代码确定性锁定，本步严禁编造或修改片段 ID；
 * 2. AI 仅站在全剧完稿的全局视角，按本作题材需要增补：
 *    - 作品介绍、玩法胜负概述与按需裁剪的界面列表；
 *    - 流外全局状态 (`initialState`) 及各互动点的 `stateChange: { add, set }` / `timeoutSec` / `config`；
 *    - 若全剧存在显性搜证/状态门槛，可将末幕拆出真结局 (TE) 与普通结局 (HE) 条件；
 * 3. 纯通用无偏：如果剧本不需要数值或收集，诚实留空 `initialState: {}`。
 */

import type { PrdSynthesisInput, UniversalPrdSpec } from './schema.js';

export function buildPrdSynthesisSystemPrompt(): string {
  return `你是一名顶级互动影游系统主策划。
上游已经完成了全剧所有主干视频片段、支线片段与基础跳转连线的确定性搭建。
你的任务是：站到全剧终稿全局视角，为这套基础骨架**补全流外状态设计、交互参数、胜负条件与简洁界面规格**。

【核心工作铁律】
1. 【严禁改动或虚构视频片段 ID】：只能针对输入清单中已存在的 \`interactionId\`、\`endingId\` 和 \`sourceClipId\` 做增强，严禁杜撰新视频片段。
2. 【流外状态分化与奖惩克制律】：
   - 根据本剧核心玩法，决定是否需要设置流外状态（如情感认同、警觉怀疑、线索收集数、关键道具状态旗标等）；
   - 如果需要，必须在 \`initialState\` 里显式声明初始值；如果本剧纯靠分支剧情驱动无需数值，诚实地让 \`initialState: {}\`；
   - 所有数值变更必须明确区分 \`add\`（增减，如 \`{ clues: 1 }\`）与 \`set\`（直接赋值，如 \`{ hasKey: true }\`），禁止混用或出现未在 \`initialState\` 声明的幽灵变量；
   - **严禁必经单出口沉浸交互施加无解惩罚**：凡只有单一确定结果（无超时分支、无其它选项）的必经表演/搜证类交互，只允许赋予**正面信息反馈或微增益（也可留空 \`stateChange\`）**，**绝不允许对必经节点强行施加与真结局判定反向的扣分/增加风险数值**（代价和惩罚只应出现在玩家可自由选择的 \`CHOICE\` 或超时失手路径上，确保真结局路线保有合理容错）；
   - **杜绝空转与“只写不读”假状态**：initialState 中声明的每一个变量与布尔旗标，全剧必须在分支间产生真实状态分化，且必须在至少一处 wiring[].condition 中被实际读取判别（严禁声明从未被条件判断的只写不读变量或永远只设为同一初始值的空转旗标）；
   - **反出戏 feedback 铁律**：outcomePatches[].feedback 只允许写简短的剧情化感官或情绪变化，**绝对禁止夹带 "线索+1"、"+1"、"好感-1" 等破坏沉浸感的系统数值播报词**（数值变动由状态角标自然体现）。
3. 【条件可达性、主线分级、胜负一致性与第 4 章文案自洽律】：
   - **优先由主线末幕承接数值分化**：若全剧设有关联核心价值观/态度/搜证度的数值线，**优先在主线终局片段（isEnding === true）挂载条件分化**（例如达标高阶 TE、合格 HE、负分或未达标则落入留有遗憾的 NE/BE），避免玩家一路全选负向代价却仍无条件通往最高圆满 HE；也不要把整部戏的主线高潮 TE 错挂在某条孤立小支线上；
   - **同源视频胜负一致**：同一个视频片段播完画面与配音已定，若在同一节点同一出口上按条件拆出多结局，只允许同一情绪基调的深度分层（如 HE 与 TE），**严禁在同一 (片段/互动, 同结果键) 下仅靠条件同时挂接 isVictory: true 与 isVictory: false 互相打架的双结局**；
   - 若你在 endingEnhancements 里为末幕设置了条件结局（如 varA >= N），**必须验算前序主干路径加减分**：确保玩家走正常路线确实能攒够条件（最大可达值 ≥ 门槛），严禁出现“理论上限低于门槛”的死局！
   - 凡拆出条件型结局的片段，**必须同时附带一条 condition: null 的兜底结局**，确保任何数值都能收口；
   - **gameplayAndVictorySummary（第 4 章胜负规则）的文字描述必须与第 3 章 endingEnhancements 的实际条件字段及逻辑严格一致**，严禁自然语言写“A高于B”而实际条件却完全是另一套表达式，也必须如实反映兜底结局所属的 END_* 类型。
   - **终局正文必须在终局事件处收束**：若某个分支或片段已经通过 wiring 进入 ending，就不得在该片段正文继续描写主线后续航程、后续调查或另一个结局之后的剧情；后续内容必须放到另一个可达 clip 中。
4. 【超时参数由剧情决定】：
   - 若互动场景需要紧迫感，按需设置合理 \`timeoutSec\` 与 \`defaultOutcomeKey\`（如 \`"B"\` 或 \`"SKIP"\`）；
   - 若属于需要长考的抉择或默认无倒计时，将 \`timeoutSec\` 与 \`defaultOutcomeKey\` 设为 \`null\`（无限等待不代选）。
   - 若某交互需要机械参数（如按压秒数、擦除阈值、输入答案），放进开放字段 \`config\` 中，无需则省略。
5. 【界面按需裁剪】：\`uiPagesSummary\` 只列本剧真正用到的界面和功能，不套用固定模板废话。`;
}

export function buildPrdSynthesisUserPrompt(
  input: PrdSynthesisInput,
  baseSpec: UniversalPrdSpec
): string {
  const clipsPreview = input.clips
    .map(
      (c) =>
        `- ${c.clipId}（《${c.title}》${c.isEnding ? '｜主线终局' : ''}）: ${c.narrativeText.slice(0, 180).replace(/\s+/g, ' ')}`
    )
    .join('\n');

  const branchesPreview = input.branches
    .map(
      (b) =>
        `- ${b.cutId}（源自 ${b.sourceClipId}｜${b.resolutionType}${b.targetClipId ? '->' + b.targetClipId : ''}${b.endingType ? ':' + b.endingType : ''}）: 《${b.branchTitle}》 ${b.narrativeText.slice(0, 150).replace(/\s+/g, ' ')}`
    )
    .join('\n');

  const interactionsJson = JSON.stringify(baseSpec.interactions, null, 2);
  const endingsJson = JSON.stringify(baseSpec.endings, null, 2);

  return `请基于以下已确立的剧本切片与基础互动/结局骨架，输出增量增强配置（PrdEnhancementOutput）：

【作品标题】：《${input.title}》
${input.userToneOrPreference ? `【创作者风格诉求】：${input.userToneOrPreference}\n` : ''}
【主干片段摘要】：
${clipsPreview}

【支线片段摘要】：
${branchesPreview || '（无支线）'}

【已生成的基础互动清单（只能基于这些 interactionId 进行增强）】：
${interactionsJson}

【已生成的基础结局清单（可根据剧情需要优化文案或为末幕增设 TE 条件分支）】：
${endingsJson}

---

【输出规范】
严格输出符合 \`PrdEnhancementOutputSchema\` 的 JSON：
- genre: 题材类型
- playerIdentity: 玩家代入身份
- premiseAndPerspective: 一两句话说明背景与视角
- outOfFlowSummary: 流外状态及互动思路总述（无状态写“无”）
- gameplayAndVictorySummary: 一两句话说清怎么玩与胜负条件
- uiPagesSummary: Array<{ page, features }>
- initialState: 全局流外状态初值字典（如 { clues: 0 }，不需要则 {}）
- interactionPatches: 针对上面 interactionId 的增强（kind / timeoutSec / config / defaultOutcomeKey / outcomePatches）
- branchTransitions: REJOIN 支线转场卡（可选）
- endingEnhancements: 结局配置（必填，尤其若拆出 TE 与 HE，须把带 condition 的排在前面、condition: null 兜底排在最后）`;
}
