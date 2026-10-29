import path from 'path';
import fs from 'fs';
import { BaseAgent, AgentContext, AgentResult } from './base.agent.js';
import { WorkflowStage } from '../types/workflow.js';
import { ScriptArtifact, CharacterProfile, EpisodePlan, ScriptBible } from '../types/script.js';
import { parseScriptText } from '../types/script.parser.js';
import { llmProvider, ChatMessage } from '../providers/llm.provider.js';
import { imageProvider } from '../providers/image.provider.js';
import { config } from '../config/index.js';
import { routeGenre, loadGenreModule, listGenreModules } from '../prompts/loader.js';
import { characterEvaluator } from './character.evaluator.js';

export class ScriptWriterAgent extends BaseAgent<ScriptArtifact> {
  readonly stage = WorkflowStage.SCRIPT_GENERATION;

  async execute(context: AgentContext): Promise<AgentResult<ScriptArtifact>> {
    const { session, userFeedback } = context;
    const { idea, style, episodes: targetEpisodesCount = 3 } = session.meta;

    const existingArtifact = session.stageArtifacts[
      WorkflowStage.SCRIPT_GENERATION
    ] as ScriptArtifact | undefined;

    // Check if intervention requested a specific action (e.g. expand single episode or regenerate bible)
    let parsedFeedback: any = null;
    if (userFeedback) {
      try {
        parsedFeedback = typeof userFeedback === 'string' ? JSON.parse(userFeedback) : userFeedback;
      } catch {
        parsedFeedback = { instruction: userFeedback };
      }
    }

    // Action A: Expand / Elaborate a specific episode
    if (parsedFeedback?.action === 'expand_episode') {
      const epNum = Number(parsedFeedback.episodeNumber || 1);
      return await this.expandEpisode(context, existingArtifact, epNum);
    }

    // Action B: Generate character images
    if (parsedFeedback?.action === 'generate_character_images' || parsedFeedback?.action === 'generate_character_image') {
      return await this.generateCharacterImages(context, existingArtifact, parsedFeedback?.characterName);
    }

    // Action C: Revise existing outline with AI natural language instruction
    if (parsedFeedback?.action === 'revise_bible' || (parsedFeedback?.instruction && existingArtifact?.bible)) {
      return await this.reviseBible(context, existingArtifact, parsedFeedback.instruction || parsedFeedback.prompt || '');
    }

    // Action D: Generate or Regenerate the Story Bible & Outline
    return await this.generateBible(
      context,
      existingArtifact,
      parsedFeedback?.instruction,
      parsedFeedback?.preferredGenre
    );
  }

