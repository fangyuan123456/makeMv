import { WorkflowSession, WorkflowStage, SessionStatus, StopPoint } from '../../types/workflow.js';
import { BaseAgent, AgentResult } from '../../agents/base/index.js';
import { SessionManager } from '../session.manager.js';
import { PipelineNavigator } from './pipeline.navigator.js';
import { PipelineExecutionOptions } from './pipeline.types.js';
import { sessionLock } from '../../utils/concurrency.js';
import { auditService } from '../../audit/index.js';

export class PipelineRunner {
  constructor(
    private navigator: PipelineNavigator,
    private sessionMgr: SessionManager,
    private stageRegistry: Map<WorkflowStage, BaseAgent>
  ) {}

  /**
   * 推进或单步步进工作流流水线的主入口。
 * 通过 sessionLock 对同一项目的并发请求进行排队串行化，
 * 同时允许多个项目彼此独立并发执行。
   */
  async execute(sessionId: string, options?: PipelineExecutionOptions): Promise<WorkflowSession> {
    return await sessionLock.acquire(sessionId, async () => {
      const session = this.sessionMgr.getSession(sessionId);
      if (!session) throw new Error(`Session ${sessionId} not found`);

      const resolution = this.navigator.resolveTarget(session, {
        stageOverride: options?.stageOverride,
        feedback: options?.userFeedback,
      });

      switch (resolution.action) {
        case 'IDLE':
          return session;

        case 'COMPLETE':
          this.markCompleted(session);
          this.sessionMgr.saveSession(session);
          return session;

        case 'EXECUTE_SINGLE':
          return await this.runSingleStage(session, resolution.stage!, options?.userFeedback);

        case 'EXECUTE_PARALLEL':
          return await this.runParallelStages(session, resolution.stages!, options?.userFeedback);

        case 'EXECUTE_SEQUENCE':
          return await this.runSequenceStages(session, resolution.stages!, options?.userFeedback);
      }
    });
  }

  /**
   * Executes a single stage agent within a managed lifecycle.
   */
  private async runSingleStage(
    session: WorkflowSession,
    targetStage: WorkflowStage,
    userFeedback?: string
  ): Promise<WorkflowSession> {
    const agent = this.stageRegistry.get(targetStage);
    if (!agent) {
      throw new Error(`No agent registered for stage: ${targetStage}`);
    }

    const projectDir = this.sessionMgr.getProjectDir(session.id);
    const audit = auditService.createRecorder(
      session.id,
      targetStage,
      agent.constructor.name || targetStage,
      projectDir,
      userFeedback,
      session.meta,
      session.stageArtifacts
    );

    session.currentStage = targetStage;
    session.status = SessionStatus.RUNNING;
    this.sessionMgr.saveSession(session);

    try {
      console.log(`[Pipeline] Executing stage [${targetStage}] for session: ${session.id}`);
      const result: AgentResult = await agent.execute({
        session,
        projectDir,
        userFeedback,
        audit,
      });

      session.stageArtifacts[targetStage] = result.artifact;
      this.handleSingleStageSuccess(session, targetStage, result, userFeedback);

      await audit.finalize({
        artifact: result.artifact,
        status: 'success',
        stopPointTitle: result.stopPointTitle,
        stopPointDescription: result.stopPointDescription,
      });
      this.sessionMgr.saveSession(session);
      return session;
    } catch (err: any) {
      await audit.finalize({ status: 'failed', error: err.stack || err.message });
      this.handleStageFailure(session, targetStage, err);
      this.sessionMgr.saveSession(session);
      throw err;
    }
  }

