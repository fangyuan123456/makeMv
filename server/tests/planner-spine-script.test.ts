/**
 * tests/planner-spine-script.test.ts
 * Planner 子工作流 Step 1: 黄金主干剧本工序 (spine-script) 自动化单元测试
 *
 * 核心验证：
 * 1. 彻底纯净化：零 projectId 基础设施污染，纯认知函数调用；
 * 2. 纯连贯故事：100% 杜绝人工生硬标记“场景一、场景二”。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { LLMProvider } from '../src/llm/provider.js';
import { MockLanguageModel } from '../src/llm/mock-model.js';
import {
  executeWriteSpineScriptStep,
} from '../src/agents/planner/steps/spine-script/step.js';
import { executePlannerSpineScript } from '../src/agents/planner/planner.workflow.js';

test('Planner 子工作流: 黄金主干剧本工序 (spine-script)', async (t) => {
  // 挂载 Mock 模型确保测试 100% 离线确定性执行
  const mockModel = new MockLanguageModel();
  LLMProvider.setMockModel(mockModel);

  t.after(() => {
    LLMProvider.setMockModel(null as any);
  });

  await t.test('1. 纯认知推演（零 projectId 基础设施污染）', async () => {
    // 纯纯的函数调用：只给创意需求
    const output = await executeWriteSpineScriptStep({
      userPrompt: '赛博谍战逃生：代号夜雀的双面特工在暴雨走廊遭遇肃清主管维克托搜身盘问，必须保全公文包夹层里的绝密名单',
    });

    // 1.1 校验返回结构：纯粹的标题与主干剧本
    assert.ok(output.title && output.title.length > 0, '短剧标题不得为空');
    assert.ok(output.spineScript && output.spineScript.length > 50, '黄金主干剧本内容不得为空');

    // 1.2 校验绝不人为分场（无“场景一”、“Scene 1”等字样）
    assert.ok(!output.spineScript.includes('场景一'), '主干剧本绝不应人为出现“场景一”');
    assert.ok(!output.spineScript.includes('场景二'), '主干剧本绝不应人为出现“场景二”');
    assert.ok(!output.spineScript.includes('Scene 1'), '主干剧本绝不应人为出现“Scene 1”');
  });

  await t.test('2. 验证 executePlannerSpineScript 便捷门面调用', async () => {
    const output = await executePlannerSpineScript({
      userPrompt: '家庭伦理悬疑：女儿回到老宅照顾患阿尔茨海默症的母亲，在雨夜阁楼翻出烧焦的音乐盒',
    });

    assert.ok(output.title, '标题不得为空');
    assert.ok(output.spineScript && output.spineScript.length > 50, '剧本内容不得为空');
    assert.ok(!output.spineScript.includes('场景一'), '不得包含人工生硬场景标记');
  });
});