  /**
   * Step 1: Generates the Story Bible & Series Outline (大纲企划，只生成一次，支持页面内编辑与重新生成)
   */
  async generateBible(
    context: AgentContext,
    existing?: ScriptArtifact,
    instruction?: string,
    preferredGenre?: string
  ): Promise<AgentResult<ScriptArtifact>> {
    const { session } = context;
    const { idea, style, episodes = 3 } = session.meta;

    // 1. LLM Intent Router: Dynamically routes to the best genre module without hardcoding
    const routing = await routeGenre(idea, style, preferredGenre);
    const genreModule = loadGenreModule(routing.genreId);

    const systemPrompt = `
你是顶级影视策划总监与故事架构师。你的职责是根据创作者输入的【核心创意与设定】，架构一份具备深度戏剧张力与影视工业水准的【全剧企划大纲与故事圣经 (Story Bible)】。

【当前剧作已匹配的影视范式】：
- 范式名称：《${genreModule.meta.name}》（ID: ${genreModule.meta.id}）
- 范式定位：${genreModule.meta.description}
- 判定依据：${routing.reason}

【该范式专属叙事弧线与分集节拍规范】：
${genreModule.narrativeArc}

【该范式专属一票否决禁忌（Negative Boundaries - 严格遵守）】：
${genreModule.negativeRules}

【实体与剧作原则】：
1. 【实体对齐与主体地位（Entity Fidelity）】：
   - 深入解析创作者输入中的核心实体（人物、生物、群体、阵营、神话对象或核心概念）。
   - 若创作者已指明特定主体或对立双方（如哥斯拉与金刚），这些主体即为故事无可争议的核心第一主角，剧作必须毫无保留地围绕其交锋、行动与命运展开，绝对严禁虚构无关第三方大Boss或配角喧宾夺主。
2. 【片名规范】：
   - 片名必须直接反射创作者的核心创意与核心主体，具备高辨识度与强商业吸引力，避免毫无关联的偏门片名。
3. 【剧作核心维度构建】：
   - 题材类型：准确提炼风格与类型定位标签。
   - 故事总梗概 (Logline)：凝练交代核心危机、主角的核心行动、对抗阻碍与终极悬念（150-250字）。
   - 核心商业看点 (Selling Points)：根据该题材与设定本身独有的特质，提炼 3-4 个最抓人的视听奇观、叙事钩子或戏剧张力点。
   - 核心角色/主体清单 (Character Profiles)：
     * name：角色/主体名称（严格对应创作者指定的核心主角与对立面）；
     * role：在故事世界中的身份、阵营与戏剧功能；
     * personality：性格特质与行事风格简述（1-2句）。
   - 分集规划 (Episode Plans)：
     * 严格规划 ${episodes} 集，严格遵照上述【该范式专属叙事弧线与分集节拍规范】推进；
     * 每集必须包含：
       - episodeNumber: 集数序号（从 1 开始）；
       - title: 吸睛的分集标题；
       - logline: 本集核心事件与剧情大纲；
       - cliffhanger: 本集结尾卡点悬念钩子（必须符合该题材特质，杜绝低幼狗血）；
       - targetDuration: 目标预估时长（单位：秒，建议60-90秒）。

严格输出纯 JSON 格式：
{
  "title": "片名标题",
  "theme": "题材与风格标签",
  "logline": "整体故事总梗概",
  "sellingPoints": [
    "看点1：具体描述",
    "看点2：具体描述",
    "看点3：具体描述"
  ],
  "characters": [
    {
      "name": "角色/主体名称",
      "role": "身份与定位/戏剧功能",
      "personality": "简要性格特质"
    }
  ],
  "episodePlans": [
    {
      "episodeNumber": 1,
      "title": "分集标题",
      "logline": "本集核心事件与剧情大纲",
      "cliffhanger": "本集结尾卡点断章悬念钩子",
      "targetDuration": 60
    }
  ]
}
`.trim();

    const userPrompt = `
【核心创意 / 故事灵感】：
${idea}

【视觉风格】：
${style}

【规划总集数】：
${episodes} 集

【影视范式】：
《${genreModule.meta.name}》

${instruction ? `【修改企划指令】：${instruction}\n` : ''}
请严格基于上述核心创意与主体设定，遵照《${genreModule.meta.name}》的叙事节拍与负向禁忌，生成高水准的企划大纲与故事圣经 JSON。
`.trim();

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const bibleData = await llmProvider.chatJSON<any>(messages);

    const characterNames = (bibleData.characters || []).map((c: any) => c.name);
    const episodePlans: EpisodePlan[] = (bibleData.episodePlans || []).map((ep: any, idx: number) => ({
      episodeNumber: ep.episodeNumber || idx + 1,
      title: ep.title || `第${idx + 1}集`,
      logline: ep.logline || '',
      cliffhanger: ep.cliffhanger || '',
      targetDuration: Number(ep.targetDuration) || 60,
      status: 'planned',
    }));

    const bible: ScriptBible = {
      title: bibleData.title || session.title || '未命名剧作',
      theme: bibleData.theme || style || '影视短剧',
      style: style || 'realistic',
      logline: bibleData.logline || '',
      sellingPoints: bibleData.sellingPoints || [],
      characters: bibleData.characters || [],
      episodePlans,
      isLocked: false, // 初始未锁定，允许页面内任意编辑与重新生成
      genreId: genreModule.meta.id,
      genreName: genreModule.meta.name,
      genreReason: routing.reason,
    };

    const artifact: ScriptArtifact = {
      title: bible.title,
      theme: bible.theme,
      style: bible.style,
      logline: bible.logline,
      sellingPoints: bible.sellingPoints,
      bible,
      characters: bible.characters,
      episodes: episodePlans,
      characterNames,
      locations: [],
      isLocked: false,
      genreId: genreModule.meta.id,
      genreName: genreModule.meta.name,
      genreReason: routing.reason,
    };

    return {
      stage: this.stage,
      artifact,
      requiresIntervention: true,
      stopPointTitle: '剧本大纲与企划确认',
      stopPointDescription: `已成功匹配《${genreModule.meta.name}》范式并生成《${artifact.title}》故事大纲、核心看点、人物清单与 ${episodePlans.length} 集分集规划。支持直接在页面内修改大纲或再次生成；点击任意一集的「开始生成」即可进入分集正文制作流程（同时锁定大纲）。`,
    };
  }

