/**
 * tools/film-production/storyboard-planning-tool/steps/01-plan/prompt.ts
 * 分镜台本规划工序专属提示词体系 (Storyboard Planning Prompt SSOT)
 *
 * 核心微内核架构哲学（Universal Cinematic Language & Dramatic Beat Driven）：
 * 1. 【系统级题材中立与零套路枚举】坚决拒绝机械模式枚举与特定题材硬编码，遵循底层通用电影视听语法；
 * 2. 【戏剧节拍自然切分（Dramatic Beat）】以人物意图转变、信息揭示、冲突交锋、情绪反应与视线焦点转移作为自然分镜节点；
 * 3. 【无数量上限展开】镜头数量完全由剧本文本信息密度驱动，长情节幕充分展开（8~15镜+），拒绝走马灯式跳步；
 * 4. 【三明治工业视听双轨结构】精确规划首帧画面、动态运镜表演与双轨环境音/动作拟音。
 */

import type { StoryboardPlanningInput } from './schema.js';
import { VISUAL_CONTINUITY_LOCK } from '../../../visual-continuity.js';

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

三、 严格忠实于本幕剧本（Script-Faithful & Beat-Driven）
- 必须且只能拆解【本幕剧本正文】中实际发生的场景、出场人物、动作与对白：
  - 全剧视觉资产清单仅作为外貌/场景/道具参考字典，严禁将未在本幕出现的场景、道具或后续幕次的剧情/结局越界塞入本幕；
  - 镜头数量严格由本幕剧本的真实戏剧信息密度自然决定（简短对白幕自然收敛为 4~8 镜，动作密集或长交锋幕再充分展开），严禁为了凑镜头数凭空注水编造剧本外的桥段；
  - 开场与建立镜头遵循本幕真实在场人物与动作，若剧本开场角色已在场并立即展开交互，建立全景应优先将已在场的核心主体纳入画面，避免无剧情依据的纯空镜导致与下一镜站位跳接。

四、 三明治工业级视听双轨规范（Sandwich Structure）
- 首帧生图词 (firstFramePrompt)：
  [精确景别与摄影机位] + [在场人物姓名、定妆外貌、服装质感、站位姿态与生理状态] + [具体场景空间、光影氛围与空间深度] + [核心构图与全局艺术基调]；
  - **结构化 ID 与自然语言严格解耦**：角色/场景/道具的程序 ID（如 \`char_xxx\`、\`loc_xxx\`、\`item_xxx\`）只能填在结构化字段 \`characters\` / \`items\` / \`backgroundImageUrl\` 中，**严禁将任何英文内部 ID 写进 \`firstFramePrompt\` 或 \`videoPrompt\`**；
  - **画面与出场角色强一致**：凡是 \`firstFramePrompt\` 画面中出现的人物，必须在 \`characters\` 数组中列出其对应的全部 \`characterId\`；画面中无人时 \`characters\` 才为空数组；
- 动态表演与运镜词 (videoPrompt)：
  [主体微表情与动作起止轨迹] + [摄影机运镜动势（推/拉/摇/移/跟随/固定）] + [物理环境交互动态]；
- 声音音效规划 (audioPrompt / dialogue)：
  精准规划环境氛围音（Ambience）、动作拟音（Foley/SFX）、台词潜台词与情绪配乐走向，对白忠实还原剧本原文。

【全局视觉连续性硬约束】
- ${VISUAL_CONTINUITY_LOCK}
- 每个 firstFramePrompt 都必须写明沿用定妆参考图和本幕既定色彩分级；每个 videoPrompt 只描述动作与运镜，不重新设计颜色和背景。

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

  return `请作为电影视听总导演，严格依据【本幕剧本正文】执行工业级电影分镜拆解：

【本幕标识】：${clipId}（${clipTitle}）
【全局艺术调性】：${artStyle || '电影级摄影质感，真实光影与高动态范围'}

【本幕剧本正文（唯一叙事依据，严禁越界编造本幕之外的剧情与场景）】：
\`\`\`text
${narrativeText}
\`\`\`

【全剧动态视觉资产字典（仅挑选本幕实际出场的角色、场景、道具引用，严禁把未出场资产塞入本幕）】：
- 可用角色库：
${JSON.stringify(characters.map((c) => ({ characterId: c.characterId || c.id, name: c.name, identity: c.identity, appearance: c.appearanceSummary })), null, 2)}
- 可用场景空间库：
${JSON.stringify(locations.map((l) => ({ locationId: l.locationId || l.id, name: l.name, atmosphere: l.atmosphere, appearance: l.appearanceSummary })), null, 2)}
- 可用道具库：
${JSON.stringify(items.map((i) => ({ itemId: i.itemId || i.id, name: i.name, description: i.description, appearance: i.appearanceSummary })), null, 2)}

${instruction ? `【创作者定向指导要求】：${instruction}\n` : ''}

【特别执行要求】：
1. 严格忠实于【本幕剧本正文】，按【戏剧节拍（Dramatic Beat）】精准切分镜头，完整承载本幕所有动作、对白与情绪转折，严禁编造其他幕次的场景、道具或后续剧情；
2. 镜头数量完全匹配本幕剧本实际信息密度，不人为凑数、不跳过关键对白；
3. 每个镜头 shotId 统一格式为 "${clipId}-01", "${clipId}-02", "${clipId}-03"...
4. 严格按照三明治提示词结构填充 firstFramePrompt, videoPrompt, audioPrompt, dialogue, characters, items；其中 \`firstFramePrompt\` 必须使用纯中文自然语言画面描述（禁止出现 \`char_xxx\` 等程序 ID），且画面中入画的所有人物必须在 \`characters\` 中准确填入其 \`characterId\`；
5. 所有镜头必须继承同一套角色、场景和色彩连续性约束，不得逐镜头重新配色或更换背景；
6. 输出严格符合规范的单幕订单 JSON (CinematicClipOrder)。`;
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
