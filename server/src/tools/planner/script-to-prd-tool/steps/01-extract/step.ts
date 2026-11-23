/**
 * tools/planner/script-to-prd-tool/steps/01-extract/step.ts
 * 步骤一：剧本结构语义抽取专属工序执行器 (extractScriptStep)
 *
 * 核心源头治理：
 * 刚性唯一消费 context.triggerData 契约，彻底消灭四重空值合并胶水；
 * 缺失剧本时唯一直连 ProjectStore 黑板水合，契约不符时刚性阻断 (Fail-Fast)。
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../../../llm/index.js';
import { generateStructured } from '../../../../../utils/llm-diagnostics.js';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { validateExtractedRouting } from './validate-routing.js';
import { parseGeneratedScreenplay } from './parse-generated.js';
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

    const generated = parseGeneratedScreenplay(scriptMarkdown);
    if (generated) {
      validateExtractedRouting(scriptMarkdown, generated);
      return generated;
    }

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

    validateExtractedRouting(scriptMarkdown, extracted);
    return extracted;
  },
});
