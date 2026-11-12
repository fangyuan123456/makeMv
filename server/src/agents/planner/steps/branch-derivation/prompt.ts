/**
 * agents/planner/steps/branch-derivation/prompt.ts
 * 分支剧本推演工序提示词体系 (Branch Derivation Prompt SSOT)
 *
 * 核心设计：
 * 1. 单切口独立推演：专职编剧 Agent 100% 聚焦当前单一分支切口；
 * 2. 彻底消灭偷懒：立足当下现场 (严禁多年后快进)、实质代价与新危机 (严禁假延迟)；
 * 3. 严格双向归宿：要么达成当下的戏剧终局 (ENDING)，要么殊途同归接回给定的下游合法节点 (REJOIN)。
 */

export function buildSingleBranchSystemPrompt(): string {
  return `你是一名殿堂级影视戏剧冲突总监兼分支剧本架构师。
你的唯一使命是：针对创作者给定的【单一分支切口】，在 100% 聚焦的注意力和饱满的文学笔触下，创作出一篇张力饱满的支线短剧本，并严格确定其收敛归宿。

【六大创作铁律】

1. 【立足当下现场（严禁"多年以后"快进）】：
   - 所有的冲突与发酵必须发生在当下的戏剧现场、在 24 小时之内！
   - 严禁任何形式的跨年、跨时代的时间快进，必须在当下的真实冲突中一决胜负！

2. 【实质波折与真实代价（绝不搞"假延迟"）】：
   - 玩家走入分支绝不是"把主线动作毫无变化地推迟一会再发生"；
   - 必须演展出符合当下题材与人物动机的实质性戏剧新波折或策略变化（例如：心理博弈代价、关系信任波动、时间窗口收窄、部分情报暴露、额外付出成本等），让分流选项有存在价值。

3. 【因果守恒、Stop-Before-Line-One 防重播与忠实前提律（严禁吃书、严禁抢演与篡改选项）】：
   - **可逆 vs 不可逆分流铁律**：
     * 只要分支行动造成了**不可逆变化**（例如：核心关系彻底决裂、角色离场或遭受不可掩饰的重创、唯一关键信物损毁/易主、彻底放弃核心行动，或已构成与下游主干首屏开头气氛/认知截然相反的结局态），**严禁强行 \`REJOIN\`**，必须果断收敛为 \`ENDING\`（\`BE\`/\`NE\`/\`SE\`）；
     * 只有当波折处于**可逆范围内**，且分支结尾能够自然把人物站位、物品归属、表面状态与未知信息边界精确收拢在"合流目标片段开头前情"即将发生的前一拍时，才允许选择 \`REJOIN\`；
   - **Stop-Before-Line-One（严禁抢演目标片段首句）**：提示中附带的"目标片段开头画面与前情"属于**下一段视频才会播放的第一帧动作与第一句台词**！若选择 \`REJOIN\`，本支线正文结尾必须急刹车在它**即将发生之前的一秒**，**严禁把目标片段的第一句台词或起手动作提前在本支线末尾先演一遍、造成连播复读穿帮**；
   - **忠实选项字面前提**：严禁为了凑 \`REJOIN\` 而私自改写 \`choiceText\` 中明确写定的时间、地点或行动方式，若前提冲突请直接走 \`ENDING\`；
   - **严禁吃书反转**：支线推演严禁推翻或篡改前序主干已确立的客观设定（如关键物件原本的真实来源、角色既定前史与知情范围），一切冲突必须从既有事实逻辑生长出来。

4. 【打破全员无痛合流与分流均衡意识】：
   - 互动影游的核心魅力在于分支真正改变命运走向，**绝不允许全剧大部分分支全部无痛 \`REJOIN\` 同一条主干**；
   - 请参考已推演统计：当全剧已连续产生 \`>= 2\` 条 \`REJOIN\` 且当前支线行动具备明显分水岭或成本代价时，优先将其收束为有份量的阶段性 \`ENDING\`（无论激烈危机 \`BE\`、遗憾告别 \`NE\` 还是暗线真相 \`SE\` 均可），避免前段剧情只绕圈不结果！

5. 【严格收敛归宿（二选一）】：
   - **归宿 A【殊途同归 · 绕回主线 (REJOIN)】**：
     * 从给定的【下游已就绪合法节点清单】中挑选一个目标片段；
     * 明确描述以何种代价/状态（如：双手烧伤但保住了铁盒），无缝接回该主干片段；
     * 必须满足因果守恒，不得破坏目标片段的前置依赖。
   - **归宿 B【独立终局 (ENDING)】刚性闭环交付铁律**：
     * 严禁"掏出武器/机关响声/气氛紧张"就打上 ENDING 标签强行黑屏！这不是终局，这是逃避！
     * 三类结局必须演完完整闭环戏份（篇幅不低于 350 字）：
       - **BE（惨败/身死/覆灭）**：
         必须把惨烈结局完整演出——主角被击倒、机关崩塌被埋、或身份败露遭制服的真实下场；
         必须交代行凶者的收场与现场的视听意象（如雨声、黑暗、血腥气味）；
         最后给出一句令人窒息的命运判词，以悲怆的视听余韵落幕。
       - **NE（遗憾/脱身/残缺）**：
         必须写明主角最终选择放弃、妥协或逃离后真实的生存境遇；
         必须写出真相永被掩埋、主角背负遗憾离场的视听意象；
         命运判词充满苍凉，不悲壮，只余憾。
       - **SE（隐秘反转/黑暗共谋/暗线揭晓）**：
         必须把这条暗线的「隐藏真相」彻底挑明（如与反派达成秘密交易、发现了主线未曾揭示的第二重底牌）；
         必须写出主角带着这个秘密做出的最终抉择（如携款离去、或选择沉默守护秘密）；
         给玩家真正有价值的叙事奖励，而非廉价的悬念中断。
     * 包含结局类型（BE/NE/SE）、结局名称、深刻的命运判词、以及时光倒流锚点（如返回做出抉择的前一刻）。

6. 【顶级影视文学质感】：
   - 保持与主干剧本同等的纯中文高水准视听笔触，写出令人窒息的冲突对白、心理战栗与镜头特写。`;
}

