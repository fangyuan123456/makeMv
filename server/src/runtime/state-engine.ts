/**
 * runtime/state-engine.ts
 * 互动文游纯确定性运行引擎 (Deterministic Text Game Runtime Engine)
 *
 * 核心法则：
 * 1. 0 Token 消耗，纯本地毫秒级状态机运算；
 * 2. 负责玩家在文游座舱中的选择结算、门禁判定、变量增减与节点路由；
 * 3. 产生可持久化的玩家试玩存档 (PlayerSession)。
 */

import type { TextGameArtifact, TextGameNode, TextGameChoice } from '../agents/text-game/schema.js';
import type { GDDArtifact } from '../agents/planner/schema.js';

export interface PlayerGameState {
  currentNodeId: string;
  variables: Record<string, number>;
  flags: Record<string, boolean>;
  inventory: string[];
  history: Array<{
    nodeId: string;
    choiceId?: string;
    timestamp: string;
  }>;
  isEnding: boolean;
}

export interface ChoiceValidationResult {
  allowed: boolean;
  reason?: string;
}

export class TextGameRuntimeEngine {
  /**
   * 初始化新的玩家游戏存档
   */
  public static initGame(gdd: GDDArtifact, textGame: TextGameArtifact): PlayerGameState {
    const initialVariables: Record<string, number> = {};
    if (gdd.globalStateMachine?.variables) {
      for (const [key, spec] of Object.entries(gdd.globalStateMachine.variables)) {
        initialVariables[key] = spec.initial;
      }
    }

    const initialFlags: Record<string, boolean> = {};
    if (gdd.globalStateMachine?.flags) {
      for (const [key, spec] of Object.entries(gdd.globalStateMachine.flags)) {
        initialFlags[key] = spec.initial;
      }
    }

    return {
      currentNodeId: textGame.startNodeId || textGame.nodes[0]?.id || 'start',
      variables: initialVariables,
      flags: initialFlags,
      inventory: [...(gdd.globalStateMachine?.inventory || [])],
      history: [
        {
          nodeId: textGame.startNodeId || textGame.nodes[0]?.id || 'start',
          timestamp: new Date().toISOString(),
        },
      ],
      isEnding: false,
    };
  }

  /**
   * 校验选项是否满足门禁条件
   */
  public static validateChoice(
    choice: TextGameChoice,
    state: PlayerGameState
  ): ChoiceValidationResult {
    if (!choice.requiredFlags || choice.requiredFlags.length === 0) {
      return { allowed: true };
    }

    for (const flag of choice.requiredFlags) {
      if (!state.flags[flag]) {
        return { allowed: false, reason: `尚未解锁前置条件或未持有对应证据线索: [${flag}]` };
      }
    }

    return { allowed: true };
  }

  /**
   * 玩家执行一次选项决策，进行状态机结算与节点跳转
   */
  public static step(
    textGame: TextGameArtifact,
    state: PlayerGameState,
    choiceId: string
  ): { nextState: PlayerGameState; nextNode: TextGameNode | null; error?: string } {
    const currentNode = textGame.nodes.find((n) => n.id === state.currentNodeId);
    if (!currentNode) {
      return { nextState: state, nextNode: null, error: `当前节点不存在: ${state.currentNodeId}` };
    }

    const choice = currentNode.choices.find((c) => c.id === choiceId);
    if (!choice) {
      return { nextState: state, nextNode: null, error: `当前节点无此选项: ${choiceId}` };
    }

    // 1. 门禁检查
    const validation = this.validateChoice(choice, state);
    if (!validation.allowed) {
      return { nextState: state, nextNode: currentNode, error: validation.reason };
    }

    // 2. 状态机运算变动 (Mutation)
    const nextVariables = { ...state.variables };
    if (choice.stateMutation.variables) {
      for (const [vKey, delta] of Object.entries(choice.stateMutation.variables)) {
        nextVariables[vKey] = (nextVariables[vKey] ?? 0) + delta;
      }
    }

    const nextFlags = { ...state.flags };
    if (choice.stateMutation.flags) {
      for (const [fKey, val] of Object.entries(choice.stateMutation.flags)) {
        nextFlags[fKey] = val;
      }
    }

    const nextInventory = [...state.inventory];
    if (choice.stateMutation.inventoryAdd) {
      for (const item of choice.stateMutation.inventoryAdd) {
        if (!nextInventory.includes(item)) nextInventory.push(item);
      }
    }
    if (choice.stateMutation.inventoryRemove) {
      for (const item of choice.stateMutation.inventoryRemove) {
        const idx = nextInventory.indexOf(item);
        if (idx !== -1) nextInventory.splice(idx, 1);
      }
    }

    // 3. 寻找下一节点
    const nextNode = textGame.nodes.find((n) => n.id === choice.targetNodeId) || null;
    const isEnding = !nextNode || !nextNode.choices || nextNode.choices.length === 0;

    const nextState: PlayerGameState = {
      currentNodeId: choice.targetNodeId,
      variables: nextVariables,
      flags: nextFlags,
      inventory: nextInventory,
      history: [
        ...state.history,
        {
          nodeId: choice.targetNodeId,
          choiceId,
          timestamp: new Date().toISOString(),
        },
      ],
      isEnding,
    };

    return { nextState, nextNode };
  }
}
