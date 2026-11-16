/**
 * server/src/chat/types.ts
 * 通用对话会话微内核强类型契约 (Chat Session SSOT)
 */

export interface SessionChatMessage<TIntent = any> {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  status?: 'streaming' | 'done' | 'error';
  errorMessage?: string;
  proposal?: TIntent;
  proposalResolved?: boolean;
  // ─── 任务绑定与真实生命周期契约 ───
  taskId?: string;
  taskTool?: string;
  taskTitle?: string;
  taskStatus?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  taskProgress?: { current?: number; total?: number; message?: string; percent?: number };
  taskDurationMs?: number;
  taskOutputSummary?: string;
  taskError?: string;
  metadata?: Record<string, any>;
}

export interface ParsedIntentResult<TIntent = any> {
  cleanText: string;
  intent: TIntent | null;
  messageId?: string;
}

export interface StreamChatOptions<TIntent = any> {
  message: string;
  history?: Array<{ role?: unknown; content?: unknown }>;
  isSystemTrigger?: boolean;
  targetMessageId?: string;
  abortSignal?: AbortSignal;
  onTextChunk?: (chunk: string) => void;
  onDone?: (result: ParsedIntentResult<TIntent>) => void;
  onError?: (err: Error) => void;
}

import type { z } from 'zod';

export interface SubmittableToolSpec {
  /** 工具法定唯一标识，例如 planner.screenplay_writer */
  toolName: string;
  /** 卡片业务标题，例如“推演互动全景剧本” */
  title: string;
  /** 工具制片职责说明 */
  description: string;
  /** 严格强类型的入参 Schema (Zod) */
  schema: z.ZodType<any>;
}

export interface SessionActionIntent {
  /**
   * 意图动作类型：
   * - run_tool: 出具新方案或参数修改，等待创作者审核（渲染待审卡片）
   * - approve: 识别到创作者在自然语言中发出了明确授权（“同意/准了/开跑”），确认授权执行当前工序
   * - modify: 吸收创作者修改反馈，重塑参数提案
   * - next_stage: 跨工序推进阶段（如工序1进入工序2）
   */
  action: 'run_tool' | 'approve' | 'modify' | 'next_stage';
  tool?: string;
  stage?: string;
  title: string;
  params: Record<string, any>;
  description?: string;
  reasoning?: string;
}

export type PlannerActionIntent = SessionActionIntent;
