/**
 * tests/mastra/CriticReportContract.test.ts
 * 审查报告「单一真相」契约回归套件
 *
 * 锁住的口径（都是过去真实能出错的点）：
 *   1. 阶段报告 FAIL + 总报告 PASS → 仍判 FAIL，绝不被别阶段的结论串用；
 *   2. 阶段报告缺失，只有总报告 → UNKNOWN，绝不借来当当前阶段门禁；
 *   3. 报告字段损坏 / 只有无写入方的死别名 → null，绝不伪装成 WARN；
 *   4. criticReports（camelCase）也必须被排除在任务产物清单之外；
 *   5. 审查 step 拿不到被审查阶段时明确失败，绝不猜 'storyboard' 写错 key。
 *
 * 纯读 + 纯内存，不调 LLM、不触发渲染、不花一分钱。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { MemoryProjectStateStore } from '../../src/project-store/MemoryProjectStateStore.js';
import {
  readStageCriticReport,
  readStageGate,
  isCriticReportKey,
  stageCriticReportKey,
  CRITIC_ARCHIVE_KEY,
} from '../../src/project-store/critic-report.js';
import { ContextAssembler } from '../../src/project-store/index.js';
import { WorkflowStage } from '../../src/types/index.js';
import { Workflow } from '../../src/workflow-engine/index.js';
import { executeCriticReview } from '../../src/agents/director/generator/steps/critic-review/critic-review.step.js';

const PID = 'test_critic_report_contract';
const STAGE = WorkflowStage.NARRATIVE_DESIGN;

function makeReport(gateStatus: string, extra: Record<string, any> = {}) {
  return {
    projectName: '契约测试',
    stageReviewed: STAGE,
    gateStatus,
    scores: { overallScore: 51 },
    criticalFlaws: [
      { severity: 'CRITICAL', dimension: 'LOGIC', location: '第2幕', description: '因果断裂' },
    ],
    polishSuggestions: ['补强动机'],
    verdict: '刚性阻断',
    ...extra,
  };
}

/** 每个用例用独立内存库，并在 finally 还原全局单例 */
async function withMem<T>(fn: (mem: MemoryProjectStateStore) => Promise<T> | T): Promise<T> {
  const original = ProjectStore.getInstance();
  const mem = new MemoryProjectStateStore();
  ProjectStore.setInstance(mem);
  mem.saveProject({ projectId: PID, currentStage: STAGE } as any);
  try {
    return await fn(mem);
  } finally {
    ProjectStore.setInstance(original);
  }
}

