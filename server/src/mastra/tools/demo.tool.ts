/**
 * mastra/tools/demo.tool.ts
 * Mastra 标准 Tool 规范范例
 * 
 * 核心特性：
 * 1. 基于 createTool 统一声明；
 * 2. 纯 Zod 强类型 inputSchema 与 outputSchema；
 * 3. 原生支持 requireApproval: true 人在回路审批控制。
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const demoTool = createTool({
  id: 'demo-director-tool',
  description: 'AI 导演场景概念设计与镜头方案提议工具',
  inputSchema: z.object({
    sceneName: z.string().describe('场景名称，如：暴风雨前夕的避难所'),
    tone: z.string().default('冷峻写实，低饱和度电影调色').describe('场景影调基调'),
    keyConflict: z.string().describe('本场景的核心戏剧冲突'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    scenePlan: z.object({
      title: z.string(),
      visualPrompt: z.string(),
      cameraMovement: z.string(),
      lighting: z.string(),
    }),
    message: z.string(),
  }),
  requireApproval: true, // 标记为需要人类创作者确认授权方可执行
  execute: async (params) => {
    const { sceneName, tone, keyConflict } = params;

    // 模拟纯正的业务推演与执行
    const scenePlan = {
      title: `《${sceneName}》镜头概念方案`,
      visualPrompt: `电影级写实画面，${sceneName}，全景深景，环境氛围：${tone}，充满未知的戏剧压迫感`,
      cameraMovement: '缓慢前推特写 (Slow Dolly-in)，捕捉角色面部微表情',
      lighting: '侧逆伦勃朗光 (Rembrandt Lighting)，形成强烈明暗反差',
    };

    return {
      success: true,
      scenePlan,
      message: `场景方案【${sceneName}】已由导演工具构建完毕，核心冲突聚焦于：${keyConflict}`,
    };
  },
});
