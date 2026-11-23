/**
 * tools/film-production/storyboard-breakdown-tool/steps/01-breakdown/step.ts
 * 单幕分镜剧本拆分执行工序 (Storyboard Breakdown Step)
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../../llm/index.js';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { generateStructured } from '../../../../../utils/llm-diagnostics.js';
import { getProjectStorySections } from '../../../../../project-store/story-sections.js';
import {
  StoryboardBreakdownInputSchema,
  StoryboardBreakdownOutputSchema,
  type StoryboardBreakdownInput,
  type StoryboardBreakdownOutput,
} from './schema.js';
import { buildStoryboardBreakdownPrompt } from './prompt.js';
import { buildBranchContext } from '../../../../../project-store/story-context.js';

export const storyboardBreakdownStep = createStep({
  id: 'storyboard-breakdown-step',
  description: '将剧本分幕初次拆解为镜头台本骨架序列',
  inputSchema: StoryboardBreakdownInputSchema,
  outputSchema: StoryboardBreakdownOutputSchema,
  execute: async ({ context }) => {
    const ctx = (context as any) || {};
    const input = (ctx.triggerData || ctx.inputData || ctx || {}) as StoryboardBreakdownInput;
    const store = ProjectStore.getInstance();
    const abortSignal = (input as any)?.abortSignal || (input as any)?._context?.abortSignal;

    const filmSpec = store.getArtifact<any>(input.projectId, 'film_spec') || { clips: [] };
    const currentClip = (filmSpec.clips || []).find((c: any) => c.clipId === input.clipId);

    const storySections = getProjectStorySections(input.projectId, input.storyMarkdown);
    const sectionMeta = storySections[input.clipId];
    const clipTitle = sectionMeta?.title || currentClip?.title || input.clipId;
    const narrativeText = sectionMeta?.narrativeText || '';
    if (!narrativeText.trim()) {
      throw new Error(`[StoryboardBreakdownTool] 分幕 [${input.clipId}] 缺少剧情正文，请先补全剧本`);
    }

    const entities = store.getArtifact<any>(input.projectId, 'lookdev_entities') || { characters: [], locations: [], items: [] };

    // 自动自愈提取宏观全剧故事因果
    const prd = store.getArtifact<any>(input.projectId, 'universal_prd') || store.getArtifact<any>(input.projectId, 'prd') || {};
    const branchContext = buildBranchContext({
      clips: prd.clips || [],
      interactions: prd.interactions || [],
      wiring: prd.wiring || [],
      startNodeId: prd.startNodeId,
    }, input.clipId, storySections);

    const storyOverview = input.storyOverview || prd?.oneSentenceSummary || prd?.logline || prd?.storyline || prd?.premise || prd?.title;
    const previousClipSummary = branchContext.previousClipSummary;
    const nextClipSummary = branchContext.nextClipSummary;

    const agent = new Agent({
      name: 'storyboard-breakdown-director',
      instructions: '你是专业电影分镜总导演。专职负责剧本文学台本的镜头化切分、景别调度、戏剧冲突与台词拟音规划。严格遵循前后因果与戏剧接戏，杜绝冗长大段生图词，输出标准结构。',
      model: LLMProvider.getModel(),
    });

    const prompt = buildStoryboardBreakdownPrompt({
      clipId: input.clipId,
      clipTitle,
      narrativeText,
      characters: entities.characters || [],
      locations: entities.locations || [],
      items: entities.items || [],
      instruction: input.instruction,
      storyOverview,
      previousClipSummary,
      nextClipSummary,
    });

    const breakdownResult = (await generateStructured({
      agent,
      prompt,
      schema: StoryboardBreakdownOutputSchema.omit({ projectId: true, clipId: true, clipTitle: true }),
      stage: 'film-tool',
      step: 'storyboard-breakdown',
      label: `分镜切分·${input.clipId}`,
      abortSignal,
    })) as { shots: any[] };

    // 工业级实体依赖图谱自愈对齐（Entity Dependency Auto-Binding SSOT）
    // 若大模型在文字中提及了道具/角色但遗漏了ID，系统依据实体库全局自动对齐，保证参考图 100% 自动注入
    const availableItems: Array<{ itemId: string; name: string }> = Array.isArray(entities.items) ? entities.items : [];
    const availableChars: Array<{ characterId: string; name: string }> = Array.isArray(entities.characters) ? entities.characters : [];

    const output: StoryboardBreakdownOutput = {
      projectId: input.projectId,
      clipId: input.clipId,
      clipTitle,
      shots: (breakdownResult.shots || []).map((shot: any, index: number) => {
        const textToScan = `${shot.title || ''} ${shot.sceneSubject || ''} ${shot.poseDirective?.label || ''} ${shot.poseDirective?.instruction || ''} ${shot.dialogue || ''}`;
        
        // 自动对齐补全 itemIds
        const matchedItemIds = new Set<string>(Array.isArray(shot.itemIds) ? shot.itemIds : []);
        for (const it of availableItems) {
          if (it.name && textToScan.includes(it.name)) {
            matchedItemIds.add(it.itemId);
          }
        }

        // 自动对齐补全 characterIds
        const matchedCharIds = new Set<string>(Array.isArray(shot.characterIds) ? shot.characterIds : []);
        for (const c of availableChars) {
          if (c.name && textToScan.includes(c.name)) {
            matchedCharIds.add(c.characterId);
          }
        }

        return {
          ...shot,
          shotId: shot.shotId || `${input.clipId}-${String(index + 1).padStart(2, '0')}`,
          itemIds: Array.from(matchedItemIds),
          characterIds: Array.from(matchedCharIds),
          items: Array.from(matchedItemIds), // 契约双向统一
          characters: Array.from(matchedCharIds),
        };
      }),
    };

    return output;
  },
});
