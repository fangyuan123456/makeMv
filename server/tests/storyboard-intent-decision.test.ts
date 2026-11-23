import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { StoryboardAgent } from '../src/agents/storyboard/agent.js';
import { getStoryboardContext } from '../src/agents/storyboard/context.js';
import {
  buildShotKeyframePrompt,
  type KeyframeReferenceEntry,
} from '../src/tools/film-production/shot-keyframe-tool/steps/01-render/prompt.js';
import { shotKeyframeTool } from '../src/tools/film-production/shot-keyframe-tool/index.js';
import { storyboardBreakdownTool } from '../src/tools/film-production/storyboard-breakdown-tool/index.js';

test('🎬 验证分镜总导演通用意图决策与画面微调闭环 (Universal Shot Intent Decision)', async (t) => {
  const store = ProjectStore.getInstance();
  const projectId = 'test_intent_decision_proj_001';
  const projectDir = store.getProjectDir(projectId);

  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
  fs.mkdirSync(projectDir, { recursive: true });

  const originalLongPrompt = '特写镜头，全息投影中的机器人助手肃立于指挥官身旁，机体散发冷蓝色柔光，神情严肃注视着前方的控制台星图，背景闪烁着仪表盘的微光，电影级景深虚化';

  const mockStoryboards = [
    {
      clipId: 'c1',
      shots: [
        {
          shotId: 'c1-01',
          shotType: 'CLOSE_UP',
          cameraMovement: 'slow-push',
          durationSec: 4,
          characters: ['Athena-K'],
          firstFramePrompt: originalLongPrompt,
          firstFrameImageUrl: '/media/test/c1-01_first.png',
        },
      ],
    },
  ];

  store.setArtifact(projectId, 'storyboards', mockStoryboards);
  store.setArtifact(projectId, 'universal_prd', {
    clips: [{ id: 'c1', title: '星舰指挥室' }],
  });

  const agent = new StoryboardAgent({ projectId, clipId: 'c1' });

  await t.test('1. 上下文事实注入完整性：消除 80 字符截断，完整呈现首帧原词供导演事实审校', () => {
    const context = getStoryboardContext(projectId, 'c1');
    assert.ok(context.shotsSummary.includes(originalLongPrompt), '镜头摘要中必须包含完整首帧提示词，不应截断');
    assert.ok(!context.shotsSummary.includes('...'), '不应存在 slice(0, 80) 后的省略号截断');
  });

  await t.test('2. 系统提示词规则矩阵：明确影视三级解耦决策漏斗与单一目标派发', () => {
    const sysPrompt = (agent as any).assembleSystemPrompt();
    assert.ok(sysPrompt.includes('事实审校与意图分流决策漏斗'), '系统提示词中必须包含决策漏斗');
    assert.ok(sysPrompt.includes('诉求 4：纯出图/重绘/局部姿态修复'), '必须包含局部姿态出图微调诉求');
    assert.ok(sysPrompt.includes(shotKeyframeTool.toolName), '系统提示词必须包含 shotKeyframeTool');
    assert.ok(sysPrompt.includes(storyboardBreakdownTool.toolName), '系统提示词必须包含 storyboardBreakdownTool');
  });

  await t.test('3. 单步画面微调意图解析器：当传入 instruction 时自动标准化 force: true 与 clipId', () => {
    const rawIntent = {
      action: 'propose',
      targetTool: shotKeyframeTool.toolName,
      title: '定向微调镜头 c1-01 首帧站姿',
      description: '保持原画面整体构图与光影，将机器人站姿微调为双脚自然并拢直立，消除交叉腿',
      params: {
        shotId: 'c1-01',
        instruction: '机器人不要双脚交叉，站姿改为双脚自然并拢直立',
      },
    };

    const resolved = (agent as any).resolveDirectorIntent(rawIntent);
    assert.equal(resolved.tool, shotKeyframeTool.toolName);
    assert.equal(resolved.params.clipId, 'c1', '应自动补全 clipId');
    assert.equal(resolved.params.force, true, '微调画面必须强制开启 force: true 以触发重跑');
    assert.equal(resolved.params.instruction, '机器人不要双脚交叉，站姿改为双脚自然并拢直立');
  });

  await t.test('4. 关键帧生图 Prompt 装配：存在 instruction 时精准注入定向微调区块，锁定原图基准', () => {
    const shot = mockStoryboards[0].shots[0] as any;
    const baseReferences: KeyframeReferenceEntry[] = [
      { role: 'base_frame', url: '/media/test/c1-01_first.png' },
    ];
    const instruction = '保持原机位构图，机器人站姿改为双脚自然直立，消除交叉腿';

    const promptWithInstruction = buildShotKeyframePrompt(shot, baseReferences, shot.firstFramePrompt, instruction);
    assert.ok(
      promptWithInstruction.includes('【画面微调要求】'),
      'Prompt 中必须包含定向微调指导区块'
    );
    assert.ok(promptWithInstruction.includes(instruction), 'Prompt 中必须包含具体的微调指令内容');
    assert.ok(promptWithInstruction.includes(originalLongPrompt), 'Prompt 中应保留本镜基础画面设定');

    // 对比：无 instruction 时绝不产生微调区块
    const normalPrompt = buildShotKeyframePrompt(shot, baseReferences, shot.firstFramePrompt);
    assert.ok(
      !normalPrompt.includes('【画面微调要求】'),
      '普通出图时不应包含定向微调区块'
    );
  });

  await t.test('5. 末帧定向微调对称性：末帧传入 instruction 时同样装配定向微调要求并保留末帧基础画面', () => {
    const shotWithLast = {
      ...mockStoryboards[0].shots[0],
      lastFramePrompt: '中景镜头，机器人微微躬身指向星图右侧，机体散发冷蓝光',
      lastFrameImageUrl: '/media/test/c1-01_last.png',
    } as any;
    const lastBaseReferences: KeyframeReferenceEntry[] = [
      { role: 'base_frame', url: '/media/test/c1-01_last.png' },
    ];
    const lastInstruction = '手指方向稍微偏左下方一点，保持机体光影';

    const lastPrompt = buildShotKeyframePrompt(
      shotWithLast,
      lastBaseReferences,
      shotWithLast.lastFramePrompt,
      lastInstruction
    );

    assert.ok(
      lastPrompt.includes('【画面微调要求】'),
      '末帧微调必须包含定向微调要求区块'
    );
    assert.ok(lastPrompt.includes(lastInstruction), '末帧微调必须包含具体指令内容');
    assert.ok(lastPrompt.includes(shotWithLast.lastFramePrompt), '末帧微调必须保留末帧基础画面提示词');
  });
});
