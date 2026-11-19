import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { SubmittableToolSpec } from './types.js';

export const EMIT_DIRECTOR_INTENT_TOOL_NAME = 'emit_director_intent';

export function createIntentTools(
  specs: SubmittableToolSpec[],
  isSystemTrigger: boolean,
  allowPostTaskProposal: boolean,
  hasPendingProposal = true
): Record<string, any> | undefined {
  if (!specs.length) return undefined;

  const mayPropose = isSystemTrigger && allowPostTaskProposal;
  // 纯系统复盘场景（不允许发起新提案）无需强绑意图工具，直接纯文本流式输出完整复盘，彻底避免 JSON 参数包裹与吞字
  if (isSystemTrigger && !mayPropose) return undefined;

  const availableTools = specs
    .map((spec) => `- ${spec.toolName}: ${spec.description} (卡片标题: ${spec.title})`)
    .join('\n');
  const targetNames = specs.map((spec) => spec.toolName) as [string, ...string[]];
  const targetToolEnum = z.enum(targetNames);
  const allowPendingActions = !isSystemTrigger && hasPendingProposal;
  const actionDescription = isSystemTrigger
    ? '- propose: 复盘后若下一工具需要创作者授权，出具待审方案卡片（必须提供 description 与 targetTool + params 或 operations）；\n- chat_only: 仅汇报任务结果。'
    : allowPendingActions
      ? '- propose: 针对新构思、已有产物重绘/重新生成或失败重试，出具包含 description 与制片参数的待审方案卡片；\n- approve: 创作者明确同意当前挂起提案时授权执行，只填写 reply；\n- modify: 调整当前待审提案，填写 description 与完整 targetTool + params 或 operations；\n- chat_only: 只填写 reply。'
      : '- propose: 出具包含 description 与完整制片参数的待审方案卡片，单步填写 targetTool + params，批量填写 operations；\n- chat_only: 只填写 reply。';

  const operationSchema = z.object({
    targetTool: targetToolEnum,
    title: z.string().trim().min(1),
    params: z.record(z.any()),
  }).strict();
  const singleFields = {
    targetTool: targetToolEnum,
    params: z.record(z.any()),
    coverage: z.enum(['selected', 'all_pending']).optional(),
  };
  const batchFields = {
    operations: z.array(operationSchema).min(1),
  };
  const proposalFields = {
    reply: z.string().min(1),
    title: z.string().optional(),
    description: z.string().trim().min(1).describe('面向创作者展示的简明业务说明，不含工具名或内部推理'),
  };
  const branches: z.ZodTypeAny[] = [
    z.object({ action: z.literal('propose'), ...proposalFields, ...singleFields }).strict(),
    z.object({ action: z.literal('propose'), ...proposalFields, ...batchFields }).strict(),
    z.object({ action: z.literal('chat_only'), reply: z.string().min(1) }).strict(),
  ];
  if (allowPendingActions) {
    branches.push(
      z.object({ action: z.literal('approve'), reply: z.string().min(1) }).strict(),
      z.object({ action: z.literal('modify'), ...proposalFields, ...singleFields }).strict(),
      z.object({ action: z.literal('modify'), ...proposalFields, ...batchFields }).strict(),
    );
  }

  return {
    [EMIT_DIRECTOR_INTENT_TOOL_NAME]: createTool({
      id: EMIT_DIRECTOR_INTENT_TOOL_NAME,
      description: `制片意图决策工具。依据当前项目状态判定后调用。reply 必须直接回答创作者，不得复述内部动作或协议。
${actionDescription}
当前阶段可选工序:
${availableTools}`,
      inputSchema: z.union(branches as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]),
      preserveInputSchema: true,
      execute: async ({ context }) => context,
    }),
  };
}
