import fs from 'fs';
import path from 'path';
import { AgentContext, AgentResult } from '../base/index.js';
import { WorkflowStage } from '../../types/workflow.js';
import { NarrativeDesignArtifact, StoryBible, CharacterProfile } from './types.js';
import { spineService } from './spine.service.js';
import { pivotPointsService } from './pivot-points.service.js';
import { storyGraphService } from './story-graph.service.js';
import { characterProfilesService } from './character-profiles.service.js';
import { llmProvider, ChatMessage } from '../../providers/llm.provider.js';
import { loadPromptSafe, listGenreModules, loadGenreModule } from '../../prompts/loader.js';

export class BibleService {
  /**
   * 生成初始故事圣经、核心角色名录、戏剧卖点矩阵以及 10 节点互动网状拓扑图。
   */
  async generateBible(
    context: AgentContext,
    existingArtifact?: NarrativeDesignArtifact,
    userInstruction?: string,
    preferredGenreId?: string
  ): Promise<AgentResult<NarrativeDesignArtifact>> {
    const { session } = context;

    const genres = listGenreModules();
    const genreModule = loadGenreModule(preferredGenreId || 'interactive_fmv');

    // 第 1 步：生成黄金戏剧主干大纲 (01_story_spine)
    const spine = await spineService.generateStorySpine(context, existingArtifact, userInstruction);

    // 第 2 步：提取宏观与微观交互矩阵 (02_pivot_points)
    const pivotPoints = await pivotPointsService.extractPivotPoints(context, spine, userInstruction);

    // 第 3 步：编译 10 节点网状互动故事拓扑图 (03_story_graph)
    const interimArtifact: any = {
      title: spine.title,
      theme: spine.theme,
      style: spine.style,
      logline: spine.logline,
      sellingPoints: spine.sellingPoints,
      goldenSpine: spine.goldenSpine,
      pivotPoints,
    };
    const storyGraph = await storyGraphService.generateStoryGraph(context, interimArtifact, userInstruction);

    // 第 4 步：推演完整角色小传与视觉概念卡 (04_character_profiles)
    const fullCharacters = await characterProfilesService.generateProfiles(
      context,
      spine,
      pivotPoints,
      storyGraph,
      userInstruction
    );

    const characters: CharacterProfile[] = fullCharacters.map((c) => ({
      ...c,
      referenceImageUrl: existingArtifact?.characters?.find((ec) => ec.name === c.name)?.referenceImageUrl,
      imageUrl: existingArtifact?.characters?.find((ec) => ec.name === c.name)?.imageUrl,
      selected: existingArtifact?.characters?.find((ec) => ec.name === c.name)?.selected,
      versions: existingArtifact?.characters?.find((ec) => ec.name === c.name)?.versions || [],
    }));

    const episodePlans =
      spine.goldenSpine && spine.goldenSpine.length > 0
        ? spine.goldenSpine.map((act) => ({
            episodeNumber: act.act,
            title: act.name,
            logline: act.summary,
            targetDuration: act.targetDurationSec || 25,
            cliffhanger: act.cliffhanger,
          }))
        : [
            { episodeNumber: 1, title: '第 1 幕', logline: spine.logline, targetDuration: 60 },
          ];

    const uniqueLocations = Array.from(
      new Set(storyGraph.nodes.map((n) => n.location).filter(Boolean))
    );

    const bible: StoryBible = {
      title: spine.title,
      theme: spine.theme,
      style: spine.style,
      logline: spine.logline,
      sellingPoints: spine.sellingPoints,
      goldenSpine: spine.goldenSpine,
      characters,
      episodePlans,
      genreId: genreModule.meta.id,
      genreName: genreModule.meta.name,
      storyGraph,
    };

    const artifact: NarrativeDesignArtifact = {
      title: spine.title,
      theme: spine.theme,
      style: spine.style,
      logline: spine.logline,
      sellingPoints: spine.sellingPoints,
      goldenSpine: spine.goldenSpine,
      pivotPoints: pivotPoints as any,
      bible,
      characters,
      characterNames: characters.map((c) => c.name),
      episodes: episodePlans,
      locations: uniqueLocations,
      isLocked: false,
      genreId: genreModule.meta.id,
      genreName: genreModule.meta.name,
      storyGraph,
    };

    const storyGraphInfo = ` 并完成 ${storyGraph.nodes?.length || 0} 个网状互动节点与分支拓扑图（拓扑质检：${storyGraph.validation?.isPass ? '通过' : '待优化'}，收束率：${((storyGraph.validation?.convergenceRate || 0) * 100).toFixed(0)}%）。`;

    // 将阶段统一交付物 05_stage_artifact.json 直接持久化保存至磁盘
    try {
      const narrativeDir = path.join(context.projectDir, 'narrative');
      fs.mkdirSync(narrativeDir, { recursive: true });
      fs.writeFileSync(
        path.join(narrativeDir, '05_stage_artifact.json'),
        JSON.stringify(artifact, null, 2),
        'utf8'
      );
    } catch (err) {
      console.error('[BibleService] Failed to export 05_stage_artifact.json:', err);
    }

    return {
      stage: WorkflowStage.NARRATIVE_DESIGN,
      artifact,
      requiresIntervention: true,
      stopPointTitle: '互动叙事大纲与网状拓扑确认',
      stopPointDescription: `已成功匹配《${genreModule.meta.name}》范式并完成五级递进式叙事交付物架构（含黄金主干、微交互矩阵、网状拓扑图与角色小传）。${storyGraphInfo}确认后可直接流转下一阶段。`,
    };
  }