  /**
   * Executes a group of stages concurrently using Promise.all!
   */
  private async runParallelStages(
    session: WorkflowSession,
    stages: WorkflowStage[],
    userFeedback?: string
  ): Promise<WorkflowSession> {
    const projectDir = this.sessionMgr.getProjectDir(session.id);

    session.currentStage = stages[0];
    session.status = SessionStatus.RUNNING;
    this.sessionMgr.saveSession(session);

    console.log(`[Pipeline] ⚡ Executing PARALLEL stages: [${stages.join(', ')}] for session: ${session.id}`);

    try {
      const results = await Promise.all(
        stages.map(async (stg) => {
          const agent = this.stageRegistry.get(stg);
          if (!agent) throw new Error(`No agent registered for stage: ${stg}`);
          const audit = auditService.createRecorder(
            session.id,
            stg,
            agent.constructor.name || stg,
            projectDir,
            userFeedback,
            session.meta,
            session.stageArtifacts
          );
          console.log(`[Pipeline] -> Branch [${stg}] started...`);
          try {
            const res = await agent.execute({ session, projectDir, userFeedback, audit });
            await audit.finalize({
              artifact: res.artifact,
              status: 'success',
              stopPointTitle: res.stopPointTitle,
              stopPointDescription: res.stopPointDescription,
            });
            console.log(`[Pipeline] <- Branch [${stg}] completed!`);
            return { stage: stg, result: res };
          } catch (err: any) {
            await audit.finalize({ status: 'failed', error: err.stack || err.message });
            throw err;
          }
        })
      );

      for (const item of results) {
        session.stageArtifacts[item.stage] = item.result.artifact;
        session.history.push({
          timestamp: new Date().toISOString(),
          stage: item.stage,
          action: userFeedback ? 'STAGE_REVISED' : 'STAGE_COMPLETED',
          details: item.result.stopPointTitle,
        });
      }

      const interventionItem = results.find((r) => r.result.requiresIntervention);
      const stepIdx = this.navigator.findStepIndexByStage(stages[0]);

      if (this.navigator.isLastStep(stepIdx)) {
        this.markCompleted(session);
      } else if (interventionItem) {
        this.applyIntervention(session, interventionItem.stage, interventionItem.result);
      } else {
        const nextStep = this.navigator.getStep(stepIdx + 1);
        if (nextStep) {
          session.currentStage = nextStep.type === 'stage' ? nextStep.stage : nextStep.stages[0];
        } else {
          this.markCompleted(session);
        }
      }

      this.sessionMgr.saveSession(session);
      return session;
    } catch (err: any) {
      this.handleStageFailure(session, stages[0], err);
      this.sessionMgr.saveSession(session);
      throw err;
    }
  }

  /**
   * 在单个统一的里程碑步骤内，按依赖拓扑顺序串行执行各子阶段任务。
   */
  private async runSequenceStages(
    session: WorkflowSession,
    stages: WorkflowStage[],
    userFeedback?: string
  ): Promise<WorkflowSession> {
    const projectDir = this.sessionMgr.getProjectDir(session.id);
    console.log(`[Pipeline] 🔗 Executing SEQUENCE stages: [${stages.join(' -> ')}] for session: ${session.id}`);

    let lastResult: AgentResult | undefined;
    let lastStage: WorkflowStage = stages[stages.length - 1];

    try {
      for (const stg of stages) {
        const agent = this.stageRegistry.get(stg);
        if (!agent) throw new Error(`No agent registered for stage: ${stg}`);

        const audit = auditService.createRecorder(
          session.id,
          stg,
          agent.constructor.name || stg,
          projectDir,
          userFeedback,
          session.meta,
          session.stageArtifacts
        );

        session.currentStage = stg;
        session.status = SessionStatus.RUNNING;
        this.sessionMgr.saveSession(session);

        console.log(`[Pipeline] -> Sub-stage [${stg}] started...`);
        try {
          const result: AgentResult = await agent.execute({ session, projectDir, userFeedback, audit });
          await audit.finalize({
            artifact: result.artifact,
            status: 'success',
            stopPointTitle: result.stopPointTitle,
            stopPointDescription: result.stopPointDescription,
          });
          console.log(`[Pipeline] <- Sub-stage [${stg}] completed!`);

          session.stageArtifacts[stg] = result.artifact;
          session.history.push({
            timestamp: new Date().toISOString(),
            stage: stg,
            action: userFeedback ? 'STAGE_REVISED' : 'STAGE_COMPLETED',
            details: result.stopPointTitle,
          });

          lastResult = result;
          lastStage = stg;
        } catch (err: any) {
          await audit.finalize({ status: 'failed', error: err.stack || err.message });
          throw err;
        }
      }

      const stepIdx = this.navigator.findStepIndexByStage(lastStage);
      if (this.navigator.isLastStep(stepIdx)) {
        this.markCompleted(session);
      } else if (lastResult?.requiresIntervention) {
        this.applyIntervention(session, lastStage, lastResult);
      } else {
        const nextStep = this.navigator.getStep(stepIdx + 1);
        if (nextStep) {
          session.currentStage = nextStep.type === 'stage' ? nextStep.stage : nextStep.stages[0];
        } else {
          this.markCompleted(session);
        }
      }

      this.sessionMgr.saveSession(session);
      return session;
    } catch (err: any) {
      this.handleStageFailure(session, lastStage, err);
      this.sessionMgr.saveSession(session);
      throw err;
    }
  }

