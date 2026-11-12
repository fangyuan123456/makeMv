/**
 * tests/test-stage2-real-probe.ts
 * 阶段二真实全闭环联调探针 (Stage 2 End-to-End Real Probe)
 */

import path from 'path';
import fs from 'fs';
import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { STAGE, PLANNER_STEP, readArtifactFile } from '../src/project-store/artifact-fs.js';
import { parseUniversalPrdFromMarkdown } from '../src/workflows/steps/build-text-game.step.js';
import {
  runTextGameWorkflow,
  validateScenePointers,
  type SingleSceneJson,
} from '../src/agents/text-game/index.js';

async function runStage2Probe() {
  const projectId = 'proj_interactive_1794289250706';
  const store = ProjectStore.getInstance();
  const project = store.getProject(projectId);

  if (!project) {
    throw new Error(`找不到项目: ${projectId}`);
  }

  const prdMarkdown = readArtifactFile(projectId, 'delivery', STAGE.planner, PLANNER_STEP.prd, 'prd.md');
  const storyMarkdown = readArtifactFile(projectId, 'delivery', STAGE.planner, PLANNER_STEP.prd, 'story.md');

  if (!prdMarkdown || !storyMarkdown) {
    throw new Error(`项目 [${projectId}] 缺少 Stage 1 Step 4 交付资产 (prd.md, story.md)`);
  }

  const prd = parseUniversalPrdFromMarkdown(prdMarkdown);
  const title = prd.gameTitle || project.meta.title;

  console.log(`[Stage2 Probe] 开始运行阶段二真实流水线...`);
  console.log(`[Stage2 Probe] 项目: ${projectId} - 《${title}》`);
  console.log(`[Stage2 Probe] PRD 片段总数: ${prd.clips.length}`);

  const startTime = Date.now();
  const result = await runTextGameWorkflow({
    projectId,
    title,
    prd,
    storyMarkdown,
    concurrency: 4,
  });

  const durationMs = Date.now() - startTime;
  console.log(`\n========================================`);
  console.log(`[Stage2 Probe] 阶段二流水线运行成功！耗时: ${durationMs}ms`);
  console.log(`========================================`);

  const projectDir = store.getProjectDir(projectId);
  const scenesDir = path.resolve(projectDir, 'scenes');
  const textGameDir = path.resolve(projectDir, 'text-game');

  // 1. 验证 scenes/ 目录文件
  console.log(`\n[Stage2 Probe] 1. 验证分幕独立 JSON 切片资产 (1:1 锚定未来视频)...`);
  const sceneFiles = fs.readdirSync(scenesDir).filter((f) => f.endsWith('.json'));
  console.log(`- 磁盘生成 JSON 文件数: ${sceneFiles.length}`);
  console.log(`- 文件列表: ${sceneFiles.join(', ')}`);

  if (!fs.existsSync(path.resolve(scenesDir, 'entities.json'))) {
    throw new Error('缺少 entities.json 资产');
  }

  // 2. 验证指针无死链接
  console.log(`\n[Stage2 Probe] 2. 验证指针自驱动闭环 (Zero Manifest & No Dead Links)...`);
  const loadedScenes: SingleSceneJson[] = [];
  for (const f of sceneFiles) {
    if (f === 'entities.json') continue;
    const content = JSON.parse(fs.readFileSync(path.resolve(scenesDir, f), 'utf-8'));
    loadedScenes.push(content);
  }

  const validation = validateScenePointers(loadedScenes);
  if (!validation.valid) {
    throw new Error(`指针校验失败: ${validation.errors.join('; ')}`);
  }
  console.log(`- 所有 ${loadedScenes.length} 幕独立切片指针 100% 闭环无死链接！`);

  // 3. 验证尾帧场景图回填与本地持久化
  console.log(`\n[Stage2 Probe] 3. 验证尾帧场景图物理落盘与回填...`);
  for (const scene of loadedScenes) {
    const bgPath = scene.visualAnchor.sceneImagePath;
    if (!bgPath) {
      throw new Error(`场景 [${scene.sceneId}] 缺少 sceneImagePath`);
    }
    const absBgPath = path.resolve(projectDir, bgPath);
    if (!fs.existsSync(absBgPath)) {
      throw new Error(`场景 [${scene.sceneId}] 尾帧场景图文件未落盘: ${absBgPath}`);
    }
  }
  console.log(`- 所有场景尾帧场景图物理落盘完整，已回填相对路径！`);

  // 4. 验证面向对象源码生成与打包产物
  console.log(`\n[Stage2 Probe] 4. 验证面向对象源码与独立体验座舱...`);
  const expectedSrcFiles = ['SceneTypes.ts', 'StateBlackboard.ts', 'SceneLoader.ts', 'InteractiveShell.ts', 'main.ts'];
  for (const srcFile of expectedSrcFiles) {
    const p = path.resolve(textGameDir, 'src', srcFile);
    if (!fs.existsSync(p)) {
      throw new Error(`缺少生成的源码文件: ${srcFile}`);
    }
  }
  console.log(`- TypeScript 面向对象源码完整: ${expectedSrcFiles.join(', ')}`);

  const bundleJsPath = path.resolve(textGameDir, 'bundle.js');
  const indexHtmlPath = path.resolve(textGameDir, 'index.html');
  if (!fs.existsSync(bundleJsPath) || !fs.existsSync(indexHtmlPath)) {
    throw new Error('缺少 bundle.js 或 index.html 打包产物');
  }
  const bundleStat = fs.statSync(bundleJsPath);
  const indexStat = fs.statSync(indexHtmlPath);
  console.log(`- bundle.js 尺寸: ${(bundleStat.size / 1024).toFixed(1)} KB`);
  console.log(`- index.html 尺寸: ${indexStat.size} Bytes`);

  console.log(`\n========================================`);
  console.log(`[Stage2 Probe] 全部验证通过！0 报错！`);
  console.log(`========================================\n`);
}

// 真实算力探针不得混进 CI：硬编码项目 ID + 真调 LLM/ComfyUI，
// 必须显式 RUN_REAL_PROBE=1 才执行；npm test 里默认跳过，避免前面测试修好后烧算力。
if (process.env.RUN_REAL_PROBE === '1') {
  runStage2Probe().catch((err) => {
    console.error('[Stage2 Probe] 探测失败:', err);
    process.exit(1);
  });
} else {
  console.log('[Stage2 Probe] 已跳过（真实算力探针，需显式设置 RUN_REAL_PROBE=1）');
}
