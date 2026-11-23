/**
 * tools/film-production/storyboard-breakdown-tool/steps/01-breakdown/prompt.ts
 * 单幕分镜剧本拆分提示词 (Storyboard Breakdown Prompt SSOT)
 */

export function buildStoryboardBreakdownPrompt(params: {
  clipId: string;
  clipTitle: string;
  narrativeText: string;
  characters?: Array<{ characterId: string; name: string }>;
  locations?: Array<{ locationId: string; name: string }>;
  items?: Array<{ itemId: string; name: string }>;
  instruction?: string;
  storyOverview?: string;
  previousClipSummary?: string;
  nextClipSummary?: string;
}): string {
  if (!params.narrativeText.trim()) throw new Error('分镜生成需要非空剧情正文');

  const {
    clipId,
    clipTitle,
    narrativeText,
    characters = [],
    locations = [],
    items = [],
    instruction,
    storyOverview,
    previousClipSummary,
    nextClipSummary,
  } = params;

  return `你是一名享誉国际的专业电影分镜大师与执行导演（Storyboard Director）。
现在请为分幕【${clipId} · ${clipTitle}】进行文学分镜切分与戏剧台本规划：

${storyOverview ? `【全剧核心背景与戏剧弧光】：\n${storyOverview}\n` : ''}
${previousClipSummary ? `【前序剧情承接（前幕因果）】：\n${previousClipSummary}\n` : '【前序剧情承接】：前序信息未知，不得推断为全剧开篇\n'}
【本幕剧情内容】：
\`\`\`markdown
${narrativeText}
\`\`\`
${nextClipSummary ? `【后续剧情预期（后幕走向）】：\n${nextClipSummary}\n` : ''}

【全剧可用角色】：
${characters.map((c) => `- ${c.name} (ID: ${c.characterId})`).join('\n') || '无预设角色'}

【全剧可用场景】：
${locations.map((l) => `- ${l.name} (ID: ${l.locationId})`).join('\n') || '无预设场景'}

【全剧可用核心道具】：
${items.map((it) => `- ${it.name} (ID: ${it.itemId})`).join('\n') || '无预设道具'}

${instruction ? `【创作者导演要求】：\n${instruction}\n` : ''}

【分镜切分规划规范】：
1. 【戏剧节拍驱动】：根据信息释放与戏剧冲突合理切分镜头（一般一幕规划 4~8 个镜头），镜与镜之间具备清晰的景别亲密度呼吸感（远景定场 ➔ 中景交流 ➔ 特写情绪 ➔ 反应正反打）；
2. 【前后因果接戏】：依据当前正文与剧情图的候选前后路径设计接戏；互斥分支的伤情、情绪和道具不能合并。正文未确认的状态保持未知，后续候选不等于必然发生；
3. 【文学台本纯净性】：
   - 填写镜头叙事核心 (sceneSubject 必须描摹具备物理起止时序的动作因果，如“[主角姓名]单手持握[随身道具]向前迈步并在[核心地标]前停步、做出[即时戒备/交互动作]”，为视频动量提供时序闭环)、景别机位 (cameraDirective 明确相对于场景地标的空间观察视点，如“机位置于[主要通路]面向[核心地标]低角度仰拍”、“掩体窥视视点 POV”、“[核心地标]旁过肩向[主入口]反打”等)、角色台词 (dialogue)、拟音与配乐 (audioPrompt)；
   - 严禁在此生成大段详细生图词与运镜参数（后续由专用提示词工具承接）；
4. 【结构化元数据与道具图谱】：
   - 在 characterIds 中关联入画人物的真实 characterId；
   - 若剧情涉及手持、携带或交互的重要道具（如武器、提箱、书信），务必在 itemIds 中关联真实 itemId。
5. 【地理空间动线与 180° 轴线连续性（刚性空间几何规则）】：
   - 相邻镜头的摄影机机位视点转移必须严格遵循场景真实三维空间方位，严禁出现空间错位；
   - 跨场景空间位移（如从室内纸扎铺到室外古镇街巷）必须设计空间动线过渡（如纸人跨出门槛 ➔ 纸人背影步入街巷 ➔ 主角跟出探头），严禁无因果空间断崖瞬移；
   - 严格遵守 180° 视线轴线法则（Eye-line Match），交互角色的视线与身体朝向必须严格呼应，严禁同向跳轴。
6. 输出符合 StoryboardBreakdownOutputSchema 的 JSON。`;
}
