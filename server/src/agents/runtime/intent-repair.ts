/**
 * agents/runtime/intent-repair.ts
 * 意图参数异常静默自愈纠偏引擎 (Intent Repair Engine SSOT)
 *
 * 核心架构职责：
 * 当大模型首跳调用 emit_director_intent 因漏填 targetTool 或参数缺失触发 Schema 校验拦截时，
 * 静默发起 1 次结构化纠偏重试，确保“口头说开跑/确认”时执行卡片不会漏发。
 */

import type { Agent } from '@mastra/core/agent';
import type { CoreMessage } from 'ai';
import { streamAgentWithCompat } from '../../mastra-compat/streamAgent.js';
import { EMIT_DIRECTOR_INTENT_TOOL_NAME } from './intent-tool.js';

export interface IntentRepairContext {
  sessionId: string;
  agent: Agent;
  workingMessages: CoreMessage[];
  existingSpeech: string;
  errorMessage: string;
  resolveIntent: (args: any) => any;
  abortSignal?: AbortSignal;
}

export class IntentRepairEngine {
  public static async repair(ctx: IntentRepairContext): Promise<{ intent: any; reply?: string } | null> {
    const correctionPrompt = `【系统参数纠偏】刚才调用 emit_director_intent 未成功解析，原因：${ctx.errorMessage}。请审视创作者最新发言：若创作者表达的是纯肯定/同意/授权开跑待审方案（如“同意/好的/开跑/确认/行/可以”），必须直接调用 emit_director_intent(action: "approve", reply: "收到确认，方案已锁定，立即开跑推演。")；若创作者是提出新方案或修改，请重新补齐 action="propose"、tool 及完整 params；若纯探讨请调用 action="chat_only"。`;

    let repairMessages: CoreMessage[];
    if (ctx.existingSpeech) {
      repairMessages = [
        ...ctx.workingMessages,
        { role: 'assistant', content: ctx.existingSpeech },
        { role: 'user', content: correctionPrompt },
      ];
    } else if (ctx.workingMessages.length > 0) {
      const cloned = [...ctx.workingMessages];
      const last = cloned[cloned.length - 1];
      if (last.role === 'user' && typeof last.content === 'string') {
        cloned[cloned.length - 1] = { role: 'user', content: `${last.content}\n\n${correctionPrompt}` };
        repairMessages = cloned;
      } else {
        repairMessages = [
          ...cloned,
          { role: 'assistant', content: '我需要补齐可执行方案的结构化参数。' },
          { role: 'user', content: correctionPrompt },
        ];
      }
    } else {
      repairMessages = [{ role: 'user', content: correctionPrompt }];
    }

    const retryResult = streamAgentWithCompat(ctx.agent, repairMessages, {
      maxSteps: 1,
      toolChoice: 'required',
      abortSignal: ctx.abortSignal,
    });

    for await (const _chunk of retryResult.textStream) {
      // 静默消费流，确保 toolCalls 收敛完成且不向前端重复推字
    }

    const retryToolCalls = await retryResult.toolCalls;
    if (!Array.isArray(retryToolCalls) || retryToolCalls.length === 0) return null;
    const retryCall = retryToolCalls[0];
    if (retryCall.toolName !== EMIT_DIRECTOR_INTENT_TOOL_NAME) return null;

    const intent = ctx.resolveIntent(retryCall.args);
    const reply = typeof retryCall.args?.reply === 'string' ? retryCall.args.reply.trim() : undefined;
    console.log(`[IntentRepairEngine:${ctx.sessionId}] 静默自愈纠偏成功，已自动补全合法提案`);
    return { intent, reply };
  }
}
