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
import type { GDDArtifact, GlobalStateMachine } from '../agents/planner/schema.js';

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
  public static initGame(
    gdd: { globalStateMachine?: Partial<GlobalStateMachine> } | GDDArtifact,
    textGame: TextGameArtifact
  ): PlayerGameState {
    const initialVariables: Record<string, number> = {};
    if (gdd.globalStateMachine?.variables) {
      for (const [key, spec] of Object.entries(gdd.globalStateMachine.variables)) {
        if (spec && typeof spec.initial === 'number') {
          initialVariables[key] = spec.initial;
        }
      }
    }

    const initialFlags: Record<string, boolean> = {};
    if (gdd.globalStateMachine?.flags) {
      for (const [key, spec] of Object.entries(gdd.globalStateMachine.flags)) {
        if (spec && typeof spec.initial === 'boolean') {
          initialFlags[key] = spec.initial;
        }
      }
    }

    const initialInventory: string[] = [...(gdd.globalStateMachine?.inventory || [])];

    // 合入 PRD initialState（保留文本游与独立座舱统一的初始状态）
    if (textGame.initialState) {
      for (const [key, val] of Object.entries(textGame.initialState)) {
        if (typeof val === 'number' && initialVariables[key] === undefined) {
          initialVariables[key] = val;
        } else if (typeof val === 'boolean' && initialFlags[key] === undefined) {
          initialFlags[key] = val;
        } else if (Array.isArray(val)) {
          for (const item of val) {
            if (typeof item === 'string' && !initialInventory.includes(item)) {
              initialInventory.push(item);
            }
          }
        }
      }
    }

    return {
      currentNodeId: textGame.startNodeId || textGame.nodes[0]?.id || 'S1',
      variables: initialVariables,
      flags: initialFlags,
      inventory: initialInventory,
      history: [
        {
          nodeId: textGame.startNodeId || textGame.nodes[0]?.id || 'S1',
          timestamp: new Date().toISOString(),
        },
      ],
      isEnding: false,
    };
  }

  /**
   * 校验选项是否满足多态门禁条件（布尔标记 / 道具持有 / 数值门槛）
   */
  public static validateChoice(
    choice: TextGameChoice,
    state: PlayerGameState
  ): ChoiceValidationResult {
    // 1. 布尔旗标门禁判定
    if (choice.requiredFlags && choice.requiredFlags.length > 0) {
      for (const flag of choice.requiredFlags) {
        if (!state.flags[flag]) {
          return { allowed: false, reason: `尚未解锁前置条件或未达成对应标记: [${flag}]` };
        }
      }
    }

    // 2. 随身物品/线索持有门禁判定
    if (choice.requiredItems && choice.requiredItems.length > 0) {
      for (const item of choice.requiredItems) {
        if (!state.inventory.includes(item)) {
          return { allowed: false, reason: `尚未持有关键随身物品或证据线索: [${item}]` };
        }
      }
    }

    // 3. 数值门槛条件判定 (gte / lte)
    if (choice.requiredVariables && Object.keys(choice.requiredVariables).length > 0) {
      for (const [varKey, range] of Object.entries(choice.requiredVariables)) {
        const currentVal = state.variables[varKey] ?? 0;
        if (range.gte !== undefined && currentVal < range.gte) {
          return {
            allowed: false,
            reason: `当前 [${varKey}] (${currentVal}) 未达到要求下限 (${range.gte})`,
          };
        }
        if (range.lte !== undefined && currentVal > range.lte) {
          return {
            allowed: false,
            reason: `当前 [${varKey}] (${currentVal}) 超出允许上限 (${range.lte})`,
          };
        }
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
    if (choice.stateMutation?.variables) {
      for (const [vKey, delta] of Object.entries(choice.stateMutation.variables)) {
        nextVariables[vKey] = (nextVariables[vKey] ?? 0) + delta;
      }
    }
    if (choice.stateMutation?.setVariables) {
      for (const [vKey, val] of Object.entries(choice.stateMutation.setVariables)) {
        nextVariables[vKey] = val;
      }
    }

    const nextFlags = { ...state.flags };
    if (choice.stateMutation?.flags) {
      for (const [fKey, val] of Object.entries(choice.stateMutation.flags)) {
        nextFlags[fKey] = val;
      }
    }

    const nextInventory = [...state.inventory];
    if (choice.stateMutation?.inventoryAdd) {
      for (const item of choice.stateMutation.inventoryAdd) {
        if (!nextInventory.includes(item)) nextInventory.push(item);
      }
    }
    if (choice.stateMutation?.inventoryRemove) {
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
