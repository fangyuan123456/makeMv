/**
 * tools/planner/index.ts
 * 互动影游策划推演工具导出总装出口 (Planner Task Tools SSOT)
 *
 * 核心架构：
 * 1. ScreenplayTool: 互动影游全景剧本与结构化分幕拓扑生成工具
 * 2. 继承 BaseTaskTool，分两次刚性回调 (第一次回调 taskId，第二次回调最终结果)
 */

export * from './screenplay-tool/index.js';
