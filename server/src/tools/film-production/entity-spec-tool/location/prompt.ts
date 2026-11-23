/**
 * tools/film-production/entity-spec-tool/location/prompt.ts
 * 场景空间与美术置景规格推演提示词体系 (Location Spec Prompt SSOT)
 */

export function buildLocationSpecPrompt(params: {
  name: string;
  roleOrBrief?: string;
  instruction?: string;
  storyMarkdown: string;
  prd?: any;
  artStyle?: string;
  existingSpec?: any;
  knownCharacters?: string[];
  knownItems?: string[];
}): string {
  const { name, roleOrBrief, instruction, storyMarkdown, prd, artStyle, existingSpec, knownCharacters, knownItems } = params;

  const charactersExcludeText = knownCharacters && knownCharacters.length > 0
    ? `全剧已声明角色清单（场景空间绝对互斥）：${knownCharacters.join('、')}\n`
    : '';
  const itemsExcludeText = knownItems && knownItems.length > 0
    ? `全剧已声明独立道具清单（案几台面绝对互斥）：${knownItems.join('、')}\n`
    : '';

  return `你是一名享誉国际的顶级电影美术总监与置景大师（Production Designer）。
请聚焦于全剧中指定的唯一目标场景，结合剧本中该场景的戏剧冲突、空间方位、世界观与创作者意见，推演其专业级视觉置景规格（Location Lookdev Spec）：

目标场景：${name}
${roleOrBrief ? `空间定位：${roleOrBrief}\n` : ''}${artStyle ? `全剧艺术风格：${artStyle}\n` : ''}${charactersExcludeText}${itemsExcludeText}创作者指导意见：
${instruction || '请结合剧本世界观与场景定位，精细化推演其空间进深透视、核心地标置景、物理材质肌理与主导冷暖光影'}

${existingSpec ? `既有视觉设定参考：\n\`\`\`json\n${JSON.stringify(existingSpec, null, 2)}\n\`\`\`\n` : ''}剧本上下文参考：
\`\`\`markdown
${storyMarkdown || '参照剧本世界观'}
\`\`\`
${prd ? `策划案大纲参考：\n\`\`\`json\n${JSON.stringify(prd, null, 2)}\n\`\`\`\n` : ''}
执行规范与字段正交解耦公理（生图词与空间蓝图绝对分离，零硬编码）：
1. promptZh（场景空镜概念生图词 · 专供场景定妆出图 · 严格 100~130 汉字）：
   - 一整段纯中文正向可见描述，材质、色彩与光影服从创作者和项目艺术风格，不强制实拍质感；
   - ⚠️【绝对刚性禁令 · 严禁空间坐标与方位结构】：
     * 100% 绝对严禁包含“面向某物时左侧是.../右侧是.../后方是...”、“以某物为空间原点”等空间几何结构描述！此类空间拓扑坐标 100% 由下方的 spatialLayout 专职负责，绝不在生图词中冗余重复！
     * 100% 绝对严禁使用“东南西北/自南向北”等虚假罗盘词汇；
     * 100% 绝对严禁输出任何结构小标题或标号；
   - 描写范式：建筑开间格局与进深透视 -> 核心焦点视觉地标与置景陈设 -> PBR 真实物理材质（老木开裂、夯土斑驳、纸帛纤维漫反射、石板青苔） -> 主导冷暖光影视听氛围（如冷月光与烛火昏黄对撞，阴翳层次深沉）；
   - 纯空间无生物实体（零角色、零人体、零动物、零背影），案几台面整洁中立（零手持道具、零武器）；
2. spatialLayout（三维空间构造蓝图 · 纯文本单字段 · 专供下游分镜镜头拍摄调度，100~150 汉字）：
   - 必须以场景内核心视觉地标为三维空间原点，连贯交代正对地标的入口通路、面向地标时的左右翼立面、顶空挑高与进深；
   - 本字段与 promptZh 一起用于场景定妆生图，并供后续分镜调度；地标和入口关系需一致，promptZh 不重复整段蓝图；
3. atmosphere：场景空间氛围意境提炼（10~25字）；
4. appearanceSummary：场景物理外观极简概括（20~40字）；
5. 输出严格符合 LocationSpecSchema 的 JSON。`;
}

export function buildLocationSpecModifyPrompt(params: {
  name: string;
  existingSpec: any;
  instruction: string;
  artStyle?: string;
  storyMarkdown?: string;
  knownCharacters?: string[];
  knownItems?: string[];
}): string {
  const { name, existingSpec, instruction, artStyle, storyMarkdown, knownCharacters, knownItems } = params;

  const charactersExcludeText = knownCharacters && knownCharacters.length > 0
    ? `全剧已声明角色清单（场景空间互斥）：${knownCharacters.join('、')}\n`
    : '';
  const itemsExcludeText = knownItems && knownItems.length > 0
    ? `全剧已声明独立道具清单（案几台面互斥）：${knownItems.join('、')}\n`
    : '';

  return `你是一名享誉国际的顶级电影美术总监与置景大师（Production Designer）。
创作者对既有的场景【${name}】视觉设定提出了定向微调意见，请在严格保留原有空间核心特征的前提下进行增量融合优化：

目标场景：${name}
${artStyle ? `视觉风格：${artStyle}\n` : ''}${charactersExcludeText}${itemsExcludeText}既有场景视觉设定（基准底稿）：
\`\`\`json
${JSON.stringify(existingSpec || {}, null, 2)}
\`\`\`

创作者微调意见：
${instruction}

${storyMarkdown ? `剧本上下文参考：\n\`\`\`markdown\n${storyMarkdown}\n\`\`\`\n` : ''}
修改铁律：
1. 增量继承：未提及的核心建筑特征与空间关系必须无损保留；
2. promptZh（100~130 汉字）：纯正面置景材质与光影，严禁包含任何“面向某物时左侧/右侧/后方/原点”等空间结构句式，严禁罗盘方位词与小标题；
3. spatialLayout（100~150 汉字）：专职维持三维空间相对拓扑蓝图，供下游分镜调度；
4. 输出严格符合 LocationSpecSchema 的 JSON。`;
}
