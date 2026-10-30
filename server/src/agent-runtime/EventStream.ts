/**
 * agent-runtime/EventStream.ts
 * 事件流核心实现 —— 全系统统一流式事件与事实来源 (SSOT)
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { AgentEvent } from './contracts/Events.js';

export type EventHandler<T extends AgentEvent = AgentEvent> = (event: T) => void;

export class EventStream {
  private readonly emitter = new EventEmitter();
  private readonly history: AgentEvent[] = [];
  private readonly projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
    this.emitter.setMaxListeners(100);
  }

  /**
   * 发布事件到流中，自动补充 id、timestamp、projectId
   */
  emit<T extends AgentEvent>(event: Omit<T, 'id' | 'timestamp' | 'projectId'>): T {
    const fullEvent = {
      ...event,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      projectId: this.projectId,
    } as T;

    this.history.push(fullEvent);
    this.emitter.emit(fullEvent.type, fullEvent);
    this.emitter.emit('*', fullEvent);
    return fullEvent;
  }

  /**
   * 订阅特定类型事件
   */
  on<T extends AgentEvent>(type: T['type'] | '*', handler: EventHandler<T>): () => void {
    this.emitter.on(type, handler as EventHandler);
    return () => this.emitter.off(type, handler as EventHandler);
  }

  /**
   * 单次订阅
   */
  once<T extends AgentEvent>(type: T['type']): Promise<T> {
    return new Promise<T>((resolve) => {
      this.emitter.once(type, resolve as EventHandler);
    });
  }

  /**
   * 获取所有事件历史
   */
  getHistory(): readonly AgentEvent[] {
    return this.history;
  }
}
