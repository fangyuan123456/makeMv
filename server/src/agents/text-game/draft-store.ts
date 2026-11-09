/**
 * agents/text-game/draft-store.ts
 * 互动文游 Pi Agent 建造草稿黑板 (Working Draft Store SSOT)
 *
 * 核心法则：
 * 1. 纯内存状态黑板，支撑 Pi Agent 在自主决策循环中逐步写入节点、自检与测试；
 * 2. 隔离并发会话，每个任务具备独立的建造沙箱；
 * 3. 具备纯代码级拓扑扫描器与确定性测试能力。
 */

import type { TextGameArtifact, TextGameNode } from './schema.js';
import { TextGameRuntimeEngine, type PlayerGameState } from '../../runtime/state-engine.js';
import type { GDDArtifact } from '../planner/schema.js';

export interface GraphAuditReport {
  valid: boolean;
  totalNodes: number;
  startNodeId: string;
  endingNodes: string[];
  issues: string[];
  suggestions: string[];
}

export interface TestPlayReport {
  success: boolean;
  reachedEnding: boolean;
  endingNodeTitle?: string;
  endingType?: string;
  visitedNodes: string[];
  finalVariables: Record<string, number>;
  finalFlags: Record<string, boolean>;
  errors: string[];
}

export class TextGameDraftSession {
  public title: string = '未命名图文互动游戏';
  public startNodeId: string = 'node_start';
  public nodes: Map<string, TextGameNode> = new Map();
  public deliveredArtifact: TextGameArtifact | null = null;

  constructor(public readonly sessionId: string) {}

  public upsertNode(node: TextGameNode): void {
    this.nodes.set(node.id, node);
  }

  public getNode(nodeId: string): TextGameNode | undefined {
    return this.nodes.get(nodeId);
  }

  public toArtifact(): TextGameArtifact {
    const nodeList = Array.from(this.nodes.values());
    if (nodeList.length === 0) {
      throw new Error(`[TextGameDraftSession] 当前草稿无任何节点，无法导出`);
    }
    return {
      schemaVersion: '2.0.0',
      title: this.title,
      startNodeId: this.startNodeId || nodeList[0].id,
      nodes: nodeList,
    };
  }

  /**
   * 静态拓扑图谱自检（查孤岛、断头路、门禁闭环）
   */
  public audit(): GraphAuditReport {
    const issues: string[] = [];
    const suggestions: string[] = [];
    const nodeList = Array.from(this.nodes.values());
    const nodeIds = new Set(this.nodes.keys());
    const endingNodes: string[] = [];

    if (nodeList.length === 0) {
      return {
        valid: false,
        totalNodes: 0,
        startNodeId: this.startNodeId,
        endingNodes: [],
        issues: ['当前未创建任何游戏场景节点，请先使用 write_node 创建起始节点。'],
        suggestions: ['首先阅读 PRD，创建开场节点。'],
      };
    }

    if (!nodeIds.has(this.startNodeId)) {
      issues.push(`起始节点 [${this.startNodeId}] 尚未创建，请确认起始节点 ID。`);
    }

    const referencedTargets = new Set<string>();

    for (const node of nodeList) {
      // 检查结局节点
      if (node.isEnding || node.choices.length === 0) {
        endingNodes.push(node.id);
      }

      // 检查选项指向的目标节点是否存在
      for (const choice of node.choices) {
        referencedTargets.add(choice.targetNodeId);
        if (!nodeIds.has(choice.targetNodeId)) {
          issues.push(
            `节点 [${node.title || node.id}] 中的选项 [${choice.text}] 指向的目标节点 [${choice.targetNodeId}] 尚未创建！`
          );
        }
      }

      // 检查首帧视觉参考
      if (!node.visual?.imagePromptEn) {
        suggestions.push(`节点 [${node.id}] 缺少纯英文视觉生图母本 Prompt，建议补齐以供下游视频模型参考。`);
      }
    }

    // 检查是否存在不可达孤岛节点 (除了起始节点)
    for (const node of nodeList) {
      if (node.id !== this.startNodeId && !referencedTargets.has(node.id)) {
        suggestions.push(`节点 [${node.id}] 目前没有任何前置选项指向它（孤岛节点），请检查连接。`);
      }
    }

    if (endingNodes.length === 0) {
      issues.push('整张图谱中没有检测到任何结局节点 (choices 为空或 isEnding=true)，游戏无法通关！');
    }

    return {
      valid: issues.length === 0,
      totalNodes: nodeList.length,
      startNodeId: this.startNodeId,
      endingNodes,
      issues,
      suggestions,
    };
  }

  /**
   * 模拟试玩一条路线
   */
  public simulatePlay(pathChoiceIds: string[]): TestPlayReport {
    const artifact = this.toArtifact();
    const gddMock: GDDArtifact = {
      schemaVersion: '2.0.0',
      title: this.title,
      genre: '互动文游',
      markdown: '',
      characters: [],
      flowchartNodes: [],
      globalStateMachine: {
        variables: {
          suspicion: { name: '怀疑度', initial: 35, min: 0, max: 100 },
          neural_overload: { name: '神经负荷', initial: 20, min: 0, max: 100 },
          courage: { name: '决断意志', initial: 50, min: 0, max: 100 },
        },
        flags: {
          has_victor_black_account: { name: '掌握黑账', initial: false },
          swapped_name_list: { name: '掉包名单', initial: false },
        },
        inventory: ['fake_id_chip'],
      },
    };

    let state: PlayerGameState = TextGameRuntimeEngine.initGame(gddMock, artifact);
    const visitedNodes = [state.currentNodeId];
    const errors: string[] = [];

    for (const choiceId of pathChoiceIds) {
      if (state.isEnding) break;
      const res = TextGameRuntimeEngine.step(artifact, state, choiceId);
      if (res.error) {
        errors.push(`在节点 [${state.currentNodeId}] 无法执行选项 [${choiceId}]: ${res.error}`);
        break;
      }
      state = res.nextState;
      visitedNodes.push(state.currentNodeId);
    }

    const lastNode = this.nodes.get(state.currentNodeId);
    return {
      success: errors.length === 0,
      reachedEnding: state.isEnding,
      endingNodeTitle: lastNode?.title,
      endingType: lastNode?.endingType,
      visitedNodes,
      finalVariables: state.variables,
      finalFlags: state.flags,
      errors,
    };
  }
}

/**
 * 全局会话注册表单例
 */
export class TextGameDraftRegistry {
  private static sessions: Map<string, TextGameDraftSession> = new Map();

  public static getOrCreate(sessionId: string): TextGameDraftSession {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = new TextGameDraftSession(sessionId);
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  public static remove(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