  /**
   * Step 1.2: AI Copilot Revision - Modifies an existing Story Bible according to user's instruction.
   * Preserves characters' established images and unchanged lore!
   */
  async reviseBible(
    context: AgentContext,
    existingArtifact: ScriptArtifact | undefined,
    instruction: string
  ): Promise<AgentResult<ScriptArtifact>> {
    const { session } = context;
    const { idea, style, episodes = 3 } = session.meta;

    if (!existingArtifact || !existingArtifact.bible) {
      return await this.generateBible(context, existingArtifact, instruction);
    }

    const currentBible = existingArtifact.bible;
    const genreId = currentBible.genreId || (await routeGenre(idea, style)).genreId;
    const genreModule = loadGenreModule(genreId);

    const systemPrompt = `
你是顶级影视策划总监与剧作导师。创作者正在创作一部剧作，并给出了针对当前【故事大纲与企划圣经】的【修改与优化意见】。
你的任务是：**精准执行创作者的修改指令，对当前已有的大纲进行定向重构与增删修饰，同时保持其余未要求修改的设定自洽稳定**。

【作品所属范式及禁忌（修改时必须严格遵守，防止题材跑偏）】：
- 范式名称：《${genreModule.meta.name}》（ID: ${genreModule.meta.id}）
- 范式定位：${genreModule.meta.description}
- 专属节拍规范：${genreModule.narrativeArc}
- 专属一票否决禁忌（Negative Boundaries）：${genreModule.negativeRules}

【创作原则】：
1. 明确遵循创作者的指令。如指令要求更改某集的事件、调整角色设定、增加新冲突看点或转变故事基调，必须切实在对应模块中落实修改。
2. 保持其余合理设定的延续性与自洽性，不要无故推翻创作者已经确认的基础核心设定。
3. 严格输出符合格式的纯 JSON 数据。

严格输出纯 JSON 格式：
{
  "title": "片名标题（如指令要求修改则更新，否则保留）",
  "theme": "题材与风格标签",
  "logline": "整体故事总梗概（依据修改指令精修后的梗概，150-250字）",
  "sellingPoints": [
    "看点1：具体描述",
    "看点2：具体描述",
    "看点3：具体描述"
  ],
  "characters": [
    {
      "name": "角色/主体名称",
      "role": "身份与定位/戏剧功能",
      "personality": "简要性格特质"
    }
  ],
  "episodePlans": [
    {
      "episodeNumber": 1,
      "title": "分集标题",
      "logline": "本集核心事件与剧情大纲",
      "cliffhanger": "本集结尾卡点断章悬念钩子",
      "targetDuration": 60
    }
  ]
}
`.trim();

    const userPrompt = `
【全剧核心创意】：
${idea}

【全剧视觉风格】：
${style}

【规划总集数】：
${episodes} 集

【当前已有大纲与企划内容】：
片名：《${currentBible.title}》
类型：${currentBible.theme}
梗概：${currentBible.logline}
核心看点：${JSON.stringify(currentBible.sellingPoints)}
现有角色：${JSON.stringify(currentBible.characters?.map((c) => ({ name: c.name, role: c.role, personality: c.personality })))}
现有分集大纲：${JSON.stringify(currentBible.episodePlans?.map((e) => ({ episodeNumber: e.episodeNumber, title: e.title, logline: e.logline, cliffhanger: e.cliffhanger })))}

【创作者提出的 AI 修改指令】：
${instruction}

请立即根据创作者的修改指令，精修并输出最新版大纲与企划圣经 JSON。
`.trim();

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const revisedData = await llmProvider.chatJSON<any>(messages);

    // Merge characters while strictly preserving any existing generated images/versions!
    const updatedCharacters: CharacterProfile[] = (revisedData.characters || []).map((newChar: any) => {
      const existingChar = currentBible.characters?.find((c) => c.name === newChar.name);
      return {
        name: newChar.name,
        role: newChar.role || existingChar?.role || '',
        personality: newChar.personality || existingChar?.personality || '',
        appearance: existingChar?.appearance || '',
        motivation: existingChar?.motivation || '',
        referenceImageUrl: existingChar?.referenceImageUrl,
        imageUrl: existingChar?.imageUrl,
        selected: existingChar?.selected,
        versions: existingChar?.versions || (existingChar?.imageUrl ? [existingChar.imageUrl] : []),
      };
    });

    const updatedEpisodePlans: EpisodePlan[] = (revisedData.episodePlans || []).map((ep: any, idx: number) => {
      const existingEp = existingArtifact.episodes?.find((e) => e.episodeNumber === (ep.episodeNumber || idx + 1));
      return {
        episodeNumber: ep.episodeNumber || idx + 1,
        title: ep.title || `第${idx + 1}集`,
        logline: ep.logline || '',
        cliffhanger: ep.cliffhanger || existingEp?.cliffhanger || '',
        targetDuration: Number(ep.targetDuration) || existingEp?.targetDuration || 60,
        status: existingEp?.content ? 'completed' : 'planned',
        content: existingEp?.content,
        scenes: existingEp?.scenes,
      };
    });

    const updatedBible: ScriptBible = {
      title: revisedData.title || currentBible.title,
      theme: revisedData.theme || currentBible.theme,
      style: currentBible.style || style || 'realistic',
      logline: revisedData.logline || currentBible.logline,
      sellingPoints: revisedData.sellingPoints || currentBible.sellingPoints,
      characters: updatedCharacters,
      episodePlans: updatedEpisodePlans,
      isLocked: false,
      genreId: currentBible.genreId || genreModule.meta.id,
      genreName: currentBible.genreName || genreModule.meta.name,
      genreReason: currentBible.genreReason,
    };

    const updatedArtifact: ScriptArtifact = {
      ...existingArtifact,
      title: updatedBible.title,
      theme: updatedBible.theme,
      logline: updatedBible.logline,
      sellingPoints: updatedBible.sellingPoints,
      bible: updatedBible,
      characters: updatedCharacters,
      episodes: updatedEpisodePlans,
      characterNames: updatedCharacters.map((c) => c.name),
      isLocked: false,
      genreId: updatedBible.genreId,
      genreName: updatedBible.genreName,
      genreReason: updatedBible.genreReason,
    };

    return {
      stage: this.stage,
      artifact: updatedArtifact,
      requiresIntervention: true,
      stopPointTitle: 'AI 修改大纲完成',
      stopPointDescription: `已成功根据您的指令「${instruction}」对大纲进行了精准修改与更新。您可以在下方继续查看、微调或进行分集定妆与制作。`,
    };
  }

