/**
 * tests/planner-interaction-slicing.test.ts
 * Planner 子工作流 Step 2: 互动切口与剧幕拆分工序 (interaction-slicing) 自动化单元测试
 *
 * 核心验证：
 * 1. 彻底纯净化：零 projectId 基础设施污染，纯认知函数调用；
 * 2. 纯结构化流转：输出强类型 clips 数组，拓扑层级 level 严谨自增；
 * 3. 纯代码 Markdown 格式化：零 token 消耗，确定性拼装人类友好的 Markdown 工作台本。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { LLMProvider } from '../src/llm/provider.js';
import { MockLanguageModel } from '../src/llm/mock-model.js';
import {
  executeSliceInteractionsStep,
} from '../src/agents/planner/steps/interaction-slicing/step.js';
import { formatClipsToMarkdown } from '../src/agents/planner/steps/interaction-slicing/schema.js';
import { executePlannerSliceInteractions } from '../src/agents/planner/planner.workflow.js';

test('Planner 子工作流: 互动切口与剧幕拆分工序 (interaction-slicing)', async (t) => {
  // 挂载 Mock 模型确保测试 100% 离线确定性执行
  const mockModel = new MockLanguageModel();
  LLMProvider.setMockModel(mockModel);

  t.after(() => {
    LLMProvider.setMockModel(null as any);
  });

  await t.test('1. 纯认知结构化切分（输出强类型 clips 数组）', async () => {
    const fakeSpineScript = `凌晨三点，旧城基地的合金走廊内暴雨如注，警报红灯在积水的防弹玻璃上映出猩红冷光。
夜雀将装有潜伏者绝密名单的加密公文包贴在身侧，快步穿过排风管道区，却在转角处迎面撞上了带着两名防暴卫兵的肃清主管维克托。`;

    const output = await executeSliceInteractionsStep({
      spineScript: fakeSpineScript,
    });

    // 1.1 校验返回结构
    assert.ok(output.title && output.title.length > 0, '短剧标题不得为空');
    assert.ok(Array.isArray(output.clips) && output.clips.length >= 2, 'clips 必须是包含至少2个片段的数组');

    const firstClip = output.clips[0];
    assert.equal(firstClip.level, 1, '第一片段层级必须为 1');
    assert.ok(firstClip.narrativeText.length > 20, '片段正文不得为空');
    assert.ok(firstClip.interaction, '非终局片段必须包含单一 interaction');

    const choiceClip = output.clips.find((c) => c.interaction?.category === 'CHOICE');
    assert.ok(choiceClip && choiceClip.interaction?.category === 'CHOICE', '至少需包含 CHOICE 分支切口');
    assert.ok(choiceClip.interaction.cutId, '切口必须有唯一 cutId');
    assert.ok(choiceClip.interaction.mainlineChoice, '切口必须有主线选项');
    assert.ok(choiceClip.interaction.branchChoice, '切口必须有分支选项');

    // 1.2 校验纯代码 Markdown 格式化器
    const markdown = formatClipsToMarkdown(output.title, output.clips);
    assert.ok(markdown.includes('互动分幕导演工作台本'), '台本标题必须包含“互动分幕导演工作台本”');
    assert.ok(markdown.includes('## 片段 01'), '必须包含片段切分标记');
    assert.ok(markdown.includes('🎬【互动点 01'), '必须包含互动切口标记');
    assert.ok(markdown.includes('进入片段 02'), '必须包含主线顺延承接指示');
  });

  await t.test('2. 验证 executePlannerSliceInteractions 便捷门面调用', async () => {
    const output = await executePlannerSliceInteractions({
      spineScript: '老宅火灾真相追溯...',
    });

    assert.ok(output.title, '标题不得为空');
    assert.ok(output.clips && output.clips.length > 0, 'clips 列表不得为空');
  });
});
