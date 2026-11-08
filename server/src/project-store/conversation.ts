/**
 * project-store/conversation.ts
 * 会话侧投影：把落盘的原始消息整理成大模型可直接消费的形态 (Conversation Projection SSOT)
 *
 * 为什么在这一层：
 * 本文件不含任何工序、技能或智能体知识，只回答两个问题——「哪些消息算一次有效
 * 对话」「窗口怎么切」。它与 context-assembler 是同层的两种投影：那个投影黑板
 * 态势（System Instructions），这个投影会话历史（messages）。原先它挂在
 * agents/director/memory 下，属于名义上的归属——真正的调用方是 HTTP 路由，
 * 而总导演智能体本身并不读这里。
 *
 * 为什么要集中：
 * 同一套判据原先散在四处（HTTP 路由、两个故事圣经步骤、导演工作记忆），每处各写
 * 一遍 role 过滤与空内容过滤。要加一条「系统插话」前缀就得改四处，漏一处不会
 * 报错，只是悄悄把脏数据喂进 prompt。
 */

import { ProjectStore } from './ProjectStore.js';

/** 送进大模型的单轮对话 */
export interface WorkingTurnMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** 只依赖结构，不绑定具体实现：存量数据常带额外字段，甚至 role/content 缺失 */
type MessageLike = { role?: unknown; content?: unknown } | null | undefined;

/** 历史遗留的系统插话前缀。当前代码已无写入方，仅旧会话里存在，保留判据以防回流 */
const SYSTEM_NOTICE_PREFIX = '🎬【系统工序通知】';

const DEFAULT_MAX_TURNS = 10;

/**
 * 结构兜底用的兜底话术。
 *
 * 刻意不带任何领域口吻：本层不该替调用方决定「用什么身份说话」。需要导演腔、
 * 审查官腔的地方由调用方自己传。
 */
const DEFAULT_FALLBACK_PROMPT = '请根据当前项目进展继续';

/**
 * 是不是一次「有效对话」：角色合法且内容非空。
 *
 * 这是所有会话读取的公共底座——空消息（流式中断留下的占位、只有 tool call 没有
 * 正文的轮次）会让部分模型直接报 400，必须在窗口化之前就排掉。
 */
export function isConversational(m: MessageLike): boolean {
  return (
    !!m &&
    (m.role === 'user' || m.role === 'assistant') &&
    typeof m.content === 'string' &&
    m.content.trim().length > 0
  );
}

/** 是不是系统插话（不是创作者说的，也不是导演说的） */
export function isSystemNotice(m: MessageLike): boolean {
  return typeof m?.content === 'string' && m.content.startsWith(SYSTEM_NOTICE_PREFIX);
}

/**
 * 纯函数内核：把任意消息序列整理成严格合规的轮次。
 *
 * 三条硬约束（缺一条就可能触发大模型 400）：
 * 1. 窗口内有效消息为空 → 用兜底话术起一个 user，绝不返回空数组；
 * 2. 首条必须是 user → 窗口恰好从 assistant 起头时向后修剪，全为 assistant 则前置兜底；
 * 3. 相邻同角色折叠 → 连续两条 user 合并成一条，保证 user/assistant 严格交替。
 */
export function buildWorkingTurns(
  messages: Array<MessageLike> | undefined,
  maxTurns: number = DEFAULT_MAX_TURNS,
  fallbackUserPrompt: string = DEFAULT_FALLBACK_PROMPT
): WorkingTurnMessage[] {
  const valid = (messages || [])
    .filter(isConversational)
    .map((m) => ({
      role: m!.role as 'user' | 'assistant',
      content: String(m!.content).trim(),
    }));

  if (valid.length === 0) {
    return [{ role: 'user', content: fallbackUserPrompt }];
  }

  let windowed = valid.slice(-Math.max(1, maxTurns));

  // 首条保障：窗口可能是从半句话开始的
  const firstUserIndex = windowed.findIndex((m) => m.role === 'user');
  if (firstUserIndex === -1) {
    windowed = [{ role: 'user', content: fallbackUserPrompt }, ...windowed];
  } else if (firstUserIndex > 0) {
    windowed = windowed.slice(firstUserIndex);
  }

  // 严格交替：模型不认「连着两条 user」，只能折叠成一条
  const turns: WorkingTurnMessage[] = [];
  for (const msg of windowed) {
    const last = turns[turns.length - 1];
    if (last && last.role === msg.role) {
      last.content = `${last.content}\n${msg.content}`;
    } else {
      turns.push({ role: msg.role, content: msg.content });
    }
  }

  return turns.length > 0 ? turns : [{ role: 'user', content: fallbackUserPrompt }];
}

