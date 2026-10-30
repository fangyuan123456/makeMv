/**
 * agent-runtime/message/MessageCenter.ts
 * 统一多 Agent 消息中心实现 (Message Center SSOT)
 *
 * 核心机制：
 * 1. 负责基于 (to + projectId) 的精准请求-响应路由 (Request-Response)
 * 2. 负责基于事件主题的发布-订阅广播 (Pub-Sub)
 * 3. 彻底解耦调用方与被调用方的物理依赖
 */

import { randomUUID } from 'crypto';
import type { AgentMessage, AgentResponse, MessageHandler } from '../contracts/AgentMessage.js';

export class MessageCenter {
  private static instance: MessageCenter;
  private readonly handlers = new Map<string, MessageHandler>();
  private readonly subscriptions = new Map<string, Set<(payload: any, projectId: string) => void>>();

  public static getInstance(): MessageCenter {
    if (!MessageCenter.instance) {
      MessageCenter.instance = new MessageCenter();
    }
    return MessageCenter.instance;
  }

  public registerHandler(agentName: string, handler: MessageHandler): void {
    this.handlers.set(agentName, handler);
  }

  public unregisterHandler(agentName: string): void {
    this.handlers.delete(agentName);
  }

  public async request<TInput = unknown, TOutput = unknown>(
    params: Omit<AgentMessage<TInput>, 'id' | 'timestamp'> & { id?: string },
  ): Promise<AgentResponse<TOutput>> {
    const handler = this.handlers.get(params.to);
    if (!handler) {
      return {
        success: false,
        error: `No handler registered for recipient: ${params.to}`,
      };
    }

    const message: AgentMessage<TInput> = {
      ...params,
      id: params.id || randomUUID(),
      timestamp: new Date().toISOString(),
    };

    const start = Date.now();
    try {
      const response = await handler(message);
      return {
        ...response,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  public publish<T = unknown>(event: string, payload: T, projectId: string): void {
    const listeners = this.subscriptions.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(payload, projectId);
        } catch (e) {
          console.error(`[MessageCenter] Error in event listener for "${event}":`, e);
        }
      }
    }
  }

  public subscribe<T = unknown>(event: string, callback: (payload: T, projectId: string) => void): () => void {
    let listeners = this.subscriptions.get(event);
    if (!listeners) {
      listeners = new Set();
      this.subscriptions.set(event, listeners);
    }
    listeners.add(callback);
    return () => {
      listeners?.delete(callback);
    };
  }
}
