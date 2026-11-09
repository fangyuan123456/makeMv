/**
 * tests/comfyui-media-and-svg.test.ts
 * ComfyUI 算力提供商、纯物理工具、MediaResolver 安全沙箱与自绘 SVG 图谱测试套件
 */

process.env.NODE_ENV = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  ComfyUIMediaProvider,
  ComfyUITopologyInjector,
  ensureApiPromptFormat,
  MediaResolver,
  MediaProviderFactory,
  StoryGraphSvgRenderer,
} from '../src/media/index.js';
import { imageGenerateTool } from '../src/tools/index.js';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import type { TextGameArtifact } from '../src/agents/text-game/schema.js';

const TEST_PROJ_ID = `test_media_${Date.now()}`;

test.after(() => {
  ProjectStore.getInstance().deleteProject(TEST_PROJ_ID);
});

test('ComfyUI 拓扑注入器 (ComfyUITopologyInjector) 单元测试', () => {
  const provider = new ComfyUIMediaProvider();
  const t2iPath = provider.resolveTemplatePath('comfyui_t2i.json');
  assert.ok(fs.existsSync(t2iPath), 'comfyui_t2i.json 模板文件必须存在');

  const rawJson = JSON.parse(fs.readFileSync(t2iPath, 'utf-8'));
  const apiPrompt = ensureApiPromptFormat(rawJson);

  // 1. 测试提示词注入
  const promptInjected = ComfyUITopologyInjector.injectPrompts(
    apiPrompt,
    '深海观测站控制台，冷调青蓝荧光，高精电影特写',
    'low quality, blur'
  );
  assert.ok(promptInjected, '提示词应成功注入到对应文本编码节点中');

  // 2. 测试随机种子注入
  const seedInjected = ComfyUITopologyInjector.injectSeed(apiPrompt, 424242);
  assert.ok(seedInjected, '随机种子应成功注入到采样器节点中');

  // 3. 测试分辨率注入
  const sizeInjected = ComfyUITopologyInjector.injectImageSize(apiPrompt, '1280*720');
  assert.ok(sizeInjected, '画幅尺寸应成功注入');
});

test('纯物理生图工具 (imageGenerateTool) 与本地沙箱持久化闭环', async () => {
  const store = ProjectStore.getInstance();
  const proj = store.getProject(TEST_PROJ_ID);
  assert.ok(proj, '测试工程上下文必须就绪');

  // 执行 imageGenerateTool
  const result = await (imageGenerateTool.execute as any)({
    context: {
      projectId: TEST_PROJ_ID,
      prompt: '极地深海空间站舷窗，维克托博士的侧影，冷蓝微光',
      subfolder: 'keyframes',
      customFilename: 'shot_scene_01.svg',
    },
  });

  assert.equal(result.success, true);
  assert.ok(result.mediaUrl.startsWith(`/media/${TEST_PROJ_ID}/keyframes/`));

  // 验证真实文件在磁盘落盘且非空 (拒绝假收敛)
  assert.ok(fs.existsSync(result.diskPath), '生成的媒体文件必须真实落盘');
  assert.ok(fs.statSync(result.diskPath).size > 0, '落盘文件尺寸必须大于 0');

  // 验证 MediaResolver 路径解析与安全沙箱防穿越
  const resolved = MediaResolver.resolveDiskPath(result.mediaUrl);
  assert.equal(resolved.isValid, true);
  assert.equal(resolved.projectId, TEST_PROJ_ID);

  // 验证跨项目越权与路径穿越拦截
  const hackResolved = MediaResolver.resolveDiskPath(`/media/${TEST_PROJ_ID}/../../../etc/passwd`);
  assert.equal(hackResolved.isValid, false, '越权路径穿越必须被刚性拦截');
});

test('纯 SVG 拓扑图谱渲染器 (StoryGraphSvgRenderer) 闭环测试', () => {
  const mockArtifact: TextGameArtifact = {
    title: '测试深海互动文游',
    startNodeId: 'node_start',
    variables: {
      P_Suspicion: 10,
      Victor_Mind_Defense: 80,
    },
    nodes: [
      {
        id: 'node_start',
        title: '冷蓝色的深海舷窗',
        narrativeText: '你在极渊水下控制室苏醒，警报在头顶低沉鸣响。',
        visual: {
          scenePrompt: '水下观测站控制室，舷窗外深海微光',
          characterPrompt: '主角身着深潜服，神色凝重',
          composition: '第一人称中景，仪表盘指示灯微闪',
        },
        choices: [
          {
            id: 'c1',
            text: '立刻查验公文包',
            targetNodeId: 'node_briefcase',
            variableChanges: { P_Suspicion: 5 },
          },
          {
            id: 'c2',
            text: '保持静默观察维克托',
            targetNodeId: 'node_watch',
            variableChanges: { Victor_Mind_Defense: -5 },
          },
        ],
      },
      {
        id: 'node_briefcase',
        title: '公文包内的机密',
        narrativeText: '包内是一份带血的绝密档案。',
        choices: [
          {
            id: 'c3',
            text: '拔枪对准维克托',
            targetNodeId: 'node_end_confront',
          },
        ],
      },
      {
        id: 'node_watch',
        title: '无声的心理对峙',
        narrativeText: '维克托的手指在控制台有节奏地敲击。',
        choices: [
          {
            id: 'c4',
            text: '尝试破译终端密码',
            targetNodeId: 'node_end_hack',
          },
        ],
      },
      {
        id: 'node_end_confront',
        title: '结局：破晓绝杀',
        narrativeText: '枪声震碎了深海的沉寂。',
        isEnding: true,
        endingType: 'TE',
      },
      {
        id: 'node_end_hack',
        title: '结局：思维共振',
        narrativeText: '终端数据瞬间倾泻入脑。',
        isEnding: true,
        endingType: 'HE',
      },
    ],
  };

  const svg = StoryGraphSvgRenderer.renderToSvg(mockArtifact);

  assert.ok(svg.startsWith('<?xml'), 'SVG 必须包含 XML 标准头部');
  assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'), '必须包含合规 SVG 根标签');
  assert.ok(svg.includes('START'), '必须渲染 START 胶囊');
  assert.ok(svg.includes('TE') && svg.includes('HE'), '必须渲染分支结局徽章');
  assert.ok(svg.includes('path d="M'), '必须包含贝塞尔曲线连线');
  assert.ok(svg.includes('立刻查验公文包'), '必须包含抉择分支文本标注');
});
