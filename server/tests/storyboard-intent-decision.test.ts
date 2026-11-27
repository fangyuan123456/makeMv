import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { StoryboardAgent } from '../src/agents/storyboard/agent.js';
import { getStoryboardContext } from '../src/agents/storyboard/context.js';
import { shotVideoTool } from '../src/tools/film-production/shot-video-tool/index.js';
import { shootingScriptTool } from '../src/tools/film-production/shooting-script-tool/index.js';

test('验证分镜总导演通用意图决策与视频推演闭环 (Universal Shot Intent Decision)', async (t) => {
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
          videoPrompt: 'Ref2V 时间戳多机位动态推演',
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
    assert.ok(sysPrompt.includes('诉求精准定位'), '系统提示词中必须包含精准定位');
    assert.ok(sysPrompt.includes('视频动态渲染'), '必须包含视频渲染诉求');
    assert.ok(sysPrompt.includes(shotVideoTool.toolName), '系统提示词必须包含 shotVideoTool');
    assert.ok(sysPrompt.includes(shootingScriptTool.toolName), '系统提示词必须包含 shootingScriptTool');
  });

  await t.test('3. 单步视频渲染意图解析器：当传入 params 时自动补全 clipId', () => {
    const rawIntent = {
      action: 'propose',
      targetTool: shotVideoTool.toolName,
      title: '渲染镜头 c1-01 视频',
      description: '按当前动态提示词渲染 Ref2V 视频',
      params: {
        shotId: 'c1-01',
        force: true,
      },
    };

    const resolved = (agent as any).resolveDirectorIntent(rawIntent);
    assert.equal(resolved.tool, shotVideoTool.toolName);
    assert.equal(resolved.params.clipId, 'c1', '应自动补全 clipId');
  });
});