/**
 * agents/planner/modifier/planner-modifier.ts
 * 策划案 (Planner) 外科手术级 Patch 精修执行器 (Planner Modifier SSOT)
 *
 * 核心机制：
 * 1. 唯一消费与生产目标产物：Step 4 (04-prd-synthesis) 的 prd.md 与 story.md；
 * 2. 严格基于大模型输出的 Patch 清单执行精确文本替换，拒绝推翻重来；
 * 3. 同步写回 delivery 与 .debug 产物目录，并实时刷新 ProjectStore 内存黑板中的 gdd artifact。
 */

import { Agent } from '@mastra/core/agent';
import { LLMProvider } from '../../../llm/index.js';
import {
  readArtifactFile,
  writeArtifactFile,
  STAGE,
  PLANNER_STEP,
} from '../../../project-store/artifact-fs.js';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import type { GDDArtifact } from '../schema.js';
import {
  buildPlannerModifierSystemPrompt,
  buildPlannerModifierUserPrompt,
  PlannerModifierOutputSchema,
  type PlannerModifierOutput,
  type PatchOperation,
} from './prompt.js';

export interface PlannerModifyParams {
  projectId: string;
  target: string;
  detail: string;
  onProgress?: (note: string) => void;
}

export interface PlannerModifyResult {
  prdPatched: boolean;
  storyPatched: boolean;
  appliedPatches: number;
  totalPatches: number;
  summary: string;
  failedPatches?: Array<{ file: string; find: string; reason: string }>;
}

/**
 * 执行 Planner 产物定向精修
 */
export async function runPlannerModify(
  params: PlannerModifyParams
): Promise<PlannerModifyResult> {
  const { projectId, target, detail, onProgress } = params;

  onProgress?.('正在读取已生成的策划案产物 (prd.md / story.md)...');

  // 1. 读取磁盘中的真实交付物
  const prdContent =
    readArtifactFile(projectId, 'delivery', STAGE.planner, PLANNER_STEP.prd, 'prd.md') ||
    readArtifactFile(projectId, 'debug', STAGE.planner, PLANNER_STEP.prd, 'prd.md') ||
    '';
  const storyContent =
    readArtifactFile(projectId, 'delivery', STAGE.planner, PLANNER_STEP.prd, 'story.md') ||
    readArtifactFile(projectId, 'debug', STAGE.planner, PLANNER_STEP.prd, 'story.md') ||
    '';

  if (!prdContent && !storyContent) {
    throw new Error(`[PlannerModifier] 项目 [${projectId}] 尚未生成策划案产物 (prd.md / story.md)，无法执行修改`);
  }

  onProgress?.(`正在根据修改诉求「${target}」推演外科手术 Patch 方案...`);

  // 2. 调度专职 Agent 生成结构化 Patch
  const agent = new Agent({
    name: 'planner-modifier-agent',
    instructions: buildPlannerModifierSystemPrompt(),
    model: LLMProvider.getModel(),
  });

  const prompt = buildPlannerModifierUserPrompt({
    target,
    detail,
    prdContent,
    storyContent,
  });

  const response = await agent.generate(prompt, {
    output: PlannerModifierOutputSchema,
  });

  const patchOutput = response.object as PlannerModifierOutput | undefined;
  if (!patchOutput || !Array.isArray(patchOutput.patches)) {
    throw new Error('[PlannerModifier] 大模型未返回合规的 Patch 清单');
  }

  onProgress?.(`正在应用 ${patchOutput.patches.length} 处定向 Patch...`);

  // 3. 执行精确字符串替换
  let prdText = prdContent;
  let storyText = storyContent;
  let appliedPatches = 0;
  const failedPatches: Array<{ file: string; find: string; reason: string }> = [];

  for (const patch of patchOutput.patches) {
    if (patch.file === 'prd') {
      if (prdText.includes(patch.find)) {
        prdText = prdText.replace(patch.find, patch.replace);
        appliedPatches++;
      } else {
        console.warn(`[PlannerModifier] prd.md 未能命中 find 片段: "${patch.find.slice(0, 50)}..."`);
        failedPatches.push({
          file: 'prd.md',
          find: patch.find.slice(0, 80),
          reason: patch.reason,
        });
      }
    } else if (patch.file === 'story') {
      if (storyText.includes(patch.find)) {
        storyText = storyText.replace(patch.find, patch.replace);
        appliedPatches++;
      } else {
        console.warn(`[PlannerModifier] story.md 未能命中 find 片段: "${patch.find.slice(0, 50)}..."`);
        failedPatches.push({
          file: 'story.md',
          find: patch.find.slice(0, 80),
          reason: patch.reason,
        });
      }
    }
  }

  const prdPatched = prdText !== prdContent;
  const storyPatched = storyText !== storyContent;

  // 4. 写回磁盘持久化
  if (prdPatched || storyPatched) {
    for (const scope of ['debug', 'delivery'] as const) {
      if (prdPatched) {
        writeArtifactFile(projectId, scope, STAGE.planner, PLANNER_STEP.prd, 'prd.md', prdText);
      }
      if (storyPatched) {
        writeArtifactFile(projectId, scope, STAGE.planner, PLANNER_STEP.prd, 'story.md', storyText);
      }
    }

    // 5. 刷新 ProjectStore 内存黑板中的 gdd artifact
    const store = ProjectStore.getInstance();
    const gdd = store.getArtifact<GDDArtifact>(projectId, 'gdd');
    if (gdd) {
      if (prdPatched) gdd.markdown = prdText;
      if (storyPatched) gdd.storyMarkdown = storyText;
      store.setArtifact(projectId, 'gdd', gdd);
    }
  }

  onProgress?.(`定向修改完成：已成功应用 ${appliedPatches}/${patchOutput.patches.length} 处修改`);

  return {
    prdPatched,
    storyPatched,
    appliedPatches,
    totalPatches: patchOutput.patches.length,
    summary: patchOutput.summary,
    ...(failedPatches.length > 0 ? { failedPatches } : {}),
  };
}
