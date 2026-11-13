/**
 * workflows/steps/compile-film.step.ts
 * 步骤三：已验证文游一键升维翻译为影游切片资产清单 - 基于 Mastra 官方 createStep 规范
 */

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { executeStoryboardStep } from '../../agents/film-production/steps/storyboard/index.js';
import { FilmAdapterArtifactSchema, type FilmAdapterArtifact } from '../../project-store/contracts/film-production/index.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import {
  STAGE,
  FILM_STEP,
  writeArtifactFile,
  renderArtifactMarkdown,
} from '../../project-store/artifact-fs.js';
import { createProgressReporter } from '../../workflow-engine/progress.js';

export const compileFilmStepInputSchema = z.object({
  projectId: z.string(),
  taskId: z.string().optional(),
});

export const compileFilmStepOutputSchema = z.object({
  projectId: z.string(),
  filmSpec: FilmAdapterArtifactSchema,
});

export type CompileFilmStepInput = z.infer<typeof compileFilmStepInputSchema>;
export type CompileFilmStepOutput = z.infer<typeof compileFilmStepOutputSchema>;

/**
 * 步骤三核心业务影视编译逻辑
 */
export async function executeCompileFilmStep(
  input: CompileFilmStepInput
): Promise<CompileFilmStepOutput> {
  const { projectId, taskId = 'task_compile_film' } = input;
  const store = ProjectStore.getInstance();
  const report = createProgressReporter(projectId, taskId);

  const gdd = store.getArtifact<any>(projectId, 'gdd');
  const plannerPrd = store.getArtifact<any>(projectId, 'planner_prd');
  const title = gdd?.title || plannerPrd?.title || store.getProject(projectId).meta.title;
  report(25, '视听总导演正在读取 Planner 最终 PRD 与剧情，生成真实视频分镜订单...');

  // 2. 调用 Mastra 官方原生影游翻译 Agent 提取视听资产需求
  // Step 1 只负责分镜规划：把文游分幕拆成镜头，并绑定已确认的场景/角色母本图。
  // 图片与视频的物理生成留给后续工序。
  const filmSpec = await executeStoryboardStep({ projectId });

  report(88, '正在生成各镜头切片订单并落盘影视资产清单...');

  // 3. 落盘：运行时黑板 + .debug 展示镜像 + 外层交付文档
  try {
    const md = renderArtifactMarkdown(`《${title}》影游视听切片清单`, filmSpec);
    writeArtifactFile(projectId, 'debug', STAGE.filmAdapter, FILM_STEP.compile, 'film_spec.md', md);
    writeArtifactFile(projectId, 'delivery', STAGE.filmAdapter, FILM_STEP.compile, 'film_spec.md', md);
  } catch (err) {
    console.warn(`[CompileFilmStep] 写入影视切片清单失败:`, err);
  }

  report(100, `影视化切片清单已编译完成，共计 ${filmSpec.clips.length} 个视听镜头需求`);

  return {
    projectId,
    filmSpec,
  };
}

/**
 * Mastra 官方原生 Step 实例
 */
export const compileFilmStep = createStep({
  id: 'compile-film',
  description: '将文游升维编译为影游视听镜头切片资产清单',
  inputSchema: compileFilmStepInputSchema,
  outputSchema: compileFilmStepOutputSchema,
  execute: async ({ context, runId }) => {
    return await executeCompileFilmStep({
      projectId: context.projectId,
      taskId: context.taskId || runId,
    });
  },
});
