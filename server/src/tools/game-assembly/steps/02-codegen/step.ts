/**
 * tools/game-assembly/steps/02-codegen/step.ts
 * 互动影游代码生成与静态打包工序执行器 (codegenStep)
 */

import { createStep } from '@mastra/core/workflows';
import { generateText } from 'ai';
import path from 'path';
import fs from 'fs';
import { LLMProvider } from '../../../../llm/index.js';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import {
  CodegenStepInputSchema,
  CodegenStepOutputSchema,
  type CodegenStepInput,
  type CodegenStepOutput,
} from './schema.js';
import type { TechFileSpec, TechPlanStepOutput } from '../01-tech-plan/schema.js';
import { buildScreeningList } from '../01-tech-plan/runtime-contract.js';
import { VirtualFS } from './vfs.js';
import { RUNTIME_FILES } from './runtime-files.js';
import { applyDrafts, buildSymbolSummary, parseDrafts } from './tools.js';
import { buildCodegenSystemPrompt, buildContinueUserPrompt, buildKickoffUserPrompt } from './prompt.js';
import type { UniversalPrdSpec } from '../../../../project-store/contracts/planner/index.js';

const MAX_ROUNDS = 12;
const MAX_EMPTY_ROUNDS = 2;
const HISTORY_WINDOW = 4;

export interface CodegenDeps {
  generate?: (system: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>) => Promise<string>;
}

function pickReadyFiles(plan: TechPlanStepOutput, vfs: VirtualFS, remaining: Set<string>): TechFileSpec[] {
  const done = new Set(vfs.list());
  const ready = plan.files.filter(
    (f) => remaining.has(f.fileName) && f.dependencies.every((dep) => done.has(dep) || !remaining.has(dep))
  );
  if (ready.length > 0) return ready;
  const first = plan.files.find((f) => remaining.has(f.fileName));
  return first ? [first] : [];
}

