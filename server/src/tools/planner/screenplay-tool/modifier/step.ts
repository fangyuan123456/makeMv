/**
 * tools/planner/screenplay-tool/modifier/step.ts
 * 剧本文本局部 Patch 手术执行器 (screenplayModifierStep)
 */

import fs from 'node:fs';
import path from 'node:path';
import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../llm/index.js';
import { generateStructured } from '../../../../utils/llm-diagnostics.js';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import {
  ScreenplayModifierInputSchema,
  ScreenplayModifierOutputSchema,
  StructuredScreenplayPatchOutputSchema,
  type ScreenplayModifierInput,
  type StructuredScreenplayPatchOutput,
} from './schema.js';
import {
  STRUCTURED_SCREENPLAY_PATCH_SYSTEM_PROMPT,
  buildStructuredScreenplayPatchPrompt,
} from './prompt.js';
import {
  buildStructuredScreenplayDocument,
  parseScreenplayMarkdownToStructured,
} from '../steps/02-screenplay/renderer.js';

export const screenplayModifierStep = createStep({
  id: 'patch-screenplay-text',
  description: '以已有全景剧本为唯一基准，遵照指令执行精准局部文本外科手术 (Text Patch)',
  inputSchema: ScreenplayModifierInputSchema,
  outputSchema: ScreenplayModifierOutputSchema,
  execute: async ({ context }) => {
    const ctx = (context as any) || {};
    const input = (ctx.triggerData || ctx.inputData || ctx || {}) as ScreenplayModifierInput;
    const { projectId, instruction, targetAct } = input;
    const abortSignal = ctx.abortSignal || (input as any)?._context?.abortSignal;

    if (!projectId) {
      throw new Error('[ScreenplayModifier] 缺少必须参数: projectId');
    }

    if (!instruction || !instruction.trim()) {
      throw new Error('[ScreenplayModifier] 缺少必须修改指令: instruction');
    }

    const store = ProjectStore.getInstance();
    let existingScreenplayJson = store.getArtifact<any>(projectId, 'screenplay_json');
    if (!existingScreenplayJson) {
      const screenplayJsonPath = path.join(store.getProjectDir(projectId), 'screenplay.json');
      if (fs.existsSync(screenplayJsonPath)) {
        try {
          existingScreenplayJson = JSON.parse(fs.readFileSync(screenplayJsonPath, 'utf-8'));
        } catch {
          existingScreenplayJson = undefined;
        }
      }
    }

    const existingScreenplay = existingScreenplayJson?.scriptMarkdown || '';

    if (!existingScreenplay.trim()) {
      throw new Error(`[ScreenplayModifier] 项目 [${projectId}] 尚未生成结构化剧本 (screenplay.json)，无法执行局部微调`);
    }

    let outline: any = null;
    let outlineAnchor = '';
    try {
      outline = store.getArtifact<any>(projectId, 'outline');
      if (!outline) {
        const outlinePath = path.join(store.getProjectDir(projectId), 'outline.json');
        if (fs.existsSync(outlinePath)) {
          outline = JSON.parse(fs.readFileSync(outlinePath, 'utf-8'));
        }
      }
      if (outline && Array.isArray(outline.interactions) && outline.interactions.length > 0) {
        const charNames = Array.isArray(outline.characters)
          ? outline.characters.map((c: any) => `${c.name}(${c.role})`).join('、')
          : '';
        const actLines = Array.isArray(outline.actOutlines)
          ? outline.actOutlines
              .map(
                (a: any) =>
                  `- 第 ${a.actNumber} 幕《${a.title}》母场景: ${Array.isArray(a.scenes) ? a.scenes.join(' / ') : ''}`
              )
              .join('\n')
          : '';
        const interactionLines = outline.interactions
          .map((it: any) => {
            const outcomes = Array.isArray(it.outcomes)
              ? it.outcomes
                  .map((o: any) => {
                    const dest =
                      o.targetType === 'ENDING'
                        ? `终局【${o.endingTitle || '终局'}】(${o.endingType || 'BE'})`
                        : '推进主线进入下一幕';
                    return `  * [${o.key}] ${o.label} -> ${dest}`;
                  })
                  .join('\n')
              : '';
            return `- 第 ${it.actNumber} 幕互动节点 (${it.isBranching ? '命运分支' : '单线'} ${it.kind}):\n${outcomes}`;
          })
          .join('\n');

        outlineAnchor = [
          charNames ? `核心角色：${charNames}` : '',
          actLines ? `分幕场景：\n${actLines}` : '',
          `互动分支拓扑（严禁改为假合流）：\n${interactionLines}`,
        ]
          .filter(Boolean)
          .join('\n');
      }
    } catch {
      // 忽略大纲读取异常，不阻断局部修改
    }

    if (
      !outline ||
      !Array.isArray(outline.actOutlines) ||
      outline.actOutlines.length === 0 ||
      !Array.isArray(outline.interactions)
    ) {
      throw new Error(`[ScreenplayModifier] 项目 [${projectId}] 缺少有效大纲拓扑 (outline.json)，无法执行结构化局部修改`);
    }

    const structured =
      existingScreenplayJson && Array.isArray(existingScreenplayJson.acts)
        ? {
            acts: existingScreenplayJson.acts,
            endings: (existingScreenplayJson.endings || []).map((e: any) => ({
              actNumber: e.actNumber,
              outcomeKey: e.outcomeKey,
              endingTitle: e.title || e.endingTitle,
              endingType: e.endingType,
              narrativeText: e.summary || e.narrativeText || '',
            })),
          }
        : parseScreenplayMarkdownToStructured(existingScreenplay, outline);

    const agent = new Agent({
      name: 'screenplay-structured-modifier-agent',
      instructions: STRUCTURED_SCREENPLAY_PATCH_SYSTEM_PROMPT,
      model: LLMProvider.getModel(),
    });

    const prompt = buildStructuredScreenplayPatchPrompt({
      acts: structured.acts,
      endings: structured.endings,
      instruction,
      targetAct,
      outlineAnchor: outlineAnchor || undefined,
    });

    const patchResult = (await generateStructured({
      agent,
      prompt,
      schema: StructuredScreenplayPatchOutputSchema,
      stage: 'planner-tool',
      step: 'screenplay-structured-patch',
      label: '剧本结构化增量Patch',
      abortSignal,
    })) as StructuredScreenplayPatchOutput;

    const updatedActs = structured.acts.map((act: any) => {
      if (targetAct && act.actNumber !== targetAct) return act;
      const patch = patchResult.actPatches?.find((p) => p.actNumber === act.actNumber);
      if (!patch) return act;
      return {
        ...act,
        sceneHeader: patch.sceneHeader?.trim() || act.sceneHeader,
        narrativeBody: patch.narrativeBody?.trim() || act.narrativeBody,
      };
    });

    const updatedEndings = structured.endings.map((ending: any) => {
      if (targetAct && ending.actNumber !== targetAct) return ending;
      const patch = patchResult.endingPatches?.find(
        (p) =>
          p.actNumber === ending.actNumber &&
          p.outcomeKey.trim().toUpperCase() === ending.outcomeKey.trim().toUpperCase()
      );
      if (!patch) return ending;
      return {
        ...ending,
        narrativeText: patch.narrativeText?.trim() || ending.narrativeText,
      };
    });

    const mergedStructured = { acts: updatedActs, endings: updatedEndings };
    const screenplayDocument = buildStructuredScreenplayDocument(outline, mergedStructured);
    const { scriptMarkdown: finalScript, ...persistedScreenplayJson } = screenplayDocument;

    store.setArtifact(projectId, 'screenplay_json', persistedScreenplayJson);
    const screenplayJsonFile = path.join(store.getProjectDir(projectId), 'screenplay.json');
    fs.writeFileSync(screenplayJsonFile, JSON.stringify(persistedScreenplayJson, null, 2), 'utf-8');

    store.setArtifact(projectId, 'screenplay', finalScript);

    return {
      success: true,
      summaryOfChanges: patchResult.summaryOfChanges || '已完成结构化局部精修并确定性重拼',
      scriptMarkdown: finalScript,
      patchedScriptMarkdown: finalScript,
    };
  },
});
