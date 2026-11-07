/**
 * agents/director/modifier/steps/run-phases.ts
 * 四段执行器：把「load → plan → apply → commit」串成一次调用
 *
 * 三个媒介 step 共用这段串行骨架——它不是业务抽象，只是调度顺序：
 * spec 四段的中间态在这里以局部变量流转，不经过 workflow 上下文，
 * 因此每一步都有精确类型（不再是 z.any()）。
 */

import { LLMRegistry } from '../../../../llm/LLMRegistry.js';
import type { ModifierSpec, PhaseReporter } from '../spec.js';

export async function runModifierPhases(
  spec: ModifierSpec,
  inputData: any,
  report?: PhaseReporter
): Promise<any> {
  const r: PhaseReporter = typeof report === 'function' ? report : () => {};

  // llm 由 step 注入：spec 只管用，不负责取（取用是一种运行环境依赖，不是业务逻辑）
  const ctx = { ...inputData, llm: LLMRegistry.get() };

  const state = await spec.load(ctx, r);
  const plan = await spec.plan(state, ctx, r);
  const applied = await spec.apply(state, plan, ctx, r);
  const { toolResult, summary } = await spec.commit(state, applied, ctx, r);

  console.log(`[ModifierPipeline] ${spec.title} 修改完成: ${summary}`);
  return { ...inputData, toolResult, lastSummary: summary };
}
