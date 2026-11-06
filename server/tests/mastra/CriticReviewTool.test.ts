/**
 * mastra/CriticReviewTool.test.ts
 * 独立影视审查官与剧本医生挑刺技能测试套件
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { executeCriticReview, criticReviewStep, evaluateCriticAudit } from '../../src/agents/director/generator/steps/critic-review/index.js';
import { WorkflowStage, SessionStatus } from '../../src/types/index.js';
import { LLMRegistry } from '../../src/llm/LLMRegistry.js';
import { MockLLMService } from '../../src/llm/MockLLMService.js';

describe('CriticReviewStep - 影视独立审查官质检工序测试套件', () => {
  const testProjectId = 'test_critic_review_proj';
  const testProjectDir = path.resolve(process.cwd(), 'data', 'projects', testProjectId);

  beforeEach(() => {
    LLMRegistry.set(new MockLLMService());
    const store = ProjectStore.getInstance();
    const now = new Date().toISOString();
    store.saveProject({
      projectId: testProjectId,
      title: '测试赛博朋克科幻互动剧',
      status: SessionStatus.IDLE,
      currentStage: WorkflowStage.NARRATIVE_DESIGN,
      stageArtifacts: {},
      history: [],
      meta: {
        idea: '探索记忆碎片',
        style: '赛博朋克霓虹',
        videoRatio: '16:9',
        videoResolution: '720P',
      },
      createdAt: now,
      updatedAt: now,
    });

    // 预置故事圣经
    store.setArtifact(testProjectId, WorkflowStage.NARRATIVE_DESIGN, {
      title: '测试赛博朋克科幻互动剧',
      logline: '主角在霓虹都市中追查记忆芯片真相',
      characters: [
        { name: '李默', role: 'PROTAGONIST', motivation: '找回丢失记忆' },
      ],
      goldenSpine: [
        { act: 1, name: '觉醒', summary: '主角在诊所醒来', cliffhanger: '发现芯片' },
      ],
      storyGraph: {
        rootNodeId: 'node_1',
        endingsCount: 2,
        nodes: [{ id: 'node_1', title: '序幕' }],
      },
    });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testProjectDir)) {
        fs.rmSync(testProjectDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('1. 应成功执行跨工序审计并产出规范评分与门禁 (PASS/WARN/FAIL)', async () => {
    const res = await executeCriticReview({
      projectId: testProjectId,
      activeStage: 'narrative_design',
      feedback: '重点检查主角动机是否可信',
    });

    assert.ok(res.toolResult);
    assert.ok(res.toolResult.scores);
    assert.ok(['PASS', 'WARN', 'FAIL'].includes(res.toolResult.gateStatus));
    assert.ok(typeof res.toolResult.scores.overallScore === 'number');
    assert.ok(Array.isArray(res.toolResult.criticalFlaws));
    assert.ok(res.lastSummary?.includes('质检') || res.lastSummary?.includes('终审门禁'));

    // 验证状态黑板落盘 SSOT
    const store = ProjectStore.getInstance();
    const saved = store.getArtifact(testProjectId, 'criticReports');
    assert.ok(saved);
  });

  it('2. 门禁评估算法能够正确基于评分与致命缺陷判定 PASS/WARN/FAIL', () => {
    const passResult = evaluateCriticAudit({
      rawReport: {
        scores: { narrativeLogicScore: 90, characterDepthScore: 85, branchTensionScore: 88, visualFeasibilityScore: 82 },
        criticalFlaws: [],
      },
      projectName: '优质剧本',
      activeStage: 'storyboard',
    });
    assert.equal(passResult.finalReport.gateStatus, 'PASS');

    const failResult = evaluateCriticAudit({
      rawReport: {
        scores: { narrativeLogicScore: 90, characterDepthScore: 85, branchTensionScore: 88, visualFeasibilityScore: 82 },
        criticalFlaws: [{ severity: 'CRITICAL', dimension: 'LOGIC', location: '第2幕', description: '机械降神', suggestion: '铺垫伏笔' }],
      },
      projectName: '硬伤剧本',
      activeStage: 'storyboard',
    });
    assert.equal(failResult.finalReport.gateStatus, 'FAIL');
  });
});
