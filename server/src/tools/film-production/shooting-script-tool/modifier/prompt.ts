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
2. 【锁定保留未受影响内容】：未被指令要求修改的天气、对白、动作节拍原样完整保留，实现手术式精准微调；
3. 【空间结构与纯净文学语言】：场景空间、机位方位与环境调度作为动作描述（actionDescription）的有机组成部分，首镜/转场结合定妆空间蓝图建立基准，场内镜头专注人物表演、走位与道具交互；室内场景遵循空间围合与地标吸附（相机架设于室内，主体锚定地标室内相对距离，门边角色位于门内侧边缘）；提及角色、场景与道具统一使用法定标准全名；
4. 【维持道具物理连续性与前置交代】：确保随身常驻道具与核心信物在角色出场镜头（尤其是定场全景）中提前交代，并在各节拍间保持严格的持有、取出、放置逻辑连贯，杜绝后续近景突然凭空冒出道具；
5. 【镜头功能与时长自适应】：修改节拍时长（estimatedSeconds 2~5s）时遵循剪辑规律：纯空间定场建议 2~3s，4~5s 长镜头必须承载明确的骨骼位移动作；
6. 输出符合 ShootingScriptOutputSchema 规范的 JSON 数据。`;
}
