/**
 * api/routes/proposals.ts
 * 人在回路提案审批 (带锁防并发) 与驳回业务路由 (Proposal Router SSOT)
 * 
 * 核心安全特性：
 * 1. 唯一标准契约端点，彻底根除历史向下兼容空壳 (/api/workflow/resume) 与 URL 别名冗余；
 * 2. 调度 ProposalExecutor 串行单项目互斥锁 (ProjectLockManager)，杜绝高昂渲染并发重跑；
 * 3. 拦截未过审工序跨阶段推进 (Critic FAIL 守卫)。
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { Workflow } from '../../workflow-engine/index.js';
import { readJsonBody, sendJson, sendError } from '../helpers.js';

export async function handleProposalRoutes(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const engine = Workflow.getInstance();

  // 1. 人在回路批准提案: POST /api/proposals/:proposalId/approve (SSOT)
  const approveMatch = pathname.match(/^\/api\/proposals\/([^\/]+)\/approve$/);
  if (approveMatch && req.method === 'POST') {
    try {
      const proposalId = approveMatch[1];
      const body = await readJsonBody(req);
      const projectId = body.projectId;

      if (!projectId) {
        sendError(res, 400, '缺少 projectId 参数');
        return true;
      }

      console.log(`[HTTP API] 异步启动执行提案 [${proposalId}] -> 项目 [${projectId}]`);
      const startResult = await engine.startProposal({
        projectId,
        proposalId,
        overrideParameters: body.overrideParameters || body.overrides,
      });

      sendJson(res, 200, {
        success: true,
        accepted: startResult.accepted,
        proposal: startResult.proposal,
      });
    } catch (err: any) {
      console.error('[HTTP API] 启动提案异常:', err);
      sendError(res, 500, err.message || '启动提案异常，请检查工序参数');
    }
    return true;
  }

  // 2. 人在回路驳回提案: POST /api/proposals/:proposalId/reject (SSOT)
  const rejectMatch = pathname.match(/^\/api\/proposals\/([^\/]+)\/reject$/);
  if (rejectMatch && req.method === 'POST') {
    try {
      const proposalId = rejectMatch[1];
      const body = await readJsonBody(req);
      const projectId = body.projectId;

      if (!projectId) {
        sendError(res, 400, '缺少 projectId 参数');
        return true;
      }

      const reason = body.reason || '创作者主动驳回';
      console.log(`[HTTP API] 创作者驳回提案 [${proposalId}] -> 原因: ${reason}`);
      const proposal = await engine.rejectProposal(projectId, proposalId, reason);

      sendJson(res, 200, { success: true, proposal });
    } catch (err: any) {
      console.error('[HTTP API] 驳回提案异常:', err);
      const statusCode = err?.statusCode || 500;
      sendError(res, statusCode, err?.message || '驳回提案异常，请稍后重试');
    }
    return true;
  }

  return false;
}
