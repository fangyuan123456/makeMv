/**
 * agent-runtime/ToolRegistry.ts
 * 工具注册表实现 (Tool Registry SSOT)
 */

import type { ITool, ToolCall, ToolResult } from './contracts/Tool.js';

export class ToolRegistry {
  private readonly tools = new Map<string, ITool>();

  /**
   * 注册单个工具
   */
  public register(tool: ITool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * 批量注册工具
   */
  public registerAll(tools: ITool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * 获取指定工具
   */
  public get(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  /**
   * 执行工具调用
   */
  public async execute(call: ToolCall, context?: any): Promise<ToolResult> {
    const tool = this.tools.get(call.toolName);
    if (!tool) {
      return {
        success: false,
        error: `Tool not found: ${call.toolName}`,
      };
    }

    const start = Date.now();
    try {
      const result = await tool.execute(call.parameters, context);
      return {
        ...result,
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

  /**
   * 获取所有注册工具的 Schema 列表
   */
  public getAllSchemas(): any[] {
    return Array.from(this.tools.values()).map((t) => t.schema);
  }
}
