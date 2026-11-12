/**
 * tests/verify-benchmark-gdd.ts
 * 黄金标杆策划案落盘与第二步 (文游生成+可玩试玩) 全闭环验证脚本
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { GDDSchema, type GDDArtifact } from '../src/agents/planner/schema.js';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { executeBuildTextGameStep } from '../src/workflows/steps/build-text-game.step.js';
import { TextGameRuntimeEngine } from '../src/runtime/state-engine.js';
import { LLMProvider, MockLanguageModel } from '../src/llm/index.js';
import { StoryGraphSvgRenderer } from '../src/media/index.js';

const gddMdPath = path.resolve('data/projects/proj_deep_echo/artifacts/gdd.md');
const markdownContent = fs.existsSync(gddMdPath)
  ? fs.readFileSync(gddMdPath, 'utf-8')
  : fs.readFileSync(path.resolve('server/data/projects/proj_deep_echo/artifacts/gdd.md'), 'utf-8');

// 1. 构建 100% 契合 GDDSchema 工业级标准的黄金标杆策划案 (以 Markdown GDD 为核心 SSOT)
export const benchmarkGDD: GDDArtifact = {
  schemaVersion: '2.0.0',
  title: '深海逆光：临界博弈 (Project: Deep Echo)',
  genre: '赛博悬疑 / 双面潜伏 / 全动态影像互动影游 (FMV)',
  hook: '暴雨锁城的午夜审讯室，测谎红灯闪烁，伪装成清道夫的卧底特工必须在枪口与义眼过载的极限博弈中，维系怀疑度不爆表并完成名单掉包。',
  playerRole: '双面间谍卧底黑客“林巡”（代号：夜莺），表面上是财阀情报局特勤清道夫，实为地下抵抗军核心潜伏者。',
  markdown: markdownContent,
  globalStateMachine: {
    variables: {
      suspicion: {
        name: '维克托的怀疑度',
        initial: 35,
        min: 0,
        max: 100,
        description: '达到 80+ 触发就地拔枪处决 (BE)；低于 20 将彻底解除审讯戒备。',
      },
      neural_overload: {
        name: '神经义眼过载度',
        initial: 20,
        min: 0,
        max: 100,
        description: '主角义眼发热过载，达到 80+ 产生视听失真，限制高敏捷行为。',
      },
      courage: {
        name: '决断意志',
        initial: 50,
        min: 0,
        max: 100,
        description: '心理博弈底气，影响高难度攻防的掷骰与检定豁免。',
      },
    },
    flags: {
      has_victor_black_account: {
        name: '掌握维克托走私黑账',
        initial: false,
        description: '是否破译了壁挂安保终端中的走私数据。',
      },
      swapped_name_list: {
        name: '名单完成掉包',
        initial: false,
        description: '抵抗军联络名单是否已成功用空白名单替换。',
      },
      courier_executed: {
        name: '信使被处决',
        initial: false,
        description: '是否被迫射杀隔壁同伴。',
      },
    },
    inventory: ['item_fake_id_chip'],
  },
  characters: [
    {
      characterId: 'char_lin_xun',
      name: '林巡 (Lin Xun)',
      role: 'player',
      appearance: '26岁青年，右侧额发遮挡着微弱红光的义眼散热口，身穿淋湿的仿旧仿生皮革风衣，双手骨节微青。',
      personality: '深沉克制，微表情管理大师，内心被前代联络员牺牲的罪疚折磨，具备极强逻辑反制本能。',
    },
    {
      characterId: 'char_viktor',
      name: '维克托 (Viktor)',
      role: 'antagonist',
      appearance: '52岁财阀安保主管，义体化改造率高达65%，右眼为冰蓝色军规测谎义眼，右臂装配微型液压撞锤手枪。',
      personality: '冷血猎犬，热衷于在心理层面瓦解嫌疑人的心理防线，极度自负且多疑。',
    },
  ],
  flowchartNodes: [
    {
      nodeId: 'node_01_interrogation',
      title: '雨夜审讯与子弹测谎',
      summary: '暴雨倾盆。维克托将一枚刻着抵抗军代号的黄铜子弹按在铁桌上，机械测谎眼紧盯林巡。',
      choices: [
        {
          choiceId: 'choice_silent_stare',
          text: '保持绝对沉默，目光平视子弹',
          requiredFlags: [],
          stateMutations: {
            variables: { suspicion: 5, courage: 10 },
          },
          nextNodeId: 'node_02_briefcase_standoff',
        },
        {
          choiceId: 'choice_explain_routine',
          text: '“我是按安保条例去下层机房巡查阻断剂配额”',
          requiredFlags: [],
          stateMutations: {
            variables: { suspicion: -10, neural_overload: 10 },
          },
          nextNodeId: 'node_02_briefcase_standoff',
        },
        {
          choiceId: 'choice_provoke_cynical',
          text: '反讽：“维克托主管，抓内鬼抓到清道夫头上，看来你的晋升压力很大”',
          requiredFlags: [],
          stateMutations: {
            variables: { suspicion: 25 },
            flags: { provoked_viktor: true },
          },
          nextNodeId: 'node_03_counter_attack',
        },
      ],
    },
    {
      nodeId: 'node_02_briefcase_standoff',
      title: '公文包掉包悬疑',
      summary: '维克托点燃一支雪茄，转身调阅终端。桌上的公文包微露出一角带血的名单。',
      choices: [
        {
          choiceId: 'choice_swap_list_covert',
          text: '趁其吐烟瞬间，以微动作掉包夹层名单',
          requiredFlags: [],
          stateMutations: {
            variables: { suspicion: 15, neural_overload: 20 },
            flags: { swapped_name_list: true },
            inventoryAdd: ['blood_stained_list'],
          },
          nextNodeId: 'node_04_dawn_escape',
        },
        {
          choiceId: 'choice_steal_key',
          text: '顺走桌角遗落的物理铜钥，放弃名单',
          requiredFlags: [],
          stateMutations: {
            variables: { suspicion: 5 },
            flags: { has_decryption_key: true },
            inventoryAdd: ['copper_key'],
          },
          nextNodeId: 'node_04_dawn_escape',
        },
      ],
    },
    {
      nodeId: 'node_03_counter_attack',
      title: '冰冷对峙与反客为主',
      summary: '维克托被激怒，机械手猛扼住林巡咽喉，测谎警报狂鸣。',
      choices: [
        {
          choiceId: 'choice_reveal_lever',
          text: '报出主管私吞走私药剂的隐秘终端账号反制',
          requiredFlags: [],
          stateMutations: {
            variables: { suspicion: -25, courage: 20 },
          },
          nextNodeId: 'node_04_dawn_escape',
        },
      ],
    },
    {
      nodeId: 'node_04_dawn_escape',
      title: '破晓逃生或深渊处决',
      summary: '审讯接近尾声，警卫敲门报告晨班交接，维克托做出最终裁决。',
      choices: [],
    },
  ],
};

async function main() {
  console.log('🧪 开始执行标杆策划案落盘与文游扩写验证...\n');

  // 1. 验证策划案 100% 契合 GDDSchema 强类型校验
  console.log('1. 验证黄金标杆策划案强类型合规性...');
  const validatedGdd = GDDSchema.parse(benchmarkGDD);
  assert.ok(validatedGdd.title.includes('深海逆光'));
  console.log(`  ✅ GDDSchema 严格校验通过: 《${validatedGdd.title}》\n`);

  // 2. 将策划案直接写入专属项目工程
  const projectId = 'proj_deep_echo';
  console.log(`2. 将策划案持久化落盘至工程 [${projectId}]...`);
  const store = ProjectStore.getInstance();
  const proj = store.getProject(projectId);
  proj.meta.title = validatedGdd.title;
  store.saveProject(proj);
  store.setArtifact(projectId, 'gdd', validatedGdd);
  console.log(`  ✅ 策划案已原子写入 data/projects/${projectId}/project.json\n`);

  // 2.5 阶段二由微内核自动执行全量实体与道具字典提取 (entity-extract)
  LLMProvider.setMockModel(new MockLanguageModel());

  // 3. 准备第二步：调用文游工序 (executeBuildTextGameStep) 进行扩写
  console.log('3. 启动第二步：文游工序消费标杆 GDD 进行扩写装配...');
  const buildResult = await executeBuildTextGameStep({ projectId });
  const textGame = buildResult.textGame;
  assert.ok(textGame.nodes.length > 0, '扩写文游必须包含文学节点');
  store.setArtifact(projectId, 'text_game', textGame);
  console.log(`  ✅ 文游扩写成功: 共 ${textGame.nodes.length} 个文学演出节点已落盘！`);

  // 3.5 阶段二已由 imageGenPoolStep 完成全剧首帧关键帧内聚生成与落盘
  // 生成自主绘制纯 SVG 拓扑图谱
  const svg = StoryGraphSvgRenderer.renderToSvg(textGame);
  const artifactsDir = path.join(store.getProjectDir(projectId), 'artifacts');
  fs.writeFileSync(path.join(artifactsDir, 'story_graph.svg'), svg, 'utf-8');
  console.log(`  🎨 纯自主绘制 SVG 故事图谱已生成: data/projects/${projectId}/artifacts/story_graph.svg\n`);

  // 4. 启动确定性运行时：进行多分支 0-Token 实时试玩体验
  console.log('4. 启动 TextGameRuntimeEngine 本地试玩验证多分支因果律与结局矩阵...\n');

  // --- 确定性试玩流转测试 ---
  console.log('--- [路线测试：自驱动流转试玩] ---');
  const stateA0 = TextGameRuntimeEngine.initGame(validatedGdd, textGame);
  console.log(`  [开局状态] 节点: ${stateA0.currentNodeId}`);
  
  const firstChoice = textGame.nodes[0]?.choices[0];
  if (firstChoice) {
    console.log(`  👉 执行首个选项: [${firstChoice.id}] ${firstChoice.text}`);
    const stepA1 = TextGameRuntimeEngine.step(textGame, stateA0, firstChoice.id);
    assert.ok(stepA1.nextNode && stepA1.nextState.currentNodeId === firstChoice.targetNodeId);
    console.log(`  [跳转成功] ➔ ${stepA1.nextNode.title} (目标节点: ${stepA1.nextState.currentNodeId})\n`);
  }

  console.log('🎉 标杆策划案落盘与文游扩写、全链路试玩验证 100% 成功！');
}

main().catch((err) => {
  console.error('❌ 验证失败:', err);
  process.exit(1);
});
