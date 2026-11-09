/**
 * agents/text-game/tools/submit-delivery.tool.ts
 * 互动文游 Pi Agent 最终验收与定稿提交工具
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { TextGameDraftRegistry } from '../draft-store.js';

export const SUBMIT_DELIVERY_TOOL_ID = 'submit_game_delivery';

export const SubmitDeliveryInputSchema = z.object({
  sessionId: z.string().describe('当前构建会话 ID'),
  gameTitle: z.string().describe('定稿游戏名称'),
  startNodeId: z.string().describe('确认的起始节点 ID'),
  completionSummary: z.string().describe('本图文游戏的核心分支与结局总结'),
});

export const submitGameDeliveryTool = createTool({
  id: SUBMIT_DELIVERY_TOOL_ID,
  description:
    '当所有节点创建完毕、且 audit_game_graph 审查无任何错误后，调用此工具正式提交定稿图文游戏。',
  inputSchema: SubmitDeliveryInputSchema,
  execute: async ({ context }) => {
    const { sessionId, gameTitle, startNodeId, completionSummary } = context;
    const session = TextGameDraftRegistry.getOrCreate(sessionId);
    session.title = gameTitle;
    session.startNodeId = startNodeId;

    const auditResult = session.audit();
    if (!auditResult.valid) {
      return {
        success: false,
        error: `无法提交！图谱自检未通过：\n${auditResult.issues.join('\n')}`,
      };
    }

    const artifact = session.toArtifact();
    session.deliveredArtifact = artifact;

    return {
      success: true,
      deliveredTitle: artifact.title,
      totalNodes: artifact.nodes.length,
      startNodeId: artifact.startNodeId,
      summary: completionSummary,
      message: `🎉 图文互动游戏《${artifact.title}》已成功定稿交付！`,
    };
  },
});
