/**
 * workflows/steps/build-text-game.step.ts
 * 步骤二：文游 (TextGame) 扩写装配 - 基于 Mastra 官方 createStep 规范
 */

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import { textGameAgent, writeTextGameWithAgent, TextGameArtifactSchema, type TextGameArtifact } from '../../agents/text-game/index.js';
import type { GDDArtifact } from '../../agents/planner/schema.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { createProgressReporter } from '../../workflow-engine/progress.js';

export const buildTextGameStepInputSchema = z.object({
  projectId: z.string(),
  taskId: z.string().optional(),
});

export const buildTextGameStepOutputSchema = z.object({
  projectId: z.string(),
  textGame: TextGameArtifactSchema,
});

export type BuildTextGameStepInput = z.infer<typeof buildTextGameStepInputSchema>;
export type BuildTextGameStepOutput = z.infer<typeof buildTextGameStepOutputSchema>;

/**
 * 步骤二核心业务扩写装配逻辑
 */
export async function executeBuildTextGameStep(
  input: BuildTextGameStepInput
): Promise<BuildTextGameStepOutput> {
  const { projectId, taskId = 'task_build_text_game' } = input;
  const store = ProjectStore.getInstance();
  const report = createProgressReporter(projectId, taskId);

  // 1. 读取上游审批通过的 GDD (优先读取状态黑板，或自动读取物理 gdd.md 标杆文档)
  let gdd = store.getArtifact<GDDArtifact | string>(projectId, 'gdd');
  if (!gdd) {
    const mdPath = path.join(store.getProjectDir(projectId), 'artifacts', 'gdd.md');
    if (fs.existsSync(mdPath)) {
      gdd = fs.readFileSync(mdPath, 'utf-8');
    }
  }
  if (!gdd) {
    throw new Error(`[BuildTextGameStep] 项目 [${projectId}] 缺少前置 GDD 策划案资产，无法生成文游`);
  }

  report(20, '首席文豪正在为策划案节点注入文学血肉与氛围描写...');
  report(55, '正在雕琢角色微动作、机锋对白与潜台词...');

  // 2. 调用 Mastra 官方原生文游 Agent 进行扩写
  const textGame = await writeTextGameWithAgent(gdd, textGameAgent);

  report(85, '正在将文学演出与状态机跳转无缝绑定...');

  // 3. 落盘并更新阶段
  store.setArtifact(projectId, 'text_game', textGame);

  report(100, `互动文游《${textGame.title}》已装配就绪，即刻开启试玩！`);

  return {
    projectId,
    textGame,
  };
}

/**
 * Mastra 官方原生 Step 实例
 */
export const buildTextGameStep = createStep({
  id: 'build-text-game',
  description: '扩写装配可玩互动文游 (TextGame)',
  inputSchema: buildTextGameStepInputSchema,
  outputSchema: buildTextGameStepOutputSchema,
  execute: async ({ context, runId }) => {
    return await executeBuildTextGameStep({
      projectId: context.projectId,
      taskId: context.taskId || runId,
    });
  },
});