  /**
   * AI Copilot Revision - Modifies an existing Story Bible according to user's instruction.
   */
  async reviseBible(
    context: AgentContext,
    existingArtifact: NarrativeDesignArtifact | undefined,
    instruction: string
  ): Promise<AgentResult<NarrativeDesignArtifact>> {
    const { session } = context;

    if (!existingArtifact?.bible) {
      return this.generateBible(context, existingArtifact, instruction);
    }

    const systemPrompt = `你是一位顶尖的互动短剧文学顾问。请根据用户的修改建议，对现有的故事圣经（Story Bible）与人物清单进行精准修改。
只输出更新后的合法 JSON 数据结构，包含 title, theme, style, logline, sellingPoints, characters, episodePlans, genreId, genreName。不要输出额外标记。`;

    const userPrompt = `
【现有故事圣经数据】：
${JSON.stringify(existingArtifact.bible, null, 2)}

【用户的修改指示】：
${instruction}

请在保留已有核心角色设定和未受影响剧情的前提下，完成局部修改与合理演进，输出完整的更新版故事圣经 JSON。`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    let updatedBible: StoryBible;
    try {
      updatedBible = await llmProvider.chatJSON<StoryBible>(messages, 0.5);
    } catch (err) {
      console.error('[BibleService] Failed to parse revised bible JSON:', err);
      updatedBible = existingArtifact.bible;
    }

    const existingCharMap = new Map((existingArtifact.characters || []).map((c) => [c.name, c]));
    const updatedCharacters: CharacterProfile[] = (updatedBible.characters || []).map((c: any) => {
      const prev = existingCharMap.get(c.name);
      return {
        name: c.name,
        role: c.role || prev?.role || '主要人物',
        personality: c.personality || prev?.personality || '',
        appearance: c.appearance || prev?.appearance || '',
        motivation: c.motivation || prev?.motivation || '',
        referenceImageUrl: prev?.referenceImageUrl,
        imageUrl: prev?.imageUrl,
        selected: prev?.selected,
        versions: prev?.versions || [],
        evaluation: prev?.evaluation,
      };
    });

    const updatedArtifact: NarrativeDesignArtifact = {
      ...existingArtifact,
      title: updatedBible.title,
      theme: updatedBible.theme,
      logline: updatedBible.logline,
      sellingPoints: updatedBible.sellingPoints,
      bible: updatedBible,
      characters: updatedCharacters,
      episodes: updatedBible.episodePlans || existingArtifact.episodes,
      characterNames: updatedCharacters.map((c) => c.name),
      isLocked: false,
      genreId: updatedBible.genreId,
      genreName: updatedBible.genreName,
      genreReason: updatedBible.genreReason,
    };

    return {
      stage: WorkflowStage.NARRATIVE_DESIGN,
      artifact: updatedArtifact,
      requiresIntervention: true,
      stopPointTitle: 'AI 修改大纲完成',
      stopPointDescription: `已成功根据您的指令「${instruction}」对大纲进行了精准修改与更新。`,
    };
  }
}

export const bibleService = new BibleService();
