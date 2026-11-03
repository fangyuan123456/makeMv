/**
 * api/routes/proposals.ts
 * 人在回路提案审批 (带锁防并发)、驳回与 Mastra 工作流恢复业务路由
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { ProposalExecutor } from '../../mastra/router/index.js';
import { WorkflowManager } from '../../mastra/workflows/index.js';
import { readJsonBody, sendJson, sendError } from '../helpers.js';

export async function handleProposalRoutes(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const executor = ProposalExecutor.getInstance();
  const workflowManager = WorkflowManager.getInstance();

  // 1. Mastra 原生工作流推进与恢复端点: POST /api/workflow/resume
  if (pathname === '/api/workflow/resume' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const { projectId, stepId, overrideData } = body;
      if (!projectId) {
        sendError(res, 400, '缺少 projectId 参数');
        return true;
      }

      const runStatus = await workflowManager.resumeWorkflow(projectId, stepId, overrideData);
      sendJson(res, 200, { success: true, runStatus });
    } catch (err: any) {
      console.error('[HTTP API] 工作流恢复异常:', err);
      sendError(res, 500, '工作流恢复异常，请检查工序参数');
    }
    return true;
  }

  // 2. 人在回路批准提案: POST /api/proposals/:proposalId/approve (含并发锁与状态机防御)
  if (pathname.startsWith('/api/proposals/') && pathname.endsWith('/approve') && req.method === 'POST') {
    try {
      const parts = pathname.split('/');
      const proposalId = parts[3];
      const body = await readJsonBody(req);
      const { projectId, overrideParameters } = body;

      if (!projectId) {
        sendError(res, 400, '缺少 projectId 参数');
        return true;
      }

      console.log(`[HTTP API] 批准执行提案 [${proposalId}] -> 项目 [${projectId}]`);
      const execResult = await executor.executeProposal({
        projectId,
        proposalId,
        overrideParameters,
      });

      sendJson(res, 200, execResult);
    } catch (err: any) {
      console.error('[HTTP API] 执行提案异常:', err);
      sendError(res, 500, '执行提案异常，请检查工序参数');
    }
    return true;
  }

  // 3. 人在回路驳回提案: POST /api/proposals/:proposalId/reject
  if (pathname.startsWith('/api/proposals/') && pathname.endsWith('/reject') && req.method === 'POST') {
    try {
      const parts = pathname.split('/');
      const proposalId = parts[3];
      const body = await readJsonBody(req);
      const { projectId, reason } = body;

      if (!projectId) {
        sendError(res, 400, '缺少 projectId 参数');
        return true;
      }

      console.log(`[HTTP API] 创作者驳回提案 [${proposalId}] -> 原因: ${reason || '无'}`);
      const proposal = executor.rejectProposal(projectId, proposalId, reason);

      sendJson(res, 200, { success: true, proposal });
    } catch (err: any) {
      console.error('[HTTP API] 驳回提案异常:', err);
      sendError(res, 500, '驳回提案异常，请稍后重试');
    }
    return true;
  }

  return false;
}
