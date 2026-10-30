/**
 * agents/archetype/stages/GenerationStage.ts
 * 阶段 02: 结构化资产生成 (纯数据进 ➔ 纯数据出，Stage 内部原生持有 this.projectId)
 */

import { AgentStage } from '../../../agent-runtime/index.js';
import { LLMRegistry } from '../../../llm/index.js';
import { JsonSanitizer } from '../../../utils/JsonSanitizer.js';
import type { AnalysisOutput, ArchetypeArtifact } from '../types.js';

export class GenerationStage extends AgentStage<AnalysisOutput, ArchetypeArtifact> {
  public readonly name = 'GenerationStage';
  public readonly stageIndex = '02_generation';

  constructor(projectId?: string) {
    super('NARRATIVE_DESIGNER', projectId);
  }

  public async run(analysis: AnalysisOutput): Promise<ArchetypeArtifact> {
    const llm = LLMRegistry.get();

    const systemPrompt = '你是一位资深影视导演与叙事架构师。请根据用户的意图分析，输出严格合法的 JSON 对象。';
    const userPrompt = `
【主题】：${analysis.theme}
【关键词】：${analysis.keywords.join(', ')}
【意图】：${analysis.intent}

请严格输出符合以下结构的 JSON 交付物（严禁任何自然语言开场白）：
{
  "title": "项目标题",
  "summary": "概要说明",
  "elements": [
    { "id": "elem_1", "name": "元素名称", "description": "详细描述" }
  ]
}
`;

    try {
      const responseText = await llm.generateText(userPrompt, systemPrompt, {
        stage: 'archetype_generation',
      });

      const parsed = JsonSanitizer.extractJsonFromText<any>(responseText);

      return {
        title: parsed?.title || '未命名项目',
        summary: parsed?.summary || '由通用 Agent 原型生成',
        analysis,
        elements: Array.isArray(parsed?.elements) ? parsed.elements : [],
        createdAt: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        title: analysis.intent.slice(0, 20) || '默认剧本',
        summary: `意图: ${analysis.intent}`,
        analysis,
        elements: [
          { id: 'elem_1', name: '主线核心', description: analysis.intent }
        ],
        createdAt: new Date().toISOString(),
      };
    }
  }
}