  private handleSingleStageSuccess(
    session: WorkflowSession,
    stage: WorkflowStage,
    result: AgentResult,
    userFeedback?: string
  ): void {
    session.history.push({
      timestamp: new Date().toISOString(),
      stage,
      action: userFeedback ? 'STAGE_REVISED' : 'STAGE_COMPLETED',
      details: result.stopPointTitle,
    });

    const stepIdx = this.navigator.findStepIndexByStage(stage);
    if (this.navigator.isLastStep(stepIdx)) {
      this.markCompleted(session);
      return;
    }

    if (result.requiresIntervention) {
      this.applyIntervention(session, stage, result);
      return;
    }

    const nextStep = this.navigator.getStep(stepIdx + 1);
    if (nextStep) {
      session.currentStage = nextStep.type === 'stage' ? nextStep.stage : nextStep.stages[0];
    } else {
      this.markCompleted(session);
    }
  }

  private applyIntervention(
    session: WorkflowSession,
    stage: WorkflowStage,
    result: AgentResult
  ): void {
    const stopPoint: StopPoint = {
      id: `sp_${Date.now()}`,
      stage,
      title: result.stopPointTitle,
      description: result.stopPointDescription,
      artifactSummary: result.artifact,
      requiresConfirmation: true,
      createdAt: new Date().toISOString(),
    };
    session.currentStopPoint = stopPoint;
    session.status = SessionStatus.WAITING_FOR_INTERVENTION;

    if (!session.messages) session.messages = [];

    // 角色定妆阶段（或任意阶段重跑）直接就地更新阶段卡片，避免产生冗余的重复气泡消息
    const existingStageMsg = session.messages.find(
      (m) => (m.stage === stage || m.stopPoint?.stage === stage) && m.sender === 'agent'
    );
    if (existingStageMsg) {
      existingStageMsg.content = `🎯 **${result.stopPointTitle}**\n\n${result.stopPointDescription}`;
      existingStageMsg.stopPoint = stopPoint;
      existingStageMsg.timestamp = new Date().toISOString();
    } else {
      const thoughtText = this.getStageThought(stage, result);
      session.messages.push({
        id: `msg_ai_${stopPoint.id}`,
        sender: 'agent',
        senderName: 'AI 影游总制作人',
        content: `🎯 **${result.stopPointTitle}**\n\n${result.stopPointDescription}`,
        thought: thoughtText,
        thinkingDurationSec: 2.4,
        timestamp: new Date().toISOString(),
        stage,
        stopPoint,
      });
    }
  }

