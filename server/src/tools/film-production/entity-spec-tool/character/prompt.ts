/**
 * tools/film-production/entity-spec-tool/character/prompt.ts
 * 角色视觉造型与定妆规格推演提示词体系 (Character Spec Prompt SSOT)
 */

export function buildCharacterSpecPrompt(params: {
  name: string;
  roleOrBrief?: string;
  instruction?: string;
  storyMarkdown: string;
  prd?: any;
  artStyle?: string;
  existingSpec?: any;
  knownItems?: string[];
}): string {
  const { name, roleOrBrief, instruction, storyMarkdown, prd, artStyle, existingSpec, knownItems } = params;

  const itemsExcludeText = knownItems && knownItems.length > 0
    ? `全剧已声明独立道具清单（角色手部握持互斥）：${knownItems.join('、')}\n`
    : '';

  return `你是一名享誉国际的顶级影视概念造型与人物设定总监（Film Character Concept Designer）。
请聚焦于全剧中指定的唯一目标角色，结合剧本世界观与创作者意见，推演其专业级角色物理资产造型规格（Character Lookdev Spec）：

目标角色：${name}
${roleOrBrief ? `角色定位：${roleOrBrief}\n` : ''}${artStyle ? `视觉风格：${artStyle}\n` : ''}${itemsExcludeText}创作者指导意见：
${instruction || '请结合剧本世界观与人物定位，精细化推演其骨相五官、发型发色、标志性服装剪裁材质'}

${existingSpec ? `既有视觉设定参考：\n\`\`\`json\n${JSON.stringify(existingSpec, null, 2)}\n\`\`\`\n` : ''}剧本上下文参考：
\`\`\`markdown
${storyMarkdown || '参照剧本世界观'}
\`\`\`
${prd ? `策划案大纲参考：\n\`\`\`json\n${JSON.stringify(prd, null, 2)}\n\`\`\`\n` : ''}
核心执行规范（资产与渲染绝对正交解耦，零硬编码）：
1. 资产层职责单一性原则：本资产是全剧所有工序引用的角色母本。只记录角色客观物理本体（长相、身材、发型、服装、常驻佩饰），严禁越权包含下游任何特定动作姿态（严禁包含A-Pose、立姿、站立、坐姿）、严禁包含镜头机位、排版与背景。动作姿态与三视图排版由下游渲染工序专职负责；
2. promptZh 输出铁律（80~120 汉字）：
   - 必须是一整段连贯、高信噪比的纯中文纯正面物理描述；
   - 严禁输出任何结构小标题（如严禁输出“骨相：”、“服饰：”或任何带有【】/标号的字眼）；
   - 描写顺序：生理年龄与身材体格 -> 面部骨相五官与肤色特征 -> 发型发色 -> 标志性服装款式剪裁与真实面料材质（如粗棉布/亚麻/皮革的漫反射真实质感） -> 常驻穿戴佩饰（仅限静态佩戴，绝不手持任何外部道具）；
   - 保持常态母本纯净：严禁雨水湿发、伤口血污、环境彩色光污染等瞬时剧情状态，**严禁用“眼中映着火光/泛着光芒”等光影或文学修辞修饰眼瞳**；若存在单眼或面部生理特征，必须译为客观静态物理材质（如“左眼瞳孔灰白浑浊，右眼深色正常”）；
3. appearanceSummary：供创作者阅读的极简外貌概括（15~35字）；
4. voiceStyle：角色专属声色与说话风格（10~25字，如“低沉浑厚的老年男声，略带沧桑沙哑，语速沉稳缓慢”，专供视频台词配音保持一致，与画图用 promptZh 分离）；
5. identity：在剧作中的核心社会身份或角色定位；
6. 输出严格符合 CharacterSpecSchema 的 JSON。`;
}

export function buildCharacterSpecModifyPrompt(params: {
  name: string;
  existingSpec: any;
  instruction: string;
  artStyle?: string;
  storyMarkdown?: string;
  knownItems?: string[];
}): string {
  const { name, existingSpec, instruction, artStyle, storyMarkdown, knownItems } = params;

  const itemsExcludeText = knownItems && knownItems.length > 0
    ? `全剧已声明独立道具清单（角色手部握持互斥）：${knownItems.join('、')}\n`
    : '';

  return `你是一名享誉国际的顶级影视概念造型与人物设定总监（Film Character Concept Designer）。
创作者对既有的角色【${name}】视觉设定提出了定向微调意见，请在严格保留原有核心特征的前提下进行增量融合优化：

目标角色：${name}
${artStyle ? `视觉风格：${artStyle}\n` : ''}${itemsExcludeText}既有角色视觉设定（基准底稿）：
\`\`\`json
${JSON.stringify(existingSpec || {}, null, 2)}
\`\`\`

创作者微调意见：
${instruction}

${storyMarkdown ? `剧本上下文参考：\n\`\`\`markdown\n${storyMarkdown}\n\`\`\`\n` : ''}
修改铁律：
1. 增量继承：以既有设定为基准，仅根据创作者意见调整相关局部，未提及的核心骨相与服装特征必须无损保留；
2. promptZh 必须保持纯净资产特性（80~120 汉字）：纯正面物理描述，只描写外貌身材与服装面料，严禁输出任何结构小标题或标号，严禁包含动作姿态（严禁立姿、A-Pose）与下游排版；
3. 继承或按需微调 voiceStyle（声色与说话风格），不把声音描写写入 promptZh；
4. 输出严格符合 CharacterSpecSchema 的 JSON。`;
}
