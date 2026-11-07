/**
 * agents/director/modifier/steps/common.ts
 * 微调轨上下文契约 (Modifier Workflow Context SSOT)
 *
 * 与 generator/steps/common.ts 对称：生成轨声明生产上下文，修改轨声明微调上下文。
 * 两条路线各自持有自己的契约，任一轨新增字段都不会波及另一条。
 *
 * 这里只放「跨 workflow 边界」的字段——即引擎注入的通用字段和本次请求的入参。
 * 四段之间的中间态（底稿、补丁清单、渲染产物）**不在这里**：它们在 step 内部
 * 以局部变量流转，类型精确，不再退化成 z.any()。
 */

import { z } from 'zod';

export const ModifierContextSchema = z.object({
  /* ── 引擎注入的通用字段 ── */
  projectId: z.string(),
  sessionId: z.string().optional(),
  activeStage: z.string().optional(),
  /** 兼容引擎侧的反馈字段命名 */
  feedback: z.string().optional(),
  payload: z.record(z.any()).optional(),
  overrideParams: z.record(z.any()).optional(),
  lastSummary: z.string().optional(),
  toolResult: z.any().optional(),

  /* ── 微调轨专有字段 ── */
  actionType: z.string().optional(),
  /** 目标工序主责技能键（story-bible 等），管线据此选择媒介分支 */
  targetSkill: z.string().optional(),
  /** 目标条目标识（角色名 / 镜头号 / 切片号） */
  target: z.string().optional(),
  userFeedback: z.string().optional(),
});

export type ModifierWorkflowContext = z.infer<typeof ModifierContextSchema>;
