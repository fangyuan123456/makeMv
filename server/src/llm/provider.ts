/**
 * llm/provider.ts
 * 模型工厂与驱动提供者 (LLM Provider SSOT)
 *
 * 核心职责：
 * 遵循 Mastra 官方微内核理念，专注于为 Agent 提供符合 LanguageModelV1 规范的模型硬件驱动。
 * 采用透明代理模式 (Transparent Proxy)，确保无论何时切换 Mock/Real 模型，所有预实例化的 Agent 均能实时生效。
 */

import type { LanguageModelV1 } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { MockLanguageModel } from './mock-model.js';
import { healStructuredObjectText } from '../mastra-compat/jsonHealing.js';
import { config } from '../utils/config.js';
import { ConcurrencyPool } from '../workflow-engine/concurrency.js';
import {
  RunAbortedError,
  combineAbortSignals,
  getRunContext,
} from '../workflow-engine/run-context.js';

/**
 * 是否需要在请求体中注入 enable_thinking=false。
 * 该字段是硅基流动推理模型的私有开关；换成其他网关时不透传，避免请求体被拒。
 */
export function shouldDisableThinking(baseURL: string): boolean {
  return !config.llm.enableThinking && /siliconflow\.cn/i.test(baseURL);
}

/**
 * 给 OpenAI 兼容请求体注入 enable_thinking:false，用于关掉 DeepSeek 系推理模型的思考链。
 * 只改请求体 JSON，其他一切原样透传。
 */
function withThinkingDisabled() {
  return async (input: any, init?: any) => {
    if (init && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);
        if (!('enable_thinking' in body)) {
          body.enable_thinking = false;
          init = { ...init, body: JSON.stringify(body) };
        }
      } catch {
        // 非 JSON 请求体，原样透传
      }
    }
    return instrumentedFetch()(input, init);
  };
}

/**
 * 诊断用 HTTP 观测：开启 LLM_DEBUG_HTTP=1 时打印请求体规模、响应 finish_reason 与工具调用。
 */
function instrumentedFetch() {
  if (process.env.LLM_DEBUG_HTTP !== '1') return fetch;

  return async (input: any, init?: any) => {
    const reqLen = typeof init?.body === 'string' ? init.body.length : 0;
    let toolNames: string[] = [];
    if (typeof init?.body === 'string') {
      try {
        const b = JSON.parse(init.body);
        toolNames = (b.tools || []).map((t: any) => t.function?.name).filter(Boolean);
      } catch {}
    }
    const res = await fetch(input, init);
    const clone = res.clone();
    try {
      const text = await clone.text();
      const j = JSON.parse(text);
      const choice = j.choices?.[0];
      console.log(
        `[HTTP] req=${reqLen}B tools=[${toolNames.join(',')}] status=${res.status} finish=${choice?.finish_reason} calls=[${(choice?.message?.tool_calls || [])
          .map((t: any) => t.function?.name)
          .join(',')}] textLen=${(choice?.message?.content || '').length}`
      );
      if (j.error) console.log(`[HTTP] error=${JSON.stringify(j.error).slice(0, 200)}`);
    } catch {
      console.log(`[HTTP] req=${reqLen}B status=${res.status} (非 JSON 响应)`);
    }
    return res;
  };
}

function isMockModel(model: LanguageModelV1): boolean {
  return model instanceof MockLanguageModel || model.provider === 'mock-provider';
}

/**
 * 解析本次调用的取消信号：SDK 传入 + 任务取消。
 * 注意这里只承载「取消」，不含超时 —— 排队也算进超时预算会误杀并发场景。
 */
function resolveCancelSignal(optionsAbortSignal?: AbortSignal): AbortSignal | undefined {
  const runCtx = getRunContext();
  const cancelSignal = combineAbortSignals(optionsAbortSignal, runCtx?.abortSignal);
  if (cancelSignal?.aborted) {
    throw new RunAbortedError('[LLMProvider] 模型调用已因任务取消中止');
  }
  return cancelSignal;
}

/**
 * 单次调用超时计时器。必须在拿到算力槽位之后才启动：
 * 否则 batch 池排队时长会被计进单次请求预算，多工序并发时会莫名超时。
 */
function startCallTimeout(active: LanguageModelV1): {
  timeoutSignal?: AbortSignal;
  cleanup: () => void;
} {
  if (isMockModel(active)) {
    return { cleanup: () => {} };
  }

  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => {
    timeoutCtrl.abort(
      new DOMException(`[LLMProvider] 单次模型调用超时 (${config.llm.timeoutMs}ms)`, 'TimeoutError')
    );
  }, config.llm.timeoutMs);
  timer.unref?.();

  return { timeoutSignal: timeoutCtrl.signal, cleanup: () => clearTimeout(timer) };
}

function wrapStreamLifecycle(
  res: Awaited<ReturnType<LanguageModelV1['doStream']>>,
  onFinish: () => void
): Awaited<ReturnType<LanguageModelV1['doStream']>> {
  let finished = false;
  const finishOnce = () => {
    if (!finished) {
      finished = true;
      onFinish();
    }
  };
  if (!res?.stream) {
    finishOnce();
    return res;
  }
  const reader = res.stream.getReader();
  const wrappedStream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          finishOnce();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        finishOnce();
        controller.error(err);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        finishOnce();
      }
    },
  });
  return { ...res, stream: wrappedStream };
}

