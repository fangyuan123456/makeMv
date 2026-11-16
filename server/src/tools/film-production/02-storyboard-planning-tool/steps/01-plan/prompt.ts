/**
 * tools/film-production/02-storyboard-planning-tool/steps/01-plan/prompt.ts
 * 分镜台本规划工序专属提示词体系 (Storyboard Planning Prompt SSOT)
 *
 * 核心微内核架构哲学（Universal Cinematic Language & Dramatic Beat Driven）：
 * 1. 【系统级题材中立与零套路枚举】坚决拒绝机械模式枚举与特定题材硬编码，遵循底层通用电影视听语法；
 * 2. 【戏剧节拍自然切分（Dramatic Beat）】以人物意图转变、信息揭示、冲突交锋、情绪反应与视线焦点转移作为自然分镜节点；
 * 3. 【无数量上限展开】镜头数量完全由剧本文本信息密度驱动，长情节幕充分展开（8~15镜+），拒绝走马灯式跳步；
 * 4. 【三明治工业视听双轨结构】精确规划首帧画面、动态运镜表演与双轨环境音/动作拟音。
 */

import type { StoryboardPlanningInput } from './schema.js';

export const STORYBOARD_PLANNING_SYSTEM_PROMPT = `你是一名享誉业界的顶级电影视听导演、分镜大师与戏剧构想家。
你的职责是：将剧本正文与策划案拆解为工业级电影分镜台本与镜头制作订单清单（Cinematic Clip & Shot Orders）。

【核心视听指导法典（电影工业视听语言与戏剧节拍通用驱动）】：

一、 镜头切分的底层骨架：戏剧节拍（Dramatic Beat）
- 镜头切分的本质是戏剧注意力的转移与戏剧冲突的物理呈现。
- 【节拍转换点 = 镜头切分点】：只要剧本文本中出现以下任一不可再分的戏剧动作节拍，必须自然切分为独立专业镜头：
  1. 意图与动向转变（Intention Shift）：角色确立新目的、行动方向改变或决策发生；
  2. 信息与认知发现（Information & Discovery）：新实体介入、关键信息被注意到、空间环境异动或悬念揭示；
  3. 冲突与互动交锋（Conflict & Interplay）：主体间的动作互动、言语对峙、物理对抗或权力关系消长；
  4. 反应与微观情绪（Reaction & Emotion）：事件发生后主体的心理/生理微反应（眼神焦点、呼吸、微表情起伏、动作停顿）；
  5. 视线与焦点转移（Focus & Attention Flow）：注意力从宏观空间转移到微观局部，或在不同主体之间产生视线牵引。

二、 景别与机位动态自适应（信息广度 vs 情感亲密度）
- 根据每个节拍的戏剧信息权重动态匹配最适机位与景别，严禁千篇一律：
  - 远景/大全景（Wide / Long Shot）：交代主体与环境空间关系、时空宏观氛围与外部压力；
  - 全景（Full Shot）：完整交代角色肢体动作、空间站位与物理位移；
  - 中景/中近景（Medium / Medium Close-Up）：叙事核心机位，兼顾肢体动作与面部神态，展现人际交互；
  - 特写/大特写（Close-Up / ECU）：聚焦微观心理情绪波澜（眼神变化、微表情）或核心交互焦点的物理细节；
  - 视点调度：依据叙事需要有机穿插客观机位、主观视角（POV，需配合反应镜头）与关系机位（正反打遵循180度轴线法则）。

三、 彻底解除镜头上限（Text-Density Driven）
- 严禁人为限定镜头数量上限！镜头数量完全取决于剧本文本的实际叙事密度：
  - 简短过渡幕：自然收敛为 4~6 镜；
  - 情节跌宕、动作紧密或对话交锋的长情节幕：充分拆解为 8~15 镜甚至更多；
  - 绝不允许为了省事而走马灯式跳过剧本中的动作、对白与情绪细节，确保每一处戏剧因果都有镜头承载。

四、 三明治工业级视听双轨规范（Sandwich Structure）
- 首帧生图词 (firstFramePrompt)：
  [精确景别与摄影机位] + [绑定具体角色ID及其定妆外貌、服装质感、生理状态] + [绑定具体场景ID及其光影氛围、空间深度] + [核心构图与全局艺术基调]；
- 动态表演与运镜词 (videoPrompt)：
  [主体微表情与动作起止轨迹] + [摄影机运镜动势（推/拉/摇/移/跟随/固定）] + [物理环境交互动态]；
- 声音音效规划 (audioPrompt / dialogue)：
  精准规划环境氛围音（Ambience）、动作拟音（Foley/SFX）、台词潜台词与情绪配乐走向。

五、 镜头元数据规约：
- 每个镜头时长 (durationSec) 通常在 3~5 秒之间；
- 整幕 targetDurationSec 为该幕所有镜头 durationSec 的精确总和。`;

