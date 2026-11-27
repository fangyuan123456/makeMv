/**
 * tools/game-assembly/assembly-tool/steps/02-codegen/step.ts
 * 互动影游高自主三层装配与增量修改执行器 (codegenStep SSOT)
 */

import { createStep } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import path from 'path';
import fs from 'fs';
import { ProjectStore } from '../../../../../project-store/ProjectStore.js';
import { LLMProvider } from '../../../../../llm/index.js';
import {
  CodegenStepInputSchema,
  CodegenStepOutputSchema,
  type CodegenStepInput,
  type CodegenStepOutput,
} from './schema.js';
import { RUNTIME_FILES } from './runtime-files.js';
import { VirtualFS } from './vfs.js';
import {
  createCoderVfsTools,
  normalizeVfsPath,
  verifyVirtualBundle,
} from './tools.js';
import {
  buildCoderAgentSystemPrompt,
  buildCoderAgentUserPrompt,
  buildCoderModifyUserPrompt,
} from './prompt.js';
import { ensureMinimalFallbackFiles } from './fallback.js';
import {
  compileStoryBundle,
  generateIndexHtml,
  type StoryBundle,
} from '../../../shared/story-compiler.js';

export { compileStoryBundle, generateIndexHtml, type StoryBundle };

function collectRequiredInteractionKinds(bundle: StoryBundle): string[] {
  const kinds = new Set<string>();
  for (const c of bundle.clips) {
    if (c?.interaction?.kind) {
      kinds.add(String(c.interaction.kind).toUpperCase());
    }
  }
  return Array.from(kinds);
}

function loadExistingPresentationIntoVfs(
  gameAssemblyDir: string,
  vfs: VirtualFS
): void {
  if (!fs.existsSync(gameAssemblyDir)) return;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'runtime') continue;
        walk(full);
      } else if (entry.isFile()) {
        const rel = normalizeVfsPath(path.relative(gameAssemblyDir, full));
        if (rel === 'story.json' || rel === 'index.html' || !/\.(js|css|json)$/i.test(rel)) continue;
        vfs.write(rel, fs.readFileSync(full, 'utf-8'));
      }
    }
  };
  walk(gameAssemblyDir);
}

function hasAnyLlmKeyConfigured(): boolean {
  return Boolean(
    process.env.OPENAI_API_KEY ||
      process.env.DEEPSEEK_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENROUTER_API_KEY
  );
}

export async function executeCodegenStep(
  input: CodegenStepInput
): Promise<CodegenStepOutput> {
  const store = ProjectStore.getInstance();
  const projectDir = store.getProjectDir(input.projectId);
  const gameAssemblyDir = path.resolve(projectDir, 'game-assembly');

  const bundle = compileStoryBundle(input, store);
  const requiredKinds = collectRequiredInteractionKinds(bundle);

  const vfs = new VirtualFS();
  for (const file of RUNTIME_FILES) {
    vfs.write(normalizeVfsPath(file.path), file.content);
  }
  vfs.write('story.json', JSON.stringify(bundle, null, 2));
  vfs.write('index.html', generateIndexHtml(bundle.title));

  const isModify = input.mode === 'modify';
  if (isModify) {
    loadExistingPresentationIntoVfs(gameAssemblyDir, vfs);
    ensureMinimalFallbackFiles(vfs, bundle);
  }

  let rounds = 1;
  const skipLlm =
    process.env.MAKEMV_SKIP_LLM_CODEGEN === '1' || !hasAnyLlmKeyConfigured();

  if (!skipLlm) {
    try {
      const techPlan =
        input.techPlan ||
        store.getArtifact(input.projectId, 'game_assembly_tech_plan') ||
        undefined;
      const tools = createCoderVfsTools(vfs, gameAssemblyDir);
      const agent = new Agent({
        name: 'game-assembly-coder-agent',
        instructions: buildCoderAgentSystemPrompt({
          title: bundle.title,
          techPlan,
          requiredInteractionKinds: requiredKinds,
          uiThemeSummary: `${bundle.uiTheme.genreMood}（${bundle.uiTheme.hudStyle}）`,
        }),
        model: LLMProvider.getModel(),
        tools,
      });

      const userPrompt =
        isModify && input.modifyInstruction
          ? buildCoderModifyUserPrompt({
              title: bundle.title,
              modifyInstruction: input.modifyInstruction,
              existingFiles: vfs.list(),
            })
          : buildCoderAgentUserPrompt({
              title: bundle.title,
              clipCount: bundle.clips.length,
              requiredInteractionKinds: requiredKinds,
            });

      const response = await agent.generate(userPrompt, {
        maxSteps: 14,
      });
      rounds = Array.isArray((response as any)?.steps)
        ? Math.max(1, (response as any).steps.length)
        : 1;
    } catch (err) {
      console.warn(
        '[CodegenStep] Coder Agent 执行异常，将使用最小可玩兜底:',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  let check = verifyVirtualBundle(vfs);
  if (!check.valid) {
    ensureMinimalFallbackFiles(vfs, bundle);
    check = verifyVirtualBundle(vfs);
  }

  fs.mkdirSync(gameAssemblyDir, { recursive: true });
  const generatedFiles: string[] = [];
  for (const [relPath, content] of vfs.entries()) {
    const target = path.resolve(gameAssemblyDir, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
    generatedFiles.push(`game-assembly/${relPath}`);
  }

  const indexHtmlPath = path.resolve(gameAssemblyDir, 'index.html');
  const indexRel = path
    .relative(projectDir, indexHtmlPath)
    .split(path.sep)
    .join('/');

  return {
    projectId: input.projectId,
    generatedFiles,
    rounds,
    indexPath: indexRel,
    success: check.valid,
  };
}

export const codegenStep = createStep({
  id: 'codegen-step',
  description:
    '高自主三层汇编：编译 story.json + 确定性运行时底座 + Coder Agent(VFS Tools) 自主编写/修改表现层',
  inputSchema: CodegenStepInputSchema,
  outputSchema: CodegenStepOutputSchema,
  execute: async ({ context }) => {
    const ctx = context as any;
    const originalInput = ctx.triggerData || ctx.inputData || ctx;
    const projectId = originalInput?.projectId || ctx.projectId;

    return executeCodegenStep({
      projectId,
      ...originalInput,
    });
  },
});
