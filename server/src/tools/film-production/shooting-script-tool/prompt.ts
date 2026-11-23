/**
 * tools/film-production/shooting-script-tool/prompt.ts
 * 导演摄制台本提示词 (Shooting Script Prompt SSOT)
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

  return `你是一名国际顶级电影摄影指导兼执行导演（Executive Director & Cinematographer）。
现在请为分幕【${clipId} · ${clipTitle}】制作一份高度专业、具备物理可执行性的【工业级镜头级导演视听摄制台本（Visual Shooting Script）】。

${storyOverview ? `【全剧核心背景与戏剧基调】：\n${storyOverview}\n` : ''}
${previousClipSummary ? `【前序剧情承接（前幕因果）】：\n${previousClipSummary}\n` : '【前序剧情承接】：前序信息未知，按独立入场处理\n'}
【本幕文学剧情内容】：
\`\`\`markdown
${narrativeText}
\`\`\`
${nextClipSummary ? `【后续剧情预期（后幕走向）】：\n${nextClipSummary}\n` : ''}

【本剧可用角色】：
${characters.map((c) => `- ${c.name} (ID: ${c.characterId})`).join('\n') || '无预设角色'}

【本剧可用场景】：
${locations.map((l) => `- ${l.name} (ID: ${l.locationId})`).join('\n') || '无预设场景'}

【本剧可用道具】：
${items.map((it) => `- ${it.name} (ID: ${it.itemId})`).join('\n') || '无预设道具'}

${instruction ? `【创作者导演要求】：\n${instruction}\n` : ''}

----------------------------------------------------------------------
【核心任务与输出规范（工业级电影分镜与视听摄制标准）】：

1. 【场景时空与光影环境锁 (Scene Environment Lock)】：
   - 必须从文学正文中精准捕捉时间与天气信息，生成本幕不可动摇的“环境锁”，防止下游生图模型丢失天气！
   - timeOfDay: 精确到时段（如：“黄昏 Dusk”、“入夜 Night”、“深夜 Deep Night”、“清晨 Dawn”等）；
   - weatherDirective: 天气与大气物理硬约束（提取文学正文中的风霜雨雪、薄雾雾气、阴湿干燥等物理特征，填入 label 与 instruction 生图提示词）；
   - lightingDirective: 影调与光照物理硬约束（主光源方向、反差比、冷暖色调、阴影形态，杜绝大白天平光）；
   - colorTone: 整体影调色彩倾向。

2. 【按空间场景划分与镜头级单任务切解法则 (Universal Cinematography Grammar)】：
   - 【空间段落清晰划分 (space)】：文学剧情中凡涉及物理空间转移或显著时间跨度推进，必须在 space 字段中明确标示（如“空间一：外景 · 地标前 · 黄昏”、“空间二：内景 · 室内 · 入夜”等）；
   - 【严禁粗暴段落合并！严禁单镜头动作超载！】：严禁将整场戏、多句对白、走位与道具交互揉在一个节拍中！每个 actionBeat 必须对应一个具体的【镜头摄制单元】（Single-task Shot Beat，时长 3~6 秒）：
     * 空间定场镜头：负责环境全貌建立与人物入画；
     * 动势走位镜头：负责人物在场景中的空间位移与动向（跟拍、横移、半弧形环绕）；
     * 线索与特写镜头：关键道具、环境细节、重要视觉线索的发现；
     * 【对手戏单句切分刚性法则 (One Dialogue Line = One Camera Setup)】：
       凡角色之间发生对话，【每一句台词必须独立成镜】！发问者用过肩或中景机位，回答者用反打中景或特写机位。**严禁把两句及以上往复对话合并在同一镜头中！严禁同一镜头内既有 A 说话又有 B 回复！**
     * 关键物理动作交互镜头：点火、操作开关、交接物品、服下药物等关键动作必须拥有独立的近景/特写镜头；
     * 突变与视听反应镜头：突发事件（异变、爆炸、异响、灯火熄灭等）必须采用“事件瞬间特写”+“人物生理微反应（僵直、瞳孔收缩、战栗等）”双镜切解！
   - 【严禁文学心理与抒情修辞】：禁止出现“他感到心中一阵发毛”、“思绪万千”等摄影机无法捕捉的文学形容；
   - 【专注纯粹物理表演与肢体细节】：走位步幅、视线方位、手势与道具具体物理交互细节。

3. 【电影切分解构通用范式参考（禁止粗暴合并）】：
   - 错误做法（整段合并）：
     ❌ 将“人物走入场景、停步说一句台词、走到桌后观察线索、说第二句台词、对方回答、点火动作、火苗异变”合并为一个大节拍。
   - 正确做法（单镜单任务分解）：
     ✓ 镜头 1（远景定场）：人物入场走位至关键地标停步；
     ✓ 镜头 2（中景过肩）：人物凝视前方，说出第一句台词（dialogue 绑定）；
     ✓ 镜头 3（中景跟拍）：人物移动绕至物体后侧蹲下；
     ✓ 镜头 4（微距特写）：视线聚焦在关键线索刻痕上，说出第二句台词（dialogue 绑定）；
     ✓ 镜头 5（全景内景定场）：新空间转换，建立人物站位与室内光影；
     ✓ 镜头 6（中景正反打）：角色 A 交代规则（dialogue 绑定）；
     ✓ 镜头 7（中景反打）：角色 B 追问（dialogue 绑定）；
     ✓ 镜头 8（近景特写）：角色 A 实施关键物理动作；
     ✓ 镜头 9（特写反应）：突发异变产生，角色 A 给出致命警告（dialogue 绑定）；
     ✓ 镜头 10（中景后退）：角色离场，木门虚掩；
     ✓ 镜头 11（全景静态）：独处启动核心道具；
     ✓ 镜头 12（长镜头推近）：窥视视角缓慢推近；
     ✓ 镜头 13（特写反应）：未知异响浮现，角色恐惧僵直；
     ✓ 镜头 14（特写急切全景）：核心光源异变自灭，急拉远景定格。

4. 【每镜四要素刚性规范】：
   - 【beatTitle】：必须采用清晰规范的镜头标识，格式如：“镜头 01（远景定场 · 动作焦点 · 5s）”；
   - 【画面 (actionDescription)】：纯物理动作与现场画面描摹（摄影机可视）；
   - 【💬 对白 (dialogue)】：100% 原汁原味保留文学剧本中的每一句角色台词、独白、画外音，并精准绑定到该镜头中发声的角色。无台词的纯动作镜头留空；
   - 【🔊 拟音 (audioAmbience)】：为每个镜头设计具体的物理拟音与环境声景（动作拟音 + 环境背景音）；
   - 【🎥 视听机位 (cinematicIntent)】：专业的摄影机位、景别与运镜设计。

5. 【实体依赖绑定】：
   - 每个 beat 必须准确关联入画角色 characterIds 与交互道具 itemIds。

6. 【道具连续性与物理携带状态机 (Prop Continuity & Possession State)】：
   - 严禁核心道具突兀凭空显形（Pop-in）！
   - 角色随身携带的关键道具必须遵循严格的时空物理因果：
     * 收纳状态 (Stowed)：若初始在背包或衣兜内，角色入场时两手自然行走；当镜头需要手持使用时，必须有明确的物理递进动作（如“停步侧身拉开背包拉链，伸手抽出一台旧录音机握在手中”），赋予道具戏剧仪式感；
     * 佩挂状态 (Equipped)：若随身携带，必须明确其佩戴方式（如斜挎挂于腰侧，行走时随步幅轻微晃动）；
     * 手持状态 (Held)：当人物手中握持道具时，其持握姿态与左右手必须与角色定妆规格保持严格一致，且前后镜头连贯；
     * 场景放置 (Placed)：放置在桌面、供桌或地面后，后续镜头不得突兀回到手中，除非有明确的再次拾起动作。

请输出符合 ShootingScriptOutputSchema 规范的 JSON 数据。`;
}
