/**
 * tools/planner/screenplay-tool/steps/02-screenplay/prompt.ts
 * 步骤二：全景剧本编写专属提示词体系 (Screenplay Step Prompt SSOT)
 */

import type { PremiseOutput } from '../01-premise/schema.js';
import type { PathBeat } from './expand-paths.js';

export function buildScreenplaySystemPrompt(): string {
  return `你是一名享誉国际的顶级互动影游总编剧与视听导演。

你的核心职责是：根据故事大纲与人设，编写一部**简洁、可拍摄、因果完整的互动影游剧本**。

### 【剧本核心编写准则】
1. **简洁的电影剧本表达**：
   - 每场只写影响抉择或因果的可见行动与必要对白；场景描述通常一两句，避免重复气氛、神态、动作和数值说明。
   - 场景使用规范标记，如 \`【场景：地点——关键画面】\`。
   - 人物台词使用 \`[角色名]：“[台词对白]”\`，只有影响表演或信息理解时才补充简短动作。
   - 严格围绕确立的故事题材与核心角色展开，严禁生造不相干的题材背景或无关角色。

2. **按已确定的分支大纲扩写**：
   - 只输出当前节点的剧本文字，不输出 JSON、代码块或字段包装。当前路径已经发生的正文与选定行动是唯一历史。
   - narrativeText 只写当前节点的场景、行动和对白，不写节点标题、选项、合流、后继或终局标记；这些由代码根据大纲添加。
   - 先承接最近一次已选行动的实际后果，再推进当前场景。以路径历史为事实依据，不提前执行尚未选择的选项。离场人物不能无故出现；尚未发生的营救不能当作完成；不写条件画面。
   - 互斥分支分别扩写，不能将其他分支的后果混入本节点。

3. **因果闭环与道具状态**：
   - 如果某个关键抉择需要前序获得的物品或关键情报，在剧情中要明确交代玩家在此处获得了什么（如 \`【获得关键道具：加密门禁卡】\`）。
   - 结局数量、情绪与类型服从创作者要求和故事因果，可使用 HE、BE 或 NE；每个选择应有可辨别的后果，不为凑结局强加死亡、危险或胜利路线。`;
}

export function buildNodeScriptPrompt(params: {
  premise: PremiseOutput;
  userPrompt: string;
  node: PremiseOutput['storyNodes'][number];
  history: PathBeat[];
}): string {
  const { premise, userPrompt, node, history } = params;
  return [
    '【创作者需求】', userPrompt,
    '【故事与角色设定】', JSON.stringify({title:premise.title,genre:premise.genre,characters:premise.characters}),
    '角色设定只说明身份与动机，不表示角色此刻在场或愿望已经实现。',
    '【本路径已发生的正文与随后选定的行动（按时间顺序）】',
    ...history.map(h => JSON.stringify({正文:h.narrativeText,随后行动:h.chosenAction,离场事实:h.node.exitConditions})),
    ...(premise.storyBible ? [
      '【全剧不可变事实；角色未必知情】', JSON.stringify(node.causalContract ? {background:premise.storyBible.causalBackground,objectiveTruth:premise.storyBible.objectiveTruth,rules:premise.storyBible.rules} : {...premise.storyBible,states:node.contextRole==='ending'?premise.storyBible.states:undefined,endings:node.contextRole==='ending' ? premise.storyBible.endings.filter((_,i)=>node.id===`ending_${i+1}`) : undefined}),
      '【扩写边界】',
      ...(node.causalContract ? ['事实账本 before/after 是本场唯一可变事实来源。choiceIntent 的 payoff 只标记后续回报，不能在当前片段提前执行；endingResolution 则必须在终局兑现。只描写 effects 中的状态变化；unavailableFacts 不能出现在固定画面或对白中，也不能凭空获得。', '资源与空间边界：地点名称只代表地点，不能据此新增可用逃生舱、备用通道、钥匙、证据或改变难题的新设施。不要给现有证据临时添加未经设定的铁匣锁、藏匿点或解锁条件。通用表演道具可以补充，但不能改变获救/取证条件。', '连续性：本场结束必须仍符合 after 中的位置、拘束状态、伤势及资源。时间值是阶段余量，不写精确秒数或静止读数，以免在合流时倒退。终局从 entry 指定的位置和处境开始，把脱困、转移与事件收束的过程写出来，不能直接跳回另一地点。'] : []),
      node.contextRole==='common' ? '这是共用片段。只有 entryConditions 是已发生的共同历史；不能提及某个选项被选择，不能把圣经中的秘密写成角色已知。' :
      node.contextRole==='branch' ? '这是局部后果片段。先落实 continuationAction，交代如何达到 mergeContract；不能借用另一选项的行动、道具或收获。' :
      '这是终局回报。仅使用本结局条件保证的事实及共有入场事实，清楚展示选择造成的结果，不凭空补足物品/营救/修复。',
      '共有场景只能陈述本场账本保证的状态；每段固定可拍摄。禁止条件台词、备选画面和一物多主。',
    ] : []),
    '【所有实际入路均已发生的动作记录】', JSON.stringify(node.establishedEvents || []),
    '这些动作已经完成，只用于承接连续性，不能在本场重演。伤势部位、证据保存状况和资源用途沿用记录及唯一前场，不得为强化结局另添损毁、受伤或传输失败。',
    '【当前节点大纲】', JSON.stringify(premise.storyBible ? {id:node.id,kind:node.kind,contextRole:node.contextRole,summary:node.summary,entryConditions:node.entryConditions,exitConditions:node.exitConditions,mergeContract:node.mergeContract,continuationAction:node.continuationAction,causalContract:node.causalContract,choiceIntent:node.choiceIntent,endingResolution:node.endingResolution} : node),
    (node.kind === 'ending' || node.endingResolution) ? '这是终局：必须完整兑现人物最终命运与事件结果，不能停在悬念、提问或新的选择上。只承接路由条件保证的历史；必须在正文完成必要的救援、交接、修复、撤离等因果，不能假设已经完成。' : node.contextRole === 'branch' ? '落实当前 continuationAction 的即时后果，保持账本 after 中的位置与物品归属；不要重复汇合场景，也不能替玩家作下一次选择。' : '共用场景只推进到眼前问题、危险或两难出现为止，在人物作出决定之前停笔；只落实本场 effects 指定的变化，不能额外执行尚未选择的行动。',
    node.endingResolution ? '本场正文约220–280汉字：一次决定性结果、必要行动与一个最后画面；不重演前场争论。' : node.contextRole==='branch' ? '本场正文约180–230汉字，包含选择的即时后果及抵达下一场的必要动作；转场用一句动作带过，不另加争执。' : '本场正文约160–200汉字，只铺垫眼前的新问题；已交代的规则、资源数量和人物动机不反复解释。',
    '以完整因果优先删去重复台词、气氛和动作，不截断句子或省略必要救援。每场只保留2–4句关键对白，不输出流程标记。',
  ].join('\n');
}