  /**
   * Step 2: Deepens a specific episode into full screenplay text (场次、动作、对白)
   * Automatically locks the Bible to prevent inconsistencies.
   */
  async expandEpisode(
    context: AgentContext,
    existingArtifact: ScriptArtifact | undefined,
    targetEpisodeNumber: number
  ): Promise<AgentResult<ScriptArtifact>> {
    const { session } = context;

    if (!existingArtifact || !existingArtifact.episodes) {
      throw new Error('Script outline missing. Please generate the outline first.');
    }

    const targetEpIndex = existingArtifact.episodes.findIndex(
      (ep) => ep.episodeNumber === targetEpisodeNumber
    );

    if (targetEpIndex === -1) {
      throw new Error(`Episode ${targetEpisodeNumber} not found in outline plans.`);
    }

    const targetEp = existingArtifact.episodes[targetEpIndex];
    const prevEp = targetEpIndex > 0 ? existingArtifact.episodes[targetEpIndex - 1] : null;
    const nextEp = targetEpIndex < existingArtifact.episodes.length - 1 ? existingArtifact.episodes[targetEpIndex + 1] : null;

    console.log(`[ScriptWriterAgent] Deepening Episode ${targetEpisodeNumber}: "${targetEp.title}"...`);

    // Prepare previous episode continuity text
    let prevEpContext = '';
    if (prevEp) {
      const endingSnippet = prevEp.content ? prevEp.content.slice(-600) : '';
      prevEpContext = `
【前情承接（第 ${prevEp.episodeNumber} 集《${prevEp.title}》）】：
- 上集大纲提要：${prevEp.logline}
${prevEp.cliffhanger ? `- 上集结尾卡点断章：${prevEp.cliffhanger}` : ''}
${endingSnippet ? `- 上集结尾正文原文片段（请直接承接此处剧情与角色最后状态）：\n"""\n${endingSnippet}\n"""` : '（上一集剧本尚未详写，请直接依照上一集大纲与断章悬念进行承接）'}
`.trim();
    }

    // Prepare next episode cliffhanger requirement
    let nextEpContext = '';
    if (nextEp) {
      nextEpContext = `
【后篇悬念导向（第 ${nextEp.episodeNumber} 集《${nextEp.title}》）】：
- 下集预备大纲：${nextEp.logline}
- 本集结尾卡点断章目标：${targetEp.cliffhanger || '制造生死攸关或重大反转的危机高潮，直接引爆观众对下一集的期待'}
（本集最后一场戏的最后一句话/最后一个动作，必须卡在最大的冲突瞬间戛然而止，精准引出第 ${nextEp.episodeNumber} 集！）
`.trim();
    } else {
      nextEpContext = `
【全剧大结局收官高潮】：
- 本集为全剧收官终局（第 ${targetEp.episodeNumber} 集），大纲为：${targetEp.logline}
- 结尾必须将全剧终极对决、终极反转或震撼命运推向全剧最高潮！
`.trim();
    }

    const genreId = existingArtifact.genreId || existingArtifact.bible?.genreId || 'general';
    const genreModule = loadGenreModule(genreId);

    const systemPrompt = `
你是顶级影视编剧总监与视听导演。你的任务是根据全剧故事圣经与本集大纲，将该集深化创作为极具视听张力、严守题材特质、悬念拉满的【单集分场剧本】。

【当前剧作已匹配的影视范式】：
- 范式名称：《${genreModule.meta.name}》（ID: ${genreModule.meta.id}）
- 范式定位：${genreModule.meta.description}
- 专属节拍规范：${genreModule.narrativeArc}
- 专属一票否决禁忌（Negative Boundaries - 严格遵守）：${genreModule.negativeRules}

【影视剧本创作工业法则】：
1. 【开篇视听抓眼钩子 (Opening Hook)】：
   - 若为第 1 集：第 1 场戏必须快速建立核心危机、视听奇观或主要矛盾，严禁拖沓的无关闲聊！
   - 若为第 N 集 (N > 1)：无缝接驳上一集留下的断章危机，快速延续上集最后一秒的情绪与动作，零废话立刻拉紧张力！
2. 【结尾悬念断章钩子 (Cliffhanger Hook)】：
   - 本集最后一场戏的最后一句台词或核心动作，必须卡在戏剧高潮瞬间！
   - 必须严格符合《${genreModule.meta.name}》的题材逻辑与冲突属性，绝对严禁违和天降无关第三方Boss或虚假讲和！
3. 【实体与状态继承 (State Evolution & Continuity)】：
   - 严格以全剧核心第一主角（如哥斯拉与金刚）为主导推进，严禁虚构配角抢戏；
   - 角色若在上一集中受伤、战损、觉醒杀招，在本集开局及后续行动中必须真实延续，严禁状态自动回血或凭空重置！
4. 【镜头语言与视听表现力】：
   - 动作用影视专业镜头语言与物理动作描摹（如：特写镜头急推、角色呼吸急促、眼神骤变、能量撕裂空气...）；
   - 对白精炼短促、针锋相对、情绪饱满，杜绝任何低幼狗血台词；
   - 每场戏严格遵循标准格式输出：

## 第${targetEp.episodeNumber}集：${targetEp.title}
**第${targetEp.episodeNumber}集-第1场 日/夜 内/外 场景具体地点**
人物：出场角色名

[动作] 具体的物理动作描写与镜头调度...
角色A（情绪状态）：台词内容。
角色B（情绪状态）：台词内容。
[动作] 动作后续与环境反馈...
`.trim();

    const userPrompt = `
【全剧片名】：${existingArtifact.title}
【故事主线】：${existingArtifact.logline || existingArtifact.bible?.logline}
【登场人物设定表】：
${JSON.stringify(existingArtifact.characters || existingArtifact.bible?.characters || [], null, 2)}

${prevEpContext ? `${prevEpContext}\n` : ''}
${nextEpContext ? `${nextEpContext}\n` : ''}

【本集具体创作目标】：
- 集数：第 ${targetEp.episodeNumber} 集
- 标题：${targetEp.title}
- 本集核心大纲：${targetEp.logline}
- 本集断章钩子定位：${targetEp.cliffhanger || '悬念爆发瞬间断章'}
- 目标预估时长：${targetEp.targetDuration} 秒（约编写 20-35 行精炼动作与对白）

请严格执行【黄金3秒开篇钩子】与【结尾掐脖子断章】，为第 ${targetEp.episodeNumber} 集创作完整的长文本影视剧本（直接输出 Markdown，不要包裹在 JSON 中）：
`.trim();

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const scriptText = (await llmProvider.chat(messages)) || '';
    const parsed = parseScriptText(scriptText);

    // Merge locations
    const allLocations = new Set([...existingArtifact.locations, ...parsed.locations]);

    // Update the episode plan with detailed content
    const updatedEpisodes: EpisodePlan[] = existingArtifact.episodes.map((ep) => {
      if (ep.episodeNumber === targetEpisodeNumber) {
        return {
          ...ep,
          content: scriptText,
          status: 'completed' as const,
          scenes: parsed.episodes?.[0]?.scenes || ep.scenes || [],
        };
      }
      return ep;
    });

    // Crucial: Lock the outline permanently once any episode is generated!
    const updatedArtifact: ScriptArtifact = {
      ...existingArtifact,
      episodes: updatedEpisodes,
      isLocked: true, // 核心逻辑：一旦点生成某集，锁定大纲修改功能
      locations: Array.from(allLocations),
      activeEpisodeNumber: targetEpisodeNumber,
      scriptText: scriptText,
      rawText: scriptText,
    };

    if (updatedArtifact.bible) {
      updatedArtifact.bible.isLocked = true;
      updatedArtifact.bible.episodePlans = updatedEpisodes;
    }

    return {
      stage: this.stage,
      artifact: updatedArtifact,
      requiresIntervention: true,
      stopPointTitle: `第 ${targetEp.episodeNumber} 集长文本剧本生成完成`,
      stopPointDescription: `已成功根据大纲为《${existingArtifact.title}》第 ${targetEp.episodeNumber} 集《${targetEp.title}》深化写出完整剧本。大纲已进入安全锁定状态。你可以在下方通读修改本集台词，满意后可生成下一集或直接流转至角色场景设计。`,
    };
  }

