/**
 * tests/universal-pipeline-engine.test.ts
 * 验证通用底层流水线引擎 (Pipeline SOP Engine) 与 Agent 声明式顺位架构
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { renderPipelineSopGuidance, formatPipelineEntityLabel } from '../src/agents/runtime/pipeline.js';
import { StoryboardAgent } from '../src/agents/storyboard/agent.js';
import { LookdevAgent } from '../src/agents/lookdev/agent.js';
import { PlannerAgent } from '../src/agents/planner/agent.js';
import { DirectorIntentResolver } from '../src/agents/runtime/intent-resolver.js';
import { AgentRunner } from '../src/agents/runtime/runner.js';
import { storyboardCapabilities } from '../src/agents/storyboard/capabilities.js';
import { plannerCapabilities } from '../src/agents/planner/capabilities.js';

describe('通用底层工序流水线 SOP 微内核 (Universal Pipeline SOP Engine)', () => {
  it('1. StoryboardAgent 注入工序执行顺序与严禁阶段之外提议的通用铁律', () => {
    const agent = new StoryboardAgent({ projectId: 'test_p1', clipId: 'c1' });
    const mockTask: any = {
      toolName: 'film.shot_keyframe',
      input: {
        projectId: 'test_p1',
        clipId: 'c1',
        shotId: 'c1-02',
        frame: 'first',
      },
    };

    const prompt = agent.getPostTaskPrompt(mockTask, '首帧关键帧渲染');
    assert.match(prompt, /镜02/);
    assert.match(prompt, /本工序导演标准执行顺序（SOP）/);
    assert.match(prompt, /SeedVR2 高清超分/);
    assert.match(prompt, /修改作用域精确内聚/);
    assert.match(prompt, /人类意愿第一位准则/);
    assert.match(prompt, /严禁阶段之外的伪提议/);
    assert.match(prompt, /绝对严禁将“复盘”、“自愈”、“待审确认”等元指令作为卡片发起/);
  });

  it('2. LookdevAgent 注入 4 步定妆顺序与通用推演铁律', () => {
    const agent = new LookdevAgent({ projectId: 'test_p1' });
    const mockTask: any = {
      toolName: 'film.entity_spec',
      input: {
        projectId: 'test_p1',
        targetKind: 'character',
        targetId: 'char_linxiu',
        name: '林修',
      },
    };

    const prompt = agent.getPostTaskPrompt(mockTask, '单实体视觉规格推演');
    assert.match(prompt, /林修/);
    assert.match(prompt, /视觉资产定妆/);
    assert.match(prompt, /修改作用域精确内聚/);
    assert.match(prompt, /人类意愿第一位准则/);
    assert.match(prompt, /严禁阶段之外的伪提议/);
    assert.match(prompt, /终态自知/);
  });

  it('3. PlannerAgent 注入策划两步顺序与通用推演铁律', () => {
    const agent = new PlannerAgent({ projectId: 'test_p1' });
    const mockTask: any = {
      toolName: 'planner.screenplay_writer',
      input: {
        projectId: 'test_p1',
      },
    };

    const prompt = agent.getPostTaskPrompt(mockTask, '全景剧本推演');
    assert.match(prompt, /全景剧本推演/);
    assert.match(prompt, /全剧分幕拓扑拆解/);
    assert.match(prompt, /修改作用域精确内聚/);
    assert.match(prompt, /人类意愿第一位准则/);
    assert.match(prompt, /严禁阶段之外的伪提议/);
  });

  it('4. DirectorIntentResolver 刚性防伪门禁：彻底净化“复盘/自愈”伪标题', () => {
    const specs = storyboardCapabilities('c1');
    const resolved = DirectorIntentResolver.resolve({
      args: {
        action: 'propose',
        tool: 'film.shot_keyframe',
        title: '镜02已完成 · 复盘与自愈提案',
        params: {
          shotId: 'c1-02',
          frame: 'first',
        },
      },
      projectId: 'test_p1',
      specs,
      clipId: 'c1',
    });

    assert.ok(resolved);
    assert.strictEqual(resolved.action, 'propose');
    assert.strictEqual(resolved.title, '镜02 · 首帧关键帧渲染');
    assert.doesNotMatch(resolved.title, /复盘/);
    assert.doesNotMatch(resolved.title, /自愈/);
  });

  it('5. AgentRunner 意图漏斗与 P0 压轴置底验证', () => {
    const funnel = AgentRunner.renderFunnelPromptMatrix();
    assert.match(funnel, /最高优先级 P0 · 待审提案裁决/);
    assert.match(funnel, /修改作用域精确内聚公理/);
    assert.match(funnel, /全局单阶段推进与人类意志第一位准则/);
    assert.match(funnel, /严禁阶段之外的伪提议/);
    assert.match(funnel, /工序自治、权能边界与终态自知公理/);
  });
});
