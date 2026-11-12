/**
 * tests/planner-branch-derivation.test.ts
 * Planner 子工作流 Step 3: 分支剧本推演工序 (branch-derivation) 自动化单元测试
 *
 * 核心验证：
 * 1. 纯图元拓扑：输入主干 clips，通过反向拓扑优先算法调度推演；
 * 2. 数量受控与闭环：每次弹出层级 n 最大的切口，单切口 100% 聚焦；
 * 3. 终局收敛与殊途同归：严格判定直至所有切口成功闭环；
 * 4. 纯代码 Markdown 格式化：零 token 消耗，确定性拼装人类友好的 Markdown 分支台本。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { LLMProvider } from '../src/llm/provider.js';
import { MockLanguageModel } from '../src/llm/mock-model.js';
import {
  executeDeriveBranchesStep,
} from '../src/agents/planner/steps/branch-derivation/step.js';
import { formatBranchesToMarkdown } from '../src/agents/planner/steps/branch-derivation/schema.js';
import { executePlannerDeriveBranches } from '../src/agents/planner/planner.workflow.js';

test('Planner 子工作流: 分支剧本推演工序 (branch-derivation)', async (t) => {
  // 挂载 Mock 模型确保测试 100% 离线确定性执行
  const mockModel = new MockLanguageModel();
  LLMProvider.setMockModel(mockModel);

  t.after(() => {
    LLMProvider.setMockModel(null as any);
  });

  await t.test('1. 反向拓扑优先推演（输入结构化 clips，闭环输出 branches）', async () => {
    const fakeClips = [
      {
        clipId: 'clip_01',
        level: 1,
        title: '暴雨走廊',
        narrativeText: '夜雀被维克托按死公文包...',
        isEnding: false,
        interaction: {
          category: 'CHOICE' as const,
          cutId: 'cut_01',
          mainlineChoice: '递出钥匙公事公办',
          branchChoice: '反手拔枪背刺突围',
          conflictSummary: '公事公办 vs 拔枪殊死一搏',
        },
      },
      {
        clipId: 'clip_02',
        level: 2,
        title: '破晓放行（通关好结局 HE）',
        narrativeText: '维克托放行，要塞闸门升起...',
        isEnding: true,
      },
    ];

    const output = await executeDeriveBranchesStep({
      title: '深海逆光：临界博弈',
      clips: fakeClips,
    });

    // 1.1 校验返回结构
    assert.ok(output.title && output.title.length > 0, '短剧标题不得为空');
    assert.ok(Array.isArray(output.branches) && output.branches.length === 1, '必须精准推演出 1 个分支');

    const branch = output.branches[0];
    assert.equal(branch.cutId, 'cut_01', '必须与发源切口 ID 一致');
    assert.equal(branch.sourceClipId, 'clip_01', '发源片段标识必须一致');
    assert.equal(branch.resolutionType, 'ENDING', 'Mock 模型中应达成终局');
    assert.equal(branch.endingType, 'BE', '结局定性应为 BE');
    assert.ok(branch.narrativeText.length > 50, '分支文学正文不得为空');

    // 1.2 校验纯代码 Markdown 格式化器
    const markdown = formatBranchesToMarkdown(output.title, output.branches);
    assert.ok(markdown.includes('分支剧本与死局推演'), '必须包含分支剧本集大标题');
    assert.ok(markdown.includes('🔀 分支 01'), '必须包含具体分支标题');
    assert.ok(markdown.includes('【支线文学剧情正文】'), '必须包含支线文学正文');
    assert.ok(markdown.includes('【去向承接或命运结算】'), '必须包含去向承接或命运结算模块');
    assert.ok(markdown.includes('BE · 暴雨喋血'), '必须包含结局称号');
    assert.ok(markdown.includes('时光倒流'), '必须包含时光倒流锚点');
  });

  await t.test('2. 验证 executePlannerDeriveBranches 便捷门面调用', async () => {
    const output = await executePlannerDeriveBranches({
      title: '测试短剧',
      clips: [
        {
          clipId: 'c1',
          level: 1,
          title: '一幕',
          narrativeText: '正文',
          isEnding: false,
          interaction: {
            category: 'CHOICE' as const,
            cutId: 'cut_c1',
            mainlineChoice: 'A',
            branchChoice: 'B',
          },
        },
        {
          clipId: 'c2',
          level: 2,
          title: '二幕',
          narrativeText: '终局',
          isEnding: true,
        },
      ],
    });

    assert.ok(output.title, '标题不得为空');
    assert.ok(output.branches && output.branches.length === 1, '必须成功推演出分支');
  });
});