  /**
   * Step 1.5: Generates concept art images for all or a specific character in the Story Bible.
   */
  async generateCharacterImages(
    context: AgentContext,
    existingArtifact: ScriptArtifact | undefined,
    targetCharacterName?: string
  ): Promise<AgentResult<ScriptArtifact>> {
    const { session, projectDir } = context;

    if (!existingArtifact || !existingArtifact.characters || existingArtifact.characters.length === 0) {
      throw new Error('当前未找到角色设定。请先生成剧本大纲。');
    }

    const charsDir = path.join(projectDir, 'characters');
    fs.mkdirSync(charsDir, { recursive: true });

    const ratio = session.meta.videoRatio || '16:9';
    const isFast = config.image.qualityLevel === 'fast';

    let renderWidth = 1280;
    let renderHeight = 720;
    if (ratio === '9:16') {
      renderWidth = isFast ? 512 : 720;
      renderHeight = isFast ? 912 : 1280;
    } else if (ratio === '1:1') {
      renderWidth = isFast ? 512 : 1024;
      renderHeight = isFast ? 512 : 1024;
    } else {
      renderWidth = isFast ? 912 : 1280;
      renderHeight = isFast ? 512 : 720;
    }

    const charactersToProcess = targetCharacterName
      ? existingArtifact.characters.filter((c) => c.name === targetCharacterName)
      : existingArtifact.characters;

    for (const char of charactersToProcess) {
      console.log(`[ScriptWriterAgent] Generating concept art for character: "${char.name}"...`);

      const promptMessages: ChatMessage[] = [
        {
          role: 'system',
          content:
            'You are an elite visual director and concept artist. Given a character/creature name, role, visual traits, and visual style, write a high-impact, professional English text-to-image prompt (30-45 words) suitable for cinematic AI image generators. Focus on visual scale, lighting, textures, camera framing, and photorealistic detail. Return ONLY the raw prompt string, without quotes or commentary.',
        },
        {
          role: 'user',
          content: `Character Name: ${char.name}\nRole: ${char.role}\nAppearance: ${char.appearance || ''}\nPresence/Style: ${char.personality || ''}\nOverall Visual Style: ${existingArtifact.style || 'cinematic realistic'}${char.referenceImageUrl ? '\n[Visual Reference]: An image reference is attached. Maintain key likeness, silhouette, and aesthetic features from this reference.' : ''}`,
        },
      ];

      let imagePrompt = '';
      try {
        imagePrompt = (await llmProvider.chat(promptMessages))?.trim() || '';
      } catch {
        imagePrompt = `cinematic concept art portrait of ${char.name}, ${char.role}, ${char.appearance || ''}, ${existingArtifact.style || 'cinematic photorealistic'}, 8k, masterpiece`;
      }

      const safeName = (char.name || 'char').replace(/[\\/:*?"<>|]/g, '_').trim();
      const filename = `${safeName}_portrait_${Date.now()}.jpg`;
      const imgPath = path.join(charsDir, filename);

      const res = await imageProvider.generateImage(
        {
          prompt: imagePrompt,
          style: existingArtifact.style || 'realistic',
          width: renderWidth,
          height: renderHeight,
          referenceImageUrl: char.referenceImageUrl,
        },
        imgPath
      );

      const webPath = `/media/${session.id}/characters/${filename}`;
      char.imageUrl = webPath;
      char.selected = webPath;
      (char as any).imagePrompt = imagePrompt;
      if (res.rewrite_result) {
        (char as any).rewrite_result = res.rewrite_result;
      }
      if (!char.versions) char.versions = [];
      if (!char.versions.includes(webPath)) {
        char.versions.unshift(webPath);
      }

      // Quality audit via CharacterEvaluator (LLM/Vision-as-a-Judge)
      const evalResult = await characterEvaluator.evaluateCharacter(
        char.name,
        `${char.role}。${char.personality || ''}。${char.appearance || ''}`,
        imgPath,
        webPath
      );
      char.evaluation = evalResult;
      console.log(`[ScriptWriterAgent] Evaluated character "${char.name}": score ${evalResult.score}/10, acceptable: ${evalResult.isAcceptable}`);
    }

    // Sync to bible.characters
    if (existingArtifact.bible) {
      existingArtifact.bible.characters = existingArtifact.characters;
    }

    // Sync to character_design stage artifact so downstream is pre-populated
    const charDesignArtifact = (session.stageArtifacts[WorkflowStage.CHARACTER_DESIGN] || {}) as any;
    charDesignArtifact.characters = existingArtifact.characters.map((c, idx) => ({
      id: `char_${idx + 1}`,
      name: c.name,
      role: c.role,
      personality: c.personality,
      appearancePrompt: c.appearance || '',
      clothingPrompt: '',
      imagePrompt: (c as any).imagePrompt || '',
      imageUrl: c.imageUrl,
      selected: c.selected,
      versions: c.versions || (c.imageUrl ? [c.imageUrl] : []),
      evaluation: c.evaluation,
      rewrite_result: (c as any).rewrite_result,
    }));
    session.stageArtifacts[WorkflowStage.CHARACTER_DESIGN] = charDesignArtifact;

    return {
      stage: this.stage,
      artifact: existingArtifact,
      requiresIntervention: true,
      stopPointTitle: '角色形象图生成完成',
      stopPointDescription: '所有核心角色的定妆形象图已生成就绪。请确认角色视觉造型，满意后即可解锁并开始生成分集剧本。',
    };
  }
}
