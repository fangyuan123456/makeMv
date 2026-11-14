/**
 * tools/planner/index.ts
 * 互动影游策划推演双核心工具导出总装出口 (Planner Task Tools SSOT)
 *
 * 核心架构：
 * 1. ScreenplayTool: 互动影游全景剧本生成工具 (专注文学与分支剧本创作)
 * 2. ScriptToPrdTool: 剧本资产工程解析与 PRD 提取工具 (专注结构化抽取与图论闭环)
 * 3. 均继承 BaseTaskTool，分两次刚性回调 (第一次回调 taskId，第二次回调最终结果)
 */

export * from './screenplay-tool/index.js';
export * from './script-to-prd-tool/index.js';
