/**
 * tools/planner/script-to-prd-tool/steps/01-extract/step.ts
 * 步骤一：剧本结构语义抽取专属工序执行器 (extractScriptStep)
 *
 * 核心源头治理：
 * 刚性唯一消费 context.triggerData 契约，彻底消灭四重空值合并胶水；
 * 缺失剧本时唯一直连 ProjectStore 黑板水合，契约不符时刚性阻断 (Fail-Fast)。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../../llm/index.js';
import { generateStructured } from '../../../../../utils/llm-diagnostics.js';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { parseScreenplayMarkdownToStructured } from '../../../../planner/screenplay-tool/steps/02-screenplay/renderer.js';
import type { PremiseOutput } from '../../../../planner/screenplay-tool/steps/01-premise/schema.js';
import {
  ExtractStepInputSchema,
  ExtractedScriptStructureSchema,
  type ExtractStepInput,
  type ExtractedScriptStructure,
} from './schema.js';
import {
  buildScriptToPrdSystemPrompt,
  buildScriptToPrdUserPrompt,
} from './prompt.js';

export const extractScriptStep = createStep({
  id: 'extract-script-structure',
  description: '从完整 Markdown 剧本中提取分幕切片、互动抉择点与结局结构',
  inputSchema: ExtractStepInputSchema,
  outputSchema: ExtractedScriptStructureSchema,
  execute: async ({ context }) => {
    // 刚性消费 Mastra 微内核工作流标准 TriggerData，杜绝任何下游多路猜测
    const input = ((context as any)?.triggerData || (context as any)) as ExtractStepInput;
    const projectId = input?.projectId;

    if (!projectId || typeof projectId !== 'string') {
      throw new Error('[extractScriptStep] 契约执行阻断：缺少法定必填参数 projectId');
    }

    const abortSignal = input.abortSignal;
    let scriptMarkdown = input.scriptMarkdown;
    let title = input.title;

    // 若未显式透传剧本文本，从 ProjectStore 标准黑板唯一读取已落盘的 screenplay
    if (!scriptMarkdown) {
      const store = ProjectStore.getInstance();
      scriptMarkdown = store.getArtifact<string>(projectId, 'screenplay') || undefined;
      if (!title) {
        title = store.getProject(projectId)?.meta?.title || '';
      }
    }

    if (!scriptMarkdown || scriptMarkdown.trim().length === 0) {
      throw new Error(
        `[extractScriptStep] 资产前置门禁阻断：项目 [${projectId}] 尚未生成有效的全景剧本资产 (screenplay)。请先完成步骤 1 剧本创作！`
      );
    }

    // 优先走零大模型确定性直转：直接合并 outline.json 与结构化剧本正文（0 幻觉、0 耗时）
    const store = ProjectStore.getInstance();
    let outline: PremiseOutput | undefined = store.getArtifact<PremiseOutput>(projectId, 'outline') || undefined;
    if (!outline) {
      const outlinePath = path.join(store.getProjectDir(projectId), 'outline.json');
      if (fs.existsSync(outlinePath)) {
        try {
          outline = JSON.parse(fs.readFileSync(outlinePath, 'utf-8')) as PremiseOutput;
        } catch {
          outline = undefined;
        }
      }
    }

    if (
      outline &&
      Array.isArray(outline.actOutlines) &&
      outline.actOutlines.length > 0 &&
      Array.isArray(outline.interactions)
    ) {
      const structured = parseScreenplayMarkdownToStructured(scriptMarkdown, outline);
      const sortedActs = [...outline.actOutlines].sort((a, b) => a.actNumber - b.actNumber);

      // 汇总互动中的状态标签作为基础 stateSchema
      const stateMap = new Map<string, { key: string; label: string; initialValue: boolean; showInHud: boolean; description: string }>();
      for (const inter of outline.interactions) {
        for (const o of inter.outcomes || []) {
          if (o.stateTag?.trim()) {
            const rawTag = o.stateTag.trim().replace(/^[+-]/, '');
            if (rawTag && !stateMap.has(rawTag)) {
              stateMap.set(rawTag, {
                key: rawTag,
                label: rawTag,
                initialValue: false,
                showInHud: true,
                description: `第 ${inter.actNumber} 幕互动触发写入状态`,
              });
            }
          }
        }
        for (const t of inter.config?.targets || []) {
          if (t.stateTag?.trim()) {
            const rawTag = t.stateTag.trim().replace(/^[+-]/, '');
            if (rawTag && !stateMap.has(rawTag)) {
              stateMap.set(rawTag, {
                key: rawTag,
                label: t.name || rawTag,
                initialValue: false,
                showInHud: true,
                description: `搜证目标物【${t.name}】状态`,
              });
            }
          }
        }
      }

      const endings: ExtractedScriptStructure['endings'] = [];
      const endingIdMap = new Map<string, string>();

      for (const inter of outline.interactions) {
        for (const o of inter.outcomes || []) {
          if (o.targetType !== 'ENDING') continue;
          const mapKey = `${inter.actNumber}:${o.key.trim().toUpperCase()}`;
          if (endingIdMap.has(mapKey)) continue;

          const endingId = `e_${inter.actNumber}_${o.key.trim().toLowerCase()}`;
          endingIdMap.set(mapKey, endingId);

          const matchedEnding = structured.endings.find(
            (e) =>
              e.actNumber === inter.actNumber &&
              e.outcomeKey.trim().toUpperCase() === o.key.trim().toUpperCase()
          );

          endings.push({
            id: endingId,
            title: matchedEnding?.endingTitle || o.endingTitle || '专有终局',
            endingType: (matchedEnding?.endingType || o.endingType || 'BE') as 'TE' | 'HE' | 'BE' | 'NE' | 'SE',
            summary: matchedEnding?.narrativeText || o.approachAndCost || '',
          });
        }
      }

      const clips: ExtractedScriptStructure['clips'] = sortedActs.map((act, idx) => {
        const clipId = `c${act.actNumber}`;
        const nextAct = sortedActs[idx + 1];
        const nextClipId = nextAct ? `c${nextAct.actNumber}` : undefined;
        const actScript = structured.acts.find((a) => a.actNumber === act.actNumber);
        const sceneHeader = actScript?.sceneHeader || (act.scenes?.[0] ?? '核心场景');
        const narrativeBody = actScript?.narrativeBody || act.plotSummary || '';

        const inter = outline!.interactions.find((it) => it.actNumber === act.actNumber);

        return {
          id: clipId,
          title: act.title,
          narrativeText: `【场景：${sceneHeader}】\n\n${narrativeBody}`,
          interaction: inter
            ? {
                kind: inter.kind,
                isBranching: inter.isBranching,
                prompt: inter.prompt,
                timeoutSec: inter.timeoutSec ?? null,
                config: inter.config,
                outcomes: inter.outcomes.map((o) => {
                  const mapKey = `${act.actNumber}:${o.key.trim().toUpperCase()}`;
                  return {
                    key: o.key,
                    label: o.label,
                    targetNodeId: o.targetType === 'CONTINUE_MAINLINE' ? nextClipId : undefined,
                    targetEndingId: o.targetType === 'ENDING' ? endingIdMap.get(mapKey) : undefined,
                    stateTag: o.stateTag,
                    feedback: o.feedback,
                  };
                }),
              }
            : null,
        };
      });

      const protagonist = outline.characters?.[0];
      return {
        title: title || outline.title || '未命名互动影游',
        genre: outline.genre,
        playerIdentity: protagonist ? `${protagonist.name}（${protagonist.role}）` : undefined,
        premiseAndPerspective: outline.logline,
        stateSchema: Array.from(stateMap.values()),
        clips,
        endings,
      };
    }

    // 兜底：无 outline.json 的历史数据仍走大模型抽取
    const agent = new Agent({
      name: 'script-parser-agent',
      instructions: buildScriptToPrdSystemPrompt(),
      model: LLMProvider.getModel(),
    });

    const prompt = buildScriptToPrdUserPrompt(scriptMarkdown, title);

    const extracted = (await generateStructured({
      agent,
      prompt,
      schema: ExtractedScriptStructureSchema,
      stage: 'planner-tool',
      step: 'script-extract',
      label: '剧本资产语义解析与结构抽取',
      abortSignal,
    })) as ExtractedScriptStructure;

    return extracted;
  },
});