/**
 * 取指定会话最近 N 轮，整理成可直接生成/流式的入参。
 *
 * 注意：这里**不**排系统插话。排序会改变已上线会话的既有行为（旧会话里确实存在
 * 这类消息），是否一起排掉属于单独的行为决策，不在搬迁范围内。
 */
export function getWorkingTurns(
  projectId: string,
  sessionId: string,
  maxTurns: number = DEFAULT_MAX_TURNS,
  fallbackUserPrompt: string = DEFAULT_FALLBACK_PROMPT
): WorkingTurnMessage[] {
  const stored = ProjectStore.getInstance().getMessages(projectId, sessionId) || [];
  return buildWorkingTurns(stored, maxTurns, fallbackUserPrompt);
}

/**
 * 解析会话 ID：显式传入优先，否则取该项目最早创建的会话。
 *
 * 工序步骤拿不到会话上下文时靠这条兜底——否则「生成故事圣经」这类后台任务会
 * 完全读不到创作者的原话。
 */
export function resolveSessionId(projectId: string, sessionId?: string): string | undefined {
  if (sessionId) return sessionId;
  try {
    return ProjectStore.getInstance().listSessions(projectId)[0]?.sessionId;
  } catch {
    return undefined;
  }
}

/**
 * 最近几条用户诉求（时间正序，可剔除本轮）。
 *
 * 用途：修改裁决器要解析「再短一点」「太老了」这类省略句，只靠本轮文本无法知道
 * 短的是什么、老的是谁。这些短句恰恰最容易落 unknown、最需要模型补判，也恰恰
 * 最缺信息——所以把上一轮原话一并给出去。
 */
export function recentUserInstructions(
  projectId: string,
  sessionId: string,
  currentText: string = '',
  limit: number = 3
): string[] {
  try {
    const messages = ProjectStore.getInstance().getMessages(projectId, sessionId) || [];
    const texts = messages
      .filter((m: any) => m?.role === 'user')
      .map((m: any) => String(m?.content || '').trim())
      .filter(Boolean);

    // 本轮用户消息在调用前已落库，必须剔除末尾那条，否则会出现一遍和本轮一样的内容
    const current = (currentText || '').trim();
    if (current && texts.length > 0 && texts[texts.length - 1] === current) texts.pop();

    return texts.slice(-Math.max(1, limit));
  } catch (err: any) {
    console.warn(`[Conversation] 读取历史诉求失败（不影响调用方）: ${err?.message || err}`);
    return [];
  }
}

/**
 * 最近一条「导演沉淀」正文：跳过系统插话。
 *
 * 生成轨要的是总导演把多轮沟通收敛成的那段方案，而不是最后一句寒暄；但这条判据
 * 只保证「是 assistant 说的、不是系统插的」，**不保证它一定是总结**——最后一条
 * 也可能是一句反问。要不要按内容特征判定，属于另一次语义改动。
 */
export function latestAssistantDigest(projectId: string, sessionId?: string): string {
  const sid = resolveSessionId(projectId, sessionId);
  if (!sid) return '';

  try {
    const messages = ProjectStore.getInstance().getMessages(projectId, sid) || [];
    const candidates = messages.filter(
      (m: any) => isConversational(m) && m.role === 'assistant' && !isSystemNotice(m)
    );
    const latest = candidates[candidates.length - 1];
    return latest ? String(latest.content).trim() : '';
  } catch (err: any) {
    console.warn(`[Conversation] 读取导演沉淀失败（不影响工序）: ${err?.message || err}`);
    return '';
  }
}

/**
 * 追加一条 assistant 消息。
 *
 * 只用于「不是模型流式产出、但必须让会话结构完整」的场合（例如流式中断后的占位
 * 回复）。文案由调用方给——中断提示用哪种口吻，是本层不该知道的事。
 */
export function appendAssistantMessage(projectId: string, sessionId: string, content: string): void {
  ProjectStore.getInstance().appendMessage(projectId, sessionId, {
    role: 'assistant',
    content,
    timestamp: new Date().toISOString(),
  } as any);
}
