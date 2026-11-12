/**
 * agents/text-game/steps/bundler/step.ts
 * 互动文游静态打包工序 (bundlerStep) - 基于 Mastra 官方微内核原生 Step
 *
 * 核心设计：
 * 1. 零外部运行时依赖：使用自带的 typescript 编译器 (ts.transpileModule) 编译为独立 bundle.js；
 * 2. 注入独立可玩入口：生成标准 index.html，浏览器打开即可试玩；
 * 3. 产物直接落盘到 data/projects/:projectId/text-game/。
 */

import { createStep } from '@mastra/core/workflows';
import path from 'path';
import fs from 'fs';
import ts from 'typescript';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { runTaskRecordedStep } from '../../../../workflow-engine/TaskStore.js';
import {
  BundlerInputSchema,
  BundlerOutputSchema,
  type BundlerInput,
  type BundlerOutput,
} from './schema.js';
import {
  getSceneTypesCode,
  getStateBlackboardCode,
  getSceneLoaderCode,
  getInteractiveShellCode,
  getMainEntryCode,
} from '../codegen/index.js';

function stripModuleDirectives(code: string): string {
  return code
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^import\s+.*$/gm, '')
    .replace(/^export\s+/gm, '');
}

export function assembleStandaloneTs(options?: {
  startNodeId?: string;
  initialState?: Record<string, any>;
}): string {
  // 组装无外部 import/export 依赖的浏览器自包含纯原生脚本
  const cleanTypes = stripModuleDirectives(getSceneTypesCode());
  const cleanBlackboard = stripModuleDirectives(getStateBlackboardCode());
  const cleanLoader = stripModuleDirectives(getSceneLoaderCode());
  const cleanShell = stripModuleDirectives(getInteractiveShellCode());
  const cleanMain = stripModuleDirectives(getMainEntryCode(options));

  return `
// ==========================================
// 互动影游座舱独立运行时 (Standalone Browser Runtime)
// ==========================================

${cleanTypes}

${cleanBlackboard}

${cleanLoader}

${cleanShell}

${cleanMain}
`;
}

export function compileTsToJs(tsCode: string): string {
  const result = ts.transpileModule(tsCode, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
      removeComments: false,
    },
  });
  return result.outputText;
}

export function generateIndexHtml(title: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>${title} - 互动短剧体验座舱</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    html, body {
      width: 100%;
      height: 100%;
      background-color: #000;
      color: #fff;
      display: flex;
      justify-content: center;
      align-items: center;
      overflow: hidden;
    }
    #app {
      width: 100%;
      height: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
    }
  </style>
</head>
<body>
  <div id="app"></div>
  <script src="./bundle.js"></script>
</body>
</html>
`;
}

export async function executeBundlerStep(input: BundlerInput): Promise<BundlerOutput> {
  const { projectId, title, startNodeId, initialState } = input;
  const store = ProjectStore.getInstance();
  const projectDir = store.getProjectDir(projectId);

  const textGameDir = path.resolve(projectDir, 'text-game');
  fs.mkdirSync(textGameDir, { recursive: true });

  // 1. 组装与编译 bundle.js
  const combinedTs = assembleStandaloneTs({ startNodeId, initialState });
  const compiledJs = compileTsToJs(combinedTs);
  const bundlePath = path.resolve(textGameDir, 'bundle.js');
  fs.writeFileSync(bundlePath, compiledJs, 'utf-8');

  // 2. 生成 index.html
  const htmlContent = generateIndexHtml(title);
  const indexPath = path.resolve(textGameDir, 'index.html');
  fs.writeFileSync(indexPath, htmlContent, 'utf-8');

  return {
    projectId,
    bundlePath: `text-game/bundle.js`,
    indexPath: `text-game/index.html`,
    success: true,
  };
}

export const bundlerStep = createStep({
  id: 'bundler-step',
  inputSchema: BundlerInputSchema,
  outputSchema: BundlerOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const trigger = ctx.triggerData || ctx;
    const projectId = trigger.projectId || ctx.projectId;
    const title = trigger.title || ctx.title || '互动短剧';
    const bundlerResult = await runTaskRecordedStep(
      'bundler-step',
      () =>
        executeBundlerStep({
          projectId,
          title,
          startNodeId: trigger.prd?.startNodeId || ctx.startNodeId,
          initialState: trigger.prd?.initialState || ctx.initialState,
        }),
      {
        verifyCached: (cached) => {
          const projectDir = ProjectStore.getInstance().getProjectDir(projectId);
          return (
            fs.existsSync(path.resolve(projectDir, cached.bundlePath || 'text-game/bundle.js')) &&
            fs.existsSync(path.resolve(projectDir, cached.indexPath || 'text-game/index.html'))
          );
        },
      }
    );

    // 若在工作流中串联执行，自动汇总保存全局分幕清单到 ProjectStore
    const store = ProjectStore.getInstance();
    const imageGenResult = ctx.steps?.['image-gen-pool-step']?.output;
    const entities = ctx.steps?.['entity-extract-step']?.output;
    if (imageGenResult && imageGenResult.scenes) {
      store.setArtifact(projectId, 'text_game_manifest', {
        projectId,
        title,
        totalScenes: imageGenResult.totalScenes || imageGenResult.scenes.length,
        renderedImages: imageGenResult.renderedCount || 0,
        scenes: imageGenResult.scenes.map((s: any) => ({
          sceneId: s.sceneId,
          title: s.title,
          targetVideoClipName: s.targetVideoClipName,
          jsonFile: `scenes/${s.sceneId}.json`,
          sceneImagePath: s.visualAnchor?.sceneImagePath,
        })),
        entities: entities || { artStyle: '', characters: [], items: [] },
        playableIndex: bundlerResult.indexPath,
        updatedAt: new Date().toISOString(),
      });
    }

    return bundlerResult;
  },
});
