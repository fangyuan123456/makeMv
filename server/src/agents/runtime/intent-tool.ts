import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { SubmittableToolSpec } from './types.js';
import { IntentPolicy } from './intent-policy.js';

export const EMIT_DIRECTOR_INTENT_TOOL_NAME = 'emit_director_intent';

export function createIntentTools(
  specs: SubmittableToolSpec[],
  isSystemTrigger: boolean,
  hasPendingProposal = true
): Record<string, any> | undefined {
  if (!specs.length) return undefined;

  const toolNames = specs.map((spec) => spec.toolName) as [string, ...string[]];
  const toolEnum = z.enum(toolNames);
  const allowPendingActions = !isSystemTrigger && hasPendingProposal;

  const operationSchema = z.object({
    tool: toolEnum.describe('当前步骤目标工具（单一事实来源，必须与编目工具名一致）'),
    title: z.string().trim().min(1).describe('步骤简要标题（例如：角色定妆 · [目标实体名]）'),
    params: z.record(z.any()).describe('当前步骤的输入参数对象'),
  });

  const actionEnum = isSystemTrigger && hasPendingProposal
    ? z.enum(['chat_only'])
    : allowPendingActions
    ? z.enum(['propose', 'modify', 'approve', 'chat_only'])
    : z.enum(['propose', 'chat_only']);

  const intentInputSchema = z.object({
    action: actionEnum.describe('选择制片意图动作（propose: 提议新方案; modify: 精修已有提案; approve: 授权开跑; chat_only: 纯对白）'),
    reply: z.string().min(1).describe('面向创作者的自然语言发言（方案亮点说明、开跑确认、答疑或追问）'),
    ...(allowPendingActions ? {
      invalidatePendingProposal: z.boolean().optional().describe('仅 chat_only 使用：用户明确否定或要求修改旧方案，但还需澄清才能提出新方案时设为 true，使旧卡片失效；纯咨询或暂缓不设置'),
    } : {}),
    title: z.string().optional().describe('下一阶段具体制片工序的主标题（格式如：[实体名/镜号] · [工序名称]，例如“镜02 · 首帧关键帧渲染”；绝对严禁包含“复盘”、“自愈”、“已完成”等汇报性状态词）'),
    description: z.string().optional().describe('面向创作者展示的简明工序业务说明（propose 必填，不含工具名或内部推理，阐述下一阶段将执行的具体内容）'),
    tool: toolEnum.optional().describe('单任务目标工具（仅限单实体单步任务；若批量处理多个实体严禁填此，改填 operations）'),
    params: z.record(z.any()).optional().describe('单任务执行参数（仅限单实体单步任务；若批量处理多个实体严禁填此，改填 operations）'),
    operations: z.array(operationSchema).optional().describe('批量多实体/多步骤 Plan 清单（当涉及 2 个及以上实体，如多个角色/场景/道具/镜头时，必须且唯一使用本字段为每个实体独立列出一条 step，根节点 tool 与 params 留空）'),
  }).refine((data) => {
    if (data.invalidatePendingProposal && data.action !== 'chat_only') return false;
    if (data.action === 'approve') {
      return !data.params && !data.tool && !data.operations;
    }
    return true;
  }, { message: 'invalidatePendingProposal 仅用于 chat_only；approve 不得附带执行参数' });

  const toolDescription = IntentPolicy.getToolDescription(allowPendingActions);

  return {
    [EMIT_DIRECTOR_INTENT_TOOL_NAME]: createTool({
      id: EMIT_DIRECTOR_INTENT_TOOL_NAME,
      description: toolDescription,
      inputSchema: intentInputSchema,
      preserveInputSchema: true,
      execute: async ({ context }) => context,
    }),
  };
}
