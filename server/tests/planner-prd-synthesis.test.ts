/**
 * tests/planner-prd-synthesis.test.ts
 * 策划子工作流 Step 4: 全案策划案汇总与状态机拓扑装配工序单元测试
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStoryGraph,
  formatGddPrdToMarkdown,
  executePrdSynthesisStep,
  type PrdSynthesisInput,
  type GameDesignPrd,
} from '../src/agents/planner/steps/prd-synthesis/index.js';
import type { SlicedClipNode } from '../src/agents/planner/steps/interaction-slicing/schema.js';
import type { DerivedBranchNode } from '../src/agents/planner/steps/branch-derivation/schema.js';

describe('Planner Step 4: PRD Synthesis & StoryGraph DAG Unit Tests', () => {
  const dummyClips: SlicedClipNode[] = [
    {
      clipId: 'clip_01',
      level: 1,
      title: '暴雨走廊',
      narrativeText: '夜雀快步穿过走廊，维克托铁手按住公文包。',
      isEnding: false,
      branchCut: {
        cutId: 'cut_01',
        mainlineChoice: '交出钥匙示弱',
        branchChoice: '拔枪背刺反抗',
        conflictSummary: '正面冲突还是暂避锋芒',
      },
    },
    {
      clipId: 'clip_02',
      level: 2,
      title: '掉包盲区',
      narrativeText: '维克托背身点烟，三秒视野盲区。',
      isEnding: true,
    },
  ];

  const dummyBranches: DerivedBranchNode[] = [
    {
      cutId: 'cut_01',
      sourceClipId: 'clip_01',
      level: 1,
      choiceText: '拔枪背刺反抗',
      branchTitle: '暴雨喋血',
      narrativeText: '夜雀反手拔枪，却被维克托机械重臂轰飞，当场暴毙。',
      resolutionType: 'ENDING',
      endingType: 'BE',
      endingTitle: '暴雨喋血',
      verdict: '在绝对力量前，冲动的拔枪不过是自掘坟墓。',
      rewindTargetClipId: 'clip_01',
    },
  ];

  it('1. buildStoryGraph 纯算法必须构建 100% 形式化闭环的 DAG', () => {
    const graph = buildStoryGraph(dummyClips, dummyBranches);

    assert.equal(graph.startNodeId, 'clip_01');
    assert.equal(graph.nodes.length, 5); // clip_01, clip_02, goldenEnding, branch_cut_01, ending_cut_01 => 5 nodes
    // Nodes check
    const clip1Node = graph.nodes.find((n) => n.nodeId === 'clip_01');
    const branch1Node = graph.nodes.find((n) => n.nodeId === 'branch_cut_01');
    const beEndingNode = graph.nodes.find((n) => n.nodeId === 'ENDING_cut_01');

    assert.ok(clip1Node);
    assert.ok(branch1Node);
    assert.ok(beEndingNode);

    // Edges check
    const rewindEdge = graph.edges.find((e) => e.edgeType === 'REWIND');
    assert.ok(rewindEdge);
    assert.equal(rewindEdge.fromNodeId, 'ENDING_cut_01');
    assert.equal(rewindEdge.toNodeId, 'clip_01');
  });

  it('2. formatGddPrdToMarkdown 确定性渲染器必须输出符合规范的 Markdown 策划案', () => {
    const dummyPrd: GameDesignPrd = {
      gameMeta: {
        title: '深海逆光：临界博弈',
        genre: '赛博朋克 / 谍战博弈',
        playerIdentity: '代号“夜雀”的双面特工',
        oneSentenceHook: '3分钟高压生死逃脱！',
        coreMechanicSummary: '每幕绝境 ➔ 弹出选择 ➔ 动线流转',
      },
      uiShellSpecification: {
        hudElements: [{ name: '怀疑度', position: '顶部居中', description: '危险进度条' }],
        viewportRatio: '9:16',
        subtitleRules: '每屏1~2句精炼台词',
        interactionZoneRules: '底部卡片式弹出',
      },
      interactionMechanics: [
        {
          name: '幕末二选一',
          triggerType: 'BRANCH_CHOICE',
          operationDescription: '底部弹出两个选择卡片，玩家点击决定行动走向',
          playerFeel: '自主掌控主角命运的分流感',
        },
      ],
      gameFeelAndFeedback: {
        haptics: '点击选项时一次轻微震动',
        floatingTexts: '选中项高亮描边',
        soundEffects: '机械下压音效',
      },
    };

    const md = formatGddPrdToMarkdown(dummyPrd, dummyClips, dummyBranches);
    assert.ok(md.includes('# 《深海逆光：临界博弈》互动短剧游戏策划案 (PRD)'));
    assert.ok(md.includes('玩家通关动线总览表'));
    assert.ok(md.includes('暴雨喋血'));
    assert.ok(!md.includes('三大主干心流路线'));
    assert.ok(md.includes('未生成 StoryGraph'));
  });

  it('3. executePrdSynthesisStep 纯认知执行应返回完整的 PRD 和 Graph', async () => {
    const input: PrdSynthesisInput = {
      title: '深海逆光：临界博弈',
      clips: dummyClips,
      branches: dummyBranches,
    };

    const output = await executePrdSynthesisStep(input);

    assert.equal(output.title, '深海逆光：临界博弈');
    assert.ok(output.prd.gameMeta.oneSentenceHook);
    assert.ok(output.graph.nodes.length >= 3);
    assert.ok(output.graph.edges.length >= 2);
  });
});
