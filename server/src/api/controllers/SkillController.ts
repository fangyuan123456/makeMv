/**
 * api/controllers/SkillController.ts
 * 声明式影视工序技能执行控制器 (Skill Controller SSOT)
 */

import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { streamSSE } from 'hono/streaming';
import { SkillRegistry } from '../../skills/SkillRegistry.js';
import { SessionStore } from '../../chat/session/SessionStore.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import type { ChatMessage } from '../../chat/session/types.js';

export const skillController = new Hono();

// 获取系统所有已挂载的技能清单
skillController.get('/api/skills', (c) => {
  const skills = SkillRegistry.getInstance().list();
  return c.json({ success: true, skills });
});

// 执行指定影视工序技能 (SSE 流式进度与阶段双向同步)
skillController.post('/api/chat/:projectId/skill/execute', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await c.req.json().catch(() => ({}));
  const skillName = body.skillName;
  const sessionId = body.sessionId;
  const params = body.params || {};

  if (!skillName) {
    return c.json({ success: false, error: '缺少 skillName 参数' }, 400);
  }

  const skill = SkillRegistry.getInstance().get(skillName);
  if (!skill) {
    return c.json({ success: false, error: `技能 [${skillName}] 未注册` }, 404);
  }

  const session = sessionId ? SessionStore.getInstance().getSession(projectId, sessionId) : undefined;
  const userConstraints = session?.scratchpad?.userConstraints;

  return streamSSE(c, async (stream) => {
    try {
      const result = await skill.execute({
        projectId,
        sessionId,
        params,
        userConstraints,
        abortSignal: c.req.raw.signal,
        onProgress: async (percent, message) => {
          await stream.writeSSE({
            event: 'progress',
            data: JSON.stringify({ percent, message }),
          });
        },
      });

      // 🌟 工序推进双向同步：技能执行成功后，刚性同步权威阶段状态至 Session
      if (sessionId && result.success) {
        const sessionStore = SessionStore.getInstance();
        const latestProject = ProjectStore.getInstance().getProject(projectId);
        if (latestProject?.currentStage) {
          const currentSession = sessionStore.getSession(projectId, sessionId);
          if (currentSession && currentSession.currentStage !== latestProject.currentStage) {
            currentSession.currentStage = latestProject.currentStage;
            sessionStore.saveSession(currentSession);
          }
        }

        // 🌟 提案生命周期闭环：将对应待处理的 ActionProposal 回标为 'executed'，彻底消除历史误触与重复提议
        const messages = sessionStore.getMessages(projectId, sessionId);
        let proposalUpdated = false;
        const targetActionId = body.actionId || params.actionId;

        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg.actionProposal && msg.actionProposal.status === 'pending') {
            if (!targetActionId || msg.actionProposal.actionId === targetActionId) {
              msg.actionProposal.status = 'executed';
              msg.actionProposal.executedAt = new Date().toISOString();
              msg.actionProposal.resultSummary = result.summary;
              proposalUpdated = true;
              break;
            }
          }
        }
        if (proposalUpdated) {
          sessionStore.saveMessages(projectId, sessionId, messages);
        }

        const completionMessage: ChatMessage = {
          id: `msg_skill_${randomUUID().slice(0, 8)}`,
          role: 'assistant',
          content: result.summary,
          createdAt: new Date().toISOString(),
        };
        sessionStore.appendMessage(projectId, sessionId, completionMessage);
      }

      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify(result),
      });
    } catch (err: any) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: err.message || 'Skill execution failed' }),
      });
    }
  });
});
