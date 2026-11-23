/**
 * tools/film-production/entity-spec-tool/item/prompt.ts
 * 道具材质与特写视觉规格推演提示词体系 (Item Spec Prompt SSOT)
 */

export function buildItemSpecPrompt(params: {
  name: string;
  roleOrBrief?: string;
  instruction?: string;
  storyMarkdown: string;
  prd?: any;
  artStyle?: string;
  existingSpec?: any;
  knownCharacters?: string[];
}): string {
  const { name, roleOrBrief, instruction, storyMarkdown, prd, artStyle, existingSpec, knownCharacters } = params;

  const charactersExcludeText = knownCharacters && knownCharacters.length > 0
    ? `全剧已声明角色清单（道具单体互斥）：${knownCharacters.join('、')}\n`
    : '';

  return `你是一名享誉国际的顶级电影道具设计师与概念模型师（Prop Designer）。
请聚焦于全剧中指定的唯一目标道具，结合剧本中该道具的线索功能、材质工艺、世界观与创作者意见，推演其专业级实物视觉规格（Item Lookdev Spec）：

目标道具：${name}
${roleOrBrief ? `道具定位：${roleOrBrief}\n` : ''}${artStyle ? `全剧艺术风格：${artStyle}\n` : ''}${charactersExcludeText}创作者指导意见：
${instruction || '请结合剧本世界观与道具定位，精细化推演其几何形制、材质工艺、自然使用磨损与包浆质感'}

${existingSpec ? `既有视觉设定参考：\n\`\`\`json\n${JSON.stringify(existingSpec, null, 2)}\n\`\`\`\n` : ''}剧本上下文参考：
\`\`\`markdown
${storyMarkdown || '参照剧本世界观'}
\`\`\`
${prd ? `策划案大纲参考：\n\`\`\`json\n${JSON.stringify(prd, null, 2)}\n\`\`\`\n` : ''}
执行规范与正交解耦公理（实物本体与下游棚拍外壳绝对分离，零硬编码）：
1. 资产层职责单一性原则：本资产是全剧道具母本。只记录实物本身的物理长相与岁月包浆，严禁越权包含下游棚拍外壳（严禁包含居中陈列、中性影调、摄影棚背景、无手部无背景、无反光等词眼）。居中特写与三点静物棚拍由下游渲染工序专职负责；
2. promptZh 输出铁律（严格 60~100 汉字）：
   - 一整段纯中文纯正面物理描述，直击真实物理质感；
   - 严禁输出任何结构小标题或标号（严禁输出“几何形制：”、“材质：”等字眼）；
   - 描写顺序：实物几何构型与比例尺寸 -> 专属物理材质与手工加工工艺纹理（如手工构皮纸米糊粘接、素银锤揲、老竹纤维） -> 岁月自然使用痕迹、氧化包浆、边缘磕碰磨平与细微开裂；
3. appearanceSummary：道具形态与材质速览（15~35字）；
4. description：道具在剧作中的核心线索功能与作用；
5. 输出严格符合 ItemSpecSchema 的 JSON。`;
}

export function buildItemSpecModifyPrompt(params: {
  name: string;
  existingSpec: any;
  instruction: string;
  artStyle?: string;
  storyMarkdown?: string;
  knownCharacters?: string[];
}): string {
  const { name, existingSpec, instruction, artStyle, storyMarkdown, knownCharacters } = params;

  const charactersExcludeText = knownCharacters && knownCharacters.length > 0
    ? `全剧已声明角色清单（道具单体互斥）：${knownCharacters.join('、')}\n`
    : '';

  return `你是一名享誉国际的顶级电影道具设计师与概念模型师（Prop Designer）。
创作者对既有的道具【${name}】视觉设定提出了定向微调意见，请在严格保留原有物理材质与形态特征的前提下进行增量融合优化：

目标道具：${name}
${artStyle ? `视觉风格：${artStyle}\n` : ''}${charactersExcludeText}既有道具视觉设定（基准底稿）：
\`\`\`json
${JSON.stringify(existingSpec || {}, null, 2)}
\`\`\`

创作者微调意见：
${instruction}

${storyMarkdown ? `剧本上下文参考：\n\`\`\`markdown\n${storyMarkdown}\n\`\`\`\n` : ''}
修改铁律：
1. 增量继承：未提及的核心物理形制与材质特征必须无损保留；
2. promptZh（严格 60~100 汉字）：纯正面实物物理描述，只描写几何构型、专属材质与包浆痕迹，严禁输出任何结构小标题或标号，严禁包含居中陈列、中性影调、静物棚拍等下游渲染外壳；
3. 输出严格符合 ItemSpecSchema 的 JSON。`;
}
