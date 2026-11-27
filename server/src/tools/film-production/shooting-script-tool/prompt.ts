/**
 * tools/film-production/shooting-script-tool/prompt.ts
 * 导演工业级视听摄制台本生成提示词 (Shooting Script Generator Prompt SSOT)
 *
 * 职责分工边界 (Separation of Concerns)：
 * 1. 本提示词专职约束【剧情片段拆分工具】的段落切分、输入资产绑定与道具物理状态连续性；
 * 2. 微观镜头机位、景别与多机位时间轴留待下游视频提示词生成阶段处理，本阶段保持纯净事件分段。
 */

export function buildShootingScriptPrompt(params: {
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
  if (!params.narrativeText.trim()) throw new Error('摄制台本生成需要非空剧情正文');

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

  return `你是一名国际顶级电影摄影指导兼执行总导演（Executive Director & Director of Photography）。
你现在正在工序 2【分镜台本制作工坊】中，专职负责将分幕【${clipId} · ${clipTitle}】的故事剧本升级为【工业级视听摄制台本（Shooting Script）】。

${storyOverview ? `【全剧核心背景与戏剧基调】：\n${storyOverview}\n` : ''}
${previousClipSummary ? `【前序剧情承接（前幕因果）】：\n${previousClipSummary}\n` : '【前序剧情承接】：前序信息未知，按独立入场处理\n'}
【本幕文学剧情内容】：
\`\`\`markdown
${narrativeText}
\`\`\`
${nextClipSummary ? `【后续剧情预期（后幕走向）】：\n${nextClipSummary}\n` : ''}

【法定资产库标准清单（必须严格使用标准 ID 与规范名称，杜绝私自捏造）】：
- 登场角色库:
${characters.map((c) => `  * [${c.characterId}] ${c.name}`).join('\n') || '  暂无预设角色'}
- 场景空间库:
${locations.map((l) => `  * [${l.locationId}] ${l.name}`).join('\n') || '  暂无预设场景'}
- 核心道具库:
${items.map((it) => `  * [${it.itemId}] ${it.name}`).join('\n') || '  暂无预设道具'}

${instruction ? `【创作者导演要求】：\n${instruction}\n` : ''}

【工业级分镜摄制台本核心架构规范】：
1. 【场景时空与光影环境锁 (Scene Environment Lock)】：
   - 提取并锁定本幕统一的时空基准，全幕所有镜头必须严格共享同一环境锁；
   - timeOfDay: 统一时段（如 "夜"、"午夜"、"破晓"、"正午"）；
   - weatherDirective: 天气物理现象与环境质感；
   - lightingDirective: 影调与光照物理硬约束（主光源方向、光比反差、冷暖色调）；
   - colorTone: 整体影调色彩倾向。

2. 【剧情片段拆分原则（按事件分段，不写琐碎分镜）】：
   - 【按完整戏剧事件/空间切换分段】：
     * 将本幕按完整事件或空间转换拆分为 **3~6 个连续剧情片段**，每段 \`estimatedSeconds\` 控制在 **6~15 秒**（只有独立短转场才用 3~5 秒）；
     * **同一场连贯对话或连续动作保留在同一个片段内**，不因换人说话或微动作而碎切；
   - 【场景归属与位置锚定 (locationId & location)】：
     * 每个 actionBeat 必须明确输出 locationId（使用上方场景清单中的真实 ID，如 "loc_xxx"）与 location（场景中文名称）；
   - 【⭐ 时空单向因果递进与登场时序铁律】：
     * 片段推进必须严格遵循文学正文的单向因果时序！后续才推门进入的角色，严禁在第 1 片段开头提前站在屋里剧透；
   - 【专业电影文学语言与法定标准名称】：
     * 出场角色、场景与核心道具在 actionDescription 中必须**一字不差**地使用上方清单中的法定标准全名，严禁对场景名称做简称、缩写或同义改写（否则前端高亮与下游参考图均会失配），专注客观可视的物理表演与场面调度；

3. 【每段要素规范】：
   - 【locationId】、【location】、【space】：所属场景资产 ID 与名称；
   - 【beatTitle】：片段标识，格式如：“片段 01（灵堂异响）”；
   - 【画面与声画正文 (actionDescription)】：**将物理动作、角色对白（如 \`[角色]：“台词”\`）与关键拟音/声景（如 \`（脚步声渐近、铜铃轻响）\`）按真实时间顺序统一写进同一段 \`actionDescription\` 正文里**，保持声画时间咬合，无需再拆成孤立的对白与拟音清单，也无需编写微观机位、景别或焦段参数；

4. 【实体依赖绑定】：
   - 每个 beat 准确关联入画角色 characterIds 与交互道具 itemIds。

5. 【道具连续性与物理携带状态机 (Prop Continuity & Possession State)】：
   - 【⭐ 核心信物与常驻道具首镜前置交代铁律 (Prop Early Establishment Law)】：
     * 凡剧本中角色常驻随身携带、佩挂或怀抱的核心道具（如随身常抱的玩偶/信物、盲杖、佩剑/配枪、公文包、手提箱等），在角色首次登场的镜头（特别是第 01 镜空间全景定场）中，必须在动作描述（actionDescription）中明确交代其手持/怀抱/佩戴姿态，并在 itemIds 中首次声明绑定！
     * 绝对禁止角色前几个镜头两手空空，后续特写或近景镜头才突兀凭空冒出道具（Pop-in）！
     * 场景关键陈设道具同理，定场镜头中必须交代其初始物理位置与空间关系，并同步绑定 itemIds。
   - 角色随身携带的关键道具遵循严格的时空物理因果与连续性：
     * 收纳状态 (Stowed)：若初始在背包或衣兜内，角色入场时两手自然行走；当镜头需要手持使用时，设计明确的物理递进动作，赋予道具戏剧仪式感；
     * 佩挂状态 (Equipped)：若随身携带，明确其佩戴方式（如斜挎挂于腰侧，行走时随步幅轻微晃动）；
     * 手持状态 (Held)：当人物手中握持道具时，其持握姿态与左右手保持与角色定妆规格及前后镜头连贯；
     * 场景放置 (Placed)：放置在桌面、案台或地面后，后续镜头保持环境静置状态；若角色需要再次使用，须有明确的拾起交互动作；
     * 【⭐ 道具连续性与防凭空蒸发 (Prop Anti-Vanish SSOT)】：角色已持有的关键道具（如武器、核心信物、工具、证件、容器），后续只要该角色在场，在未交代脱手、收纳或递出前，必须持续在 itemIds 中声明并在动作中交代其物理状态（持握中/别在腰间/揣入怀中/插回鞘内），绝对禁止上一镜手里拿着、下一镜毫无交代两手空空蒸发！

请输出符合 ShootingScriptOutputSchema 规范的 JSON 数据。`;
}