describe('审查报告：阶段报告是唯一门禁真相', () => {
  it('阶段 FAIL + 总报告 PASS → 仍判 FAIL（旧实现会被 PASS 串用而放行）', async () => {
    await withMem((mem) => {
      mem.setArtifact(PID, stageCriticReportKey(STAGE), makeReport('FAIL'));
      mem.setArtifact(PID, CRITIC_ARCHIVE_KEY, makeReport('PASS'));

      assert.equal(readStageGate(PID, STAGE), 'FAIL');
      const prompt = ContextAssembler.getInstance().buildSystemInstructions(PID, 'sess_contract');
      assert.ok(prompt.includes('最新质检门禁: [FAIL]'), '态势黑板也必须看到 FAIL');
    });
  });

  it('只有总报告 PASS、阶段报告缺失 → UNKNOWN，绝不借别阶段结论', async () => {
    await withMem((mem) => {
      mem.setArtifact(PID, CRITIC_ARCHIVE_KEY, makeReport('PASS'));

      assert.equal(readStageCriticReport(PID, STAGE), null);
      assert.equal(readStageGate(PID, STAGE), 'UNKNOWN');
      const prompt = ContextAssembler.getInstance().buildSystemInstructions(PID, 'sess_contract');
      assert.ok(prompt.includes('暂无审查记录'));
      assert.ok(!prompt.includes('[PASS]'), '绝不把总报告当成当前阶段已通过');
    });
  });

  it('旧 key critic_review 不被识别（全仓从无写入方）', async () => {
    await withMem((mem) => {
      mem.setArtifact(PID, 'critic_review', makeReport('FAIL'));
      assert.equal(readStageGate(PID, STAGE), 'UNKNOWN');
    });
  });

  it('gateStatus 缺失或非法 → null 并告警，绝不伪装成 WARN', async () => {
    await withMem((mem) => {
      mem.setArtifact(PID, stageCriticReportKey(STAGE), { ...makeReport('PASS'), gateStatus: 'PASSED' });
      assert.equal(readStageCriticReport(PID, STAGE), null);
      assert.equal(readStageGate(PID, STAGE), 'UNKNOWN');

      const prompt = ContextAssembler.getInstance().buildSystemInstructions(PID, 'sess_contract');
      assert.ok(!prompt.includes('[WARN]'), '损坏报告不能被当成告警通过');

      mem.setArtifact(PID, stageCriticReportKey(STAGE), { gateDecision: 'FAIL' });
      assert.equal(readStageCriticReport(PID, STAGE), null);
    });
  });

  it('死别名不参与判定：gateDecision / 顶层 overallScore / suggestions / blockingIssues', async () => {
    await withMem((mem) => {
      mem.setArtifact(PID, stageCriticReportKey(STAGE), {
        gateDecision: 'FAIL',
        overallScore: 99,
        blockingIssues: ['阻断项'],
        suggestions: ['建议'],
      });
      assert.equal(readStageCriticReport(PID, STAGE), null, '只有别名、无合法 gateStatus 时应视为无报告');

      mem.setArtifact(PID, stageCriticReportKey(STAGE), {
        gateStatus: 'PASS',
        overallScore: 99,
        suggestions: ['别名建议'],
      });
      const report = readStageCriticReport(PID, STAGE)!;
      assert.equal(report.overallScore, undefined, '顶层 overallScore 不是契约字段');
      assert.deepEqual(report.polishSuggestions, [], 'suggestions 不是契约字段');
    });
  });

  it('合法报告按 schema 字段投影，不误伤既有缺陷/建议文本', async () => {
    await withMem((mem) => {
      mem.setArtifact(PID, stageCriticReportKey(STAGE), makeReport('FAIL'));
      const report = readStageCriticReport(PID, STAGE)!;
      assert.equal(report.gateStatus, 'FAIL');
      assert.equal(report.overallScore, 51);
      assert.equal(report.criticalFlaws.length, 1);
      assert.deepEqual(report.polishSuggestions, ['补强动机']);

      const prompt = ContextAssembler.getInstance().buildSystemInstructions(PID, 'sess_contract');
      assert.ok(prompt.includes('综合得分: 51/100'));
      assert.ok(prompt.includes('[CRITICAL][第2幕] 因果断裂'));
      assert.ok(prompt.includes('剧本医生自愈建议: 补强动机'));
    });
  });
});

describe('审查报告：键位与产物清单', () => {
  it('isCriticReportKey 覆盖三种形态，普通产物键不受影响', () => {
    assert.equal(isCriticReportKey(stageCriticReportKey(STAGE)), true);
    assert.equal(isCriticReportKey('critic_review'), true);
    assert.equal(isCriticReportKey(CRITIC_ARCHIVE_KEY), true, 'camelCase 总报告也不能漏');
    assert.equal(isCriticReportKey(WorkflowStage.STORYBOARD), false);
    assert.equal(isCriticReportKey('narrative_design'), false);
  });

  it('criticReports 不再被计入 TaskArtifact 清单（旧前缀判断漏掉 camelCase）', async () => {
    await withMem((mem) => {
      mem.setArtifact(PID, WorkflowStage.STORYBOARD, { shots: [] });
      mem.setArtifact(PID, CRITIC_ARCHIVE_KEY, makeReport('PASS'));
      mem.setArtifact(PID, stageCriticReportKey(STAGE), makeReport('FAIL'));

      const engine = Workflow.getInstance() as any;
      const list = engine.collectTaskArtifacts(
        PID,
        { stages: [] } as any,
        new Set<string>(),
        {}
      ) as Array<{ stage: string }>;

      const stages = list.map((a) => a.stage);
      assert.ok(stages.includes(WorkflowStage.STORYBOARD), '正常产物应被计入');
      assert.ok(!stages.includes(CRITIC_ARCHIVE_KEY), '总报告不得混入产物清单');
      assert.ok(!stages.includes(stageCriticReportKey(STAGE)), '阶段报告不得混入产物清单');
    });
  });
});

describe('审查报告：写入侧不再猜默认阶段', () => {
  it('拿不到被审查阶段时明确抛错，绝不默认 storyboard 写错 key', async () => {
    await withMem(async () => {
      await assert.rejects(
        () => executeCriticReview({ projectId: 'proj_without_stage_ctx' } as any),
        /无法确定被审查阶段/
      );
    });
  });
});
