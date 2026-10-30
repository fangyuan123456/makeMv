/**
 * agents/director/Director.ts
 * 互动影游总导演编排推进器 (Workflow Director SSOT)
 * 统筹全链路各阶段流水线调度与项目状态步进
 */

import { ProjectStore } from '../../project-store/ProjectStore.js';
import { ProgressBus } from '../../queue/ProgressBus.js';
import {
  WorkflowSession,
  WorkflowStage,
  SessionStatus,
  STAGE_SEQUENCE,
  SessionMeta,
} from '../../contracts/index.js';

export interface DirectorOptions {
  projectId: string;
}

export class Director {
  private static instance: Director;

  public static getInstance(): Director {
    if (!Director.instance) {
      Director.instance = new Director();
    }
    return Director.instance;
  }

  /**
   * 创建并持久化新工程 (SSOT: 全局统一概念为 projectId)
   */
  public createProject(title: string, meta: SessionMeta): WorkflowSession {
    const projectId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const store = ProjectStore.getInstance();

    const project: WorkflowSession = {
      projectId,
      title,
      meta,
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [
        {
          timestamp: new Date().toISOString(),
          stage: WorkflowStage.NARRATIVE_DESIGN,
          action: 'PROJECT_CREATED',
          details: `Project "${title}" created`,
        },
      ],
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    store.saveProject(project);
    return project;
  }

  /**
   * 执行或单步步进流水线
   */
  public async step(
    projectId: string,
    userFeedback?: string,
    stageOverride?: WorkflowStage,
  ): Promise<WorkflowSession> {
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found in ProjectStore`);

    const targetStage = stageOverride || project.currentStage || WorkflowStage.NARRATIVE_DESIGN;
    project.status = SessionStatus.RUNNING;
    project.currentStage = targetStage;
    project.updatedAt = new Date().toISOString();
    store.saveProject(project);

    ProgressBus.getInstance().emitProgress({
      projectId,
      stage: targetStage,
      percent: 10,
      detail: `开始执行阶段: ${targetStage}`,
      timestamp: new Date().toISOString(),
    });

    return project;
  }

  /**
   * 确认当前卡点并推进至下一个阶段
   */
  public async continue(projectId: string): Promise<WorkflowSession> {
    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const currentIndex = STAGE_SEQUENCE.indexOf(project.currentStage);
    if (currentIndex >= 0 && currentIndex < STAGE_SEQUENCE.length - 1) {
      project.currentStage = STAGE_SEQUENCE[currentIndex + 1];
      project.status = SessionStatus.IDLE;
    } else {
      project.status = SessionStatus.COMPLETED;
    }

    project.updatedAt = new Date().toISOString();
    store.saveProject(project);
    return project;
  }

  /**
   * 提交创作者反馈并重跑
   */
  public async revise(
    projectId: string,
    feedback: string,
    stageOverride?: WorkflowStage,
  ): Promise<WorkflowSession> {
    return this.step(projectId, feedback, stageOverride);
  }

  /**
   * 跑完所有阶段
   */
  public async runAll(projectId: string): Promise<WorkflowSession> {
    let project = await this.continue(projectId);
    while (project.status !== SessionStatus.COMPLETED && project.status !== SessionStatus.FAILED) {
      project = await this.continue(projectId);
    }
    return project;
  }
}

export const director = Director.getInstance();
