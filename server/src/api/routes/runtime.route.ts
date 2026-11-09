/**
 * api/routes/runtime.route.ts
 * 纯确定性文游运行与试玩决策路由 (Runtime Domain Route)
 *
 * 特性：0 Token 消耗，纯本地内存级毫秒运算
 */

import { Router } from 'express';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { TextGameRuntimeEngine, type PlayerGameState } from '../../runtime/state-engine.js';
import type { GDDArtifact } from '../../agents/planner/schema.js';
import type { TextGameArtifact } from '../../agents/text-game/schema.js';
import { sendSuccess, sendError } from '../helpers.js';

export const runtimeRouter = Router();
const store = ProjectStore.getInstance();

/**
 * 初始化文游试玩存档
 */
runtimeRouter.post('/:projectId/init', (req, res) => {
  const gdd = store.getArtifact<GDDArtifact>(req.params.projectId, 'gdd');
  const textGame = store.getArtifact<TextGameArtifact>(req.params.projectId, 'text_game');

  if (!gdd || !textGame) {
    return sendError(
      res,
      400,
      '项目尚未生成完整的 GDD 策划案或文游资产，无法开启试玩'
    );
  }

  try {
    const state = TextGameRuntimeEngine.initGame(gdd, textGame);
    const firstNode = textGame.nodes.find((n) => n.id === state.currentNodeId) || textGame.nodes[0];
    sendSuccess(res, { state, node: firstNode }, '游戏存档初始化就绪');
  } catch (err: any) {
    sendError(res, 500, err.message);
  }
});

/**
 * 玩家下达决策选择，状态机推进
 */
runtimeRouter.post('/:projectId/step', (req, res) => {
  const { currentState, choiceId } = req.body as {
    currentState?: PlayerGameState;
    choiceId?: string;
  };

  if (!currentState || !choiceId) {
    return sendError(res, 400, '请求体缺少 currentState 或 choiceId');
  }

  const textGame = store.getArtifact<TextGameArtifact>(req.params.projectId, 'text_game');
  if (!textGame) {
    return sendError(res, 400, '未找到对应的文游资产，无法推进剧情');
  }

  const result = TextGameRuntimeEngine.step(textGame, currentState, choiceId);
  if (result.error) {
    return sendError(res, 400, result.error);
  }

  sendSuccess(res, { state: result.nextState, node: result.nextNode }, '状态机推进成功');
});
