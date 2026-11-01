/**
 * agents/director/DirectorAgent.ts
 * 互动影游总导演编排与决策总控智能体 (Director Agent SSOT)
 *
 * 核心机制：
 * 1. 继承 BaseAgent，实例终生绑定特定 projectId，专职服务当前工程 (Transient Per-Project Lifecycle)；
 * 2. 挂载 StageExecutor 执行机，通过控制反转 (IoC) 注入流水线工厂与同工程绑定的 Doctor 自愈医生；
 * 3. 驱动项目全局状态黑板 (ProjectStore)，统一对外提供 step、continue、revise、createProject 等高内聚导演业务；
 * 4. continue() 基于 stageArtifacts 事实黑板派生推导，消灭单工序重跑导致的“时光倒流”缺陷。
 */

import {
  BaseAgent,
  type AgentResult,
  StageExecutor,
  type StageBlueprint,
} from '../../agent-runtime/index.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { STAGE_PIPELINE_FACTORY } from '../../pipelines/index.js';
import { DoctorAgent } from '../doctor/index.js';
import {
  WorkflowSession,
  WorkflowStage,
  SessionStatus,
  SessionMeta,
} from '../../types/index.js';

export { type StageBlueprint };

/**
 * 🌟 严格对齐互动影游 5 大宏观核心阶段编排蓝图 (SSOT)
 */
export const DIRECTOR_STAGE_BLUEPRINTS: StageBlueprint[] = [
  // 第一步：叙事架构师（网状故事圣经与剧情拓扑）
  {
    type: 'STAGE',
    stage: WorkflowStage.NARRATIVE_DESIGN,
    label: '叙事架构工序：网状故事圣经与剧情拓扑',
  },

  // 第二步：双轨并发资产（角色视觉锚点 ⑊ 场景分场剧本）
  {
    type: 'PARALLEL',
    label: '双轨并发资产：角色设计 ⑊ 分场剧本',
    stages: [
      { stage: WorkflowStage.CHARACTER_DESIGN, label: '角色定妆与视觉锚点' },
      { stage: WorkflowStage.SCENE_SCRIPT, label: '场景分场剧本拓展' },
    ],
  },

  // 第三步：视听预演工序（分镜镜头切分 ➔ 首帧关键帧参考图）
  {
    type: 'SEQUENCE',
    label: '视听预演工序：分镜切分 ➔ 关键帧参考图',
    stages: [
      { stage: WorkflowStage.STORYBOARD, label: '视听分镜表规划' },
      { stage: WorkflowStage.KEYFRAME_REFERENCE, label: '首帧关键帧渲染' },
    ],
  },

  // 第四步：视频导演切片（各分支节点动态视频渲染）
  {
    type: 'STAGE',
    stage: WorkflowStage.VIDEO_PRODUCTION,
    label: '视频导演工序：分支节点动态视频切片渲染',
  },

  // 第五步：影游装配发布（工程混音与播放器 Manifest 打包）
  {
    type: 'STAGE',
    stage: WorkflowStage.FMV_PACKAGING,
    label: '影游装配工序：工程混音与交互播放器打包',
  },
];

export class DirectorAgent extends BaseAgent<any, any> {
  private readonly stageExecutor: StageExecutor;

  constructor(projectId: string) {
    super('DIRECTOR', projectId);
    this.stageExecutor = new StageExecutor({
      pipelineRegistry: STAGE_PIPELINE_FACTORY,
      healer: new DoctorAgent(projectId),
    });
  }

