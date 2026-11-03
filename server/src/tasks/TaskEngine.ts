/**
 * tasks/TaskEngine.ts
 * 异步长耗时工序任务执行引擎 (Task Engine SSOT)
 *
 * 单一职责：
 * 1. 彻底终结“长连接 SSE 扛长任务”的脆弱架构，将技能执行提升为独立异步持久化任务；
 * 2. 真实物理磁盘持久化：每个任务落盘在 projects/{projectId}/tasks/{taskId}.json；
 * 3. 支持断线重连、页面刷新恢复与多端轮询，算力永不失联。
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { config } from '../utils/config.js';
import { atomicWriteJsonSync } from '../utils/index.js';
import { trace, classify } from '../utils/trace.js';
import { SkillRegistry } from '../skills/SkillRegistry.js';
import { ProjectStore, ProposalStore } from '../project-store/index.js';
import { GateGuard } from '../agents/reviewer/GateGuard.js';
import { CriticReviewerAgent } from '../agents/reviewer/CriticReviewerAgent.js';
import { STAGE_SEQUENCE, WorkflowStage } from '../types/index.js';
import type { TaskEntity, CreateTaskOptions, TaskStatus } from './types.js';
import type { ChatMessage } from '../chat/session/types.js';

export class TaskEngine {
  private static instance?: TaskEngine;
  private taskCache = new Map<string, TaskEntity>();
  private abortControllers = new Map<string, AbortController>();
  private cancelledTaskIds = new Set<string>();
  private emitter = new EventEmitter();

  private constructor() {
    this.recoverOrphanTasks();
  }

  public static getInstance(): TaskEngine {
    if (!TaskEngine.instance) {
      TaskEngine.instance = new TaskEngine();
    }
    return TaskEngine.instance;
  }

  /**
   * 🌟 获取当前项目处于活跃运行态 (pending / running) 的任务列表 (消除导演任务盲视)
   */
  public getActiveTasks(projectId: string): TaskEntity[] {
    const list: TaskEntity[] = [];
    for (const task of this.taskCache.values()) {
      if (task.projectId === projectId && (task.status === 'running' || task.status === 'pending')) {
        list.push(task);
      }
    }
    return list;
  }

  /**
   * 🌟 启动孤儿任务恢复扫描 (Crash / Restart Orphan Recovery SSOT)
   * 服务重启后，扫描磁盘中未完结（running / pending）的孤儿任务，刚性标为 failed，杜绝假死与并发排重死锁
   */
  private recoverOrphanTasks(): void {
    try {
      const projectsDir = config.paths.projects;
      if (!fs.existsSync(projectsDir)) return;

      const projectEntries = fs.readdirSync(projectsDir, { withFileTypes: true });
      for (const entry of projectEntries) {
        if (!entry.isDirectory()) continue;
        const tasksDir = path.join(projectsDir, entry.name, 'tasks');
        if (!fs.existsSync(tasksDir)) continue;

        const taskFiles = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.json'));
        for (const file of taskFiles) {
          const filePath = path.join(tasksDir, file);
          try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const task = JSON.parse(raw) as TaskEntity;
            if (task.status === 'pending' || task.status === 'running') {
              console.warn(`[TaskEngine] ⚠️ 检测到重启遗留孤儿任务 [${task.taskId}] (状态: ${task.status})，执行自愈终止`);
              task.status = 'failed';
              task.error = '服务异常重启或断电，未完结任务已自动终止';
              task.message = task.error;
              task.updatedAt = new Date().toISOString();
              atomicWriteJsonSync(filePath, task);
              this.taskCache.set(task.taskId, task);
            }
          } catch {
            // 忽略损坏的单任务文件
          }
        }
      }
    } catch (err) {
      console.error('[TaskEngine] 孤儿任务恢复扫描异常:', err);
    }
  }

  private getTasksDir(projectId: string): string {
    const dir = path.join(config.paths.projects, projectId, 'tasks');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private getTaskFile(projectId: string, taskId: string): string {
    return path.join(this.getTasksDir(projectId), `${taskId}.json`);
  }

  private persistTask(task: TaskEntity): void {
    this.taskCache.set(task.taskId, task);
    const file = this.getTaskFile(task.projectId, task.taskId);
    try {
      atomicWriteJsonSync(file, task);
    } catch (err) {
      console.error(`[TaskEngine] 任务持久化失败: ${file}`, err);
    }
    this.emitter.emit(`task:${task.taskId}`, task);
  }

  /**
   * 提交并异步启动工序任务
   */
  public submitTask(options: CreateTaskOptions): TaskEntity {
    const { projectId, sessionId, skillName, params = {}, actionId } = options;
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);
    const session = sessionId ? store.getSession(projectId, sessionId) : undefined;
    const currentStage = project?.currentStage || session?.currentStage || 'narrative_design';

    const skill = SkillRegistry.getInstance().get(skillName);
    if (!skill) {
      throw new Error(`技能 [${skillName}] 未注册`);
    }

    // 🌟 项目级并发任务排重防御 (Concurrency Safeguard): 同一项目同时只允许执行一个重型工序任务，彻底杜绝手抖连点与并发烧钱
    const activeTasksForProject = Array.from(this.taskCache.values()).filter(
      (t) => t.projectId === projectId && (t.status === 'running' || t.status === 'pending')
    );
    if (activeTasksForProject.length >= 1) {
      throw new Error(`当前项目已有工序任务 [${activeTasksForProject[0].taskId}] 正在执行中，请等待其完成后再提交新任务。`);
    }

    // 🌟 统一门禁拦截 (GateGuard SSOT)
    const reviewReport = CriticReviewerAgent.getInstance().getEffectiveReport(projectId, currentStage);
    const gateResult = GateGuard.check(skillName, currentStage, reviewReport);
    if (!gateResult.passed) {
      throw new Error(gateResult.reason || '门禁刚性阻断');
    }

    const taskId = `task_${Date.now()}_${randomUUID().slice(0, 6)}`;
    const now = new Date().toISOString();

    const task: TaskEntity = {
      taskId,
      projectId,
      sessionId,
      skillName,
      params,
      status: 'pending',
      progress: 0,
      message: `任务已创建，等待调度启动: ${skill.manifest.displayName}`,
      createdAt: now,
      updatedAt: now,
    };

    this.persistTask(task);

    // 异步执行驱动 (不阻塞请求，算力后台执行)
    setTimeout(() => {
      this.executeTask(task, actionId).catch((err) => {
        console.error(`[TaskEngine] 任务 [${taskId}] 异常崩溃:`, err);
      });
    }, 0);

    return task;
  }

  private async executeTask(task: TaskEntity, actionId?: string): Promise<void> {
    // 🌟 刚性双锁防御：若在调度微任务窗口期已被创作者取消/中断，直接终止执行，杜绝覆写为 running 的取消丢失竞态
    if (this.cancelledTaskIds.has(task.taskId) || task.status === 'aborted') {
      this.cancelledTaskIds.delete(task.taskId);
      console.log(`[TaskEngine] 任务 [${task.taskId}] 调度前已被中止，退出执行`);
      return;
    }

    const { taskId, projectId, sessionId, skillName, params } = task;
    const store = ProjectStore.getInstance();
    const skill = SkillRegistry.getInstance().get(skillName)!;

    const abortController = new AbortController();
    this.abortControllers.set(taskId, abortController);

    task.status = 'running';
    task.startedAt = new Date().toISOString();
    task.updatedAt = task.startedAt;
    task.message = `正在执行: ${skill.manifest.displayName}...`;
    task.progress = 5;
    this.persistTask(task);

    try {
      const session = sessionId ? store.getSession(projectId, sessionId) : undefined;
      const userConstraints = session?.scratchpad?.userConstraints;

      const result = await skill.execute({
        projectId,
        sessionId,
        params,
        isRefinement: params.isRefinement,
        userConstraints,
        abortSignal: abortController.signal,
        onProgress: async (percent: number, message: string) => {
          task.progress = Math.min(99, Math.max(percent, task.progress));
          task.message = message || task.message;
          task.updatedAt = new Date().toISOString();
          this.persistTask(task);
        },
      });

      if (!result.success) {
        throw new Error(result.error || '技能执行未收敛');
      }

      task.status = 'completed';
      task.progress = 100;
      task.message = result.summary || '工序已成功交付';
      task.result = result.data;
      task.completedAt = new Date().toISOString();
      task.updatedAt = task.completedAt;
      this.persistTask(task);

      trace(projectId, 'task.execute', {
        taskId,
        skillName: skill.manifest.name,
        status: 'completed',
        progress: 100,
        durationMs: task.startedAt ? Date.now() - new Date(task.startedAt).getTime() : 0,
      });

      // 🌟 工序阶段跃迁与提案回标 (防误推双重刚性守卫 SSOT)
      const latestProject = store.getProject(projectId);
      if (latestProject && skill.manifest.category !== 'critic' && skill.manifest.targetStage) {
        const targetStage = skill.manifest.targetStage as WorkflowStage;
        const currIdx = STAGE_SEQUENCE.indexOf(latestProject.currentStage as WorkflowStage);
        const targetIdx = STAGE_SEQUENCE.indexOf(targetStage);

        // 严格判定是否属于微调/重绘 (显式 isRefinement || 目标就是当前阶段)
        const isRefinementTask = Boolean(params.isRefinement) || (targetStage === latestProject.currentStage);

        // 🌟 P0-2 & P1-1 终态防倒退与相邻工序单调推进门禁 (Adjacent Stage Progression Guard)：
        // 1. 支持从 INIT 初始阶段正常跃迁至序列首个工序 (targetIdx === 0)
        // 2. 严格要求 latestProject.currentStage !== WorkflowStage.COMPLETED (终态不可逆，坚决禁止被拉回工序阶段)
        // 3. 仅在明确非微调任务、且目标阶段恰为紧邻下一阶段 (targetIdx === currIdx + 1) 时，才准许单步向前跃迁！禁止跨工序空跳 (如 Stage 1 直跳 Stage 7)
        const isFromInit = latestProject.currentStage === WorkflowStage.INIT && targetIdx === 0;
        const isStrictAdjacentNext = currIdx !== -1 && targetIdx === currIdx + 1;
        if (!isRefinementTask && (isFromInit || isStrictAdjacentNext) && latestProject.currentStage !== WorkflowStage.COMPLETED) {
          latestProject.currentStage = targetStage;
          store.saveProject(latestProject);
          console.log(`[TaskEngine] 🚀 任务 ${taskId} 执行成功，权威阶段跃迁至相邻下一工序: ${targetStage}`);
        } else if (!isRefinementTask && currIdx !== -1 && targetIdx > currIdx + 1) {
          console.warn(`[TaskEngine] ⚠️ 拦截非法跨工序空跳：当前阶段 [${latestProject.currentStage}]，目标技能工序 [${targetStage}]，拒绝跃迁`);
        }
      }

      // 提案原子回标 (ProposalStore + Messages SSOT 双持久化保全)
      const targetActionId = actionId || params.actionId;
      if (targetActionId) {
        ProposalStore.getInstance().updateProposalStatus(projectId, targetActionId, 'executed', {
          executedAt: task.completedAt,
          resultSummary: result.summary,
        });

        const sessionsToSearch = sessionId
          ? [store.getSession(projectId, sessionId)].filter((s): s is NonNullable<typeof s> => Boolean(s))
          : store.listSessions(projectId);

        for (const sess of sessionsToSearch) {
          const messages = store.getMessages(projectId, sess.sessionId);
          const targetMsg = messages.find((m) => m.actionProposal?.actionId === targetActionId);
          if (targetMsg?.actionProposal) {
            targetMsg.actionProposal.status = 'executed';
            targetMsg.actionProposal.executedAt = task.completedAt;
            targetMsg.actionProposal.resultSummary = result.summary;
            store.saveMessages(projectId, sess.sessionId, messages);
            break;
          }
        }
      }

      if (sessionId) {
        const currentProject = store.getProject(projectId);
        const currentSession = store.getSession(projectId, sessionId);
        if (currentProject?.currentStage && currentSession && currentSession.currentStage !== currentProject.currentStage) {
          currentSession.currentStage = currentProject.currentStage;
          store.saveSession(currentSession);
        }

        // 注入总结通知消息
        const notifyMsg: ChatMessage = {
          id: `msg_task_${randomUUID().slice(0, 8)}`,
          role: 'assistant',
          content: `🎬【${skill.manifest.displayName}】工序执行完成！\n${result.summary}`,
          createdAt: new Date().toISOString(),
        };
        store.appendMessage(projectId, sessionId, notifyMsg);
      }
    } catch (err: any) {
      task.status = abortController.signal.aborted ? 'aborted' : 'failed';
      const classified = classify(err);
      task.errorCode = classified.code;
      task.errorDetail = classified.detail;
      task.error = err.message || '任务失败';
      task.message = `[${classified.code}] ${task.error}`;
      task.updatedAt = new Date().toISOString();
      if (err?.partial) {
        task.partialResult = err.partial;
      }
      this.persistTask(task);

      trace(projectId, 'task.execute', {
        taskId,
        skillName: skill.manifest.name,
        status: task.status,
        errorCode: task.errorCode,
        errorDetail: task.errorDetail,
        durationMs: task.startedAt ? Date.now() - new Date(task.startedAt).getTime() : 0,
      });

      // 🌟 任务异常失败后，原子回标提案状态为 failed，支持一键重试与自愈流转
      const targetActionId = actionId || params.actionId;
      if (targetActionId) {
        ProposalStore.getInstance().updateProposalStatus(projectId, targetActionId, 'failed', {
          error: task.error,
          failedAt: task.updatedAt,
        });

        const sessionsToSearch = sessionId
          ? [store.getSession(projectId, sessionId)].filter((s): s is NonNullable<typeof s> => Boolean(s))
          : store.listSessions(projectId);

        for (const sess of sessionsToSearch) {
          const messages = store.getMessages(projectId, sess.sessionId);
          const targetMsg = messages.find((m) => m.actionProposal?.actionId === targetActionId);
          if (targetMsg?.actionProposal) {
            targetMsg.actionProposal.status = 'failed';
            targetMsg.actionProposal.description = `[执行未收敛] ${task.error}。可点击卡片重新执行本工序。`;
            store.saveMessages(projectId, sess.sessionId, messages);
            break;
          }
        }

        if (sessionId) {
          const alertMsg: ChatMessage = {
            id: `msg_task_err_${randomUUID().slice(0, 8)}`,
            role: 'assistant',
            content: `🚨【${skill.manifest.displayName}】工序执行遇到异常: ${task.error}。\n您可以在上方卡片点击【重新尝试】或在对话中微调要求后再次推进。`,
            isError: true,
            createdAt: new Date().toISOString(),
          };
          store.appendMessage(projectId, sessionId, alertMsg);
        }
      }
    } finally {
      this.abortControllers.delete(taskId);
      this.cancelledTaskIds.delete(taskId);
    }
  }

  /**
   * 获取指定任务详情 (支持缓存 + 磁盘落盘双回退)
   */
  public getTask(projectId: string, taskId: string): TaskEntity | undefined {
    if (this.taskCache.has(taskId)) {
      return this.taskCache.get(taskId);
    }

    const file = this.getTaskFile(projectId, taskId);
    if (fs.existsSync(file)) {
      try {
        const raw = fs.readFileSync(file, 'utf-8');
        const entity = JSON.parse(raw) as TaskEntity;
        this.taskCache.set(taskId, entity);
        return entity;
      } catch (err) {
        console.warn(`[TaskEngine] 加载任务快照失败: ${file}`, err);
      }
    }
    return undefined;
  }

  /**
   * 订阅指定任务进度变更流 (轻量重连与恢复)
   */
  public subscribeTask(taskId: string, callback: (task: TaskEntity) => void): () => void {
    const listener = (task: TaskEntity) => callback(task);
    this.emitter.on(`task:${taskId}`, listener);
    return () => {
      this.emitter.off(`task:${taskId}`, listener);
    };
  }

  /**
   * 取消/中断运行中的任务
   */
  public cancelTask(projectId: string, taskId: string): boolean {
    this.cancelledTaskIds.add(taskId);
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
      return true;
    }
    const task = this.getTask(projectId, taskId);
    if (task && (task.status === 'pending' || task.status === 'running')) {
      task.status = 'aborted';
      task.message = '任务已被创作者中断';
      task.updatedAt = new Date().toISOString();
      this.persistTask(task);
      return true;
    }
    return false;
  }
}
