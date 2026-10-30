/**
 * agent-runtime/contracts/Events.ts
 * 全局统一流式事件定义 (Events SSOT)
 */

import type { ToolCall, ToolResult } from './Tool.js';
import type { AgentRole } from './AgentRole.js';

export interface BaseEvent {
  id: string;
  timestamp: string;
  projectId: string;
}

export interface ThoughtEvent extends BaseEvent {
  type: 'THOUGHT';
  agentId: string;
  agentRole: AgentRole;
  content: string;
}

export interface ActionEvent extends BaseEvent {
  type: 'ACTION';
  agentId: string;
  agentRole: AgentRole;
  action: ToolCall;
}

export interface ObservationEvent extends BaseEvent {
  type: 'OBSERVATION';
  agentId: string;
  agentRole: AgentRole;
  result: ToolResult;
}

export interface ProgressEvent extends BaseEvent {
  type: 'PROGRESS';
  stage: string;
  detail: string;
  percent: number;
}

export interface StageCompleteEvent extends BaseEvent {
  type: 'STAGE_COMPLETE';
  stage: string;
  status: 'completed' | 'waiting_for_intervention' | 'failed';
  requiresIntervention: boolean;
  artifact?: any;
}

export interface ErrorEvent extends BaseEvent {
  type: 'ERROR';
  content: string;
  fatal?: boolean;
}

export type AgentEvent =
  | ThoughtEvent
  | ActionEvent
  | ObservationEvent
  | ProgressEvent
  | StageCompleteEvent
  | ErrorEvent;
