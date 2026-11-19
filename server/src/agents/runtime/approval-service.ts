import type { AgentSessionStore } from './session-store.js';
import type { ParsedIntentResult, SessionActionIntent, ConversationMessage } from './types.js';

export function approveProposal<TIntent>(
  store: AgentSessionStore<TIntent>,
  proposalId: string,
  resolveIntent: () => SessionActionIntent
): ParsedIntentResult<TIntent> {
  const messages = store.getMessages();
  const existing = messages.find((message) => message.metadata?.approvedProposalId === proposalId);
  if (existing) return { cleanText: existing.content, intent: existing.proposal || null, messageId: existing.id };

  const pending = [...messages].reverse().find((message) => message.proposal && !message.proposalResolved);
  if (!pending || pending.id !== proposalId) {
    throw new Error('该提案已失效，请刷新对话查看当前待审方案');
  }
  const intent = resolveIntent();
  if (intent?.action !== 'approve') {
    throw new Error(intent?.reply || '该提案无法批准，请检查目标资产');
  }

  pending.proposalResolved = true;
  const createdAt = new Date().toISOString();
  const userMessage: ConversationMessage<TIntent> = {
    id: `msg_user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    role: 'user', content: '同意', createdAt,
  };
  const assistantMessage: ConversationMessage<TIntent> = {
    id: `msg_assistant_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    role: 'assistant',
    content: `已确认【${intent.title}】，开始执行。`,
    createdAt,
    proposal: intent as TIntent,
    proposalResolved: true,
    metadata: { approvedProposalId: proposalId },
  };
  messages.push(userMessage, assistantMessage);
  store.writeMessages(messages);
  return { cleanText: assistantMessage.content, intent: intent as TIntent, messageId: assistantMessage.id };
}
