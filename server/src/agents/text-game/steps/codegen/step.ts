/**
 * agents/text-game/steps/codegen/step.ts
 * 互动影游代码生成工序 (codegenStep)
 *
 * 模型按 tech-plan 给出的依赖拓扑，分阶段把运行时写成浏览器可直接加载的
 * ES module + CSS，每写完一个文件立即落盘；本工序顺手生成入口 index.html。
 * 没有打包、没有转译——打开 index.html 就是成品。
 */

import { createStep } from '@mastra/core/workflows';
import { generateText } from 'ai';
import path from 'path';
import fs from 'fs';
import { LLMProvider } from '../../../../llm/index.js';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { runTaskRecordedStep } from '../../../../workflow-engine/TaskStore.js';
import { CodegenInputSchema, CodegenOutputSchema, type CodegenInput, type CodegenOutput } from './schema.js';
import type { TechFileSpec, TechPlanOutput } from '../tech-plan/schema.js';
import { buildScreeningList } from '../tech-plan/runtime-contract.js';
import { VirtualFS } from './vfs.js';
import { RUNTIME_FILES } from './runtime-files.js';
import { applyDrafts, buildSymbolSummary, parseDrafts } from './tools.js';
import { buildCodegenSystemPrompt, buildContinueUserPrompt, buildKickoffUserPrompt } from './prompt.js';

const MAX_ROUNDS = 12;
const MAX_EMPTY_ROUNDS = 2;
const HISTORY_WINDOW = 4;

export interface CodegenDeps {
  /** 注入点：默认走真实模型；单测可替换成脚本化回复 */
  generate?: (system: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>) => Promise<string>;
}

/** 依赖已全部就绪、可以开始写的文件；按规划顺序取，避免乱序抢跑 */
function pickReadyFiles(plan: TechPlanOutput, vfs: VirtualFS, remaining: Set<string>): TechFileSpec[] {
  const done = new Set(vfs.list());
  const ready = plan.files.filter(
    (f) => remaining.has(f.fileName) && f.dependencies.every((dep) => done.has(dep) || !remaining.has(dep))
  );
  if (ready.length > 0) return ready;
  const first = plan.files.find((f) => remaining.has(f.fileName));
  return first ? [first] : [];
}

/** 入口页由系统生成：只负责挂 #app 与引入模块入口、样式表 */
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
  const targetDir = isCss ? path.resolve(projectDir, 'text-game') : path.resolve(projectDir, 'text-game', 'js');
  fs.mkdirSync(targetDir, { recursive: true });
  const fullPath = path.resolve(targetDir, spec.fileName);
  fs.writeFileSync(fullPath, content, 'utf-8');
  return path.relative(projectDir, fullPath).split(path.sep).join('/');
}

