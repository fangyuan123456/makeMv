/**
 * tools/film-production/shooting-script-tool/step.ts
 * 导演摄制台本执行工序 (Shooting Script Step)
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../llm/index.js';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { generateStructured } from '../../../utils/llm-diagnostics.js';
import { getProjectStorySections } from '../../../project-store/story-sections.js';
import { buildBranchContext } from '../../../project-store/story-context.js';
import {
  ShootingScriptInputSchema,
  ShootingScriptOutputSchema,
  type ShootingScriptInput,
  type ShootingScriptOutput,
} from './schema.js';
import { buildShootingScriptPrompt } from './prompt.js';
import { extractNarrativeDialogues, verifyDialogueCoverage } from './verifier.js';
import { resolveEntityBindingsFromText } from '../../../media/compiler/media-semantic-compiler.js';

export const shootingScriptStep = createStep({
  id: 'shooting-script-step',
  description: '将剧本文学分幕深化扩展为包含时空环境锁与纯物理动作流的导演摄制台本',
  inputSchema: ShootingScriptInputSchema,
  outputSchema: ShootingScriptOutputSchema,
  execute: async ({ context }) => {
    const ctx = (context as any) || {};
    const input = (ctx.triggerData || ctx.inputData || ctx || {}) as ShootingScriptInput;
    const store = ProjectStore.getInstance();
    const abortSignal = (input as any)?.abortSignal || (input as any)?._context?.abortSignal;

    const filmSpec = store.getArtifact<any>(input.projectId, 'film_spec') || { clips: [] };
    const currentClip = (filmSpec.clips || []).find((c: any) => c.clipId === input.clipId);

    const storySections = getProjectStorySections(input.projectId, input.storyMarkdown);
    const sectionMeta = storySections[input.clipId];
    const clipTitle = sectionMeta?.title || currentClip?.title || input.clipId;
    const narrativeText = sectionMeta?.narrativeText || '';
    if (!narrativeText.trim()) {
      throw new Error(`[ShootingScriptTool] 分幕 [${input.clipId}] 缺少剧情正文，请先补全剧本`);
    }

    const entities = store.getArtifact<any>(input.projectId, 'lookdev_entities') || { characters: [], locations: [], items: [] };

    // 宏观全剧故事因果
    const prd = store.getArtifact<any>(input.projectId, 'universal_prd') || store.getArtifact<any>(input.projectId, 'prd') || {};
    const branchContext = buildBranchContext(
      {
        clips: prd.clips || [],
        interactions: prd.interactions || [],
        wiring: prd.wiring || [],
        startNodeId: prd.startNodeId,
      },
      input.clipId,
      storySections
    );

    const storyOverview = input.storyOverview || prd?.oneSentenceSummary || prd?.logline || prd?.storyline || prd?.premise || prd?.title;
    const previousClipSummary = branchContext.previousClipSummary;
    const nextClipSummary = branchContext.nextClipSummary;

    const agent = new Agent({
      name: 'shooting-script-director',
      instructions:
        '你是国际顶级电影摄影指导与执行导演。负责将文学剧本深化为纯物理动作表演流与时空环境锁，严禁文学心理与散文修辞，严格输出标准结构化台本。',
      model: LLMProvider.getModel(),
    });

    const prompt = buildShootingScriptPrompt({
      clipId: input.clipId,
      clipTitle,
      narrativeText,
      characters: entities.characters || [],
      locations: entities.locations || [],
      items: entities.items || [],
      instruction: input.instruction?.trim() || undefined,
      storyOverview,
      previousClipSummary,
      nextClipSummary,
    });

    const result = (await generateStructured({
      agent,
      prompt,
      schema: ShootingScriptOutputSchema.omit({ projectId: true, clipId: true, clipTitle: true }),
      stage: 'film-tool',
      step: 'shooting-script',
      label: `摄制台本·${input.clipId}`,
      abortSignal,
    })) as {
      environmentLock: any;
      actionBeats: any[];
    };

    // 服务端通用语义解析器：精准扫描正文对齐角色、道具与场景资产 ID
    let beats = (result.actionBeats || []).map((beat: any, idx: number) => {
      const textToScan = `${beat.beatTitle || ''} ${beat.actionDescription || ''}`;
      const resolved = resolveEntityBindingsFromText(textToScan, entities);

      const mergedCharIds = Array.from(new Set([...(beat.characterIds || []), ...resolved.characterIds]));
      const mergedItemIds = Array.from(new Set([...(beat.itemIds || []), ...resolved.itemIds]));

      return {
        ...beat,
        beatId: beat.beatId || `b${idx + 1}`,
        shotNumber: beat.shotNumber || idx + 1,
        location: beat.location || resolved.locationName,
        locationId: beat.locationId || resolved.locationId,
        characterIds: mergedCharIds,
        itemIds: mergedItemIds,
      };
    });

    // ─────────────────────────────────────────────────────────────
    // 🛡️ 工业级台词覆盖率核验与自愈 (Dialogue Coverage Verifier)
    // ─────────────────────────────────────────────────────────────
    try {
      const narrativeDialogues = await extractNarrativeDialogues(narrativeText, abortSignal);
      const coverage = verifyDialogueCoverage(beats, narrativeDialogues);
      if (!coverage.isFullyCovered && coverage.missingLines.length > 0) {
        console.warn(
          `[ShootingScriptTool] 发现 ${coverage.missingLines.length} 处原著台词未被分配镜头，自动触发补镜自愈:`,
          coverage.missingLines
        );
        for (const missing of coverage.missingLines) {
          const matchedChar = (entities.characters || []).find((c: any) => c.name === missing.speaker);
          const healSeconds = Math.min(15, Math.max(5, Math.ceil((missing.line || '').length / 3) + 2));
          beats.push({
            beatId: `b_heal_${beats.length + 1}`,
            shotNumber: beats.length + 1,
            space: beats[beats.length - 1]?.space || '内景',
            beatTitle: `镜头 ${String(beats.length + 1).padStart(2, '0')}（近景反打 · ${missing.speaker}台词补入 · ${healSeconds}s）`,
            actionDescription: `${missing.speaker}神情微动，开口说道：“${missing.line}”（伴随细微呼吸与环境声景）。`,
            characterIds: matchedChar ? [matchedChar.characterId] : [],
            itemIds: [],
            estimatedSeconds: healSeconds,
          });
        }
      }
    } catch (verifyErr) {
      console.warn('[ShootingScriptTool] 台词核验自愈非阻塞警告:', verifyErr);
    }

    const output: ShootingScriptOutput = {
      projectId: input.projectId,
      clipId: input.clipId,
      clipTitle,
      environmentLock: result.environmentLock,
      actionBeats: beats,
    };

    const shootingScriptPayload = {
      clipId: input.clipId,
      clipTitle,
      environmentLock: output.environmentLock,
      actionBeats: output.actionBeats,
      generatedAt: new Date().toISOString(),
    };

    // 1. 原子持久化到 film_spec.json
    store.mutateArtifact(input.projectId, 'film_spec', (currentSpec: any) => {
      const spec = currentSpec || { clips: [] };
      const clips = [...(spec.clips || [])];
      const clipIndex = clips.findIndex((c: any) => c.clipId === input.clipId || c.sourceNodeId === input.clipId);
      if (clipIndex >= 0) {
        clips[clipIndex] = {
          ...clips[clipIndex],
          shootingScript: shootingScriptPayload,
        };
      } else {
        clips.push({
          clipId: input.clipId,
          sourceNodeId: input.clipId,
          targetDurationSec: 5.0,
          shots: [],
          shootingScript: shootingScriptPayload,
        });
      }
      return {
        ...spec,
        clips,
      };
    });

    // 2. 双向原子持久化到 storyboards.json
    store.mutateArtifact(input.projectId, 'storyboards', (currentRaw: any) => {
      const rawStoryboards = Array.isArray(currentRaw) ? currentRaw : [];
      return rawStoryboards.map((item: any) => {
        if (
          item.clipId === input.clipId ||
          item.id === input.clipId ||
          item.sourceNodeId === input.clipId ||
          item.clipId === `c${input.clipId.replace(/\D/g, '')}`
        ) {
          return {
            ...item,
            shootingScript: shootingScriptPayload,
          };
        }
        return item;
      });
    });

    return output;
  },
});
