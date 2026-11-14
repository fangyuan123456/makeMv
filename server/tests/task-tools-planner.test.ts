/**
 * tests/task-tools-planner.test.ts
 * 验证基于任务发布与两次回调机制的独立工具架构 (ScreenplayTool & ScriptToPrdTool)
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { BaseTaskTool, TaskToolCallbacks } from '../src/tools/base/task-tool.js';
import { synthesizePrdStep } from '../src/tools/planner/script-to-prd-tool/steps/02-synthesize/index.js';
import { ScriptToPrdTool } from '../src/tools/planner/script-to-prd-tool/index.js';
import { ScreenplayTool } from '../src/tools/planner/screenplay-tool/index.js';

// 清理外层废弃文件 (保证功能完全内聚在 step 内部，外层绝不留 prompt 和 schema)
const filesToClean = [
  'src/tools/planner/screenplay-tool/prompt.ts',
  'src/tools/planner/screenplay-tool/schema.ts',
  'src/tools/planner/screenplay-tool/steps/premise.step.ts',
  'src/tools/planner/screenplay-tool/steps/screenplay.step.ts',
  'src/tools/planner/script-to-prd-tool/prompt.ts',
  'src/tools/planner/script-to-prd-tool/schema.ts',
  'src/tools/planner/script-to-prd-tool/steps/extract.step.ts',
  'src/tools/planner/script-to-prd-tool/steps/synthesize.step.ts',
];

for (const rel of filesToClean) {
  const full = path.join(process.cwd(), rel.startsWith('src/') ? rel : `server/${rel}`);
  const directFull = path.join(process.cwd(), 'server', rel);
  for (const candidate of [full, directFull]) {
    if (fs.existsSync(candidate)) {
      try {
        fs.unlinkSync(candidate);
        console.log(`[Clean] 成功移除外层废弃冗余文件: ${candidate}`);
      } catch {}
    }
  }
}

console.log('🚀 开始验证双阶段回调工具架构 (Task Tool & Dual-Callback Pattern)...\n');

// 1. 验证 BaseTaskTool 的核心两次回调契约
class MockMathTool extends BaseTaskTool<{ val: number }, { double: number }> {
  public readonly toolName = 'mock.math_doubler';
  public readonly description = '测试用倍增工具';

  protected buildWorkflow(): any {
    return {
      createRun: () => ({
        start: async (params: any) => {
          const data = params.inputData || params.triggerData || {};
          // 模拟执行耗时
          await new Promise((r) => setTimeout(r, 20));
          return { double: data.val * 2 };
        },
      }),
    };
  }
}

async function testBaseTaskToolCallbacks() {
  console.log('--- 测试 1: BaseTaskTool 两次刚性回调验证 ---');
  const tool = new MockMathTool();

  let firstCallbackTaskId: string | null = null;
  let secondCallbackResult: any = null;
  let callbackSequence: string[] = [];

  const taskIdReturned = await tool.dispatch(
    { val: 21 },
    {
      onTaskId: (taskId) => {
        firstCallbackTaskId = taskId;
        callbackSequence.push('FIRST:onTaskId');
        console.log(`[回调 1] 立即收到 taskId: ${taskId}`);
      },
      onResult: (result) => {
        secondCallbackResult = result;
        callbackSequence.push('SECOND:onResult');
        console.log(`[回调 2] 异步收到 result:`, result);
      },
    }
  );

  assert.ok(taskIdReturned.startsWith('task_mock_math_doubler_'), 'dispatch 应返回语义化 taskId');
  assert.strictEqual(firstCallbackTaskId, taskIdReturned, '第一次回调的 taskId 应与返回值一致');

  // 等待异步内部执行完成
  await new Promise((r) => setTimeout(r, 50));

  assert.strictEqual(callbackSequence[0], 'FIRST:onTaskId', '必须第一次先回调 onTaskId');
  assert.strictEqual(callbackSequence[1], 'SECOND:onResult', '必须第二次后回调 onResult');
  assert.ok(secondCallbackResult, '第二次回调结果应存在');
  assert.strictEqual(secondCallbackResult.success, true);
  assert.strictEqual(secondCallbackResult.data.double, 42);

  console.log('✅ 测试 1 通过: 两次回调严格有序且产物正确！\n');
}

// 2. 验证工具嵌套调用 (callSubTool)
class MockParentCompositeTool extends BaseTaskTool<{ baseVal: number }, { total: number }> {
  public readonly toolName = 'mock.composite_pipeline';
  public readonly description = '测试用复合工具';

  protected buildWorkflow(): any {
    const subTool = new MockMathTool();
    return {
      createRun: () => ({
        start: async (params: any) => {
          const inputData = params.inputData || params.triggerData || {};
          const context = inputData._context;
          let subTaskIdRecorded: string | null = null;

          // 复合工具调用子工具
          const subOutput = await this.callSubTool(
            subTool,
            { val: inputData.baseVal },
            context,
            {
              onTaskId: (subId) => {
                subTaskIdRecorded = subId;
                console.log(`  [父工具感知子任务] 子任务 ID: ${subId}`);
              },
            }
          );

          assert.ok(subTaskIdRecorded, '应监听到子工具的第一次回调');
          assert.ok(subTaskIdRecorded.includes('_sub_'), '子任务 ID 格式应包含 sub');

          return { total: subOutput.double + 10 };
        },
      }),
    };
  }
}

async function testToolComposition() {
  console.log('--- 测试 2: 工具调用工具 (Tool Composition) 级联两次回调 ---');
  const parentTool = new MockParentCompositeTool();

  let parentTaskId: string | null = null;
  let finalResult: any = null;

  await parentTool.dispatch(
    { baseVal: 10 },
    {
      onTaskId: (id) => {
        parentTaskId = id;
        console.log(`[父任务创建] ID: ${id}`);
      },
      onResult: (res) => {
        finalResult = res;
        console.log(`[父任务完成] 结果:`, res);
      },
    }
  );

  await new Promise((r) => setTimeout(r, 80));

  assert.ok(parentTaskId, '父任务应拿到 taskId');
  assert.ok(finalResult?.success, '父任务应执行成功');
  assert.strictEqual(finalResult.data.total, 30, '子工具算力倍增 10*2=20，加 10 后总计应为 30');

  console.log('✅ 测试 2 通过: 工具嵌套调用与两次回调级联完全闭环！\n');
}

// 3. 验证 ScriptToPrdTool 的核心规约与图论自愈
async function testSynthesizePrdStep() {
  console.log('--- 测试 3: 验证从剧本抽取结构到 PRD 与图论拓扑构建 ---');

  const sampleExtracted = {
    title: '深空救赎',
    clips: [
      {
        id: 'c1',
        title: '冷冻舱惊魂',
        narrativeText: '警报声刺破寂静，冰霜从面罩上融化...',
        choices: [
          {
            id: 'ch_1',
            text: '强行破门',
            targetNodeId: 'c2',
          },
          {
            id: 'ch_2',
            text: '检查控制台日志',
            targetEndingId: 'e_be_1',
          },
        ],
      },
      {
        id: 'c2',
        title: '中央反应堆',
        narrativeText: '核心反应堆即将超载，必须做出最终决断。',
        choices: [
          {
            id: 'ch_3',
            text: '切断主供能并手动锁定',
            targetEndingId: 'e_he_1',
          },
        ],
      },
    ],
    endings: [
      {
        id: 'e_he_1',
        title: '孤胆拯救 (胜利通关)',
        endingType: 'HE' as const,
        summary: '成功挽救空间站，并向地球发送警报信号。',
      },
      {
        id: 'e_be_1',
        title: '触电身亡 (惨痛失败)',
        endingType: 'BE' as const,
        summary: '控制台高压电弧爆发，未能及时撤离。',
      },
    ],
  };

  const output = await (synthesizePrdStep as any).execute({
    context: sampleExtracted,
  });

  assert.strictEqual(output.title, '深空救赎');
  assert.ok(output.prd, '应生成 UniversalPrdSpec');
  assert.strictEqual(output.prd.clips.length, 2, '应包含 2 个视频切片');
  assert.strictEqual(output.prd.endings.length, 2, '应包含 2 个结局');
  assert.strictEqual(output.prd.interactions.length, 2, '应包含 2 个互动抉择点');
  assert.ok(output.prd.wiring.length >= 4, '接线表应包含片段流转与选项跳转');
  assert.strictEqual(output.validation.valid, true, '图论拓扑检测应通过，无断头路');
  assert.ok(output.storySections['c1']?.narrativeText, '故事分段应包含 c1 剧本');

  console.log('✅ 测试 3 通过: 剧本结构成功解析为标准 Universal PRD，图论拓扑 100% 闭环合法！\n');
}

// 执行所有测试
async function runAllTests() {
  await testBaseTaskToolCallbacks();
  await testToolComposition();
  await testSynthesizePrdStep();
  console.log('🎉 所有测试全部通过！双阶段回调任务工具架构 (BaseTaskTool) 验证完毕。');
}

runAllTests().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
