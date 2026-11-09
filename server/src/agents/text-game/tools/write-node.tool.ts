/**
 * agents/text-game/tools/write-node.tool.ts
 * 互动文游 Pi Agent 场景节点原子写入工具
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { TextGameNodeSchema, type TextGameNode } from '../schema.js';
import { TextGameDraftRegistry } from '../draft-store.js';

export const WRITE_NODE_TOOL_ID = 'write_game_node';

export const WriteNodeInputSchema = z.object({
  sessionId: z.string().describe('当前构建会话 ID'),
  node: TextGameNodeSchema.describe('要创建或更新的场景节点完整数据'),
});

export const writeGameNodeTool = createTool({
  id: WRITE_NODE_TOOL_ID,
  description:
    '向当前图文游戏草稿中写入或更新一个场景节点。包含第一视角文学文本、首帧视觉描述、选项分支与数值变动。',
  inputSchema: WriteNodeInputSchema,
  execute: async ({ context }) => {
    const { sessionId, node } = context;
    const session = TextGameDraftRegistry.getOrCreate(sessionId);
    session.upsertNode(node as TextGameNode);

    return {
      success: true,
      nodeId: node.id,
      title: node.title,
      totalNodesNow: session.nodes.size,
      message: `场景节点 [${node.title || node.id}] 已成功录入草稿图谱，当前共 ${session.nodes.size} 个节点。`,
    };
  },
});
