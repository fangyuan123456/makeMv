/**
 * agent-runtime/pipeline/PipelineStep.ts
 * 通用流水线步骤接口与弹性重试规范定义 (纯数据输入输出 SSOT)
 */

export interface RetryPolicy {
  maxRetries: number;       // 最大重试次数（如 2）
  backoffMs?: number;       // 重试等待毫秒（默认 1000ms）
  exponential?: boolean;    // 是否开启指数退避（如 1s -> 2s -> 4s，默认 true）
}

export interface PipelineStep<TInput = any, TOutput = any> {
  readonly name: string;
  readonly retry?: RetryPolicy;
  run(input?: TInput): Promise<TOutput>;
}
