/**
 * tools/film-production/shooting-script-tool/modifier/prompt.ts
 * 导演视听演绎剧本微调提示词 (Shooting Script Modifier Prompt SSOT)
 */

export function buildShootingScriptModifyPrompt(params: {
  clipId: string;
  clipTitle: string;
  existingEnvironmentLock: any;
  existingActionBeats: Array<{
    beatId: string;
    beatTitle: string;
    actionDescription: string;
    cinematicIntent: string;
    characterIds?: string[];
    itemIds?: string[];
    dialogue?: string;
    audioAmbience?: string;
    estimatedSeconds?: number;
  }>;
  instruction: string;
  targetBeatId?: string;
}): string {
  const { clipId, clipTitle, existingEnvironmentLock, existingActionBeats, instruction, targetBeatId } = params;

  return `你是一名国际顶级电影摄影指导兼执行导演（Executive Director & Cinematographer）。
创作者对分幕【${clipId} · ${clipTitle}】现有的【视听演绎剧本】提出了定向修改指令。请根据指令对手术式修改并输出更新后的完整演绎剧本：

【⭐ 当前已有场景时空与光影环境锁】：
- 时段: ${existingEnvironmentLock?.timeOfDay || '未指定'}
- 天气环境: ${existingEnvironmentLock?.weatherDirective?.label || ''} (${existingEnvironmentLock?.weatherDirective?.instruction || ''})
- 影调光照: ${existingEnvironmentLock?.lightingDirective?.label || ''} (${existingEnvironmentLock?.lightingDirective?.instruction || ''})
${existingEnvironmentLock?.colorTone ? `- 色彩倾向: ${existingEnvironmentLock.colorTone.label} (${existingEnvironmentLock.colorTone.instruction})` : ''}

【🎬 当前已有纯物理动作流序列】：
${existingActionBeats
  .map(
    (b, idx) =>
      `${idx + 1}. [${b.beatId} · ${b.beatTitle}] (预估 ${b.estimatedSeconds || 3}s):
   - 物理动作详述: ${b.actionDescription}
   - 建议视听机位: ${b.cinematicIntent}
   - 角色对白/同期声: ${b.dialogue || '无'}
   - 动作与环境拟音: ${b.audioAmbience || '无'}
   - 入画角色: ${b.characterIds?.join(', ') || '无'} | 涉及道具: ${b.itemIds?.join(', ') || '无'}`
  )
  .join('\n')}

${targetBeatId ? `【聚焦修改目标节拍】：${targetBeatId}\n` : ''}
【创作者导演修改指令】：
\`\`\`
${instruction}
\`\`\`

【微调执行规范】：
1. 【精准定向响应】：若指令涉及修改天气/光影（如改成雨夜、清晨），精准更新 environmentLock；若涉及修改某个走位/手势动作或对白，精准更新对应的 actionBeat；
2. 【锁死保留未受影响内容】：未被指令要求修改的天气、对白、动作节拍必须原样保留，严禁擅自推倒无关内容！
3. 【坚守纯物理表演与戏剧对白】：保持动作描述纯粹为物理表演（走位、视线、肢体手势与道具交互），并确保角色对白不丢失；
4. 【维持道具物理连续性】：确保关键随身道具在各节拍间的持有、取出、放置逻辑严丝合缝，严禁道具突兀凭空显形（Pop-in）；
5. 输出符合 ShootingScriptOutputSchema 规范的 JSON 数据。`;
}
