/**
 * api/routes/tasks.ts
 * 任务（Task）流转路由 (Task Router SSOT)
 *
 * 任务是一等公民：未开始 / 执行中 / 已结束 的状态、进度与产物链接全部由这里读写，
 * 对话消息只保存 taskId 引用。
 *
 * 端点：
 * - GET  /api/projects/:projectId/tasks   项目任务列表（客户端唯一轮询目标）
 * - GET  /api/tasks/:taskId?projectId=    单任务
 * - POST /api/tasks/:taskId/approve       批准并启动（未开始 → 执行中）
 * - POST /api/tasks/:taskId/reject        取消（仅未开始态）
 * - POST /api/tasks/:taskId/retry         失败后重试（复用同一任务实体）
 *
 * 兼容：保留 /api/proposals/:id/approve|reject 旧路径，内部转译为任务调用，
 * 避免旧前端在灰度期 404。
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { Workflow } from '../../workflow-engine/index.js';
import { TaskStore } from '../../project-store/TaskStore.js';
import { readJsonBody, sendJson, sendError } from '../helpers.js';

export async function handleTaskRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<boolean> {
  const engine = Workflow.getInstance();
  const taskStore = TaskStore.getInstance();

  // 1. 项目任务列表: GET /api/projects/:projectId/tasks
  const listMatch = pathname.match(/^\/api\/projects\/([^\/]+)\/tasks$/);
  if (listMatch && req.method === 'GET') {
    const projectId = decodeURIComponent(listMatch[1]);
    try {
      const tasks = taskStore.listTasks(projectId);
      sendJson(res, 200, { success: true, tasks });
    } catch (err: any) {
      sendError(res, 400, err.message || '读取任务列表失败');
    }
    return true;
  }

  // 2. 单任务: GET /api/tasks/:taskId?projectId=xxx
  const getMatch = pathname.match(/^\/api\/tasks\/([^\/]+)$/);
  if (getMatch && req.method === 'GET') {
    const taskId = decodeURIComponent(getMatch[1]);
    const projectId = new URL(req.url || '', 'http://localhost').searchParams.get('projectId') || '';
    if (!projectId) {
      sendError(res, 400, '缺少 projectId 参数');
      return true;
    }
    const task = taskStore.getTask(projectId, taskId);
    if (!task) {
      sendError(res, 404, '任务不存在');
      return true;
    }
    sendJson(res, 200, { success: true, task });
    return true;
  }

  // 3. 批准启动: POST /api/tasks/:taskId/approve
  const approveMatch = pathname.match(/^\/api\/tasks\/([^\/]+)\/approve$/);
  if (approveMatch && req.method === 'POST') {
    try {
      const taskId = decodeURIComponent(approveMatch[1]);
      const body = await readJsonBody(req);
      const projectId = body.projectId;
      if (!projectId) {
        sendError(res, 400, '缺少 projectId 参数');
        return true;
      }
      console.log(`[HTTP API] 批准并启动任务 [${taskId}] -> 项目 [${projectId}]`);
      const startResult = await engine.startTask({
        projectId,
        taskId,
        overrideParameters: body.overrideParameters || body.overrides,
      });
      sendJson(res, 200, { success: true, accepted: startResult.accepted, task: startResult.task });
    } catch (err: any) {
      console.error('[HTTP API] 启动任务异常:', err);
      sendError(res, err?.statusCode || 500, err.message || '启动任务异常，请检查工序参数');
    }
    return true;
  }

  // 4. 取消任务: POST /api/tasks/:taskId/reject
  const rejectMatch = pathname.match(/^\/api\/tasks\/([^\/]+)\/reject$/);
  if (rejectMatch && req.method === 'POST') {
    try {
      const taskId = decodeURIComponent(rejectMatch[1]);
      const body = await readJsonBody(req);
      const projectId = body.projectId;
      if (!projectId) {
        sendError(res, 400, '缺少 projectId 参数');
        return true;
      }
      const task = await engine.cancelTask(projectId, taskId, body.reason || '创作者主动驳回');
      sendJson(res, 200, { success: true, task });
    } catch (err: any) {
      console.error('[HTTP API] 取消任务异常:', err);
      sendError(res, err?.statusCode || 500, err.message || '取消任务异常，请稍后重试');
    }
    return true;
  }

  // 5. 失败重试: POST /api/tasks/:taskId/retry —— 复用同一任务实体，状态回到 queued 再启动
  const retryMatch = pathname.match(/^\/api\/tasks\/([^\/]+)\/retry$/);
  if (retryMatch && req.method === 'POST') {
    const taskId = decodeURIComponent(retryMatch[1]);
    let projectId = '';
    try {
      const body = await readJsonBody(req);
      projectId = body.projectId;
      if (!projectId) {
        sendError(res, 400, '缺少 projectId 参数');
        return true;
      }
      const existing = taskStore.getTask(projectId, taskId);
      if (!existing) {
        sendError(res, 404, '任务不存在');
        return true;
      }
      if (existing.status !== 'failed' && existing.status !== 'cancelled') {
        sendError(res, 409, `任务处于 [${existing.status}]，仅失败或已取消任务可重试`);
        return true;
      }
      // 复位必须清空上一轮产物与进度，否则重试成功后气泡会混入旧产物与旧进度
      taskStore.resetForRetry(projectId, taskId);
      const startResult = await engine.startTask({
        projectId,
        taskId,
        overrideParameters: body.overrideParameters || body.overrides,
      });
      sendJson(res, 200, { success: true, accepted: startResult.accepted, task: startResult.task });
    } catch (err: any) {
      console.error('[HTTP API] 重试任务异常:', err);
      // resetForRetry 已把任务置 queued；若 startTask 在置 running 之前抛错
      // （门禁拦截 / 缺注册等），任务会永久卡在 queued，客户端死轮询。拉回 failed。
      try {
        const stuck = taskStore.getTask(projectId, taskId);
        if (stuck && stuck.status === 'queued') {
          taskStore.setStatus(projectId, taskId, 'failed', {
            error: `重试启动失败: ${err?.message || '未知异常'}`,
          });
        }
      } catch {}
      sendError(res, err?.statusCode || 500, err.message || '重试任务异常，请稍后重试');
    }
    return true;
  }

  /* ── 旧路径兼容：/api/proposals/:id/approve|reject 内部转译 ── */
  const legacyApprove = pathname.match(/^\/api\/proposals\/([^\/]+)\/approve$/);
  if (legacyApprove && req.method === 'POST') {
    try {
      const taskId = decodeURIComponent(legacyApprove[1]);
      const body = await readJsonBody(req);
      if (!body.projectId) {
        sendError(res, 400, '缺少 projectId 参数');
        return true;
      }
      const startResult = await engine.startTask({
        projectId: body.projectId,
        taskId,
        overrideParameters: body.overrideParameters || body.overrides,
      });
      sendJson(res, 200, { success: true, accepted: startResult.accepted, task: startResult.task });
    } catch (err: any) {
      sendError(res, err?.statusCode || 500, err.message || '启动任务异常');
    }
    return true;
  }

  const legacyReject = pathname.match(/^\/api\/proposals\/([^\/]+)\/reject$/);
  if (legacyReject && req.method === 'POST') {
    try {
      const taskId = decodeURIComponent(legacyReject[1]);
      const body = await readJsonBody(req);
      if (!body.projectId) {
        sendError(res, 400, '缺少 projectId 参数');
        return true;
      }
      const task = await engine.cancelTask(body.projectId, taskId, body.reason || '创作者主动驳回');
      sendJson(res, 200, { success: true, task });
    } catch (err: any) {
      sendError(res, err?.statusCode || 500, err.message || '取消任务异常');
    }
    return true;
  }

  return false;
}