export class LLMProvider {
  private static modelInstance: LanguageModelV1 | null = null;
  private static proxyInstance: LanguageModelV1 | null = null;
  private static batchPool: ConcurrencyPool = new ConcurrencyPool(config.llm.maxConcurrency);

  public static getBatchPool(): ConcurrencyPool {
    return this.batchPool;
  }

  /**
   * 获取底层当前真实激活的模型实例
   */
  public static getActiveModel(): LanguageModelV1 {
    if (!this.modelInstance) {
      const isReal =
        (config.llm.provider === 'real' || config.llm.provider === 'openai') &&
        Boolean(config.llm.apiKey);
      if (isReal) {
        const baseURL = (
          config.llm.baseURL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
        ).replace(/\/+$/, '');
        console.log(
          `[LLMProvider] 挂载生产级商用模型 (LanguageModelV1): ${config.llm.model} (${baseURL}) | 思考链: ${config.llm.enableThinking ? '开' : '关'}`
        );
        const openai = createOpenAI({
          baseURL,
          apiKey: config.llm.apiKey,
          // 硅基流动的推理模型支持 enable_thinking 开关；其他网关不透传该字段，避免请求体被拒
          ...(shouldDisableThinking(baseURL)
            ? { fetch: withThinkingDisabled() }
            : {}),
        });
        this.modelInstance = openai(
          config.llm.model || 'qwen-plus'
        ) as unknown as LanguageModelV1;
      } else {
        console.log(`[LLMProvider] 挂载离线确定性驱动 (MockLanguageModel)`);
        this.modelInstance = new MockLanguageModel();
      }
    }
    return this.modelInstance;
  }

  /**
   * 获取 Mastra 原生 Agent 所需的标准 LanguageModelV1 实例 (动态透明代理)
   */
  public static getModel(): LanguageModelV1 {
    if (!this.proxyInstance) {
      this.proxyInstance = new Proxy({} as LanguageModelV1, {
        get(_target, prop) {
          const active = LLMProvider.getActiveModel();
          // 商业网关统一以 json_object 模式生成结构化对象，避免 OpenAI tool_choice 在 DeepSeek 等模型上陷入复读死锁
          if (prop === 'defaultObjectGenerationMode' && !isMockModel(active)) {
            return 'json';
          }
          if (prop === 'supportsStructuredOutputs' && !isMockModel(active)) {
            return false;
          }
          if (prop === 'doGenerate') {
            return async (options: any) => {
              const runCtx = getRunContext();
              const cancelSignal = resolveCancelSignal(options?.abortSignal);
              let release: (() => void) | undefined;
              let stopTimeout: () => void = () => {};
              try {
                if (runCtx?.lane === 'batch') {
                  // 排队期间只受取消信号约束，不消耗单次调用的超时预算
                  release = await LLMProvider.batchPool.acquire(cancelSignal);
                }
                if (cancelSignal?.aborted) {
                  throw new RunAbortedError('[LLMProvider] 模型调用已因任务取消中止');
                }
                const timeout = startCallTimeout(active);
                stopTimeout = timeout.cleanup;
                const abortSignal = combineAbortSignals(cancelSignal, timeout.timeoutSignal);
                const nextOptions = abortSignal ? { ...options, abortSignal } : options;
                const result = await active.doGenerate(nextOptions);
                // 结构化对象生成：模型写入的 null 可选字段在进入 AI SDK 的 Zod 校验前归一化
                return healStructuredObjectText(result, nextOptions);
              } finally {
                stopTimeout();
                release?.();
              }
            };
          }
          if (prop === 'doStream') {
            return async (options: any) => {
              const runCtx = getRunContext();
              const cancelSignal = resolveCancelSignal(options?.abortSignal);
              let release: (() => void) | undefined;
              let stopTimeout: () => void = () => {};
              try {
                if (runCtx?.lane === 'batch') {
                  release = await LLMProvider.batchPool.acquire(cancelSignal);
                }
                if (cancelSignal?.aborted) {
                  throw new RunAbortedError('[LLMProvider] 模型调用已因任务取消中止');
                }
                const timeout = startCallTimeout(active);
                stopTimeout = timeout.cleanup;
                const abortSignal = combineAbortSignals(cancelSignal, timeout.timeoutSignal);
                const nextOptions = abortSignal ? { ...options, abortSignal } : options;
                const res = await active.doStream(nextOptions);
                return wrapStreamLifecycle(res, () => {
                  stopTimeout();
                  release?.();
                });
              } catch (err) {
                stopTimeout();
                release?.();
                throw err;
              }
            };
          }
          const val = (active as any)[prop];
          if (typeof val === 'function') {
            return val.bind(active);
          }
          return val;
        },
      });
    }
    return this.proxyInstance;
  }

  /**
   * 允许在自动化测试用例中一键切换驱动
   */
  public static setMockModel(mock: LanguageModelV1): void {
    this.modelInstance = mock;
  }

  /**
   * 重置单例驱动
   */
  public static reset(): void {
    this.modelInstance = null;
  }
}
