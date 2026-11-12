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
import {
  executeImageGenPoolStep,
  convertScenesToTextGameArtifact,
  type GlobalEntities,
  type SingleSceneJson,
  type TextGameArtifact,
} from '../src/agents/text-game/index.js';

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

test('ComfyUI 视频工作流模板 (comfyui_i2v.json) 与 videoGenerateTool 契约测试', () => {
  const provider = new ComfyUIMediaProvider();
  const i2vPath = provider.resolveTemplatePath('comfyui_i2v.json');
  assert.ok(fs.existsSync(i2vPath), 'comfyui_i2v.json 模板文件必须存在');

  const rawJson = JSON.parse(fs.readFileSync(i2vPath, 'utf-8'));
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

test('text-game 先定妆（人物+道具）→ 再以尾帧提示词+全部所需定妆参考图生成单张场景图', async () => {
  const calls: Array<{ prompt: string; options?: ImageGenerationOptions }> = [];
  const spyProvider: IImageProvider = {
    name: 'spy-mock',
    async generateImage(prompt: string, options?: ImageGenerationOptions): Promise<string> {
      calls.push({ prompt, options });
      return new MockImageProvider().generateImage(prompt, options);
    },
  };

  MediaProviderFactory.setImageProvider(spyProvider);
  try {
    const entities: GlobalEntities = {
      artStyle: '古风写实影视质感，柔和雨夜暖灯散射光',
      characters: [
        {
          characterId: 'char_shen_yan',
          name: '沈砚',
          identity: '茶馆掌柜',
          appearanceSummary: '青衫束发，温润沉稳，右手常按柜台算盘',
          promptZh: '角色定妆照，青衫束发茶馆掌柜，中性浅灰无缝背景',
          promptEn: 'character look-dev portrait of teahouse keeper',
        },
        {
          characterId: 'char_guest_gray',
          name: '灰衫中年人',
          identity: '官面探子',
          appearanceSummary: '湿透的灰布长衫，神色冷峻，左手攥断骨油纸伞',
          promptZh: '角色定妆照，灰布长衫冷峻中年人，中性浅灰无缝背景',
          promptEn: 'character look-dev portrait of gray-robed investigator',
        },
      ],
      items: [
        {
          itemId: 'item_celadon_cup',
          name: '青瓷盏',
          description: '茶馆桌面点触互动核心信物',
          appearanceSummary: '冰裂纹青瓷茶盏，盏沿微温泛翠光',
          promptZh: '道具定妆特写，单只冰裂纹青瓷茶盏，中性浅灰无缝背景',
          promptEn: 'prop look-dev close-up of celadon teacup',
        },
      ],
    };

    const scenes: SingleSceneJson[] = [
      {
        sceneId: 'S1',
        level: 1,
        title: '雨夜来客',
        targetVideoClipName: 'S1.mp4',
        estimatedDurationSeconds: 8,
        entityIds: ['char_shen_yan', 'char_guest_gray', 'item_celadon_cup'],
        visualAnchor: {
          endFrameMoment: '尾帧定格：沈砚搁下两只青瓷盏，灰衫中年人立于柜台前盯视茶盏，即将触发点触搜查。',
          cameraAngle: '中景微俯，聚焦柜台茶盏与两人对峙视线',
          lighting: '柜台暖黄油灯与窗外冷蓝雨光对比',
          promptZh: '雨夜茶馆柜台尾帧单幅电影画面，沈砚立于柜台后，灰衫中年人立于桌前，柜台正中放着青瓷盏',
          promptEn: 'end-frame teahouse counter shot with both characters and celadon teacup',
        },
        screenplay: {
          storyContext: '雨夜茶馆来客对峙。',
          videoActionDescription: '镜头慢推至柜台青瓷盏。',
          dialogues: [{ speaker: '灰衫中年人', line: '掌柜的，讨碗热茶。' }],
        },
        interaction: {
          steps: [],
          wiring: [],
          endings: [],
          choices: [],
          isEnding: false,
        },
      },
      {
        sceneId: 'S2',
        level: 2,
        title: '檐下空镜',
        targetVideoClipName: 'S2.mp4',
        estimatedDurationSeconds: 5,
        entityIds: [],
        visualAnchor: {
          endFrameMoment: '尾帧定格：雨夜檐角水帘倾泻，青石板街空无一人。',
          cameraAngle: '远景平视',
          lighting: '冷蓝雨夜微光',
          promptZh: '雨夜江南茶馆屋檐水帘与青石板空镜尾帧',
          promptEn: 'empty rainy cobblestone street under teahouse eaves end-frame shot',
        },
        screenplay: {
          storyContext: '雨势骤紧。',
          videoActionDescription: '檐角雨水滴落慢镜头。',
          dialogues: [{ speaker: '旁白', line: '雨，还在下。' }],
        },
        interaction: {
          steps: [],
          wiring: [],
          endings: [],
          choices: [],
          isEnding: true,
        },
      },
    ];

    const out = await executeImageGenPoolStep({
      projectId: TEST_PROJ_ID,
      scenes,
      entities,
      concurrency: 2,
      force: true,
    });

    // 1. 先定妆（2 角色 + 1 道具 = 前 3 次调用均为 character_t2i，且无 character_three_view）
    assert.equal(calls.length, 5, '2角色定妆 + 1道具定妆 + 2幕尾帧场景图 = 共5次生图调用');
    const lookDevCalls = calls.slice(0, 3);
    for (const c of lookDevCalls) {
      assert.equal(c.options?.mode, 'character_t2i', '人物与道具定妆必须全部走 character_t2i');
      assert.equal(c.options?.referenceImageUrls, undefined, '定妆阶段应纯提示词生图');
    }

    // 2. S1 尾帧场景图：必须一次传入全部 3 个定妆照（2 角色 + 1 道具），绝不拼装、绝不丢道具
    const s1Call = calls.find((c) => c.prompt.includes('雨夜茶馆柜台尾帧'));
    assert.ok(s1Call, '必须执行 S1 尾帧生图');
    assert.equal(s1Call.options?.mode, 'scene_ref2i');
    assert.equal(s1Call.options?.size, '768*1344');
    assert.equal(s1Call.options?.referenceImageUrls?.length, 3, 'S1 必须同时注入 2 角色 + 1 道具定妆图');
    assert.ok(s1Call.prompt.includes('<image1> 为角色【沈砚】定妆基准'));
    assert.ok(s1Call.prompt.includes('<image2> 为角色【灰衫中年人】定妆基准'));
    assert.ok(s1Call.prompt.includes('<image3> 为道具【青瓷盏】定妆基准'));
    assert.ok(s1Call.prompt.includes('【尾帧定格画面】'));

    // 3. S2 纯空镜尾帧：同系 character_t2i 768*1344
    const s2Call = calls.find((c) => c.prompt.includes('檐角水帘'));
    assert.ok(s2Call, '必须执行 S2 空镜尾帧生图');
    assert.equal(s2Call.options?.mode, 'character_t2i');
    assert.equal(s2Call.options?.size, '768*1344');

    // 4. 产物字段回填与 TextGameArtifact 投影对齐
    const s1Out = out.scenes.find((s) => s.sceneId === 'S1')!;
    assert.ok(s1Out.visualAnchor.sceneImagePath?.includes('S1_end.'));
    assert.ok(s1Out.visualAnchor.sceneImageUrl?.startsWith(`/media/${TEST_PROJ_ID}/assets/scenes/S1_end.`));
    assert.equal(Object.keys(s1Out.entityRefs || {}).length, 3);

    const artifact = convertScenesToTextGameArtifact('雨夜茶馆测试', out.scenes, undefined, out.entities);
    assert.equal(artifact.nodes[0].visual?.imageUrl, s1Out.visualAnchor.sceneImageUrl);
    assert.deepEqual(artifact.nodes[0].visual?.entityNames, ['沈砚', '灰衫中年人', '青瓷盏']);
  } finally {
    MediaProviderFactory.setImageProvider(new MockImageProvider());
  }
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

