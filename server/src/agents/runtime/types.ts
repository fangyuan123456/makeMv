/**
 * agents/runtime/types.ts
 * Agent 对话与任务消息契约。
 */

export interface PlanStepRecord {
  stepIndex: number;
  taskId: string;
  tool: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: { current?: number; total?: number; message?: string; percent?: number };
  durationMs?: number;
  error?: string;
}

export interface ChatImageAttachment {
  url: string;
  name?: string;
}

export interface ConversationMessage<TIntent = any> {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** 开跑前言对白（方案锁定、授权开跑时的前置说明，与卡片上方对白绑定） */
  leadInSpeech?: string;
  /** 任务全部物理落盘后出具的阶段复盘对白（与卡片下方对白绑定） */
  postSummarySpeech?: string;
  attachments?: ChatImageAttachment[];
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
  /** 多步 Plan 编排的子任务清单（1 条父消息统筹 N 个原子子 Task） */
  planSteps?: PlanStepRecord[];
  metadata?: Record<string, any>;
}

export interface ParsedIntentResult<TIntent = any> {
  cleanText: string;
  intent: TIntent | null;
  messageId?: string;
  task?: import('../../task-engine/types.js').TaskRecord;
  dispatchError?: string;
}

export interface AgentFocusTarget {
  /** 目标类别标识，如 'shot' | 'character' | 'location' | 'item' | 'prd_node' */
  kind: string;
  /** 目标唯一标识，如 'c1-01' | 'char_ailin' | 'I_c1' */
  id: string;
  /** 面向人类可读的目标名称，如 '镜头 01' | '艾琳' */
  label: string;
  /** 可选子步骤/子视图，如 '首帧处理' | '末帧处理' | '视频处理' */
  subview?: string;
}

export interface AgentFocusContext {
  /** 当前停留的界面/画布位置，如 '分镜画布' | '镜头处理页' | '定妆工坊' | 'PRD 故事拓扑图' */
  location: string;
  /** 可选：当前选中的具体目标对象 */
  target?: AgentFocusTarget;
  /** 可选：附带给后端反查详情用的结构化键值 */
  meta?: Record<string, string | number | boolean | undefined>;
}

export interface AgentStreamOptions<TIntent = any> {
  message: string;
  attachments?: ChatImageAttachment[];
  focus?: AgentFocusContext;
  isSystemTrigger?: boolean;
  targetMessageId?: string;
  abortSignal?: AbortSignal;
  onTextChunk?: (chunk: string) => void;
  onDone?: (result: ParsedIntentResult<TIntent>) => void | Promise<void>;
  onError?: (err: Error) => void;
}

import type { z } from 'zod';

export interface SubmittableToolSpec {
  /** 工具法定唯一标识，例如 planner.screenplay_writer */
  toolName: string;
  /** 卡片业务标题，例如“推演互动全景剧本” */
  title: string;
  /** 简明标准工序阶段名，例如“首帧关键帧渲染”，缺失时回退使用 title */
  stageName?: string;
  /** 工具制片职责说明 */
  description: string;
  /** 严格强类型的入参 Schema (Zod) */
  schema: z.ZodType<any>;
  /** 实体作用域类型（如 global, character, shot），用于流水线 SOP 顺位推导与实体绑定 */
  targetKind?: 'shot' | 'character' | 'location' | 'item' | 'global';
}

export interface SessionActionIntent {
  /**
   * 意图动作类型：
   * - propose: 出具新方案，等待创作者审核
   * - approve: 识别到创作者在自然语言中发出了明确授权（“同意/准了/开跑”），确认授权执行当前工序
   * - modify: 吸收创作者修改反馈，重塑参数提案
   */
  action: 'propose' | 'approve' | 'modify' | 'chat_only';
  tool?: string;
  stage?: string;
  title: string;
  params: Record<string, any>;
  operations?: Array<{ tool: string; title: string; params: Record<string, any> }>;
  description?: string;
  reasoning?: string;
  reply?: string;
}

export type PlannerActionIntent = SessionActionIntent;
