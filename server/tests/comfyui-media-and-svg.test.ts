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
  MediaDownloader,
  MediaResolver,
  MediaProviderFactory,
  MockImageProvider,
  StoryGraphSvgRenderer,
} from '../src/media/index.js';
import type { IImageProvider, ImageGenerationOptions } from '../src/media/providers/ImageProvider.js';
import { imageGenerateTool, videoGenerateTool } from '../src/tools/index.js';
import { ProjectStore } from '../src/project-store/ProjectStore.js';

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

  // 回归：带点号的支线片段名（如 S1.1_end / S1.2_end）绝不能被截断成 S1.svg
  const branchRes1 = await (imageGenerateTool.execute as any)({
    context: {
      projectId: TEST_PROJ_ID,
      prompt: '支线一尾帧画面',
      subfolder: 'scenes',
      customFilename: 'S1.1_end',
    },
  });
  const branchRes2 = await (imageGenerateTool.execute as any)({
    context: {
      projectId: TEST_PROJ_ID,
      prompt: '支线二尾帧画面',
      subfolder: 'scenes',
      customFilename: 'S1.2_end',
    },
  });
  assert.equal(path.basename(branchRes1.diskPath), 'S1.1_end.svg');
  assert.equal(path.basename(branchRes2.diskPath), 'S1.2_end.svg');
  assert.ok(fs.existsSync(branchRes1.diskPath));
  assert.ok(fs.existsSync(branchRes2.diskPath));
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

test('ComfyUI 视频工作流模板 (comfyui_h3_ref2v_6step.json) 与 videoGenerateTool 契约测试', () => {
  const provider = new ComfyUIMediaProvider();
  const ref2vPath = provider.resolveTemplatePath('comfyui_h3_ref2v_6step.json');
  assert.ok(fs.existsSync(ref2vPath), 'comfyui_h3_ref2v_6step.json 模板文件必须存在');

  const rawJson = JSON.parse(fs.readFileSync(ref2vPath, 'utf-8'));
  const apiPrompt = ensureApiPromptFormat(rawJson);

  // 1. 测试提示词注入视频工作流
  const promptInjected = ComfyUITopologyInjector.injectPrompts(
    apiPrompt,
    '深海潜艇缓慢推进，微表情冷酷注视',
    'low quality, flicker'
  );
  assert.ok(promptInjected, '视频工作流中提示词应成功注入');

  // 2. 测试随机种子注入
  const seedInjected = ComfyUITopologyInjector.injectSeed(apiPrompt, 888888);
  assert.ok(seedInjected, '随机种子应成功注入到视频采样器节点');

  // 3. 测试工具定义与属性
  assert.equal(videoGenerateTool.id, 'generate_video');
  assert.ok(videoGenerateTool.description.includes('视频'));
});

test('MediaDownloader 保留多级相对子目录 (assets/entities 与 assets/scenes) 并拦截路径穿越', async () => {
  const originalFetch = globalThis.fetch;
  const pngStub = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  globalThis.fetch = (async () =>
    new Response(pngStub, {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    })) as typeof fetch;

  try {
    const downloader = MediaDownloader.getInstance();
    const projectDir = ProjectStore.getInstance().getProjectDir(TEST_PROJ_ID);

    const entityUrl = await downloader.downloadToProject(
      TEST_PROJ_ID,
      'http://offline-stub.local/char_shen.png',
      'assets/entities',
      'char_shen.png'
    );
    assert.equal(entityUrl, `/media/${TEST_PROJ_ID}/assets/entities/char_shen.png`);
    assert.equal(fs.existsSync(path.resolve(projectDir, 'assets', 'entities', 'char_shen.png')), true);

    const sceneUrl = await downloader.downloadToProject(
      TEST_PROJ_ID,
      'http://offline-stub.local/S1_end.png',
      'assets/scenes',
      'S1_end.png'
    );
    assert.equal(sceneUrl, `/media/${TEST_PROJ_ID}/assets/scenes/S1_end.png`);
    assert.equal(fs.existsSync(path.resolve(projectDir, 'assets', 'scenes', 'S1_end.png')), true);

    await assert.rejects(
      () => downloader.downloadToProject(TEST_PROJ_ID, 'http://offline-stub.local/bad.png', 'assets/../secret', 'bad.png'),
      /非法子目录路径穿越/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