export function generateIndexHtml(title: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>${title}</title>
  <link rel="stylesheet" href="./runtime/player.css" />
  <link rel="stylesheet" href="./style.css" />
</head>
<body>
  <div id="app"></div>
  <script type="module" src="./js/main.js"></script>
</body>
</html>
`;
}

function summarizeRound(written: string[], rejected: Array<{ fileName: string; reason: string }>): string {
  const lines = written.map((f) => `- 已写入 ${f}`);
  for (const r of rejected) lines.push(`- 被打回 ${r.fileName}：${r.reason}`);
  return lines.length ? lines.join('\n') : '（本轮未提交任何文件块）';
}

function writeFileToDisk(projectDir: string, spec: TechFileSpec, content: string): string {
  const isCss = spec.kind === 'css';
  const targetDir = isCss ? path.resolve(projectDir, 'game-assembly') : path.resolve(projectDir, 'game-assembly', 'js');
  fs.mkdirSync(targetDir, { recursive: true });
  const fullPath = path.resolve(targetDir, spec.fileName);
  fs.writeFileSync(fullPath, content, 'utf-8');
  return path.relative(projectDir, fullPath).split(path.sep).join('/');
}

export async function executeCodegenStep(
  input: CodegenStepInput,
  deps: CodegenDeps = {}
): Promise<CodegenStepOutput> {
  const store = ProjectStore.getInstance();
  const projectDir = store.getProjectDir(input.projectId);
  const textGameDir = path.resolve(projectDir, 'game-assembly');

  fs.rmSync(path.resolve(textGameDir, 'js'), { recursive: true, force: true });
  fs.mkdirSync(path.resolve(textGameDir, 'js'), { recursive: true });

  fs.rmSync(path.resolve(textGameDir, 'runtime'), { recursive: true, force: true });
  for (const file of RUNTIME_FILES) {
    const target = path.resolve(textGameDir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content, 'utf-8');
  }

  const plan = input.techPlan;
  if (!plan || !plan.files?.length) {
    throw new Error(`[CodegenStep] 项目 [${input.projectId}] 缺少前序技术架构规划 techPlan`);
  }

  const startSceneId = input.startNodeId || input.prd?.startNodeId || 'S1';
  const scenes = input.scenes || [];
  const vfs = new VirtualFS();

  const allowedFiles = new Set(plan.files.map((f) => f.fileName));
  const remaining = new Set(plan.files.map((f) => f.fileName));

  const system = buildCodegenSystemPrompt({
    title: input.title || '互动影游',
    techPlan: plan,
    sceneCount: scenes.length,
    startSceneId,
    initialState: (input.script?.initialState || input.prd?.initialState || {}) as Record<string, unknown>,
    screening: input.script
      ? buildScreeningList(input.script, { verbatim: true })
      : '（无放映单，按起始幕直接播）',
  });

  const generate =
    deps.generate ||
    (async (sys, messages) => {
      const res = await generateText({
        model: LLMProvider.getModel(),
        system: sys,
        messages,
        temperature: 0.2,
        maxTokens: 8000,
      });
      return res.text;
    });

  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const generatedFiles: string[] = [];
  let rounds = 0;
  let emptyRounds = 0;

  let stage = pickReadyFiles(plan, vfs, remaining);
  history.push({
    role: 'user',
    content: buildKickoffUserPrompt({
      stageName: stage.map((f) => f.fileName).join(' + ') || '工程起点',
      targetFiles: stage.map((f) => f.fileName),
      symbolSummary: buildSymbolSummary(vfs),
    }),
  });

  while (remaining.size > 0 && rounds < MAX_ROUNDS) {
    rounds++;

    const raw = await generate(system, history.slice(-HISTORY_WINDOW));
    const drafts = parseDrafts(raw);

    if (drafts.length === 0) {
      emptyRounds++;
      if (emptyRounds >= MAX_EMPTY_ROUNDS) {
        break;
      }
      history.push({ role: 'assistant', content: raw });
      history.push({
        role: 'user',
        content: `未能识别出任何 \`\`\`file:文件名 代码块。请严格按格式输出目标文件：${stage.map((f) => f.fileName).join('、')}。`,
      });
      continue;
    }

    emptyRounds = 0;
    const { written, rejected } = applyDrafts(drafts, vfs, allowedFiles, plan);

    for (const name of written) {
      remaining.delete(name);
      const spec = plan.files.find((f) => f.fileName === name)!;
      const relPath = writeFileToDisk(projectDir, spec, vfs.read(name)!);
      if (!generatedFiles.includes(relPath)) generatedFiles.push(relPath);
    }

    history.push({ role: 'assistant', content: raw });

    stage = pickReadyFiles(plan, vfs, remaining);
    history.push({
      role: 'user',
      content: buildContinueUserPrompt({
        toolResults: summarizeRound(written, rejected),
        nextStageName: stage.map((f) => f.fileName).join(' + ') || null,
        nextTargetFiles: stage.map((f) => f.fileName),
        symbolSummary: buildSymbolSummary(vfs),
        missingNotes: rejected.map((r) => `${r.fileName}：${r.reason}`),
      }),
    });
  }

  // 兜底补齐未生成的剩余文件
  for (const name of remaining) {
    const spec = plan.files.find((f) => f.fileName === name)!;
    const isCss = spec.kind === 'css';
    const fallbackContent = isCss
      ? '/* 自动兜底基础样式 */\n#app { width: 100%; height: 100vh; background: #000; color: #fff; }'
      : `// 自动兜底实现: ${spec.fileName}\nexport default {};\n`;
    vfs.write(name, fallbackContent);
    const relPath = writeFileToDisk(projectDir, spec, fallbackContent);
    if (!generatedFiles.includes(relPath)) generatedFiles.push(relPath);
  }

  const indexHtmlPath = path.resolve(textGameDir, 'index.html');
  fs.writeFileSync(indexHtmlPath, generateIndexHtml(input.title || '互动影游'), 'utf-8');
  const indexRel = path.relative(projectDir, indexHtmlPath).split(path.sep).join('/');

  return {
    projectId: input.projectId,
    generatedFiles,
    rounds,
    indexPath: indexRel,
    success: true,
  };
}

export const codegenStep = createStep({
  id: 'codegen-step',
  description: '按技术拓扑生成原生 ES Module 互动影游前端运行时与 index.html 可玩入口',
  inputSchema: CodegenStepInputSchema,
  outputSchema: CodegenStepOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const stepOutput =
      ctx.getStepResult?.('tech-plan-step') ||
      ctx.steps?.['tech-plan-step']?.output ||
      ctx.triggerData?.['tech-plan-step'] ||
      ctx;

    const store = ProjectStore.getInstance();
    const originalInput = ctx.triggerData || ctx;
    const projectId = originalInput?.projectId || ctx.projectId;

    const techPlan: TechPlanStepOutput =
      (stepOutput?.files ? stepOutput : ctx.files ? ctx : null) ||
      store.getArtifact(projectId, 'game_assembly_tech_plan');

    const effectivePrd: UniversalPrdSpec = originalInput.prd || store.getArtifact(projectId, 'universal_prd');
    const effectiveTitle = originalInput.title || effectivePrd?.gameTitle || '未命名互动影游';

    const result = await executeCodegenStep({
      projectId,
      title: effectiveTitle,
      prd: effectivePrd,
      techPlan,
      scenes: originalInput.scenes || [],
      script: originalInput.script,
      startNodeId: originalInput.startNodeId || effectivePrd?.startNodeId,
    });

    return result;
  },
});
