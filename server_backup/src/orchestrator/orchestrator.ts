import {
  WorkflowSession,
  WorkflowStage,
  SessionStatus,
  STAGE_SEQUENCE,
  SessionMeta,
} from '../types/workflow.js';
import {
  BaseAgent,
  NarrativeDesignerAgent,
  CharacterDesignerAgent,
  SceneScriptAgent,
  StoryboardAgent,
  ReferenceGeneratorAgent,
  VideoProductionAgent,
  FmvPackagerAgent,
} from '../agents/index.js';
import { sessionManager, SessionManager } from './session.manager.js';
import {
  PipelineNavigator,
  PipelineRunner,
  PipelineStep,
  stage,
  parallel,
  sequence,
} from './pipeline/index.js';

export class Orchestrator {
  private runner: PipelineRunner;
  private sessionMgr: SessionManager;

  constructor() {
    this.sessionMgr = sessionManager;

    const stageRegistry = new Map<WorkflowStage, BaseAgent>([
      [WorkflowStage.NARRATIVE_DESIGN, new NarrativeDesignerAgent()],
      [WorkflowStage.CHARACTER_DESIGN, new CharacterDesignerAgent()],
      [WorkflowStage.SCENE_SCRIPT, new SceneScriptAgent()],
      [WorkflowStage.STORYBOARD, new StoryboardAgent()],
      [WorkflowStage.KEYFRAME_REFERENCE, new ReferenceGeneratorAgent()],
      [WorkflowStage.VIDEO_PRODUCTION, new VideoProductionAgent()],
      [WorkflowStage.FMV_PACKAGING, new FmvPackagerAgent()],
    ]);

    // 🏆 严格对齐《互动影游 Agent 全生命周期全景总结》的 5 大核心步骤
    const pipelineSteps: PipelineStep[] = [
      // 第一步：叙事架构师（网状故事大纲 + 拓扑图谱）
      stage(WorkflowStage.NARRATIVE_DESIGN),

      // 第二步：双轨并发资产（节点互动剧本 ⑊ 角色视觉锚点）
      parallel([
        WorkflowStage.CHARACTER_DESIGN,
        // WorkflowStage.SCENE_SCRIPT,
      ]),

      // 第三步：视听预演工序（分镜切分 ➔ 关键帧渲染 + Doctor 视觉质检）
      sequence([
        WorkflowStage.STORYBOARD,
        WorkflowStage.KEYFRAME_REFERENCE,
      ]),

      // 第四步：视频导演与切片（各节点独立视频切片 .mp4）
      stage(WorkflowStage.VIDEO_PRODUCTION),

      // 第五步：影游装配发布（manifest.json + 交互播放器）
      stage(WorkflowStage.FMV_PACKAGING),
    ];

    const navigator = new PipelineNavigator(pipelineSteps);
    this.runner = new PipelineRunner(navigator, this.sessionMgr, stageRegistry);
  }

  createProject(title: string, meta: SessionMeta): WorkflowSession {
    const id = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    return this.sessionMgr.createSession(id, title, meta);
  }

  /**
   * 执行编排流水线的下一步骤、基于反馈重跑当前阶段或跳转至目标阶段。
   */
  async step(sessionId: string, userFeedback?: string, stageOverride?: WorkflowStage): Promise<WorkflowSession> {
    return this.runner.execute(sessionId, { userFeedback, stageOverride });
  }

  /**
   * 确认当前卡点交付物并推进流水线至下一个阶段。
   */
  async continue(sessionId: string): Promise<WorkflowSession> {
    return this.runner.execute(sessionId);
  }

  /**
   * 在当前或指定阶段提交创作者反馈与修改指示。
   */
  async revise(sessionId: string, feedback: string, stageOverride?: WorkflowStage): Promise<WorkflowSession> {
    return this.runner.execute(sessionId, { userFeedback: feedback, stageOverride });
  }

  /**
   * 按序串行执行流水线中剩余的所有阶段直至全部完成。
   */
  async runAll(sessionId: string): Promise<WorkflowSession> {
    let session = this.sessionMgr.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    while (session.status !== SessionStatus.COMPLETED && session.status !== SessionStatus.FAILED) {
      session = await this.continue(sessionId);
    }

    return session;
  }
}

export const orchestrator = new Orchestrator();
