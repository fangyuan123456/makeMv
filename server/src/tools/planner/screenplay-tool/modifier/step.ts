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
  type ScreenplayModifierInput,
  type ScreenplayModifierOutput,
} from './schema.js';
import {
  SCREENPLAY_MODIFIER_SYSTEM_PROMPT,
  buildScreenplayModifierUserPrompt,
} from './prompt.js';

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
    let existingScreenplay = store.getArtifact<string>(projectId, 'screenplay');

    if (!existingScreenplay || !existingScreenplay.trim()) {
      const screenplayPath = path.join(store.getProjectDir(projectId), 'screenplay.md');
      if (fs.existsSync(screenplayPath)) {
        existingScreenplay = fs.readFileSync(screenplayPath, 'utf-8');
      }
    }

    if (!existingScreenplay || !existingScreenplay.trim()) {
      throw new Error(`[ScreenplayModifier] 项目 [${projectId}] 尚未生成初始剧本，无法执行局部微调`);
    }

    const agent = new Agent({
      name: 'screenplay-modifier-agent',
      instructions: SCREENPLAY_MODIFIER_SYSTEM_PROMPT,
      model: LLMProvider.getModel(),
    });

    const prompt = buildScreenplayModifierUserPrompt({
      existingScreenplay,
      instruction,
      targetAct,
    });

    const result = (await generateStructured({
      agent,
      prompt,
      schema: ScreenplayModifierOutputSchema,
      stage: 'planner-tool',
      step: 'screenplay-text-patch',
      label: '剧本局部文本Patch',
      abortSignal,
    })) as ScreenplayModifierOutput;

    const finalScript = (result?.scriptMarkdown || result?.patchedScriptMarkdown || '').trim();

    if (!finalScript) {
      throw new Error('[ScreenplayModifier] 大模型未返回有效的 Patch 剧本正文 (scriptMarkdown 字段为空)');
    }

    // 原子同步写回 ProjectStore 与本地磁盘 screenplay.md
    store.setArtifact(projectId, 'screenplay', finalScript);
    const screenplayFile = path.join(store.getProjectDir(projectId), 'screenplay.md');
    fs.writeFileSync(screenplayFile, finalScript, 'utf-8');

    return {
      success: true,
      summaryOfChanges: result.summaryOfChanges || '已完成局部文本外科手术修复',
      scriptMarkdown: finalScript,
      patchedScriptMarkdown: finalScript,
    };
  },
});
