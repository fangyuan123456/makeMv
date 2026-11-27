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
import { PremiseOutputSchema } from '../src/tools/planner/screenplay-tool/steps/01-premise/schema.js';
import { buildFullScriptPrompt } from '../src/tools/planner/screenplay-tool/steps/02-screenplay/prompt.js';

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
        interaction: {
          kind: 'SEARCH' as const,
          isBranching: false,
          prompt: '在冷冻舱控制台周围找出【应急门禁卡】',
          timeoutSec: 12,
          config: {
            targets: [{ name: '应急门禁卡', stateTag: '+keycard', feedback: '找到了门禁卡！' }],
            decoys: [{ name: '碎裂的护目镜', feedback: '只是旧护目镜，不是门禁卡。' }],
          },
          outcomes: [
            {
              key: 'FOUND',
              label: '找到应急门禁卡并强行破门',
              targetNodeId: 'c2',
              stateTag: '+keycard',
              feedback: '门禁卡刷开气闸！',
            },
          ],
        },
      },
      {
        id: 'c2',
        title: '中央反应堆',
        narrativeText: '核心反应堆即将超载，必须做出最终决断。',
        interaction: {
          kind: 'TIMED_CHOICE' as const,
          isBranching: true,
          prompt: '反应堆 6 秒后过载，立即决断！',
          timeoutSec: 6,
          outcomes: [
            {
              key: 'A',
              label: '切断主供能并手动锁定',
              targetEndingId: 'e_he_1',
            },
            {
              key: 'TIMEOUT',
              label: '犹豫超时，反应堆引爆',
              targetEndingId: 'e_be_1',
            },
          ],
        },
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

// 4. 验证剧本分支点上限与“抉择即命运 / 彻底废除合流”契约
async function testTwoBranchPointsAndNoMergeContract() {
  console.log('--- 测试 4: 验证全剧最多 2 个分支点及彻底废除合流契约 ---');

  const validPremise = {
    title: '迷雾深潜',
    genre: '科幻惊悚',
    logline: '深海科考站遭遇不明外星生物侵袭，幸存者必须在系统崩溃前完成撤离。',
    worldSetting: '位于太平洋万米海沟的“普罗米修斯”科考基地，因违规采集深渊地壳样本引发高维能量震荡，唤醒了沉睡的硅基寄生异兽。基地电力系统已瘫痪 70%，水压屏障仅能支撑 30 分钟。',
    characters: [
      {
        name: '陆渊',
        role: '首席轮机工程师',
        motivation: '保护深海核心样本并带领团队撤离',
        appearance: '身穿亮黄色加固潜水服，眉角有擦伤',
      },
    ],
    actOutlines: [
      {
        actNumber: 1,
        title: '警报初鸣',
        coreConflict: '供氧仓破损与异兽逼近',
        plotSummary: '陆渊从破损的加压舱中苏醒，发现全站警报红光闪烁。他艰难救出昏迷的助手，却遭遇异兽撞击中控水闸。在氧气仅剩 15% 的绝境下，陆渊必须选择是冒险引爆加压水闸还是黑入通风管道迂回逃生。',
        scenes: [
          '重症加压休眠区：警报轰鸣中陆渊艰难破舱，海水倒灌浸没脚踝',
          '中继回廊：遭遇破损高压蒸汽管线与异兽爬行留下的腐蚀黏液',
        ],
        turningPoint: '中控水闸发出刺耳的金属断裂声，异兽即将彻底破门而入',
        suspense: '选择强行加压引爆还是穿过危险通风井黑客破解',
      },
      {
        actNumber: 2,
        title: '深渊决策',
        coreConflict: '逃生舱电力不足只能承载一人或超频发射',
        plotSummary: '两人成功汇合于主逃生舱前，但推进反应堆发生超载告警，电力无法支持两人满负荷脱离。陆渊面对生死抉择，必须决定是留守手动排气保全同伴，还是冒险双人强行超频。',
        scenes: [
          '主逃生舱停泊港：深渊黑暗中，逃生舱启动器指示灯急促闪烁',
        ],
        turningPoint: '逃生舱倒计时启动，反应堆过载警报响彻海沟',
        suspense: '牺牲自我还是赌命双人超频发射',
      },
    ],
    interactions: [
      {
        pointIndex: 1,
        actNumber: 1,
        isBranching: true,
        kind: 'TIMED_CHOICE' as const,
        prompt: '中控水闸即将被异形生物撞破，立即决断！',
        timeoutSec: 6,
        sceneContext: '中控水闸即将被异形生物撞破',
        outcomes: [
          {
            key: 'A',
            label: '引爆加压水闸强行阻隔',
            targetType: 'CONTINUE_MAINLINE' as const,
            approachAndCost: '消耗了高压气瓶，造成轻微震伤，但成功炸退异兽，主线由此推进至第 2 幕',
            stateTag: '+sealed_gate',
          },
          {
            key: 'B',
            label: '犹豫观望试图寻找应急维修手册',
            targetType: 'ENDING' as const,
            approachAndCost: '错失水闸闭合窗口，异兽破门而入，加压舱瞬间失压',
            endingTitle: '窒息深渊',
            endingType: 'BE' as const,
          },
        ],
      },
      {
        pointIndex: 2,
        actNumber: 2,
        isBranching: true,
        kind: 'CHOICE' as const,
        prompt: '手动留守过载舱门让逃生舱安全脱离，还是强行双人共乘赌反应堆不爆炸？',
        timeoutSec: null,
        sceneContext: '主逃生舱前，能源核心超载倒计时 60 秒',
        outcomes: [
          {
            key: 'A',
            label: '留守锁定舱门',
            targetType: 'ENDING' as const,
            approachAndCost: '牺牲自己，将样本与希望托付队友',
            endingTitle: '孤胆牺牲',
            endingType: 'TE' as const,
          },
          {
            key: 'B',
            label: '双人强行共乘启动超频',
            targetType: 'ENDING' as const,
            approachAndCost: '在生死一线间拼尽全力稳定推进器，成功冲出海面',
            endingTitle: '破浪生还',
            endingType: 'HE' as const,
          },
        ],
      },
    ],
  };

  // 1. 合法契约校验
  const parseResult = PremiseOutputSchema.safeParse(validPremise);
  assert.strictEqual(parseResult.success, true, '合法 2 分支点数据应成功通过校验');
  assert.strictEqual(parseResult.data?.interactions[0].outcomes[0].targetType, 'CONTINUE_MAINLINE');
  assert.strictEqual(parseResult.data?.interactions[0].outcomes[1].targetType, 'ENDING');

  // 2. 单线互动不占分支名额；超过两个 isBranching=true 节点不符合契约
  const singleBranchPremise = {
    ...validPremise,
    interactions: [
      {
        ...validPremise.interactions[0],
        isBranching: false,
        kind: 'HOLD' as const,
        outcomes: [validPremise.interactions[0].outcomes[0]],
      },
      validPremise.interactions[1],
    ],
  };
  const singleResult = PremiseOutputSchema.safeParse(singleBranchPremise);
  assert.strictEqual(singleResult.success, true, '单线互动 + 1 个分支点应合法');
  assert.strictEqual(
    PremiseOutputSchema.safeParse({
      ...validPremise,
      interactions: [
        ...validPremise.interactions,
        { ...validPremise.interactions[0], pointIndex: 3 },
      ],
    }).success,
    false,
    '命运分支节点 (isBranching=true) 全剧不得超过两个'
  );
  const singlePrompt = buildFullScriptPrompt({ premise: singleResult.data! });
  assert.ok(singlePrompt.includes('命运分支 1 个，单线沉浸 1 个'), '扩写应准确注入单线与分支实际数量');

  // 3. 验证 buildFullScriptPrompt 正确注入 2 个互动节点及去向
  const prompt = buildFullScriptPrompt({
    premise: parseResult.data!,
    userPrompt: '深海生存故事',
  });

  assert.ok(prompt.includes('【互动节点 1】'), '提示词中必须明确注入互动节点 1');
  assert.ok(prompt.includes('【互动节点 2】'), '提示词中必须明确注入互动节点 2');
  assert.ok(prompt.includes('推进主线剧情进入下一幕'), '提示词中必须包含推进主线走向');
  assert.ok(prompt.includes('走向专有终局【窒息深渊】(BE)'), '提示词中必须包含走向专有终局');
  assert.ok(prompt.includes('普罗米修斯'), '提示词中必须包含世界观既定真相');
  assert.ok(prompt.includes('剧情展开脉络'), '提示词中必须包含详实分幕大纲剧情脉络');
  assert.ok(prompt.includes('场景流转'), '提示词中必须包含场景流转序列');

  console.log('✅ 测试 4 通过: 分支点最多两个，扩写使用实际数量并彻底废除合流！\n');
}

// 执行所有测试
async function runAllTests() {
  await testBaseTaskToolCallbacks();
  await testToolComposition();
  await testSynthesizePrdStep();
  await testTwoBranchPointsAndNoMergeContract();
  console.log('🎉 所有测试全部通过！双阶段回调任务工具架构 (BaseTaskTool) 验证完毕。');
}

runAllTests().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