  /**
   * 静态工厂：创建并持久化新工程 (SSOT)
   */
  public static createProject(title: string, meta: SessionMeta): WorkflowSession {
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
   * 统一受控执行切面入口 (由 BaseAgent.execute 触发)
   */
  public async run(input: any): Promise<AgentResult<WorkflowSession>> {
    const startMs = Date.now();
    const action = input?.action || 'continue';
    const userFeedback = input?.userFeedback;
    let session: WorkflowSession;

    if (action === 'step') {
      session = await this.advanceStep(userFeedback, input?.stageOverride, input?.extraOptions);
    } else if (action === 'execute') {
      session = await this.executeSingleStage(input?.stage, userFeedback, true, input?.extraOptions);
    } else {
      session = await this.advanceWorkflow(userFeedback);
    }
    return this.finishResult(true, `Director 调度完成: ${action}`, session, startMs);
  }

  /**
   * 执行单个独立工序阶段（委托至 StageExecutor）
   */
  public async executeSingleStage(
    stage: WorkflowStage,
    userFeedback?: string,
    manageSessionStatus: boolean = true,
    extraOptions?: Record<string, any>
  ): Promise<WorkflowSession> {
    return this.stageExecutor.executeSingleStage(
      this.projectId,
      stage,
      userFeedback,
      manageSessionStatus,
      extraOptions
    );
  }

  /**
   * 执行指定的宏观阶段编排蓝图（委托至 StageExecutor）
   */
  public async executeStageBlueprint(
    blueprint: StageBlueprint,
    userFeedback?: string,
    extraOptions?: Record<string, any>
  ): Promise<WorkflowSession> {
    return this.stageExecutor.executeStageBlueprint(this.projectId, blueprint, userFeedback, extraOptions);
  }

  /**
   * 单阶段步进（统一受控切面入口）
   */
  public async step(
    userFeedback?: string,
    stageOverride?: WorkflowStage,
    extraOptions?: Record<string, any>
  ): Promise<WorkflowSession> {
    const res = await this.execute({
      action: 'step',
      userFeedback,
      stageOverride,
      extraOptions,
    });
    if (!res.success) {
      throw new Error(res.error || res.summary || 'Director step 执行失败');
    }
    return res.data;
  }

  /**
   * 推进至下一个宏观核心阶段（统一受控切面入口）
   */
  public async continue(userFeedback?: string): Promise<WorkflowSession> {
    const res = await this.execute({
      action: 'continue',
      userFeedback,
    });
    if (!res.success) {
      throw new Error(res.error || res.summary || 'Director continue 执行失败');
    }
    return res.data;
  }

  /**
   * 内部工序步进驱动实现 (Internal step execution)
   */
  private async advanceStep(
    userFeedback?: string,
    stageOverride?: WorkflowStage,
    extraOptions?: Record<string, any>
  ): Promise<WorkflowSession> {
    const store = ProjectStore.getInstance();
    const project = store.getProject(this.projectId);
    if (!project) throw new Error(`Project ${this.projectId} not found in ProjectStore`);

    if (stageOverride) {
      return this.executeSingleStage(stageOverride, userFeedback, true, extraOptions);
    }

    const targetStage = project.currentStage || WorkflowStage.NARRATIVE_DESIGN;
    const blueprint = this.findBlueprintForStage(targetStage);
    return this.executeStageBlueprint(blueprint, userFeedback, extraOptions);
  }

  /**
   * 内部流水线推演驱动实现 (Internal continue execution)
   */
  private async advanceWorkflow(userFeedback?: string): Promise<WorkflowSession> {
    const store = ProjectStore.getInstance();
    const project = store.getProject(this.projectId);
    if (!project) throw new Error(`Project ${this.projectId} not found`);

    let targetBlueprint: StageBlueprint | undefined;
    for (const blueprint of DIRECTOR_STAGE_BLUEPRINTS) {
      if (!this.isBlueprintCompleted(project, blueprint)) {
        targetBlueprint = blueprint;
        break;
      }
    }

    if (!targetBlueprint) {
      project.status = SessionStatus.COMPLETED;
      project.currentStage = WorkflowStage.COMPLETED;
      project.updatedAt = new Date().toISOString();
      store.saveProject(project);
      return project;
    }

    return this.executeStageBlueprint(targetBlueprint, userFeedback);
  }

  /**
   * 判定指定宏观阶段蓝图是否已完全生成交付资产
   */
  private isBlueprintCompleted(project: WorkflowSession, blueprint: StageBlueprint): boolean {
    const artifacts = project.stageArtifacts || {};
    if (blueprint.type === 'STAGE') {
      return !!artifacts[blueprint.stage];
    }
    if (blueprint.type === 'PARALLEL' || blueprint.type === 'SEQUENCE') {
      return blueprint.stages.every((s) => !!artifacts[s.stage]);
    }
    return false;
  }

  private findBlueprintForStage(stage: WorkflowStage): StageBlueprint {
    for (const blueprint of DIRECTOR_STAGE_BLUEPRINTS) {
      if (blueprint.type === 'STAGE' && blueprint.stage === stage) return blueprint;
      if (blueprint.type === 'PARALLEL' && blueprint.stages.some((s) => s.stage === stage)) return blueprint;
      if (blueprint.type === 'SEQUENCE' && blueprint.stages.some((s) => s.stage === stage)) return blueprint;
    }
    return DIRECTOR_STAGE_BLUEPRINTS[0];
  }

  /**
   * 提交创作者反馈并重跑当前步骤
   */
  public async revise(
    userFeedback: string,
    stageOverride?: WorkflowStage
  ): Promise<WorkflowSession> {
    return this.step(userFeedback, stageOverride);
  }

  /**
   * 跑完当前所有 5 大核心步骤
   */
  public async runAll(): Promise<WorkflowSession> {
    let project = await this.continue();
    while (project.status !== SessionStatus.COMPLETED && project.status !== SessionStatus.FAILED) {
      project = await this.continue();
    }
    return project;
  }
}
