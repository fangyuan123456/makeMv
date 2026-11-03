/**
 * api/controllers/SkillController.ts
 * 声明式影视工序技能执行控制器 (Skill Controller SSOT)
 *
 * 核心设计：
 * 1. 暴露异步任务实体 API (TaskEngine SSOT，彻底终结长连接扛长任务脆弱架构)；
 * 2. 兼容保留 /skill/execute SSE 门面，底层由 TaskEngine 驱动执行与落盘；
 * 3. 统一由 GateGuard 进行刚性门禁防护。
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { SkillRegistry } from '../../skills/SkillRegistry.js';
import { TaskEngine } from '../../tasks/index.js';

export const skillController = new Hono();

// 获取系统所有已挂载的技能清单
skillController.get('/api/skills', (c) => {
  const skills = SkillRegistry.getInstance().list();
  return c.json({ success: true, skills });
});

// 🌟 1. 异步任务提交接口 (TaskEngine 核心接口，立即返回 taskId)
skillController.post('/api/chat/:projectId/tasks', async (c) => {
  try {
    const projectId = c.req.param('projectId');
    const body = await c.req.json().catch(() => ({}));
    const skillName = body.skillName;
    const sessionId = body.sessionId;
    const actionId = body.actionId;
    // 🌟 纯净化提取业务参数 (SSOT)：智能展开内层业务 params，彻底消除元数据剥离导致定向参数整包丢失
    const rawParams = (body.params && Object.keys(body.params).length > 0)
      ? body.params
      : (body.payload?.params || body.payload || {});
    const nested = (typeof rawParams.params === 'object' && rawParams.params !== null && !Array.isArray(rawParams.params))
      ? rawParams.params
      : {};
    const { stage: rawStage, skill: _skill, params: _unusedParams, ...cleanParams } = rawParams;
    const resolvedTargetStage = cleanParams.targetStage || (nested as any).targetStage || body.payload?.targetStage || rawStage || body.payload?.stage;
    const params = {
      ...nested,
      ...cleanParams,
      ...(resolvedTargetStage ? { targetStage: resolvedTargetStage } : {}),
    };

    if (!skillName) {
      return c.json({ success: false, error: '缺少 skillName 参数' }, 400);
    }

    const task = TaskEngine.getInstance().submitTask({
      projectId,
      sessionId,
      skillName,
      params,
      actionId,
    });

    return c.json({ success: true, task });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

// 🌟 2. 任务状态轮询接口 (断线重连、页面刷新恢复)
skillController.get('/api/chat/:projectId/tasks/:taskId', (c) => {
  const projectId = c.req.param('projectId');
  const taskId = c.req.param('taskId');
  const task = TaskEngine.getInstance().getTask(projectId, taskId);

  if (!task) {
    return c.json({ success: false, error: '任务不存在' }, 404);
  }

  return c.json({ success: true, task });
});

// 🌟 3. 任务中断与取消接口
skillController.post('/api/chat/:projectId/tasks/:taskId/cancel', (c) => {
  const projectId = c.req.param('projectId');
  const taskId = c.req.param('taskId');
  const cancelled = TaskEngine.getInstance().cancelTask(projectId, taskId);

  return c.json({ success: true, cancelled });
});

// 🌟 4. 执行指定影视工序技能 (SSE 流式门面，底层全量托管给 TaskEngine 确保落盘与防断联)
skillController.post('/api/chat/:projectId/skill/execute', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await c.req.json().catch(() => ({}));
  const skillName = body.skillName;
  const sessionId = body.sessionId;
  const actionId = body.actionId;
  // 🌟 纯净化提取业务参数 (SSOT)：智能展开内层业务 params，彻底消除元数据剥离导致定向参数整包丢失
  const rawParams = (body.params && Object.keys(body.params).length > 0)
    ? body.params
    : (body.payload?.params || body.payload || {});
  const nested = (typeof rawParams.params === 'object' && rawParams.params !== null && !Array.isArray(rawParams.params))
    ? rawParams.params
    : {};
    const { stage: rawStage, skill: _skill, params: _unusedParams, ...cleanParams } = rawParams;
    const resolvedTargetStage = cleanParams.targetStage || (nested as any).targetStage || body.payload?.targetStage || rawStage || body.payload?.stage;
    const params = {
      ...nested,
      ...cleanParams,
      ...(resolvedTargetStage ? { targetStage: resolvedTargetStage } : {}),
    };

  if (!skillName) {
    return c.json({ success: false, error: '缺少 skillName 参数' }, 400);
  }

  return streamSSE(c, async (stream) => {
    let task;
    try {
      task = TaskEngine.getInstance().submitTask({
        projectId,
        sessionId,
        skillName,
        params,
        actionId,
      });
    } catch (submitErr: any) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          error: submitErr.message || '门禁拦截或技能不可用',
          gateStatus: 'FAIL',
        }),
      });
      return;
    }

    let isTerminalDelivered = false;

    const unsubscribe = TaskEngine.getInstance().subscribeTask(task.taskId, async (updatedTask) => {
      try {
        if (updatedTask.status === 'running' || updatedTask.status === 'pending') {
          await stream.writeSSE({
            event: 'progress',
            data: JSON.stringify({
              taskId: updatedTask.taskId,
              percent: updatedTask.progress,
              message: updatedTask.message,
            }),
          });
        } else if (updatedTask.status === 'completed') {
          await stream.writeSSE({
            event: 'done',
            data: JSON.stringify({
              success: true,
              taskId: updatedTask.taskId,
              summary: updatedTask.message,
              data: updatedTask.result,
            }),
          });
          isTerminalDelivered = true;
        } else if (updatedTask.status === 'failed' || updatedTask.status === 'aborted') {
          await stream.writeSSE({
            event: 'error',
            data: JSON.stringify({
              taskId: updatedTask.taskId,
              error: updatedTask.error || updatedTask.message,
            }),
          });
          isTerminalDelivered = true;
        }
      } catch {
        // SSE 客户端断开连接，无需处理，任务在后台继续安全执行
      }
    });

    c.req.raw.signal.addEventListener('abort', () => {
      unsubscribe();
    });

    // 🌟 P2-2: 严密维持流式直到终态事件 100% 递交或客户端断开，消灭轮询与事件交错的截断竞态
    while (true) {
      if (c.req.raw.signal.aborted || isTerminalDelivered) {
        unsubscribe();
        break;
      }

      const current = TaskEngine.getInstance().getTask(projectId, task.taskId);
      if (!current) {
        unsubscribe();
        break;
      }

      // 兜底保护：若任务在底层已收敛为终态但事件未及时触达，主动补推终态事件后再关流
      if (current.status === 'completed') {
        try {
          await stream.writeSSE({
            event: 'done',
            data: JSON.stringify({
              success: true,
              taskId: current.taskId,
              summary: current.message,
              data: current.result,
            }),
          });
        } catch {}
        unsubscribe();
        break;
      } else if (current.status === 'failed' || current.status === 'aborted') {
        try {
          await stream.writeSSE({
            event: 'error',
            data: JSON.stringify({
              taskId: current.taskId,
              error: current.error || current.message,
            }),
          });
        } catch {}
        unsubscribe();
        break;
      }

      await new Promise((r) => setTimeout(r, 400));
    }
  });
});
