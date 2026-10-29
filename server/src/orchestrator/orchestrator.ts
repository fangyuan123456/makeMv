import {
  WorkflowSession,
  WorkflowStage,
  SessionStatus,
  STAGE_SEQUENCE,
  SessionMeta,
  StopPoint,
} from '../types/workflow.js';
import { BaseAgent, AgentResult } from '../agents/base.agent.js';
import { ScriptWriterAgent } from '../agents/script.agent.js';
import { CharacterDesignerAgent } from '../agents/character.agent.js';
import { StoryboardAgent } from '../agents/storyboard.agent.js';
import { ReferenceGeneratorAgent } from '../agents/reference.agent.js';
import { VideoPostAgent } from '../agents/video-post.agent.js';
import { sessionManager, SessionManager } from './session.manager.js';

export class Orchestrator {
  private agents: Map<WorkflowStage, BaseAgent> = new Map();
  private sessionMgr: SessionManager;

  constructor() {
    this.sessionMgr = sessionManager;
    this.registerAgents();
  }

  private registerAgents() {
    this.agents.set(WorkflowStage.SCRIPT_GENERATION, new ScriptWriterAgent());
    this.agents.set(WorkflowStage.CHARACTER_DESIGN, new CharacterDesignerAgent());
    this.agents.set(WorkflowStage.EPISODE_SCRIPT, new ScriptWriterAgent());
    this.agents.set(WorkflowStage.STORYBOARD, new StoryboardAgent());
    this.agents.set(WorkflowStage.REFERENCE_GENERATION, new ReferenceGeneratorAgent());
    this.agents.set(WorkflowStage.VIDEO_POST, new VideoPostAgent());
  }

  createProject(title: string, meta: SessionMeta): WorkflowSession {
    const id = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const session = this.sessionMgr.createSession(id, title, meta);
    return session;
  }

  /**
   * Executes the next workflow stage or reruns current stage with user feedback.
   */
  async step(sessionId: string, userFeedback?: string, stageOverride?: WorkflowStage): Promise<WorkflowSession> {
    const session = this.sessionMgr.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    if (!stageOverride && (session.currentStage === WorkflowStage.COMPLETED || session.status === SessionStatus.COMPLETED)) {
      return session;
    }

    let targetStage: WorkflowStage;

    if (stageOverride && Object.values(WorkflowStage).includes(stageOverride)) {
      targetStage = stageOverride;
    } else if (session.currentStage === WorkflowStage.INIT) {
      targetStage = STAGE_SEQUENCE[0];
    } else if (session.status === SessionStatus.WAITING_FOR_INTERVENTION && !userFeedback) {
      // If waiting for intervention and continuing without feedback, advance to next stage
      const currentIndex = STAGE_SEQUENCE.indexOf(session.currentStage);
      if (currentIndex === -1 || currentIndex >= STAGE_SEQUENCE.length - 1) {
        session.currentStage = WorkflowStage.COMPLETED;
        session.status = SessionStatus.COMPLETED;
        this.sessionMgr.saveSession(session);
        return session;
      }
      targetStage = STAGE_SEQUENCE[currentIndex + 1];
    } else {
      // Re-running current stage (e.g. revision feedback)
      targetStage = session.currentStage;
    }

    const agent = this.agents.get(targetStage);
    if (!agent) {
      throw new Error(`No agent registered for stage: ${targetStage}`);
    }

    session.currentStage = targetStage;
    session.status = SessionStatus.RUNNING;
    this.sessionMgr.saveSession(session);

    const projectDir = this.sessionMgr.getProjectDir(sessionId);

    try {
      console.log(`[Orchestrator] Executing stage: ${targetStage} for session: ${sessionId}`);
      const result: AgentResult = await agent.execute({
        session,
        projectDir,
        userFeedback,
      });

      // Save artifact
      session.stageArtifacts[targetStage] = result.artifact;

      if (targetStage === WorkflowStage.VIDEO_POST) {
        session.currentStage = WorkflowStage.COMPLETED;
        session.status = SessionStatus.COMPLETED;
        session.currentStopPoint = undefined;
      } else if (result.requiresIntervention) {
        const stopPoint: StopPoint = {
          id: `sp_${Date.now()}`,
          stage: targetStage,
          title: result.stopPointTitle,
          description: result.stopPointDescription,
          artifactSummary: result.artifact,
          requiresConfirmation: true,
          createdAt: new Date().toISOString(),
        };
        session.currentStopPoint = stopPoint;
        session.status = SessionStatus.WAITING_FOR_INTERVENTION;
      } else {
        // Auto advance if no intervention required
        const nextIndex = STAGE_SEQUENCE.indexOf(targetStage) + 1;
        if (nextIndex < STAGE_SEQUENCE.length) {
          session.currentStage = STAGE_SEQUENCE[nextIndex];
        } else {
          session.currentStage = WorkflowStage.COMPLETED;
          session.status = SessionStatus.COMPLETED;
        }
      }

      session.history.push({
        timestamp: new Date().toISOString(),
        stage: targetStage,
        action: userFeedback ? 'STAGE_REVISED' : 'STAGE_COMPLETED',
        details: result.stopPointTitle,
      });

      this.sessionMgr.saveSession(session);
      return session;
    } catch (err: any) {
      session.status = SessionStatus.FAILED;
      session.history.push({
        timestamp: new Date().toISOString(),
        stage: targetStage,
        action: 'STAGE_FAILED',
        details: err.message,
      });
      this.sessionMgr.saveSession(session);
      throw err;
    }
  }

  /**
   * User approves the stop-point and proceeds to the next stage.
   */
  async continue(sessionId: string): Promise<WorkflowSession> {
    return this.step(sessionId);
  }

  /**
   * User requests modifications with feedback.
   */
  async revise(sessionId: string, feedback: string): Promise<WorkflowSession> {
    return this.step(sessionId, feedback);
  }

  /**
   * Runs all remaining stages to completion automatically.
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