  private getStageThought(stage: WorkflowStage, result: AgentResult): string {
    switch (stage) {
      case WorkflowStage.NARRATIVE_DESIGN:
        return [
          '• 解析故事主题与核心戏剧冲突，确立整体世界观架构与视觉艺术风格。',
          '• 推演网状互动叙事拓扑图：设计剧情主干、多支线冲突抉择点与结局分支。',
          '• 执行拓扑图静态质检：核验孤岛节点可达性、死锁闭环与分支收束率。',
          '• 提炼核心角色小传、性格动机与人物关系网络。',
        ].join('\n');
      case WorkflowStage.CHARACTER_DESIGN:
        return [
          '• 扫描剧本大纲出场角色，排除无实体的背景旁白。',
          '• 深度推演核心角色的外貌特征、神态情绪与服装配饰锚点。',
          '• 构建高质量多模态生图 Prompt 结构，绑定影视级质感与灯光参数。',
          '• 准备角色定妆图生成管线，支持用户直接上传目标图与参考图。',
        ].join('\n');
      case WorkflowStage.SCENE_SCRIPT:
        return [
          '• 将故事节点细化展开为专业分幕剧本，设定内景/外景与昼夜时空调度。',
          '• 撰写角色对白与潜台词，标注 TTS 台词情绪参数。',
          '• 编写场面调度动作指示，并在决策点嵌入选项跳转与线索判定逻辑。',
        ].join('\n');
      case WorkflowStage.STORYBOARD:
        return [
          '• 依循专业影视视听语言切分镜头序列（特写、中景、远景交替）。',
          '• 编排运镜方式（推拉摇移、俯仰视角）并测算镜头秒数时长。',
          '• 注入图生视频 (I2V) 专用提示词，确保镜头间角色面部与画风一致性。',
        ].join('\n');
      case WorkflowStage.KEYFRAME_REFERENCE:
        return [
          '• 提取分镜景别特征与环境光影色调锚点。',
          '• 深度融合角色立绘设定图，锁定人物特征一致性。',
          '• 渲染高清视觉关键帧图作为视频生成的起始垫图。',
          '• 执行构图美学与视听连续性质检。',
        ].join('\n');
      case WorkflowStage.VIDEO_PRODUCTION:
        return [
          '• 提取上一镜头末尾静态帧，建立时序平滑衔接通道。',
          '• 注入物理运动提示词 (Camera Dynamics & Subject Motion)。',
          '• 调度视频大模型渲染高保真动态切片。',
          '• 使用本地 FFmpeg 执行画面标准化、音画对齐与 CRF 压缩。',
        ].join('\n');
      case WorkflowStage.FMV_PACKAGING:
        return [
          '• 提取决策分支节点末帧，生成无缝呼吸微动视频 (Breathing Loops)。',
          '• 缝合节点内部多镜头为连续视频 (Node Concatenation)。',
          '• 装配 game_manifest.json 互动短剧状态机引擎清单。',
          '• 全局混音环境声乐与对白轨，交付交互播放器。',
        ].join('\n');
      default:
        return result.stopPointDescription || '推演完成';
    }
  }

  private markCompleted(session: WorkflowSession): void {
    session.currentStage = WorkflowStage.COMPLETED;
    session.status = SessionStatus.COMPLETED;
    session.currentStopPoint = undefined;

    if (!session.messages) session.messages = [];
    session.messages.push({
      id: `msg_completed_${Date.now()}`,
      sender: 'agent',
      senderName: 'AI 影游总制作人',
      content: '🎉 恭喜！整部 AI 互动短剧制作与交互打包已全部完成！\n您现在可以在右侧窗口直接体验试玩，探索不同分支结局！',
      timestamp: new Date().toISOString(),
      stage: WorkflowStage.COMPLETED,
    });
  }

  private handleStageFailure(
    session: WorkflowSession,
    stage: WorkflowStage,
    err: any
  ): void {
    session.status = SessionStatus.FAILED;
    session.history.push({
      timestamp: new Date().toISOString(),
      stage,
      action: 'STAGE_FAILED',
      details: err.message || 'Execution error',
    });

    if (!session.messages) session.messages = [];
    session.messages.push({
      id: `msg_err_${Date.now()}`,
      sender: 'agent',
      senderName: 'AI 影游总制作人',
      content: `⚠️ 在执行【${stage}】工序时遇到问题：${err.message || '执行异常'}\n您可以点击重试或在下方输入修改意见。`,
      timestamp: new Date().toISOString(),
      stage,
    });
  }
}