export async function executeCodegenStep(input: CodegenInput, deps: CodegenDeps = {}): Promise<CodegenOutput> {
  const store = ProjectStore.getInstance();
  const projectDir = store.getProjectDir(input.projectId);
  const textGameDir = path.resolve(projectDir, 'text-game');

  // 上一轮的产物清空重来：文件划分由本次规划决定，旧文件留着只会误导人
  fs.rmSync(path.resolve(textGameDir, 'js'), { recursive: true, force: true });
  fs.mkdirSync(path.resolve(textGameDir, 'js'), { recursive: true });

  // 播放底座每次覆盖写成最新版：AI 只 import 调用，不参与实现
  // 目录整个重建，避免旧版底座文件（已合并/改名的）留在产物里
  fs.rmSync(path.resolve(textGameDir, 'runtime'), { recursive: true, force: true });
  for (const file of RUNTIME_FILES) {
    const target = path.resolve(textGameDir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content, 'utf-8');
  }
  console.log(`[CodegenStep] 播放底座已就位：${RUNTIME_FILES.map((f) => f.path).join('、')}`);

  const plan = input.techPlan;
  const startSceneId = input.startNodeId || input.prd.startNodeId || 'S1';
  const scenes = input.scenes || [];
  const vfs = new VirtualFS();

  const allowedFiles = new Set(plan.files.map((f) => f.fileName));
  const remaining = new Set(plan.files.map((f) => f.fileName));

  const system = buildCodegenSystemPrompt({
    title: input.title,
    techPlan: plan,
    sceneCount: scenes.length,
    startSceneId,
    initialState: (input.script?.initialState || input.prd.initialState || {}) as Record<string, unknown>,
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
      if (res.finishReason === 'length') {
        console.warn('[CodegenStep] 本轮输出被长度上限截断');
      }
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
    console.log(
      `[CodegenStep] 第 ${rounds}/${MAX_ROUNDS} 轮：目标 ${stage.map((f) => f.fileName).join('、') || '（无）'}，剩余 ${remaining.size} 个文件`
    );

    const raw = await generate(system, history.slice(-HISTORY_WINDOW));
    const drafts = parseDrafts(raw);

    if (drafts.length === 0) {
      emptyRounds++;
      const preview = raw.trim().slice(0, 160).replace(/\s+/g, ' ');
      console.warn(`[CodegenStep] 本轮没有可解析的文件块（${emptyRounds}/${MAX_EMPTY_ROUNDS}）：${preview}`);
      history.push({ role: 'assistant', content: '（本轮未提交文件块）' });
      if (emptyRounds >= MAX_EMPTY_ROUNDS) {
        throw new Error(
          `[CodegenStep] 连续 ${MAX_EMPTY_ROUNDS} 轮没有产出文件块，编码中止。模型回复片段：${preview}`
        );
      }
      history.push({
        role: 'user',
        content: buildContinueUserPrompt({
          toolResults: '（本轮没有识别到文件块，磁盘未变化）',
          nextStageName: stage.map((f) => f.fileName).join(' + '),
          nextTargetFiles: stage.map((f) => f.fileName),
          symbolSummary: buildSymbolSummary(vfs),
          missingNotes: ['必须用 ```file:文件名 代码块提交完整源码，且代码块要闭合'],
        }),
      });
      continue;
    }

    emptyRounds = 0;
    const { written, rejected } = applyDrafts(drafts, vfs, allowedFiles, plan);

    for (const fileName of written) {
      const spec = plan.files.find((f) => f.fileName === fileName);
      if (!spec) continue;
      const rel = writeFileToDisk(projectDir, spec, vfs.read(fileName) || '');
      if (!generatedFiles.includes(rel)) generatedFiles.push(rel);
      remaining.delete(fileName);
      console.log(`[CodegenStep] 已落盘 ${rel}`);
    }

    if (remaining.size === 0) break;

    stage = pickReadyFiles(plan, vfs, remaining);
    const nextTargetFiles = stage.map((f) => f.fileName);
    // 被打回的文件下一轮必须重写，并进下一轮目标
    for (const r of rejected) {
      if (remaining.has(r.fileName) && !nextTargetFiles.includes(r.fileName)) nextTargetFiles.push(r.fileName);
    }

    const roundSummary = summarizeRound(written, rejected);
    const nextHistory = [
      ...history,
      { role: 'assistant' as const, content: roundSummary },
      {
        role: 'user' as const,
        content: buildContinueUserPrompt({
          toolResults: roundSummary,
          nextStageName: nextTargetFiles.join(' + ') || null,
          nextTargetFiles,
          symbolSummary: buildSymbolSummary(vfs),
          missingNotes: rejected.map((r) => `${r.fileName}：${r.reason}`),
        }),
      },
    ];
    history.length = 0;
    history.push(...nextHistory.slice(-HISTORY_WINDOW));
  }

  const missing = plan.files.filter((f) => !vfs.hasFile(f.fileName)).map((f) => f.fileName);
  if (missing.length > 0) {
    throw new Error(
      `[CodegenStep] 编码未完成，仍有 ${missing.length} 个文件没有产出：${missing.join('、')}（已跑 ${rounds} 轮）`
    );
  }

  // 入口页与入口模块缺一不可，否则打开就是白屏
  if (!fs.existsSync(path.resolve(textGameDir, 'js', 'main.js'))) {
    throw new Error('[CodegenStep] 缺少 js/main.js 入口模块，无法运行');
  }
  const indexPath = path.resolve(textGameDir, 'index.html');
  fs.writeFileSync(indexPath, generateIndexHtml(input.title), 'utf-8');

  return {
    projectId: input.projectId,
    generatedFiles,
    rounds,
    indexPath: path.relative(projectDir, indexPath).split(path.sep).join('/'),
    success: true,
  };
}

export const codegenStep = createStep({
  id: 'codegen-step',
  inputSchema: CodegenInputSchema,
  outputSchema: CodegenOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const trigger = ctx.triggerData || ctx;
    const projectId = trigger.projectId || ctx.projectId;
    const techPlan = ctx.steps?.['tech-plan-step']?.output;
    const assembly = ctx.steps?.['scene-assembly-step']?.output;

    if (!techPlan?.files?.length) {
      throw new Error('[CodegenStep] 缺少技术架构规划 (tech-plan-step)，拒绝盲写代码');
    }

    return await runTaskRecordedStep(
      'codegen-step',
      () =>
        executeCodegenStep({
          projectId,
          title: trigger.title || ctx.title || '互动短剧',
          prd: trigger.prd,
          techPlan,
          scenes: assembly?.scenes || [],
          script: assembly?.script,
          startNodeId: trigger.prd?.startNodeId || ctx.startNodeId,
        }),
      {
        verifyCached: (cached) => {
          const projectDir = ProjectStore.getInstance().getProjectDir(projectId);
          return (
            Array.isArray(cached.generatedFiles) &&
            cached.generatedFiles.length > 0 &&
            cached.generatedFiles.every((rel) => fs.existsSync(path.resolve(projectDir, rel)))
          );
        },
      }
    );
  },
});
