/**
 * tests/universal-planner.test.ts
 * 互动游戏纯通用自主推衍架构专项验证测试 (Universal Planner & Polymorphic State Test)
 *
 * 验证三大极端题材：
 * 1. 温情治愈题材（零生存数值，以回忆碎片与心境驱动，独角戏/非二元角色）；
 * 2. 时空死循环科幻题材（莫比乌斯环回溯边 isLoopBack，循环拓扑闭环）；
 * 3. 纯确定性 0-Token 运行时对多态代数原语与时空循环的无缝执行。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GDDSchema,
  validateGdd,
  renderGddMarkdown,
  buildBaseUniversalPrdSpec,
  applyPrdEnhancement,
  formatGddPrdToMarkdown,
  formatStoryScenesToMarkdown,
  formatPlannerTraceMarkdown,
  validateUniversalPrdTopology,
  validatePipelineInputTopology,
  collectStoryContinuityWarnings,
  applyInteractionTagPatches,
  splitScriptByInteractTags,
  executeSliceInteractionsStep,
  parsePrdEmbeddedJson,
  extractClipIdsFromStoryMarkdown,
  runPlannerWorkflow,
  type GDDArtifact,
} from '../src/agents/planner/index.js';
import { runTopologyBranchDerivation } from '../src/agents/planner/steps/branch-derivation/topology-runner.js';
import { executePrdSynthesisStep } from '../src/agents/planner/steps/prd-synthesis/step.js';
import {
  ActionGameplayOutputSchema,
  InteractionTagPatchSchema,
} from '../src/agents/planner/steps/interaction-slicing/schema.js';
import { LLMProvider, MockLanguageModel } from '../src/llm/index.js';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { parseUniversalPrdFromMarkdown } from '../src/workflows/steps/build-text-game.step.js';
import { TextGameRuntimeEngine } from '../src/runtime/state-engine.js';
import { StoryGraphSvgRenderer } from '../src/media/index.js';
import type { TextGameArtifact } from '../src/agents/text-game/schema.js';
import {
  buildDeterministicScenesFromPlanner,
  validateScenePointers,
  convertScenesToTextGameArtifact,
  assembleStandaloneTs,
  compileTsToJs,
} from '../src/agents/text-game/index.js';
import vm from 'node:vm';

test('1. 温情治愈题材：零生存危机、以回忆碎片驱动的策划案合规性', () => {
  const healingGdd: GDDArtifact = {
    schemaVersion: '2.0.0',
    title: '海风吹拂的纸飞机',
    genre: '温情生活流 / 治愈物语',
    hook: '回到荒废海边灯塔的老人，试图在泛黄信纸上拼凑出失落的童年记忆。',
    playerRole: '72岁独居老人陈舟，在整理旧物中与过去的自己达成和解。',
    coreLoop: '整理旧物 ➔ 触发回忆 ➔ 拼凑心境碎片 ➔ 与过去和解',
    beatOutline: [
      {
        beatId: 'beat_01_attic',
        act: '第一幕·建立触点',
        title: '阁楼潮声',
        gameplayTask: '搜检阁楼旧物热点（木箱/铁盒/旧车票），自由点击检视触发回忆片段',
        dramaticGoal: '重返海边灯塔阁楼，发现童年遗留的木箱',
        keyConflicts: '陈舟老人 vs 封存旧物的执念',
        branchExpectations: [
          { intent: '撬开铁盒', targetBeatId: 'beat_02_plane' },
        ],
      },
      {
        beatId: 'beat_02_plane',
        act: '第二幕·回忆涌现',
        title: '掌心的纸飞机',
        gameplayTask: '拖拽拼合泛黄信纸碎片，组合出童谣旋律片段',
        dramaticGoal: '忆起母亲唱过的童谣，触碰少年时代的初心',
        keyConflicts: '岁月沧桑 vs 纯真梦想',
        branchExpectations: [
          { intent: '释怀轻哼', targetBeatId: 'beat_03_peace' },
        ],
      },
      {
        beatId: 'beat_03_peace',
        act: '第三幕·终局收束',
        title: '破晓之风',
        gameplayTask: '终局仪式交互：最后一次点击抉择，将纸飞机投向大海',
        dramaticGoal: '将纸飞机投向大海，达成自我和解',
        keyConflicts: '心灵释怀',
        isEnding: true,
        endingTheme: '终局：与岁月温柔和解',
      },
    ],
    globalStateMachine: {
      philosophy: '心境安宁度与回忆碎片收集，本剧绝无生命危机与怀疑度惩罚',
      variables: {
        inner_peace: { name: '心境安宁度', initial: 20, min: 0, max: 100, description: '达到80达成心结释怀' },
        nostalgia: { name: '怀旧感伤度', initial: 50, min: 0, max: 100 },
      },
      flags: {
        remembered_song: { name: '忆起母亲唱过的童谣', initial: false },
      },
      inventory: ['生锈的铁皮文具盒', '半张海边旧车票'],
    },
    characters: [
      {
        characterId: 'char_chen_elder',
        name: '陈舟 (老年)',
        role: '玩家第一视角 / 独居老人',
        appearance: '银白稀疏头发，洗得褪色的墨蓝羊毛衫，眼角有温和而落寞的褶皱。',
        personality: '沉默寡言，动作迟缓，习惯凝视潮起潮落。',
      },
      {
        characterId: 'char_chen_young',
        name: '小舟 (少年心象)',
        role: '童年心象实体 / 幻影',
        appearance: '赤足光脚踩在沙滩上的10岁男孩，手里高举着折叠纸飞机。',
        personality: '明朗热烈，毫不掩饰对远方的渴望。',
      },
    ],
    flowchartNodes: [
      {
        nodeId: 'node_attic_start',
        title: '阁楼潮声',
        summary: '暴雨停歇后的灯塔阁楼，夕阳从木百叶窗缝隙中斜射在积灰的木地板上。陈舟翻开旧木箱。',
        choices: [
          {
            choiceId: 'opt_open_box',
            text: '用发卡小心撬开生锈的铁皮文具盒',
            stateMutations: {
              variables: { inner_peace: 15 },
              inventoryAdd: ['折痕斑驳的纸飞机'],
            },
            nextNodeId: 'node_find_plane',
          },
          {
            choiceId: 'opt_look_sea',
            text: '暂时放下箱子，倚在窗边静听海鸥与潮鸣',
            stateMutations: {
              variables: { nostalgia: 20 },
            },
            nextNodeId: 'node_look_sea',
          },
        ],
      },
      {
        nodeId: 'node_find_plane',
        title: '掌心的纸飞机',
        summary: '展开泛黄的纸张，一行稚嫩的蜡笔字映入眼帘：“飞到对岸去”。陈舟的眼角泛起微光。',
        choices: [
          {
            choiceId: 'opt_hum_song',
            text: '下意识轻哼起那首只记得半句的旋律',
            stateMutations: {
              variables: { inner_peace: 45 },
              flags: { remembered_song: true },
            },
            nextNodeId: 'node_ending_peace',
          },
        ],
      },
      {
        nodeId: 'node_look_sea',
        title: '暮光潮汐',
        summary: '海浪拍打着礁石，记忆如潮水般退去又涌来。老人握紧了口袋里的半张车票。',
        choices: [
          {
            choiceId: 'opt_back_box',
            text: '转过身，重新走向那个旧箱子',
            nextNodeId: 'node_find_plane',
          },
        ],
      },
      {
        nodeId: 'node_ending_peace',
        title: '破晓之风',
        summary: '纸飞机迎着清晨的第一缕海风飞向金色海平面。陈舟微微一笑，心底沉寂多年的重荷烟消云散。',
        choices: [],
      },
    ],
  };

  // 1. GDDSchema 契约检验
  const parsed = GDDSchema.parse(healingGdd);
  assert.equal(parsed.title, '海风吹拂的纸飞机');
  assert.equal(parsed.characters[0].role, '玩家第一视角 / 独居老人');
  assert.ok(parsed.globalStateMachine.philosophy?.includes('回忆碎片'));

  // 2. 静态拓扑一致性校验
  const validation = validateGdd(parsed);
  assert.equal(validation.valid, true, `治愈题材静态校验必须通过: ${validation.errors.join(', ')}`);

  // 3. 工业级 Markdown 渲染
  const md = renderGddMarkdown(parsed);
  assert.ok(md.includes('海风吹拂的纸飞机'));
  assert.ok(md.includes('回忆碎片收集'));
});

test('2. 时空死循环科幻题材：莫比乌斯环回溯边 (isLoopBack) 与拓扑自洽性', () => {
  const timeLoopGdd: GDDArtifact = {
    schemaVersion: '2.0.0',
    title: '十二分零七秒',
    genre: '硬科幻 / 时间循环悬疑',
    hook: '一艘坠入黑洞事件视界的飞船，在警报倒计时的最后七秒反复死而复生。',
    playerRole: '领航员艾尔法，带着上一次死亡的视神经残留记忆反复重启。',
    coreLoop: '时空重置 ➔ 尝试新行为破局 ➔ 遭遇死局回溯 ➔ 跨循环继承记忆',
    beatOutline: [
      {
        beatId: 'beat_01_alarm',
        act: '第一幕·循环起点',
        title: '第七秒红警重置',
        gameplayTask: '七秒倒计时内排查座舱热点（推进器/黑匣子），限时二选一决策',
        dramaticGoal: '在黑洞视界吞噬前的最后七秒惊醒，排查推进器与黑匣子',
        keyConflicts: '引力潮汐 vs 逃生时间限制',
        branchExpectations: [
          { intent: '切断推进器', targetBeatId: 'beat_02_explosion' },
          { intent: '破解黑匣子', targetBeatId: 'beat_03_escape' },
        ],
      },
      {
        beatId: 'beat_02_explosion',
        act: '第二幕·堆芯殉爆',
        title: '堆芯过载殉爆',
        gameplayTask: '死亡演出后意识自动回溯（无输入关卡），继承上轮记忆物品',
        dramaticGoal: '反物质失效肉身崩解，意识回溯奇点',
        keyConflicts: '能量过载',
        branchExpectations: [
          { intent: '意识回溯', targetBeatId: 'beat_01_alarm', isLoopBack: true },
        ],
      },
      {
        beatId: 'beat_03_escape',
        act: '第三幕·破局信标',
        title: '视界外的破晓信标',
        gameplayTask: '在视界吞噬前完成密钥按键序列输入，发射引力波信标',
        dramaticGoal: '发射引力波信标冲破黑洞，打破循环',
        keyConflicts: '终极解脱',
        isEnding: true,
        endingTheme: '终局：破晓信标',
      },
    ],
    globalStateMachine: {
      philosophy: '跨循环继承记忆与死循环回溯',
      variables: {
        loop_count: { name: '当前循环轮次', initial: 1, min: 1, max: 999 },
        chronos_stability: { name: '时空锚定率', initial: 100, min: 0, max: 100 },
      },
      flags: {
        has_blackbox_code: { name: '获悉黑匣子终极自毁代码', initial: false },
      },
      inventory: ['裂屏的战术腕表'],
    },
    characters: [
      {
        characterId: 'char_navigator',
        name: '艾尔法',
        role: '时空循环承载者 / 领航员',
        appearance: '身穿破损负压宇航服，头盔面罩内泛着时空曲率引起的蓝紫色荧光。',
        personality: '在无数次死亡中变得极度冷静与麻木，唯一的执念是送出求救信标。',
      },
    ],
    flowchartNodes: [
      {
        nodeId: 'node_loop_start',
        title: '第七秒红警重置',
        summary: '“警报：视界突破，剩余十二分零七秒。”刺耳警报在座舱炸响，艾尔法猛然惊醒，嘴角还残留着上一次窒息的腥甜。',
        choices: [
          {
            choiceId: 'opt_pull_lever',
            text: '强行切断主曲率推进器',
            nextNodeId: 'node_core_explosion',
          },
          {
            choiceId: 'opt_hack_blackbox',
            text: '连接副控台强行破译飞行数据',
            nextNodeId: 'node_blackbox_room',
          },
        ],
      },
      {
        nodeId: 'node_core_explosion',
        title: '堆芯过载殉爆',
        summary: '反物质约束环失效，白光吞噬了视网膜。在肉身崩解的瞬间，意识被强行拽回时空奇点！',
        choices: [
          {
            choiceId: 'opt_rewind',
            text: '【时空莫比乌斯环】意识穿梭回第一声警报响起的刹那',
            isLoopBack: true,
            stateMutations: {
              variables: { loop_count: 1 },
              inventoryAdd: ['曲率失真晶片'],
            },
            nextNodeId: 'node_loop_start',
          },
        ],
      },
      {
        nodeId: 'node_blackbox_room',
        title: '黑匣子量子核',
        summary: '绿色的解码光条在面罩上飞速滚动。在引力潮汐撕裂外壳前的最后一秒，代码破解成功！',
        choices: [
          {
            choiceId: 'opt_escape_break',
            text: '输入终极密钥，引爆量子信标穿透视界',
            nextNodeId: 'node_ending_transmission',
          },
        ],
      },
      {
        nodeId: 'node_ending_transmission',
        title: '视界外的破晓信标',
        summary: '一束超越光速的引力波信标冲破黑洞引力井，飞向遥远的人类母星。死循环终于被彻底打破。',
        choices: [],
      },
    ],
  };

  const parsed = GDDSchema.parse(timeLoopGdd);
  assert.equal(parsed.flowchartNodes[1].choices[0].isLoopBack, true);

  // 验证带有 isLoopBack 回溯边的静态拓扑校验通过
  const validation = validateGdd(parsed);
  assert.equal(validation.valid, true, `时空循环校验必须通过: ${validation.errors.join(', ')}`);

  // 验证自主绘制 SVG 故事图谱能够无死锁渲染循环边
  const mockTextGame: TextGameArtifact = {
    schemaVersion: '1.0.0',
    title: parsed.title,
    startNodeId: 'node_loop_start',
    nodes: [
      {
        id: 'node_loop_start',
        title: '第七秒红警重置',
        narrativeText: '警报声撕裂神经。',
        choices: [
          { id: 'c1', text: '切断推进器', targetNodeId: 'node_core_explosion' },
        ],
      },
      {
        id: 'node_core_explosion',
        title: '堆芯过载殉爆',
        narrativeText: '白光吞噬一切。',
        choices: [
          { id: 'c2', text: '时空回溯', targetNodeId: 'node_loop_start' },
        ],
      },
    ],
  };

  const svg = StoryGraphSvgRenderer.renderToSvg(mockTextGame);
  assert.ok(svg.includes('<svg'), 'SVG 必须成功输出');
  assert.ok(svg.includes('node_loop_start'), 'SVG 必须包含起点');
  assert.ok(svg.includes('node_core_explosion'), 'SVG 必须包含回溯点');
});

test('3. 纯确定性 0-Token 运行时对自适应多态状态与循环回溯的执行', () => {
  const minimalTextGame: TextGameArtifact = {
    schemaVersion: '1.0.0',
    title: '循环验证游戏',
    startNodeId: 'n1',
    nodes: [
      {
        id: 'n1',
        title: '起点',
        narrativeText: '你在起点。',
        choices: [
          {
            id: 'c_go_n2',
            text: '前往下阶段',
            stateMutation: {
              variables: { energy: -5 },
              inventoryAdd: ['key_a'],
            },
            targetNodeId: 'n2',
          },
        ],
      },
      {
        id: 'n2',
        title: '循环点',
        narrativeText: '你在循环点。',
        choices: [
          {
            id: 'c_loop_back',
            text: '回溯至起点',
            stateMutation: {
              variables: { loops: 1 },
              flags: { looped_once: true },
            },
            targetNodeId: 'n1',
          },
        ],
      },
    ],
  };

  const mockGdd = {
    globalStateMachine: {
      variables: {
        energy: { name: '能量', initial: 100 },
        loops: { name: '轮次', initial: 0 },
      },
      flags: {
        looped_once: { name: '曾回溯', initial: false },
      },
      inventory: ['compass'],
    },
  };

  // 1. 初始化
  const s0 = TextGameRuntimeEngine.initGame(mockGdd as any, minimalTextGame);
  assert.equal(s0.variables['energy'], 100);
  assert.equal(s0.variables['loops'], 0);
  assert.equal(s0.inventory.includes('compass'), true);
  assert.equal(s0.flags['looped_once'], false);

  // 2. 第一步：流向 n2
  const r1 = TextGameRuntimeEngine.step(minimalTextGame, s0, 'c_go_n2');
  assert.equal(r1.nextState.currentNodeId, 'n2');
  assert.equal(r1.nextState.variables['energy'], 95);
  assert.equal(r1.nextState.inventory.includes('key_a'), true);

  // 3. 第二步：回溯流向 n1 (时空回溯)
  const r2 = TextGameRuntimeEngine.step(minimalTextGame, r1.nextState, 'c_loop_back');
  assert.equal(r2.nextState.currentNodeId, 'n1');
  assert.equal(r2.nextState.variables['loops'], 1);
  assert.equal(r2.nextState.flags['looped_once'], true);
  assert.equal(r2.nextState.inventory.includes('key_a'), true, '跨循环继承持有物');
});

test('4. 100% 通用 PRD 构建与 story.md 1:1 对齐及静态可达性校验', () => {
  const clips = [
    {
      clipId: 'S1',
      level: 1,
      title: '密室门前',
      narrativeText: '门锁上贴着泛黄的字条。',
      isEnding: false,
      interaction: {
        category: 'ACTION' as const,
        actionType: 'TAP_HOTSPOT',
        prompt: '点击字条查看背面密码线索',
        feedback: '纸背写着 0419',
      },
    },
    {
      clipId: 'S2',
      level: 2,
      title: '密码锁前',
      narrativeText: '通风口和暗门就在眼前。',
      isEnding: false,
      interaction: {
        category: 'CHOICE' as const,
        cutId: 'S2.1',
        mainlineChoice: '输入密码打开暗门',
        branchChoice: '强行撞击通风口',
        conflictSummary: '智取密码 vs 强行突围',
      },
    },
    {
      clipId: 'S3',
      level: 3,
      title: '暗道尽头',
      narrativeText: '手电光照亮了出口铁梯。',
      isEnding: true,
    },
  ];
  const branches = [
    {
      cutId: 'S2.1',
      sourceClipId: 'S2',
      level: 2,
      choiceText: '强行撞击通风口',
      branchTitle: '警报拉响',
      narrativeText: '通风口铁栅塌落触发红外报警。',
      resolutionType: 'ENDING' as const,
      endingType: 'BE' as const,
      endingTitle: '警铃大作',
      verdict: '鲁莽硬闯招致围堵。',
      rewindTargetClipId: 'S2',
    },
  ];

  const base = buildBaseUniversalPrdSpec({ title: '古宅密码', clips, branches });
  // 严格 1:1 单互动校验：S1 -> I_S1 -> S2 -> I_S2 -> S3 / S2.1
  assert.equal(base.interactions.length, 2);
  assert.deepEqual(base.interactions.map((i) => i.id), ['I_S1', 'I_S2']);

  const enhanced = applyPrdEnhancement(base, {
    genre: '密室解谜互动影游',
    playerIdentity: '被困访客',
    premiseAndPerspective: '扮演访客逃离封锁的古宅。',
    outOfFlowSummary: '维护 clues 线索数，集齐可认证完整真相。',
    gameplayAndVictorySummary: '搜证并选择正确出口即可获胜。',
    uiPagesSummary: [
      { page: '主页', features: '开始/继续' },
      { page: '播放页', features: '全屏播片与播完互动' },
    ],
    initialState: { clues: 0 },
    interactionPatches: [
      {
        interactionId: 'I_S1',
        kind: 'TAP_HOTSPOT',
        timeoutSec: 8,
        config: { hotspot: 'note_back' },
        defaultOutcomeKey: 'TIMEOUT',
        outcomePatches: [
          { key: 'SUCCESS', stateChange: { add: { clues: 1 } } },
        ],
      },
      {
        interactionId: 'I_S2',
        timeoutSec: null,
        defaultOutcomeKey: null,
        outcomePatches: [],
      },
    ],
    branchTransitions: [],
    endingEnhancements: [
      {
        sourceClipId: 'S3',
        endingId: 'END_S3_TE',
        endingType: 'TE',
        title: '真结局：破解全谜',
        isVictory: true,
        summary: '带着密码线索完美逃脱。',
        condition: 'clues === 1',
      },
      {
        sourceClipId: 'S3',
        endingId: 'END_S3_HE',
        endingType: 'HE',
        title: '普通通关：仓皇逃离',
        isVictory: true,
        summary: '逃出暗道但仍有疑团未解。',
        condition: null,
      },
    ],
  });

  const prdMd = formatGddPrdToMarkdown(enhanced);
  const storyMd = formatStoryScenesToMarkdown(clips, branches);

  // 1. 内嵌 JSON 可解析且无 Mermaid 噪音
  assert.equal(prdMd.includes('```mermaid'), false);
  const embedded = parsePrdEmbeddedJson(prdMd);
  assert.equal(embedded.ok, true);

  // 2. story.md 与 prd.clips 1:1 对齐
  assert.deepEqual(extractClipIdsFromStoryMarkdown(storyMd), ['S1', 'S2', 'S2.1', 'S3']);

  // 3. 合法性检验通过
  const validRes = validateUniversalPrdTopology({ prd: enhanced, storyMarkdown: storyMd, prdMarkdown: prdMd });
  assert.equal(validRes.valid, true, `预期通过校验，实际错误: ${validRes.errors.join('; ')}`);

  // 4. 验证静态门禁拦截：不可达单条件 (`clues >= 5`) + 复合条件 (`&&`/`||`) + 矛盾合取
  const brokenPrd = {
    ...enhanced,
    wiring: enhanced.wiring.map((w) =>
      w.to === 'END_S3_TE' ? { ...w, condition: 'clues >= 5' } : w
    ),
  };
  const brokenRes = validateUniversalPrdTopology({ prd: brokenPrd, storyMarkdown: storyMd, prdMarkdown: prdMd });
  assert.equal(brokenRes.valid, false);
  assert.ok(brokenRes.errors.some((e) => e.includes('不可达')));

  const brokenAndPrd = {
    ...enhanced,
    wiring: enhanced.wiring.map((w) =>
      w.to === 'END_S3_TE' ? { ...w, condition: 'clues >= 1 && clues <= 0' } : w
    ),
  };
  const brokenAndRes = validateUniversalPrdTopology({ prd: brokenAndPrd, storyMarkdown: storyMd });
  assert.equal(brokenAndRes.valid, false);
  assert.ok(brokenAndRes.errors.some((e) => e.includes('不可达')));

  const brokenOrPrd = {
    ...enhanced,
    wiring: enhanced.wiring.map((w) =>
      w.to === 'END_S3_TE' ? { ...w, condition: 'clues >= 5 || clues <= -1' } : w
    ),
  };
  const brokenOrRes = validateUniversalPrdTopology({ prd: brokenOrPrd, storyMarkdown: storyMd });
  assert.equal(brokenOrRes.valid, false);

  const validOrPrd = {
    ...enhanced,
    wiring: enhanced.wiring.map((w) =>
      w.to === 'END_S3_TE' ? { ...w, condition: 'clues >= 5 || clues === 1' } : w
    ),
  };
  const validOrRes = validateUniversalPrdTopology({ prd: validOrPrd, storyMarkdown: storyMd });
  assert.equal(validOrRes.valid, true, `有效析取条件应通过校验: ${validOrRes.errors.join('; ')}`);
});

test('5. 端到端 runPlannerWorkflow 生成新通用 prd.md 与 1:1 story.md（Mock 模式）', async () => {
  LLMProvider.setMockModel(new MockLanguageModel());
  const pid = `test_univ_prd_${Date.now()}`;
  const store = ProjectStore.getInstance();
  try {
    const out = await runPlannerWorkflow({
      projectId: pid,
      userPrompt: '设计一个赛博谍战互动影游',
    });
    assert.equal(out.validation?.valid, true, `工作流校验应通过: ${out.validation?.errors.join('; ')}`);
    const embedded = parsePrdEmbeddedJson(out.gdd.markdown || '');
    assert.equal(embedded.ok, true);
    const prdIds = (embedded.ok ? embedded.data.clips : []).map((c: any) => c.id);
    const storyIds = extractClipIdsFromStoryMarkdown(out.gdd.storyMarkdown || '');
    assert.deepEqual(storyIds, prdIds);
    assert.ok(Object.keys(out.gdd.globalStateMachine.variables).length > 0, 'globalStateMachine 应从 prd.initialState 自动回填');
  } finally {
    store.deleteProject(pid);
  }
});

test('6. Stage 2 对齐新版 PRD：统一 S1 节点 ID、状态透传、独立运行时 StateBlackboard 求值', () => {
  const clips = [
    {
      clipId: 'S1',
      level: 1,
      title: '门槛搜证',
      narrativeText: '你在门口停下脚步，注意到木柱上的暗记。',
      isEnding: false,
      interaction: {
        category: 'ACTION' as const,
        actionType: 'TAP_HOTSPOT',
        prompt: '检视门口告示牌背面',
        feedback: '记下暗号数字',
      },
    },
    {
      clipId: 'S2',
      level: 2,
      title: '门前盘查',
      narrativeText: '守门人冷冷伸手索要通行信物。',
      isEnding: false,
      interaction: {
        category: 'CHOICE' as const,
        cutId: 'S2.1',
        mainlineChoice: '递交通行函',
        branchChoice: '强行翻墙进入',
        conflictSummary: '守规矩交函 vs 冒险翻墙',
      },
    },
    {
      clipId: 'S3',
      level: 3,
      title: '庭院会面',
      narrativeText: '推开木门迎来清晨。',
      isEnding: true,
    },
  ];
  const branches = [
    {
      cutId: 'S2.1',
      sourceClipId: 'S2',
      level: 2,
      choiceText: '强行翻墙进入',
      branchTitle: '惊动护院',
      narrativeText: '护院犬吠破清晨宁静。',
      resolutionType: 'ENDING' as const,
      endingType: 'BE' as const,
      endingTitle: '翻墙失手',
      verdict: '贸然行事打草惊蛇。',
      rewindTargetClipId: 'S2',
    },
  ];

  const basePrd = buildBaseUniversalPrdSpec({ title: '测试剧目', clips, branches });
  const prd = applyPrdEnhancement(basePrd, {
    genre: '年代悬疑',
    playerIdentity: '返乡归人',
    premiseAndPerspective: '第一视角调查陈年旧事。',
    outOfFlowSummary: '维护 clues 与 trust。',
    gameplayAndVictorySummary: '收集线索可达成真结局。',
    uiPagesSummary: [{ page: '播放页', features: '全屏与播完互动' }],
    initialState: { clues: 0, trust: 50 },
    interactionPatches: [
      {
        interactionId: 'I_S1',
        kind: 'TAP_HOTSPOT',
        timeoutSec: 6,
        defaultOutcomeKey: 'TIMEOUT',
        outcomePatches: [{ key: 'SUCCESS', stateChange: { add: { clues: 1 }, set: { checkedSign: true } } }],
      },
      {
        interactionId: 'I_S2',
        outcomePatches: [{ key: 'A', stateChange: { add: { trust: 10 } } }],
      },
    ],
    branchTransitions: [],
    endingEnhancements: [
      {
        sourceClipId: 'S3',
        endingId: 'END_S3_TE',
        endingType: 'TE',
        title: '真结局：水落石出',
        isVictory: true,
        summary: '凭暗号线索揭开全部真相。',
        condition: 'clues >= 1 && trust >= 60',
      },
      {
        sourceClipId: 'S3',
        endingId: 'END_S3_HE',
        endingType: 'HE',
        title: '普通结局：平安离开',
        isVictory: true,
        summary: '匆匆作别，真相留白。',
        condition: null,
      },
    ],
  });

  const storyMarkdown = formatStoryScenesToMarkdown(clips, branches);
  const scenes = buildDeterministicScenesFromPlanner({
    title: '测试剧目',
    prd,
    storyMarkdown,
    entities: { artStyle: '', characters: [], items: [] },
  });

  assert.deepEqual(scenes.map((s) => s.sceneId), ['S1', 'S2', 'S2.1', 'S3']);
  const pointerCheck = validateScenePointers(scenes, prd.startNodeId);
  assert.equal(pointerCheck.valid, true, pointerCheck.errors.join('; '));

  const s1 = scenes.find((s) => s.sceneId === 'S1')!;
  const s2 = scenes.find((s) => s.sceneId === 'S2')!;
  const s3 = scenes.find((s) => s.sceneId === 'S3')!;
  const s21 = scenes.find((s) => s.sceneId === 'S2.1')!;
  assert.equal(s1.interaction.steps.length, 1);
  assert.equal(s2.interaction.steps.length, 1);
  assert.equal(s3.interaction.endings.length, 2);
  assert.equal(s3.interaction.endingType, 'TE');
  assert.equal(s21.interaction.rewindTargetScene, 'S2.json');

  const textGame = convertScenesToTextGameArtifact('测试剧目', scenes, prd);
  assert.equal(textGame.startNodeId, 'S1');
  assert.deepEqual(textGame.initialState, { clues: 0, trust: 50 });
  assert.equal(textGame.nodes[1].choices[0].stateMutation.variables.trust, 10);

  // 验证 bundle TS 编译及独立浏览器运行时 StateBlackboard 条件求值
  const tsCode = assembleStandaloneTs({ startNodeId: prd.startNodeId, initialState: prd.initialState });
  const jsCode = compileTsToJs(tsCode);
  assert.equal(jsCode.includes('scene_01.json'), false, '不应残留 scene_01.json 硬编码');
  assert.equal(jsCode.includes("'S1.json'"), true, '入口必须对齐 PRD startNodeId S1.json');

  const sandbox: any = {
    document: { addEventListener: () => {}, head: { appendChild: () => {} }, getElementById: () => null },
    window: globalThis,
    console,
  };
  vm.runInNewContext(`${jsCode}\nthis.__StateBlackboard = StateBlackboard;`, sandbox);
  const bb = new sandbox.__StateBlackboard(prd.initialState);
  assert.equal(bb.evaluateCondition('clues >= 1 && trust >= 60'), false);
  bb.applyStateChange({ add: { clues: 1, trust: 10 }, set: { checkedSign: true } });
  assert.equal(bb.evaluateCondition('clues >= 1 && trust >= 60 && checkedSign === true'), true);
});

test('7. Step 3 拓扑派生仅允许合流下游主干片段并附带目标开头前情，且切片摘要不误报支线：0', async () => {
  const clips = [
    {
      clipId: 'S1',
      level: 1,
      title: '开端对峙',
      narrativeText: '暴雨敲打屋檐，主角推开木门与来客照面。',
      isEnding: false,
      interaction: { category: 'CHOICE' as const, cutId: 'S1.1', mainlineChoice: '静观其变', branchChoice: '主动试探', conflictSummary: '进与退' },
    },
    {
      clipId: 'S2',
      level: 2,
      title: '火炉试探',
      narrativeText: '炭火正旺，桌上放着一只尚未启封的旧木匣，双方正屏息观望。',
      isEnding: false,
      interaction: { category: 'CHOICE' as const, cutId: 'S2.1', mainlineChoice: '转移话题', branchChoice: '直问来意', conflictSummary: '虚实之争' },
    },
    {
      clipId: 'S3',
      level: 3,
      title: '拂晓收束',
      narrativeText: '天色渐明，雨过天青。',
      isEnding: true,
    },
  ];

  const sliceMd = formatPlannerTraceMarkdown('测试剧目', clips, [], 'slices');
  assert.equal(sliceMd.includes('支线'), false, 'slices 阶段 trace 不应误显 支线：0');

  const seenPrompts: string[] = [];
  const fakeAgent = {
    generate: async (prompt: string) => {
      seenPrompts.push(prompt);
      // 模拟 S2.1 返回一个 REJOIN 试图接回不可能目标（或走 ENDING），验证 S1.1 绝不收到 S2.1 作为合流目标
      if (prompt.includes('发源片段标识：S2')) {
        return {
          object: {
            branchTitle: '直问风波',
            narrativeText: '来客神色一变，局势瞬间紧张收束。',
            resolutionType: 'ENDING',
            endingType: 'NE',
            endingTitle: '各自散场',
            verdict: '话不投机，不欢而散。',
            rewindTargetClipId: 'S2',
          },
        };
      }
      return {
        object: {
          branchTitle: '借机攀谈',
          narrativeText: '几句寒暄过后，双方各退一步坐到炭火旁。',
          resolutionType: 'REJOIN',
          targetClipId: 'S2.1', // 故意输出支线 ID 测试强修正到 S2
          rejoinConsequence: '收拢话题回到炭火旁对峙',
        },
      };
    },
  } as any;

  const branches = await runTopologyBranchDerivation('测试剧目', clips, fakeAgent);
  const s11Prompt = seenPrompts.find((p) => p.includes('发源片段标识：S1'))!;
  assert.ok(s11Prompt.includes('[片段标识: S2]'), 'S1.1 应看到合法主干目标 S2');
  assert.ok(s11Prompt.includes('炭火正旺，桌上放着一只尚未启封的旧木匣'), '应携带 S2 开头前情预览');
  assert.equal(s11Prompt.includes('[片段标识: S2.1]'), false, '严禁把支线 S2.1 放进合流目标清单');
  assert.equal(s11Prompt.includes('[片段标识: S3]'), false, '严禁把终局 S3 放进合流目标清单');

  const b11 = branches.find((b) => b.cutId === 'S1.1')!;
  assert.equal(b11.targetClipId, 'S2', '即使模型幻觉写了 S2.1，runner 也应就地锁定为合法主干 S2');
});

test('8. 通用流外状态静态告警与 Step 4 门禁自愈重试 1 次闭环', async () => {
  const clips = [
    {
      clipId: 'S1',
      level: 1,
      title: '初入现场',
      narrativeText: '风起云涌。',
      isEnding: false,
      interaction: { category: 'ACTION' as const, actionType: 'HOLD', prompt: '按住观察', feedback: '看清眉目' },
    },
    {
      clipId: 'S2',
      level: 2,
      title: '试探抉择',
      narrativeText: '门缝透出一道寒光。',
      isEnding: false,
      interaction: { category: 'CHOICE' as const, cutId: 'S2.1', mainlineChoice: '稳妥前行', branchChoice: '冒险试探', conflictSummary: '稳进 vs 冒险' },
    },
    { clipId: 'S3', level: 3, title: '终局', narrativeText: '尘埃落定。', isEnding: true },
  ];
  const branches = [
    {
      cutId: 'S2.1',
      sourceClipId: 'S2',
      level: 2,
      choiceText: '冒险试探',
      branchTitle: '过犹不及',
      narrativeText: '打草惊蛇。',
      resolutionType: 'ENDING' as const,
      endingType: 'BE' as const,
      endingTitle: '打草惊蛇',
      verdict: '鲁莽失误。',
      rewindTargetClipId: 'S2',
    },
  ];

  // 验证 8A：空转变量 / 无分化旗标 / 必经单出口反向扣分均触发通用静态告警
  const base = buildBaseUniversalPrdSpec({ title: '通用告警测试', clips, branches });
  const noisyPrd = applyPrdEnhancement(base, {
    genre: '通用悬疑',
    playerIdentity: '亲历者',
    premiseAndPerspective: '第一视角调查。',
    outOfFlowSummary: '测试告警。',
    gameplayAndVictorySummary: '测试。',
    uiPagesSummary: [{ page: '播放页', features: '全屏播放与互动' }],
    initialState: { risk: 0, deadBool: true, ghostVar: 0 },
    interactionPatches: [
      {
        interactionId: 'I_S1',
        timeoutSec: null,
        outcomePatches: [{ key: 'SUCCESS', stateChange: { add: { risk: 1 }, set: { deadBool: true } } }],
      },
    ],
    branchTransitions: [],
    endingEnhancements: [
      {
        sourceClipId: 'S3',
        endingId: 'END_S3_TE',
        endingType: 'TE',
        title: '完美结局',
        isVictory: true,
        summary: '低风险通关。',
        condition: 'risk <= 1',
      },
      {
        sourceClipId: 'S3',
        endingId: 'END_S3_HE',
        endingType: 'HE',
        title: '普通结局',
        isVictory: true,
        summary: '勉强脱身。',
        condition: null,
      },
    ],
  });
  const warnRes = validateUniversalPrdTopology({ prd: noisyPrd });
  assert.equal(warnRes.valid, true);
  assert.ok(warnRes.warnings.some((w) => w.includes('ghostVar')), '应告警从未使用与修改的空转变量');
  assert.ok(warnRes.warnings.some((w) => w.includes('deadBool')), '应告警全程恒真/恒假未分化的旗标');
  assert.ok(warnRes.warnings.some((w) => w.includes('I_S1') && w.includes('risk')), '应告警必经单出口与门槛反向变动');

  // 验证 8B：Step 4 首次输出不可达条件 clues >= 99，收到报错后第 2 次自愈修正为 clues >= 1
  let callCount = 0;
  const selfHealingAgent = {
    generate: async (prompt: string) => {
      callCount++;
      const bad = callCount === 1;
      if (!bad) {
        assert.ok(prompt.includes('条件不可达'), '自愈重试 Prompt 必须携带精确静态报错原因');
      }
      return {
        object: {
          genre: '通用题材',
          playerIdentity: '调查员',
          premiseAndPerspective: '第一视角探索。',
          outOfFlowSummary: '维护 clues。',
          gameplayAndVictorySummary: '收集 clues >= 1 达成 TE。',
          uiPagesSummary: [{ page: '播放页', features: '播放与互动' }],
          initialState: { clues: 0 },
          interactionPatches: [
            {
              interactionId: 'I_S1',
              timeoutSec: null,
              outcomePatches: [{ key: 'SUCCESS', stateChange: { add: { clues: 1 } } }],
            },
          ],
          branchTransitions: [],
          endingEnhancements: [
            {
              sourceClipId: 'S3',
              endingId: 'END_S3_TE',
              endingType: 'TE',
              title: '真结局',
              isVictory: true,
              summary: '全貌大白。',
              condition: bad ? 'clues >= 99' : 'clues >= 1',
            },
            {
              sourceClipId: 'S3',
              endingId: 'END_S3_HE',
              endingType: 'HE',
              title: '普通结局',
              isVictory: true,
              summary: '顺利脱身。',
              condition: null,
            },
          ],
        },
      };
    },
  } as any;

  const synOut = await executePrdSynthesisStep({ title: '自愈测试', clips, branches }, selfHealingAgent);
  assert.equal(callCount, 2, '初版不合规应自动触发 1 次自愈重试');
  const repairedCheck = validateUniversalPrdTopology({ prd: synOut.prd });
  assert.equal(repairedCheck.valid, true, `自愈后应通过门禁校验: ${repairedCheck.errors.join('; ')}`);
});

test('9. 同源出口胜负冲突告警、只写不读告警、Step 3 分支比例透传及 REJOIN 重播检测', async () => {
  // 9A. 同 (from, onOutcome) 正负 isVictory 冲突 vs CHOICE A/B 正常胜负分离；+ 只写不读告警
  const clips2 = [
    { clipId: 'S1', level: 1, title: '起手', narrativeText: '推门见风。', isEnding: false, interaction: { category: 'CHOICE' as const, cutId: 'S1.1', mainlineChoice: '继续', branchChoice: '退后', conflictSummary: '进退' } },
    { clipId: 'S2', level: 2, title: '终局', narrativeText: '尘埃落定。', isEnding: true },
  ];
  const branches2 = [
    { cutId: 'S1.1', sourceClipId: 'S1', level: 1, choiceText: '退后', branchTitle: '错失', narrativeText: '转身离开。', resolutionType: 'ENDING' as const, endingType: 'BE' as const, endingTitle: '错失', verdict: '错过', rewindTargetClipId: 'S1' },
  ];

  const base2 = buildBaseUniversalPrdSpec({ title: '精准告警测试', clips: clips2, branches: branches2 });
  const prdMixedSameOutcome = applyPrdEnhancement(base2, {
    genre: '通用题材',
    playerIdentity: '亲历者',
    premiseAndPerspective: '第一视角。',
    outOfFlowSummary: '测试读写与胜负一致性。',
    gameplayAndVictorySummary: '测试。',
    uiPagesSummary: [{ page: '播放页', features: '播放' }],
    initialState: { score: 0, writeOnlyFlag: false },
    interactionPatches: [
      {
        interactionId: 'I_S1',
        outcomePatches: [{ key: 'A', stateChange: { add: { score: 1 }, set: { writeOnlyFlag: true } } }],
      },
    ],
    branchTransitions: [],
    endingEnhancements: [
      {
        sourceClipId: 'S2',
        endingId: 'END_S2_TE',
        endingType: 'TE',
        title: '胜利结局',
        isVictory: true,
        summary: '达成目标。',
        condition: 'score >= 1',
      },
      {
        sourceClipId: 'S2',
        endingId: 'END_S2_NE',
        endingType: 'NE',
        title: '失败结局',
        isVictory: false,
        summary: '遗憾收尾。',
        condition: null,
      },
    ],
  });

  const warnMixed = validateUniversalPrdTopology({ prd: prdMixedSameOutcome });
  assert.equal(warnMixed.valid, true, '同源正负胜负冲突为 warning 而非阻断 error');
  assert.ok(warnMixed.warnings.some((w) => w.includes('writeOnlyFlag') && w.includes('只写不读')));
  assert.ok(warnMixed.warnings.some((w) => w.includes('S2 (onEnded)') && w.includes('isVictory: true') && w.includes('isVictory: false')));

  // 确认正常 CHOICE A/B（不同 onOutcome）不误触发正负冲突告警
  const choiceSplitPrd = {
    ...base2,
    endings: [
      { id: 'END_S1.1', endingType: 'BE' as const, title: '失败', isVictory: false, summary: '失手' },
      { id: 'END_S2_HE', endingType: 'HE' as const, title: '胜利', isVictory: true, summary: '通关' },
    ],
  };
  const noFalseAlarm = validateUniversalPrdTopology({ prd: choiceSplitPrd });
  assert.equal(noFalseAlarm.warnings.some((w) => w.includes('兼容两极结算')), false);

  // 9B. REJOIN 末尾重播目标首句检测 + 过度 REJOIN 比例告警
  const clips4 = [
    { clipId: 'S1', level: 1, title: '一', narrativeText: '第一幕开头。', isEnding: false, interaction: { category: 'CHOICE' as const, cutId: 'S1.1', mainlineChoice: 'A', branchChoice: 'B', conflictSummary: 'c' } },
    { clipId: 'S2', level: 2, title: '二', narrativeText: '外婆站起来，颤巍巍地往屋里走："我去拿木盆。" 两人对视一眼。', isEnding: false, interaction: { category: 'CHOICE' as const, cutId: 'S2.1', mainlineChoice: 'A', branchChoice: 'B', conflictSummary: 'c' } },
    { clipId: 'S3', level: 3, title: '三', narrativeText: '第三幕平稳开头。', isEnding: false, interaction: { category: 'CHOICE' as const, cutId: 'S3.1', mainlineChoice: 'A', branchChoice: 'B', conflictSummary: 'c' } },
    { clipId: 'S4', level: 4, title: '四', narrativeText: '第四幕平稳开头。', isEnding: false, interaction: { category: 'CHOICE' as const, cutId: 'S4.1', mainlineChoice: 'A', branchChoice: 'B', conflictSummary: 'c' } },
    { clipId: 'S5', level: 5, title: '五', narrativeText: '终局。', isEnding: true },
  ];
  const branchesReplay = [
    {
      cutId: 'S1.1',
      sourceClipId: 'S1',
      level: 1,
      choiceText: 'B',
      branchTitle: '重播测试',
      narrativeText: '小满先接了一瓢水。外婆站起来，颤巍巍地往屋里走："我去拿木盆。"',
      resolutionType: 'REJOIN' as const,
      targetClipId: 'S2',
      rejoinConsequence: '合流',
    },
    { cutId: 'S2.1', sourceClipId: 'S2', level: 2, choiceText: 'B', branchTitle: 'b2', narrativeText: '过渡片段二。', resolutionType: 'REJOIN' as const, targetClipId: 'S3', rejoinConsequence: '合流' },
    { cutId: 'S3.1', sourceClipId: 'S3', level: 3, choiceText: 'B', branchTitle: 'b3', narrativeText: '过渡片段三。', resolutionType: 'REJOIN' as const, targetClipId: 'S4', rejoinConsequence: '合流' },
    { cutId: 'S4.1', sourceClipId: 'S4', level: 4, choiceText: 'B', branchTitle: 'b4', narrativeText: '过渡片段四。', resolutionType: 'REJOIN' as const, targetClipId: 'S5', rejoinConsequence: '合流' },
  ];
  const continuityWarns = collectStoryContinuityWarnings(clips4, branchesReplay);
  assert.ok(continuityWarns.some((w) => w.includes('S1.1') && w.includes('重复演播风险')), '应检出 REJOIN 逐字重播风险');
  assert.ok(continuityWarns.some((w) => w.includes('REJOIN 合流') && w.includes('0 条独立结局')), '应检出过度 REJOIN 比例');

  // 验证 validatePipelineInputTopology 会汇入 continuityWarns
  const pipeRes = validatePipelineInputTopology({
    title: '测试',
    clips: clips4,
    branches: branchesReplay,
    prd: choiceSplitPrd,
  });
  assert.ok(pipeRes.warnings.some((w) => w.includes('重复演播风险')));

  // 9C. 验证 Step 3 向后续切片透传累计 REJOIN / ENDING 统计
  const seenPrompts2: string[] = [];
  const statsClips = [
    { clipId: 'S1', level: 1, title: '一', narrativeText: '第一幕。', isEnding: false, interaction: { category: 'CHOICE' as const, cutId: 'S1.1', mainlineChoice: 'A', branchChoice: 'B', conflictSummary: 'c' } },
    { clipId: 'S2', level: 2, title: '二', narrativeText: '第二幕。', isEnding: false, interaction: { category: 'CHOICE' as const, cutId: 'S2.1', mainlineChoice: 'A', branchChoice: 'B', conflictSummary: 'c' } },
    { clipId: 'S3', level: 3, title: '三', narrativeText: '第三幕开头画面。', isEnding: false },
    { clipId: 'S4', level: 4, title: '四', narrativeText: '终局。', isEnding: true },
  ];
  await runTopologyBranchDerivation('透传测试', statsClips, {
    generate: async (p: string) => {
      seenPrompts2.push(p);
      return {
        object: {
          branchTitle: '过渡',
          narrativeText: '独立小波折后暂告段落。',
          resolutionType: 'REJOIN',
          targetClipId: 'S3',
          rejoinConsequence: '回到原点前奏',
        },
      };
    },
  } as any);
  assert.ok(seenPrompts2[0].includes('目前已生成 REJOIN 0 条、ENDING 0 条'));
  assert.ok(seenPrompts2[1].includes('目前已生成 REJOIN 1 条、ENDING 0 条'));
});

test('10. Stage 2 纯粹消费 Step 4 交付件（prd.md + story.md）：零过程耦合且无损还原交互、回溯与主结局展示', () => {
  const srcClips = [
    {
      clipId: 'S1',
      level: 1,
      title: '檐下初见',
      narrativeText: '暴雨敲打竹檐，阿青把油纸伞收在门边，抬头看见桌案上半张未写完的信笺。',
      isEnding: false,
      interaction: {
        category: 'ACTION' as const,
        actionType: 'TAP_HOTSPOT',
        prompt: '轻触桌面信笺角落',
        feedback: '指尖触到微湿的墨迹。',
      },
    },
    {
      clipId: 'S2',
      level: 2,
      title: '门外叩声',
      narrativeText: '门外脚步停在竹帘前，油灯微晃。',
      isEnding: false,
      interaction: {
        category: 'CHOICE' as const,
        cutId: 'S2.1',
        mainlineChoice: '推门迎入廊下客',
        branchChoice: '先藏起信笺再应声',
        conflictSummary: '门外脚步停在竹帘前。',
      },
    },
    {
      clipId: 'S3',
      level: 3,
      title: '炉火煮茶',
      narrativeText: '泥炉水汽升腾，来客递出一枚刻着竹叶暗纹的旧茶饼，眼神试探。',
      isEnding: false,
      interaction: {
        category: 'CHOICE' as const,
        cutId: 'S3.1',
        mainlineChoice: '接过茶饼端详纹理',
        branchChoice: '借口添水绕到窗后',
        conflictSummary: '茶香里藏着多年旧事的线索。',
      },
    },
    {
      clipId: 'S4',
      level: 4,
      title: '雨歇天明',
      narrativeText: '晨雾散尽，竹叶滴落最后一颗水珠，两人将两半信笺拼合在木桌上。',
      isEnding: true,
      interaction: {
        category: 'ACTION' as const,
        actionType: 'HOLD',
        prompt: '按住桌面拼合残信',
        feedback: '纸纹严丝合缝地对上了。',
      },
    },
  ];

  const srcBranches = [
    {
      cutId: 'S2.1',
      sourceClipId: 'S2',
      level: 2,
      choiceText: '先藏起信笺再应声',
      branchTitle: '帘外失踪',
      narrativeText: '你忙着把信笺压进抽屉，再抬头时帘外只剩一串迅速远去的水渍脚印。',
      resolutionType: 'ENDING' as const,
      endingType: 'BE' as const,
      endingTitle: '错失故人',
      verdict: '犹豫之间，雨幕隔断了重逢。',
      rewindTargetClipId: 'S2',
    },
    {
      cutId: 'S3.1',
      sourceClipId: 'S3',
      level: 3,
      choiceText: '借口添水绕到窗后',
      branchTitle: '窗影听真',
      narrativeText: '你在窗外竹影间听见来客轻叹一声，意识到对方并非恶意试探，于是捧着热水重新回屋。',
      resolutionType: 'REJOIN' as const,
      targetClipId: 'S4',
      rejoinConsequence: '听明对方苦衷后带着疑虑合流',
    },
  ];

  const basePrd = buildBaseUniversalPrdSpec({
    title: '竹廊听雨',
    clips: srcClips,
    branches: srcBranches,
  });
  // 验证 1:1 单互动：S1(ACTION)->I_S1, S2(CHOICE)->I_S2, S3(CHOICE)->I_S3, S4(ACTION)->I_S4
  assert.deepEqual(basePrd.interactions.map((i) => i.id), ['I_S1', 'I_S2', 'I_S3', 'I_S4']);

  const branchEndInPrd = basePrd.endings.find((e) => e.id === 'END_S2.1');
  assert.equal(branchEndInPrd?.rewindTargetClipId, 'S2', 'Step 4 PRD 结局节点应直接携带 rewindTargetClipId');

  const upgradedPrd = {
    ...basePrd,
    genre: '国风治愈悬疑',
    initialState: { trust: 0 },
    endings: [
      ...basePrd.endings.filter((e) => e.id !== 'END_S4_HE'),
      { id: 'END_S4_TE', endingType: 'TE' as const, title: '真结局·拼信重圆', isVictory: true, summary: '心结尽解。' },
      { id: 'END_S4_NE', endingType: 'NE' as const, title: '残信惜别', isVictory: false, summary: '各奔前程。' },
    ],
    wiring: basePrd.wiring.map((edge) => {
      if (edge.from === 'S3.1' && edge.to === 'S4') {
        return { ...edge, transition: { text: '听明对方苦衷后带着疑虑合流', durationSec: 1.5 } };
      }
      if (edge.from === 'I_S4') {
        return { ...edge, to: 'END_S4_TE', condition: 'trust >= 1' };
      }
      return edge;
    }).concat({ from: 'I_S4', onOutcome: '*', condition: null, transition: null, to: 'END_S4_NE' }),
  };

  const prdMarkdown = formatGddPrdToMarkdown(upgradedPrd, srcClips, srcBranches);
  const storyMarkdown = formatStoryScenesToMarkdown(srcClips, srcBranches);

  // 直接从 Step 4 prd.md 解析完整 UniversalPrdSpec 并驱动 Stage 2 分幕装配
  const parsedPrd = parseUniversalPrdFromMarkdown(prdMarkdown);
  assert.equal(parsedPrd.gameTitle, '竹廊听雨');
  assert.equal(parsedPrd.genre, '国风治愈悬疑');
  assert.deepEqual(parsedPrd.initialState, { trust: 0 });
  assert.equal(parsedPrd.endings.find((e) => e.id === 'END_S2.1')?.rewindTargetClipId, 'S2');

  const scenes = buildDeterministicScenesFromPlanner({
    title: parsedPrd.gameTitle,
    prd: parsedPrd,
    storyMarkdown,
    entities: { artStyle: '', characters: [], items: [] },
  });

  assert.deepEqual(scenes.map((s) => s.sceneId), ['S1', 'S2', 'S2.1', 'S3', 'S3.1', 'S4']);
  assert.equal(validateScenePointers(scenes, parsedPrd.startNodeId).valid, true);

  const s1 = scenes.find((s) => s.sceneId === 'S1')!;
  assert.ok(s1.screenplay.storyContext.includes('油纸伞收在门边'));
  assert.equal(s1.interaction.steps.length, 1);

  const s21 = scenes.find((s) => s.sceneId === 'S2.1')!;
  assert.equal(s21.interaction.isEnding, true);
  assert.equal(s21.interaction.endingType, 'BE');
  assert.equal(s21.interaction.rewindTargetScene, 'S2.json');

  const s31 = scenes.find((s) => s.sceneId === 'S3.1')!;
  assert.equal(s31.interaction.isEnding, false);
  assert.equal(s31.interaction.choices[0]?.nextSceneJson, 'S4.json');
  assert.equal(s31.interaction.choices[0]?.text, '听明对方苦衷后带着疑虑合流');

  const s4 = scenes.find((s) => s.sceneId === 'S4')!;
  assert.equal(s4.interaction.isEnding, true);
  assert.equal(s4.interaction.endingType, 'TE', '主线末幕元数据应优先展示高阶胜局 TE 而非兜底 NE');
  assert.equal(s4.interaction.rewindTargetScene, undefined, '非支线主末幕不应错挂支线回溯指针');
});

test('11. Step 2 三段式（Patch 插标签 ➔ 按标签物理分段 ➔ 实现标签玩法）无损切分闭环', async () => {
  const spineScript = [
    '月光从漏窗照进书房，桌上摊着一幅未完成的旧画，后山处画着一个朱砂圈。',
    '他伸手去碰那幅画，指尖刚触到纸面，整面墙忽然无声地滑开，露出一道向下的暗梯，潮湿的霉味涌了出来。',
    '他没有下去，听见门外传来脚步声，连忙退回来恢复原样，迎上提灯而来的林大夫。',
    '随后两人在门厅展开对峙，各自揣测对方为何深夜出现在这间书房。',
  ].join('\n\n');

  const { taggedScript, segments, appliedTags } = applyInteractionTagPatches(spineScript, [
    {
      tagId: 'I1',
      clipTitle: '书房旧画',
      insertAfter: '后山处画着一个朱砂圈。',
      category: 'ACTION',
    },
    {
      tagId: 'I2',
      clipTitle: '门外脚步',
      insertAfter: '迎上提灯而来的林大夫。',
      category: 'CHOICE',
    },
  ]);

  assert.equal(appliedTags.length, 2, '两处 Patch 锚点应全部精准定位并插入标签');
  assert.ok(taggedScript.includes('<interact id="I1" category="ACTION" />'));
  assert.ok(taggedScript.includes('<interact id="I2" category="CHOICE" />'));
  assert.deepEqual(splitScriptByInteractTags(taggedScript), segments);
  assert.equal(segments.length, 3);
  assert.ok(
    segments[1].startsWith('他伸手去碰那幅画，指尖刚触到纸面，整面墙忽然无声地滑开'),
    '碰画与开暗梯剧情必须物理保留在 I1 紧随其后的 S2 开头，绝对零丢失'
  );
  assert.equal(
    segments.join('\n\n'),
    spineScript,
    '所有分段拼合后必须一字不差等于原主干剧本'
  );

  // 加粗引号末尾落刀时，应顺手吞掉闭合的 ** 而非遗留半截 ** 在下一幕开头
  const boldSplit = applyInteractionTagPatches(
    '他盯着信纸：**"留下，还是烧掉？选吧。"**\n\n雨声在头顶轰鸣。',
    [
      {
        tagId: 'I1',
        clipTitle: '信纸抉择',
        insertAfter: '选吧。"',
        category: 'CHOICE',
      },
    ]
  );
  assert.equal(boldSplit.segments[0], '他盯着信纸：**"留下，还是烧掉？选吧。"**');
  assert.equal(boldSplit.segments[1], '雨声在头顶轰鸣。');

  // 端到端验证 executeSliceInteractionsStep：第 1 次产出 Patch 计划，随后逐标签并发仅基于切好片段实现玩法内容
  const promptsSeen: string[] = [];
  const patchAndPlayAgent = {
    generate: async (prompt: string) => {
      promptsSeen.push(prompt);
      if (promptsSeen.length === 1) {
        return {
          object: {
            title: '夜探书房',
            endingTitle: '门厅对峙',
            patches: [
              {
                tagId: 'I1',
                clipTitle: '书房旧画',
                // 刻意传入略微丢掉句号与多余空格的锚点，验证归一化定位依然精准
                insertAfter: '后山处画着一个朱砂圈',
                category: 'ACTION',
              },
              {
                tagId: 'I2',
                clipTitle: '门外脚步',
                insertAfter: '迎上提灯而来的林大夫。',
                category: 'CHOICE',
              },
            ],
          },
        };
      }
      if (prompt.includes('类型：ACTION')) {
        return {
          object: {
            actionType: 'TAP_HOTSPOT',
            prompt: '轻触画上朱砂圈',
            feedback: '指尖微凉，画纸下嵌着暗机',
          },
        };
      }
      return {
        object: {
          conflictSummary: '深夜被撞破后的应对抉择',
          mainlineChoice: '镇定反问对方来意',
          branchChoice: '转身退入暗梯试探',
        },
      };
    },
  } as any;

  const sliced = await executeSliceInteractionsStep({ spineScript }, patchAndPlayAgent);
  assert.equal(promptsSeen.length, 3, '应经过 1 次 Patch 插标签 + 2 次逐标签并发实现玩法');
  const actionPrompt = promptsSeen.find((p) => p.includes('类型：ACTION')) || '';
  const choicePrompt = promptsSeen.find((p) => p.includes('类型：CHOICE')) || '';
  assert.equal(
    actionPrompt.includes('整面墙忽然无声地滑开'),
    false,
    'ACTION 标签生成玩法时不应看到后续未演片段，彻底避免剧透'
  );
  assert.ok(choicePrompt.includes('随后两人在门厅展开对峙'));
  assert.equal(sliced.clips.length, 3);
  assert.equal(sliced.clips[0].narrativeText, '月光从漏窗照进书房，桌上摊着一幅未完成的旧画，后山处画着一个朱砂圈。');
  assert.ok(sliced.clips[1].narrativeText.startsWith('他伸手去碰那幅画'));
  assert.equal(sliced.clips[1].interaction?.category, 'CHOICE');
  if (sliced.clips[1].interaction?.category === 'CHOICE') {
    assert.equal(sliced.clips[1].interaction.cutId, 'S2.1', 'cutId 应由确定性编号规则锁定为 S2.1');
  }
  assert.equal(sliced.clips[2].isEnding, true);
  assert.equal(sliced.clips[2].title, '门厅对峙');
});

test('12. Pre-Action 切口 intentHint 透传与 actionType 枚举强约束（拒产 TAP_HOTSPOT 且零剧透）', async () => {
  assert.equal(
    ActionGameplayOutputSchema.safeParse({
      actionType: 'TAP_HOTSPOT',
      prompt: '点击按钮',
      feedback: '继续',
    }).success,
    false,
    'ActionGameplayOutputSchema 必须从源头禁止 TAP_HOTSPOT'
  );
  assert.equal(
    ActionGameplayOutputSchema.safeParse({
      actionType: 'CLICK',
      prompt: '低头查看加密日志',
      feedback: '指尖触到微凉屏幕',
    }).success,
    true
  );

  const parsedPatch = InteractionTagPatchSchema.safeParse({
    tagId: 'I1',
    clipTitle: '初闻警报',
    intentHint: '低头查看加密日志',
    insertAfter: '把一份加密日志推到你面前：“第七层，有人进去了。”',
    category: 'ACTION',
  });
  assert.equal(parsedPatch.success, true);

  const script =
    '舰长把一份加密日志推到你面前：“第七层，有人进去了。”\n\n你低头，日志上只有一行字：“我们不是在下潜，是在逃离。”';
  const seenPrompts: string[] = [];
  const customAgent = {
    generate: async (prompt: string) => {
      seenPrompts.push(prompt);
      if (seenPrompts.length === 1) {
        return {
          object: {
            title: '深海方舟',
            endingTitle: '加密日志的真相',
            patches: [
              {
                tagId: 'I1',
                clipTitle: '初闻警报',
                intentHint: '低头查看加密日志',
                insertAfter: '“第七层，有人进去了。”',
                category: 'ACTION',
              },
            ],
          },
        };
      }
      return {
        object: {
          actionType: 'CLICK',
          prompt: '低头查看加密日志',
          feedback: '你俯身将视线落向发光的加密屏幕',
        },
      };
    },
  } as any;

  const sliced = await executeSliceInteractionsStep({ spineScript: script }, customAgent);
  assert.equal(sliced.clips.length, 2);
  assert.equal(
    sliced.clips[0].narrativeText,
    '舰长把一份加密日志推到你面前：“第七层，有人进去了。”'
  );
  assert.ok(sliced.clips[1].narrativeText.startsWith('你低头，日志上只有一行字'));
  const actionPrompt = seenPrompts[1] || '';
  assert.ok(actionPrompt.includes('低头查看加密日志'), 'ACTION 生成应收到 intentHint 指引');
  assert.ok(!actionPrompt.includes('我们不是在下潜，是在逃离'), '不得把后段文本直接泄露成剧透');
});