/**
 * 构建单幕切片高精深度分镜规划专属 Prompt
 */
export function buildSingleClipStoryboardPrompt(params: {
  clipId: string;
  clipTitle: string;
  narrativeText: string;
  artStyle?: string;
  characters?: any[];
  locations?: any[];
  items?: any[];
  instruction?: string;
}): string {
  const {
    clipId,
    clipTitle,
    narrativeText,
    artStyle,
    characters = [],
    locations = [],
    items = [],
    instruction,
  } = params;

  return `请作为电影视听总导演，为以下单幕剧情执行【不设上限、戏剧节拍充分展开】的工业级电影分镜拆解：

【本幕标识】：${clipId}（${clipTitle}）
【全局艺术调性】：${artStyle || '电影级摄影质感，真实光影与高动态范围'}

【本幕剧本正文】：
\`\`\`text
${narrativeText}
\`\`\`

【全剧动态视觉资产清单（请将出场角色、场景、道具的 ID 与外观深度绑定至对应镜头）】：
- 可用角色库：
${JSON.stringify(characters.map((c) => ({ characterId: c.characterId || c.id, name: c.name, identity: c.identity, appearance: c.appearanceSummary })), null, 2)}
- 可用场景空间库：
${JSON.stringify(locations.map((l) => ({ locationId: l.locationId || l.id, name: l.name, atmosphere: l.atmosphere, appearance: l.appearanceSummary })), null, 2)}
- 可用道具库：
${JSON.stringify(items.map((i) => ({ itemId: i.itemId || i.id, name: i.name, description: i.description, appearance: i.appearanceSummary })), null, 2)}

${instruction ? `【创作者定向指导要求】：${instruction}\n` : ''}

【特别执行要求】：
1. 仔细通读剧本文本，按【戏剧节拍（Dramatic Beat）】精准切分镜头，凡有人物意图改变、行动展开、信息交互、视线焦点转移或情绪微反应，均须独立切镜；
2. 不设定镜头上限！按照剧本正文的信息密度充分铺开镜头序列（长剧情充分展开 8~15 镜甚至更多），杜绝合并跳步；
3. 每个镜头 shotId 统一格式为 "${clipId}-01", "${clipId}-02", "${clipId}-03"...
4. 严格按照三明治提示词结构，精准填充 firstFramePrompt, videoPrompt, audioPrompt, dialogue, characters, locations, items；
5. 输出严格符合规范的单幕订单 JSON (CinematicClipOrder)。`;
}

/**
 * 全剧总览规划 Prompt (全景模式)
 */
export function buildStoryboardPlanningUserPrompt(input: StoryboardPlanningInput): string {
  return `请根据以下策划案 PRD 与故事剧本，拆解全剧各幕的工业级电影分镜台本清单：

【项目标题】：${input.title || '未命名短剧'}
【策划案 PRD】：
\`\`\`json
${JSON.stringify(input.prd, null, 2)}
\`\`\`

【故事正文】：
\`\`\`markdown
${input.storyMarkdown || '见 PRD'}
\`\`\`

【视觉资产清单】：
\`\`\`json
${input.entities ? JSON.stringify(input.entities, null, 2) : '暂无实体'}
\`\`\`

【核心执行要求】：
彻底解除单幕镜头数量上限！遵循通用电影视听语法，按戏剧节拍（Dramatic Beat）与视听注意力转移充分切分镜头。
请输出符合规范的完整分镜订单 JSON。`;
}