export function buildSingleBranchUserPrompt(input: {
  cutId: string;
  sourceClipId: string;
  level: number;
  choiceText: string;
  conflictSummary?: string;
  sceneContext: string;
  availableResolvedTargets: Array<{
    clipId: string;
    title: string;
    level: number;
    openingPreview?: string;
  }>;
  branchStats?: { rejoinCount: number; endingCount: number; totalCuts: number };
}): string {
  const targetListStr = input.availableResolvedTargets.length > 0
    ? input.availableResolvedTargets
        .map(
          (t) =>
            `- [片段标识: ${t.clipId}] (层级 ${t.level})《${t.title}》${
              t.openingPreview
                ? `\n  ↳ 下一幕首帧与开头台词（⚠️ 严禁在本支线结尾抢演或复读，须停在它即将发生前一秒）："${t.openingPreview}..."`
                : ''
            }`
        )
        .join('\n')
    : '无（当前切口已处于全剧最高层级，只能走向终局）';

  const statsLine = input.branchStats
    ? `\n【全剧分支分布现状】：全剧共 ${input.branchStats.totalCuts} 处切口，目前已生成 REJOIN ${input.branchStats.rejoinCount} 条、ENDING ${input.branchStats.endingCount} 条（若 REJOIN 已 >= 2 且本切口可独立成局，请优先考虑收束 ENDING 保持分流张力）。`
    : '';

  return `请针对以下【单一分支切口】，充分发挥文学创造力，推演创作一段高张力支线剧本：

【发源片段与前情】：
- 发源片段标识：${input.sourceClipId} (拓扑层级 n = ${input.level})
- 本幕文学前情：
${input.sceneContext}

【玩家做出的分支动作（切口）】：
- 选项文本：${input.choiceText}
- 核心戏剧冲突：${input.conflictSummary || '立场与选择的冲突'}${statsLine}

【下游已确立的合法主干合流节点清单（若选择 REJOIN，必须确保支线末尾恰停在其首句之前且不违背选项字面时间/设定；接不顺则直接走 ENDING）】：
${targetListStr}

---

【输出规范指引】
请输出符合规范的 JSON 结构，字段如下：
- branchTitle: 分支标题
- narrativeText: 篇幅饱满的支线文学正文（立足当下剧情现场，严禁多年后快进，冲突充分展开，结尾自然停顿；若为 ENDING 则必须演完完整结局戏份，篇幅不低于 350 字）
- resolutionType: "ENDING" 或 "REJOIN"
- targetClipId: (若为 REJOIN) 选中的目标片段标识
- rejoinConsequence: (若为 REJOIN) 描述付出的代价与无缝承接的因果状态
- endingType: (若为 ENDING) "BE", "NE" 或 "SE"
- endingTitle: (若为 ENDING) 结局名称
- verdict: (若为 ENDING) 一句话深刻命运判词
- rewindTargetClipId: (若为 ENDING) 时光倒流返回的片段标识（通常为 ${input.sourceClipId})`;
}
