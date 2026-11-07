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
import { sendJson } from '../helpers.js';

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
          name: directorAgent.name || 'AI 视听总导演智能体',
          description: 'AI 视听总导演，统领整个互动影游生成制片与资产定向精修',
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
      // Mastra 的工作流存在容器内部 Map 中，对外只能经 listWorkflows() 读取。
      // 早期这里写的是 (mastra as any).workflows，该属性在现版本不存在，恒为 {}，
      // 导致本接口长期返回空列表（前端没有调用方，所以一直没被发现）。
      const registeredWorkflows = mastra.listWorkflows() || {};
      // 展示名兜底：description 为空时列表里会出现裸 id，补两条需要人读的
      const DISPLAY_NAMES: Record<string, string> = {
        'film-production-pipeline': '全工序流水线宏观状态机',
        'subwf-modify': '资产定向精修（文本 / 图像 / 视频三分支）',
      };

      const workflowsList = Object.entries(registeredWorkflows).map(([key, wf]: [string, any]) => {
        const stepKeys = wf.steps ? Object.keys(wf.steps) : [];
        const isPipeline = key === 'film-production-pipeline';
        return {
          id: key,
          name: DISPLAY_NAMES[key] || wf.description?.split('：')[0] || key,
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

  // 4. 边界声明：本路由只做拓扑自省，不提供任何执行入口
  //
  // 这里曾有两个 POST：/:id/start 与 /:id/resume，实现是直接 createRun() + run.start()。
  // 它们绕过了 createPipelineExecutor —— 也就绕过了 actionType 分流、validateGate 门禁、
  // onSuccess 的阶段推进与下游清理。后果是「产物已被改写、项目状态机不动、提案与历史不留痕」，
  // 这种静默不一致比直接报错难排查得多。
  //
  // 业务的唯一执行入口是 Workflow.dispatch(key)：一次请求对应一张卡、一次门禁、一次阶段推进。
  // mastra.workflows 的挂载只服务 Studio 与 GET /api/workflows 的拓扑内省，不承担执行职责。

  return false;
}
