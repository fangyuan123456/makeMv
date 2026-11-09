/**
 * agents/text-game/tools/audit-graph.tool.ts
 * 互动文游 Pi Agent 拓扑逻辑与死锁静态检查工具
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { TextGameDraftRegistry } from '../draft-store.js';

export const AUDIT_GRAPH_TOOL_ID = 'audit_game_graph';

export const AuditGraphInputSchema = z.object({
  sessionId: z.string().describe('当前构建会话 ID'),
  startNodeId: z.string().optional().describe('若需要指定或更改起始节点 ID'),
});

export const auditGameGraphTool = createTool({
  id: AUDIT_GRAPH_TOOL_ID,
  description:
    '对当前图文游戏草稿进行拓扑自检。扫描是否存在断头路、未创建的目标节点、不可达孤岛或缺少结局，返回详细问题列表。',
  inputSchema: AuditGraphInputSchema,
  execute: async ({ context }) => {
    const { sessionId, startNodeId } = context;
    const session = TextGameDraftRegistry.getOrCreate(sessionId);
    if (startNodeId) {
      session.startNodeId = startNodeId;
    }

    const report = session.audit();
    return report;
  },
});
