/**
 * queue/ProgressBus.ts
 * 实时进度事件总线 (SSE / WebSocket 桥接)
 *
 * 职责：
 * 1. 跨 Worker / Web 服务分发 Job 进度事件
 * 2. 供 HTTP 控制器注册 SSE 连接，实时推流给前端
 */

import { EventEmitter } from 'events';
import type { ProgressPayload } from './types.js';

export class ProgressBus {
  private static instance: ProgressBus;
  private readonly emitter = new EventEmitter();

  private constructor() {
    this.emitter.setMaxListeners(200);
  }

  public static getInstance(): ProgressBus {
    if (!ProgressBus.instance) {
      ProgressBus.instance = new ProgressBus();
    }
    return ProgressBus.instance;
  }

  /**
   * 发布指定工程的进度更新
   */
  public emitProgress(payload: ProgressPayload): void {
    this.emitter.emit(`progress:${payload.projectId}`, payload);
    this.emitter.emit('progress:*', payload);
  }

  /**
   * 订阅指定工程的进度更新，返回取消订阅函数
   */
  public subscribe(projectId: string, listener: (payload: ProgressPayload) => void): () => void {
    const eventName = `progress:${projectId}`;
    this.emitter.on(eventName, listener);
    return () => this.emitter.off(eventName, listener);
  }
}
