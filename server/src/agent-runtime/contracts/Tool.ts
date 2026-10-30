/**
 * agent-runtime/contracts/Tool.ts
 * 工具类型契约与参数规范定义 (Tool Contract SSOT)
 */

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
}

export interface ToolCall {
  toolName: string;
  parameters: Record<string, any>;
  callId?: string;
}

export interface ToolResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  durationMs?: number;
}

export interface ITool {
  readonly name: string;
  readonly schema: ToolSchema;
  execute(params: Record<string, any>, context?: any): Promise<ToolResult>;
}
