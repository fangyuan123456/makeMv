/**
 * agents/router/tools/emit-intent.tool.ts
 * 中枢路由总控专属意图决策工具 (Router Intent Tool SSOT)
 *
 * 核心设计：
 * 1. 伴随流式直出：大模型在与创作者探讨达成共识时，通过 Tool Call 发射行动决策；
 * 2. Zod Schema 刚性约束：保证提议类型、目标阶段和参数的强类型合规，杜绝幻觉；
 * 3. 0 伪工具套娃：只负责提议决策，绝对不在工具内部去递归调用大模型或流水线。
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const EMIT_ROUTER_INTENT_TOOL_ID = 'emit_router_intent';

export const RouterIntentSchema = z.object({
  action: z
    .enum(['start_pipeline', 'resume_pipeline', 'modify_stage', 'chat_only'])
    .describe(
      '路由决策类型：' +
        'start_pipeline(创作者阐述了新创意，提议启动影游全流水线) | ' +
        'resume_pipeline(创作者对当前阶段表示满意，提议推进下一工序) | ' +
        'modify_stage(创作者对当前已有产物提出了修改或微调意见) | ' +
        'chat_only(纯粹讨论、解疑答惑或探讨灵感，无需触发工程流水线)'
    ),
  targetStage: z
    .enum(['plan_gdd', 'build_text_game', 'compile_film'])
    .optional()
    .describe('意图所针对的目标工序阶段'),
  summary: z.string().describe('展示给创作者的一句话提议描述，如“已提炼卧底潜伏核心设定，建议启动全案策划推演”'),
  payload: z
    .record(z.any())
    .optional()
    .describe('附加参数，例如微调诉求具体文字、修改实体名称、或提炼后的 userPrompt'),
});

export type RouterIntentInput = z.infer<typeof RouterIntentSchema>;

export const emitRouterIntentTool = createTool({
  id: EMIT_ROUTER_INTENT_TOOL_ID,
  description: '中枢路由总控向创作者发射工程行动决策提案工具。在达成阶段性共识或创作者发出指令时调用。',
  inputSchema: RouterIntentSchema,
  execute: async ({ context }) => {
    // 纯物理记录并返回结构化决策数据，供前端卡片渲染与人在回路仲裁
    return context;
  },
});
