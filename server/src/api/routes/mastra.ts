/**
 * api/routes/mastra.ts
 * Mastra 微内核与 Studio 标准发现业务路由 (Mastra Studio Discovery Routes SSOT)
 * 
 * 核心能力：
 * 1. 动态暴露 Mastra 官方容器中挂载的 Agents 与 Workflows 清单；
 * 2. 供客户端 SDK (mastraStudioApi) 与 Mastra Studio 调试器进行拓扑内省与节点态势感知。
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { mastra } from '../../mastra.js';
import { sendJson, readJsonBody } from '../helpers.js';

export async function handleMastraRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<boolean> {
  // 1. 获取已挂载智能体列表: GET /api/agents
  if (pathname === '/api/agents' && req.method === 'GET') {
    try {
      const directorAgent = mastra.getAgent('director-agent');
      const agentsList = [
        {
          id: 'director-agent',
          name: directorAgent.name || 'AI 互动影游总导演',
          description: '基于自然语言意图规划互动影游全工序状态机，并生成人在回路待审提案 (ActionProposal)',
          tools: ['proposeStageActionTool', 'inspectProjectStateTool'],
        },
      ];
      sendJson(res, 200, { success: true, agents: agentsList });
      return true;
    } catch (err: any) {
      sendJson(res, 500, { success: false, error: err.message });
      return true;
    }
  }

  // 2. 获取已挂载工作流全景拓扑列表: GET /api/workflows
  if (pathname === '/api/workflows' && req.method === 'GET') {
    try {
      const registeredWorkflows = (mastra as any).workflows || {};
      const workflowsList = Object.entries(registeredWorkflows).map(([key, wf]: [string, any]) => {
        const stepKeys = wf.steps ? Object.keys(wf.steps) : [];
        const isPipeline = key === 'film-production-pipeline';
        return {
          id: key,
          name: isPipeline ? '全工序流水线宏观状态机' : wf.description?.split('：')[0] || key,
          description: wf.description || '',
          type: isPipeline ? 'pipeline' : 'subworkflow',
          stepsCount: stepKeys.length,
          stepIds: stepKeys,
        };
      });

      sendJson(res, 200, { success: true, workflows: workflowsList });
      return true;
    } catch (err: any) {
      sendJson(res, 500, { success: false, error: err.message });
      return true;
    }
  }

  // 3. 获取单个工作流详细步骤元数据: GET /api/workflows/:id
  if (pathname.startsWith('/api/workflows/') && req.method === 'GET') {
    const workflowId = decodeURIComponent(pathname.replace('/api/workflows/', ''));
    try {
      const wf = mastra.getWorkflow(workflowId as any);
      if (!wf) {
        sendJson(res, 404, { success: false, error: `未找到 ID 为 [${workflowId}] 的工作流` });
        return true;
      }

      const stepsData = Object.entries((wf as any).steps || {}).map(([sKey, sVal]: [string, any]) => ({
        id: sKey,
        description: sVal.description || sKey,
      }));

      sendJson(res, 200, {
        success: true,
        workflow: {
          id: workflowId,
          description: wf.description || '',
          steps: stepsData,
        },
      });
      return true;
    } catch (err: any) {
      sendJson(res, 500, { success: false, error: err.message });
      return true;
    }
  }

  // 4. 标准启动工作流/微观子工作流: POST /api/workflows/:id/start
  if (pathname.startsWith('/api/workflows/') && pathname.endsWith('/start') && req.method === 'POST') {
    const workflowId = decodeURIComponent(pathname.replace('/api/workflows/', '').replace('/start', ''));
    try {
      const wf = mastra.getWorkflow(workflowId as any);
      if (!wf) {
        sendJson(res, 404, { success: false, error: `未找到 ID 为 [${workflowId}] 的工作流` });
        return true;
      }

      const body = await readJsonBody(req);
      const run = await wf.createRun();
      const result = await run.start({ inputData: body.inputData || body });

      sendJson(res, 200, {
        success: result.status === 'success',
        runId: run.runId,
        status: result.status,
        result: (result as any).result || (result as any).steps,
      });
      return true;
    } catch (err: any) {
      sendJson(res, 500, { success: false, error: err.message });
      return true;
    }
  }

  // 5. 标准恢复挂起的工作流: POST /api/workflows/:id/resume
  if (pathname.startsWith('/api/workflows/') && pathname.endsWith('/resume') && req.method === 'POST') {
    const workflowId = decodeURIComponent(pathname.replace('/api/workflows/', '').replace('/resume', ''));
    try {
      const wf = mastra.getWorkflow(workflowId as any);
      if (!wf) {
        sendJson(res, 404, { success: false, error: `未找到 ID 为 [${workflowId}] 的工作流` });
        return true;
      }

      const body = await readJsonBody(req);
      const { stepId, resumeData } = body;
      const run = await wf.createRun();
      const result = await run.resume({
        stepId,
        context: resumeData || {},
      });

      sendJson(res, 200, {
        success: result.status === 'success',
        runId: run.runId,
        status: result.status,
        result: (result as any).result || (result as any).steps,
      });
      return true;
    } catch (err: any) {
      sendJson(res, 500, { success: false, error: err.message });
      return true;
    }
  }

  return false;
}
