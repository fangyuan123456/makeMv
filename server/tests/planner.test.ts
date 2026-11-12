/**
 * tests/planner.test.ts
 * 【已停用，待按新 Planner Workflow 重写】
 *
 * 本文件断言基于已废弃的单体 Planner 契约：
 *  - writeTextGameWithAgent（已删除）
 *  - characters >= 2 / 旧 PRD 章节标题 / flowchartNodes 悬空边检测
 *    （现行 convertPlannerOutputToGdd 恒 1 角色、markdown 改用 formatGddPrdToMarkdown、
 *     validateGdd 已改为基于 beatOutline 的拓扑校验，不再读 flowchartNodes）
 * 因此已从 npm test 链中摘除，避免红灯挡住后续 6 个测试。
 * 新链路覆盖见 universal-planner.test.ts / universal-gating-runtime.test.ts。
 * 注：阶段二（分幕切片 → TextGameArtifact）的接缝由 smoke.test.ts / api.test.ts 覆盖。
 */

import assert from 'assert';
import { LLMProvider, MockLanguageModel } from '../src/llm/index.js';
import {
  planGDDWithAgent,
  createPlannerAgent,
} from '../src/agents/planner/planner.agent.js';
import {
  GDDSchema,
  validateGdd,
  renderGddMarkdown,
  type GDDArtifact,
} from '../src/agents/planner/index.js';
import { buildPlannerUserPrompt } from '../src/workflows/steps/plan-gdd.prompt.js';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
// 注：阶段二（分幕切片 → TextGameArtifact）的接缝由 smoke.test.ts / api.test.ts 覆盖，
// 此处不再引用已废弃的 writeTextGameWithAgent。

async function runPlannerTests() {
  console.log('🧪 开始执行策划 Agent (Planner) 专项测试...\n');

  // 0. 挂载离线 Mock 驱动
  LLMProvider.setMockModel(new MockLanguageModel());
  const agent = createPlannerAgent();

  // 1. 测试构建包含对话上下文的 Prompt (buildPlannerUserPrompt)
  console.log('1. 测试对话上下文提炼与 Prompt 构建器...');
  const promptFromContext = buildPlannerUserPrompt({
    chatHistory: [
      { role: 'user', content: '我想做个锦衣卫查案的故事，主角叫陆寻，性格沉默寡言' },
      { role: 'assistant', content: '收到！建议切入点是雨夜诏狱失火案，涉及东厂督公的密信' },
      { role: 'user', content: '好，就定在雨夜诏狱，要有时间限制' },
    ],
    userPrompt: '确认生成完整策划案',
  });

  assert.ok(promptFromContext.includes('陆寻'), 'Prompt 必须包含对话中确认的主角名');
  assert.ok(promptFromContext.includes('雨夜诏狱'), 'Prompt 必须包含对话中确认的地点');
  assert.ok(promptFromContext.includes('读题先行'), 'Prompt 必须包含读题先行（题材自适应）指示');
  console.log('  ✅ 对话上下文格式化与事实锚定提炼测试通过\n');

  // 2. 测试 planGDDWithAgent 推演并自动生成工业级 PRD Markdown
  console.log('2. 测试 Planner Agent 结构化推演与 PRD 自动组装...');
  const testProjectId = `proj_planner_test_${Date.now()}`;
  const store = ProjectStore.getInstance();

  // 预置项目历史对话
  store.appendChatMessage(testProjectId, 'user', '做一个潜伏在敌营的特工题材');
  store.appendChatMessage(testProjectId, 'assistant', '建议以测谎审讯室作为开局');

  const gdd = await planGDDWithAgent({
    userPrompt: '开始生成最终策划案',
    projectId: testProjectId,
  }, agent);

  assert.ok(gdd.title, 'GDD 必须包含标题');
  assert.ok(gdd.hook, 'GDD 必须包含一句话高概念 hook');
  assert.ok(gdd.playerRole, 'GDD 必须包含玩家定位与生死目标');
  assert.ok(gdd.globalStateMachine?.variables, 'GDD 必须包含数值变量');
  assert.ok(gdd.characters.length >= 2, 'GDD 必须包含至少 2 名核心角色');
  assert.ok(gdd.flowchartNodes.length >= 3, 'GDD 必须包含至少 3 个流程树节点');
  assert.ok(gdd.markdown && gdd.markdown.length > 100, 'GDD 必须自动渲染出丰富详实的 Markdown PRD');
  assert.ok(gdd.markdown.includes('## 一、 核心概念与第一人称体验设计'), 'PRD 必须包含体验设计大纲');
  assert.ok(gdd.markdown.includes('## 二、 全局状态机'), 'PRD 必须包含状态机表格');
  assert.ok(gdd.markdown.includes('## 三、 登场核心角色'), 'PRD 必须包含角色通告');
  assert.ok(gdd.markdown.includes('## 四、 关卡流程'), 'PRD 必须包含流程树详案');

  console.log(`  ✅ 策划案《${gdd.title}》推演并组装成功 (Markdown 字数: ${gdd.markdown.length})\n`);

  // 3. 测试 validateGdd 拓扑一致性校验器
  console.log('3. 测试 validateGdd 拓扑一致性刚性校验...');
  const validCheck = validateGdd(gdd);
  assert.strictEqual(validCheck.valid, true, `合法策划案校验应当通过，但报错: ${validCheck.errors.join(', ')}`);

  // 测试异常策划案拦截（悬空 nextNodeId）
  const brokenGdd: GDDArtifact = {
    ...gdd,
    flowchartNodes: [
      {
        nodeId: 'node_test_1',
        title: '测试节点1',
        summary: '摘要',
        choices: [
          {
            choiceId: 'opt_1',
            text: '选项1',
            requiredFlags: [],
            stateMutations: {},
            nextNodeId: 'node_non_existent', // 悬空目标
          },
        ],
      },
      {
        nodeId: 'node_test_2',
        title: '测试节点2',
        summary: '摘要',
        choices: [],
      },
    ],
  };

  const brokenCheck = validateGdd(brokenGdd);
  assert.strictEqual(brokenCheck.valid, false, '存在悬空跳转节点的策划案必须被拦截');
  assert.ok(
    brokenCheck.errors.some((e) => e.includes('node_non_existent')),
    '校验错误信息必须明确指出悬空的节点 ID'
  );
  console.log('  ✅ validateGdd 刚性门禁拦截与错误诊断测试通过\n');

  // 4. 测试 renderGddMarkdown 纯渲染幂等性
  console.log('4. 测试 renderGddMarkdown 工业级排版渲染器...');
  const rendered = renderGddMarkdown(gdd);
  assert.ok(rendered.startsWith(`# 《${gdd.title}》`));
  assert.ok(rendered.includes('### 1. 数值型状态变量 (Variables)'));
  assert.ok(rendered.includes('### 2. 逻辑门禁布尔旗标 (Flags)'));
  console.log('  ✅ PRD Markdown 渲染器格式规范验证通过\n');

  // 清理临时测试工程
  store.deleteProject(testProjectId);

  console.log('🎉 策划 Agent (Planner) 所有专项推演、格式渲染与全链路交付测试 100% 全部通过！');
}

runPlannerTests().catch((err) => {
  console.error('❌ Planner 测试失败:', err);
  process.exit(1);
});
