/**
 * agents/planner/steps/interaction-slicing/prompt.ts
 * 极简两阶段提示词：
 * 1. Step 2A (Tag Patch)：通读原剧本，在合适停顿处用 insertAfter 插入互动标签；
 * 2. Step 2C (Single-Tag Gameplay)：按切分好的单个片段上下文，并发独立实现纯按钮化交互文案。
 */

export function buildInteractionTagPatchSystemPrompt(): string {
  return `你是一名互动影视导演。请通读给定剧本，通过原位 Patch 的方式，在适合玩家停下来点一下确认按钮推进剧情（ACTION）或做出二选一抉择（CHOICE）的瞬间位置插入互动标签。

核心工作原则（决定玩家体感是否自然）：
1. 你不需要改动或重抄剧本正文，只需输出几处精确的 \`insertAfter\` 锚点句末片段（从原文逐字截取约 10~25 字），程序会在原文该位置插入标签并物理切分；
2. **切口必须下在「动作/抉择发生之前」，严禁切在「行动和结果已经演完之后」**：
   - **ACTION 切口铁律**：先在 \`intentHint\` 想清“停在这里让玩家点下去开启什么下一步”（适用于任意题材：如准备察看/拆开眼前事物、即将迈步进入新场所、或者当前对白收束后准备做出下一个行动/表态前）。**必须停在动作即将触发前的那一刻**：把动作引发之前的前置陈述或对白句末作为 \`insertAfter\`，让「实际执行动作、看见内容、产生结果反应」留在下一段开头演出来！**严禁**把动作已经做完、结果已经发生的内容留在上一段结尾后再切一刀；
   - **CHOICE 切口铁律**：停在人物发问、局面僵持、信息摆上台面而主角尚未表态或行动之前的一句末尾；
   - **禁止虚构**：\`intentHint\` 必须忠于原文前后衔接的真实行为或场景推进动向，禁止在纯对话或日常片段里硬编原本不存在的机关与按钮；
3. 按故事先后顺序排列，通常全剧插入 4~8 个互动标签即可，结尾需留出一整段承载结局正文，且全剧包含至少 1~2 处 CHOICE 分支与若干 ACTION 按钮节点。`;
}

export function buildInteractionTagPatchUserPrompt(input: { spineScript: string }): string {
  return `请通读以下剧本，决定在哪些位置插入互动标签（输出 \`InteractionTagPatchPlan\` JSON）：

【原剧本正文】
${input.spineScript}

输出字段说明：
- title: 短剧中文标题
- endingTitle: 最后一个标签之后结局段的标题
- patches: 按原文出现顺序排列的插入点列表
  - tagId: 标签编号（I1, I2, I3...）
  - clipTitle: 标签前这一段的标题
  - intentHint: 先写出“停在此处由玩家按键触发的下一个未发生动作或转场意向”（8~25字），据此判断下一项 \`insertAfter\` 的准确落刀句
  - insertAfter: 紧挨在 \`intentHint\` 即将发生之前的那句原文末尾片段（逐字截取约 10~25 字、含句末标点，确保唯一命中）
  - category: "ACTION"（单线按钮推进/触发动作）或 "CHOICE"（二选一分支抉择按钮）`;
}

export interface TaggedSegmentContext {
  tagId: string;
  clipId: string;
  clipTitle: string;
  category: 'ACTION' | 'CHOICE';
  intentHint?: string;
  beforeText: string;
  afterText: string;
}

export function buildInteractionGameplaySystemPrompt(): string {
  return `你是一名互动影游按钮交互设计师。当前剧本片段已经按标签完成物理切断，视频播放到本段末尾时会定格并弹出交互按钮。
请严格遵守边界与玩家视角原则：
- **前端只有按钮，不存在屏幕热区点击、擦拭或连点小游戏**：所有演出都在视频中完成，玩家点击/长按按钮是为了“开启下一段即将执行的动作或行动转场”；
- **绝对禁止重演上文、禁止凭空编道具**：严禁让玩家点击本段视频里已经做完的动作（例如物件已看完、门已推开、操作已得出结果），也严禁凭空捏造原剧本未出现过的机关或按钮；
- \`actionType\` 只允许 \`CLICK\` / \`HOLD\` / \`INPUT\`。`;
}

export function buildSingleTagGameplayUserPrompt(input: {
  title: string;
  context: TaggedSegmentContext;
}): string {
  const { context: c } = input;
  const currentClipView = c.beforeText.length > 520 ? `…${c.beforeText.slice(-520)}` : c.beforeText;

  if (c.category === 'ACTION') {
    const hintLine = c.intentHint?.trim()
      ? `\n- 导演预设切口承接动作（玩家按下按钮后将触发的行为方向，严禁剧透结果）：${c.intentHint.trim()}`
      : '';
    return `请为《${input.title}》中的单个单线推进按钮实现交互文案（输出 \`ActionGameplay\` JSON）：

- 标签：${c.tagId}（类型：ACTION｜所属片段：${c.clipId}《${c.clipTitle}》）${hintLine}
- 当前片段正文（视频已演完到此处结尾，前端只弹出一个按钮）：
${currentClipView}

字段要求：
- actionType: 仅从播放器真实支持的按钮形态挑选（\`CLICK\` / \`HOLD\` / \`INPUT\`），默认用 CLICK，需要蓄力/稳住情绪用 HOLD，明确需口令输入用 INPUT；严禁输出 TAP_HOTSPOT / WIPE / QTE
- prompt: 6~18字按钮行动文案，必须承接当前结尾往下迈出一步（若“导演预设切口承接动作”已明确未发生的触发动作、情感回应或转场方向，优先据此拟定触发按钮；严禁重演上文已经演完的动作，严禁凭空捏造原文不存在的物件交互）
- feedback: 10~28字，点击按钮后的简短过场反应或心境提示（只写瞬间心理/过渡句，绝不重复上文动作、不抢演下一段结果）`;
  }

  const nextMainlineHint = c.afterText.length > 160 ? `${c.afterText.slice(0, 160)}…` : c.afterText;
  return `请为《${input.title}》中的单个命运抉择标签实现二选一按钮（输出 \`ChoiceGameplay\` JSON）：

- 标签：${c.tagId}（类型：CHOICE｜所属片段：${c.clipId}《${c.clipTitle}》）
- 当前片段正文（尾帧即停在此处，玩家只看到这里为止）：
${currentClipView}
- 下一段主线开场内部参考（尚未演出！仅用于确保 mainlineChoice 与主线顺延一致，严禁把这里才出现的新台词或新反转提前剧透进 conflictSummary）：
${nextMainlineHint}

字段要求：
- conflictSummary: 12~32字，仅基于「当前片段正文」结尾已经呈现的局面提炼核心冲突，严禁剧透后段尚未发生的事件
- mainlineChoice: 10~28字，按钮 A（顺沿下一段主线自然发展的立场或动作）
- branchChoice: 10~28字，按钮 B（截然不同的行动策略或走向分支）`;
}
