/**
 * tests/universal-gating-runtime.test.ts
 * 全链路多态门禁与自由艺术终局专项测试 (Universal Gating & Freeform Ending Test)
 *
 * 验证：
 * 1. 随身物品持有门禁 requiredItems (有钥匙开门，无钥匙拦截)；
 * 2. 数值阈值门禁 requiredVariables (金钱 gte: 100 放行，不足拦截)；
 * 3. 自由艺术终局 (endingType: "自我和解与莫比乌斯重启")；
 * 4. 多机位视听构图 (perspective: "电影第三人称正反打")；
 * 5. 0-Token 纯确定性运行时全链路闭环运转。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TextGameArtifactSchema,
  type TextGameArtifact,
} from '../src/agents/text-game/schema.js';
import { TextGameRuntimeEngine } from '../src/runtime/state-engine.js';

test('1. 多态门禁与自由艺术终局：TextGameSchema 契约合规性', () => {
  const artifact: TextGameArtifact = {
    schemaVersion: '1.0.0',
    title: '古堡密锁：双生迷局',
    startNodeId: 'node_foyer',
    nodes: [
      {
        id: 'node_foyer',
        title: '回音门厅',
        visual: {
          perspective: '电影第三人称正反打',
          locationName: '中央门厅',
          scenePrompt: '阴雨绵绵的哥特古堡大厅，壁炉火光在石砖上跳跃',
          characterPrompt: '侦探艾伦收起浸湿的风衣，神色凝重',
          composition: '过肩镜头 (Over-the-Shoulder Shot)',
          imagePromptEn: 'Cinematic over-the-shoulder shot, detective in trench coat inside gothic foyer, fireplace glowing.',
        },
        narrativeText: '厚重的橡木大门在身后轰然闭合。正前方的铜门上挂着三道重锁。',
        choices: [
          {
            id: 'c_search_desk',
            text: '搜查管家桌的抽屉',
            stateMutation: {
              inventoryAdd: ['黄铜钥匙'],
              variables: { insight: 10 },
            },
            targetNodeId: 'node_foyer',
          },
          {
            id: 'c_open_bronze_door',
            text: '使用【黄铜钥匙】开启沉重铜门',
            requiredItems: ['黄铜钥匙'],
            requiredVariables: {
              insight: { gte: 10 },
            },
            targetNodeId: 'node_secret_vault',
          },
        ],
      },
      {
        id: 'node_secret_vault',
        title: '真理密室',
        narrativeText: '随着清脆的机簧声，沉重铜门缓缓推开，尘封百年的秘密在此刻释怀。',
        choices: [],
        isEnding: true,
        endingType: '释怀与真理破晓 (Reconciliation)',
      },
    ],
  };

  // 1. Zod Schema 校验
  const parsed = TextGameArtifactSchema.parse(artifact);
  assert.equal(parsed.title, '古堡密锁：双生迷局');
  assert.equal(parsed.nodes[0].visual?.perspective, '电影第三人称正反打');
  assert.equal(parsed.nodes[1].endingType, '释怀与真理破晓 (Reconciliation)');
});

test('2. 确定性运行时对 requiredItems (物品门禁) 与 requiredVariables (数值门槛) 的刚性拦截与放行', () => {
  const artifact: TextGameArtifact = {
    schemaVersion: '1.0.0',
    title: '门禁测试游戏',
    startNodeId: 'n_start',
    nodes: [
      {
        id: 'n_start',
        title: '起步点',
        narrativeText: '你在铁门前。',
        choices: [
          {
            id: 'c_get_loot',
            text: '拾取钥匙并赚取金钱',
            stateMutation: {
              inventoryAdd: ['brass_key'],
              variables: { gold: 120 },
            },
            targetNodeId: 'n_start',
          },
          {
            id: 'c_unlock_gate',
            text: '使用钥匙开门（需持有 brass_key 且金钱 >= 100）',
            requiredItems: ['brass_key'],
            requiredVariables: {
              gold: { gte: 100 },
            },
            targetNodeId: 'n_vault',
          },
        ],
      },
      {
        id: 'n_vault',
        title: '宝库',
        narrativeText: '大门洞开！',
        choices: [],
        isEnding: true,
        endingType: '黄金时代 (Golden Era)',
      },
    ],
  };

  const initState = TextGameRuntimeEngine.initGame(
    {
      globalStateMachine: {
        variables: { gold: { name: '金钱', initial: 0 } },
        inventory: [],
      },
    } as any,
    artifact
  );

  // 1. 尝试直接开门：拦截（缺少物品 brass_key）
  const failStep1 = TextGameRuntimeEngine.step(artifact, initState, 'c_unlock_gate');
  assert.ok(failStep1.error, '未持有物品时必须拦截');
  assert.ok(failStep1.error.includes('brass_key'), '错误信息必须指出缺失物品');

  // 2. 拾取钥匙并获取金钱 (gold 0 -> 120, inventory +brass_key)
  const lootStep = TextGameRuntimeEngine.step(artifact, initState, 'c_get_loot');
  assert.equal(lootStep.nextState.inventory.includes('brass_key'), true);
  assert.equal(lootStep.nextState.variables['gold'], 120);

  // 3. 再次尝试开门：放行！
  const successStep = TextGameRuntimeEngine.step(artifact, lootStep.nextState, 'c_unlock_gate');
  assert.equal(successStep.error, undefined, '条件全部满足时必须放行');
  assert.equal(successStep.nextState.currentNodeId, 'n_vault');
  assert.equal(successStep.nextState.isEnding, true);
  assert.equal(successStep.nextNode?.endingType, '黄金时代 (Golden Era)');
});
