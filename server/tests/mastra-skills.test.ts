import assert from 'node:assert/strict';
import {
  createSkill,
  formatSkillActivation,
  createSkillTools,
  loadBuiltinMastraSkills,
} from '../src/skills/index.js';
import { StoryboardAgent } from '../src/agents/storyboard/agent.js';

async function runMastraSkillsTest() {
  console.log('🧪 开始测试 Mastra 原生技能架构规范...');

  // 1. 测试 createSkill
  const testSkill = createSkill({
    name: 'test-cinematic-skill',
    description: '电影视听测试技能',
    instructions: '# 测试正文\n- 规则一\n- 规则二',
  });
  assert.equal(testSkill.name, 'test-cinematic-skill');
  assert.equal(testSkill.description, '电影视听测试技能');
  console.log('  ✅ createSkill 验证通过');

  // 2. 测试 formatSkillActivation
  const activation = formatSkillActivation(testSkill);
  assert.ok(activation.includes('# Skill: test-cinematic-skill'));
  assert.ok(activation.includes('## Instructions'));
  assert.ok(activation.includes('- 规则一'));
  console.log('  ✅ formatSkillActivation 验证通过');

  // 3. 测试 loadBuiltinMastraSkills
  const builtinSkills = loadBuiltinMastraSkills();
  assert.ok(builtinSkills.has('cinematic-storyboarding'), '必须包含 cinematic-storyboarding');
  assert.ok(builtinSkills.has('camera-movement'), '必须包含 camera-movement');
  assert.ok(builtinSkills.has('cinematic-lighting-and-color'), '必须包含 cinematic-lighting-and-color');
  assert.ok(builtinSkills.has('blocking-and-acting-direction'), '必须包含 blocking-and-acting-direction');
  assert.ok(builtinSkills.has('cinematic-sound-design'), '必须包含 cinematic-sound-design');
  assert.ok(builtinSkills.has('seamless-video-looping'), '必须包含 seamless-video-looping');
  assert.ok(builtinSkills.has('ai-interactive-screenplay'), '必须包含 ai-interactive-screenplay');
  console.log(`  ✅ loadBuiltinMastraSkills 成功加载 ${builtinSkills.size} 个工业级技能`);

  // 4. 测试 createSkillTools (skill / skill_search / skill_read)
  const skillTools = createSkillTools(builtinSkills);
  assert.ok(skillTools.skill, '包含 skill 原生工具');
  assert.ok(skillTools.skill_search, '包含 skill_search 原生工具');
  assert.ok(skillTools.skill_read, '包含 skill_read 原生工具');

  // 执行 skill_search 检索剧本技能
  const scriptSearchResult = await skillTools.skill_search.execute({
    context: { query: 'interactive' },
  });
  assert.ok(scriptSearchResult.includes('ai-interactive-screenplay'), '搜索结果必须命中剧本创作技能');
  console.log('  ✅ skill_search 检索剧本创作技能成功');

  // 执行 skill (激活剧本技能并校验大一统内容)
  const scriptSkillContent = await skillTools.skill.execute({
    context: { name: 'ai-interactive-screenplay' },
  });
  assert.ok(scriptSkillContent.includes('抉择即命运'), '剧本技能必须包含无合流互动抉择即命运');
  assert.ok(scriptSkillContent.includes('Show, Don\'t Tell'), '剧本技能必须包含物理可观测动作转化');
  assert.ok(scriptSkillContent.includes('分支切入的“动能与时空无缝承接”'), '剧本技能必须包含AI视频分支切入动能承接');
  console.log('  ✅ skill 原生工具执行成功，动态载入大一统 AI 互动抉择剧本规范');

  // 执行 skill_search
  const searchResult = await skillTools.skill_search.execute({
    context: { query: 'lighting' },
  });
  assert.ok(searchResult.includes('cinematic-lighting-and-color'), '搜索结果必须命中照明技能');
  console.log('  ✅ skill_search 原生工具执行成功');

  // 执行 skill (激活指定技能)
  const loadedSkillContent = await skillTools.skill.execute({
    context: { name: 'cinematic-storyboarding' },
  });
  assert.ok(loadedSkillContent.includes('景别'), '分镜技能激活内容必须包含景别规范');
  assert.ok(loadedSkillContent.includes('180'), '分镜技能激活内容必须包含180度轴线');
  console.log('  ✅ skill 原生工具执行成功，动态载入工业级分镜规范');

  // 执行 skill (激活待机微循环技能)
  const loopSkillContent = await skillTools.skill.execute({
    context: { name: 'seamless-video-looping' },
  });
  assert.ok(loopSkillContent.includes('待机微循环'), '待机循环技能必须包含待机微循环规约');
  assert.ok(loopSkillContent.includes('动接动'), '待机循环技能必须包含动接动切出规范');
  console.log('  ✅ skill 原生工具执行成功，动态载入待机微循环与无缝转场规约');

  // 执行 skill_read (按行切片)
  const sliceContent = await skillTools.skill_read.execute({
    context: { skillName: 'cinematic-storyboarding', startLine: 1, endLine: 5 },
  });
  assert.ok(sliceContent.length > 0, '切片内容不为空');
  console.log('  ✅ skill_read 原生工具切片读取成功');

  // 5. 测试 StoryboardAgent 原生集成
  // 创建虚拟项目测试 StoryboardAgent 的 buildDefaultTools
  const agent = new StoryboardAgent({
    projectId: 'test_p_skills',
    clipId: 'c1',
  });
  const tools = (agent as any).buildDefaultTools();
  assert.ok(tools, 'Agent 工具集存在');
  assert.ok(tools.emit_director_intent, '包含 emit_director_intent');
  assert.ok(tools.skill, '包含 Mastra 原生 skill 工具');
  assert.ok(tools.skill_search, '包含 Mastra 原生 skill_search 工具');
  assert.ok(tools.skill_read, '包含 Mastra 原生 skill_read 工具');
  console.log('  ✅ StoryboardAgent 成功原生挂载 Mastra 官方技能工具集 (Tool-First)');

  console.log('\n🎉 Mastra 原生技能架构全套测试 100% 验证通过！');
}

runMastraSkillsTest().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
