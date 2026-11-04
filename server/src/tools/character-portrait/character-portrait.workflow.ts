/**
 * tools/character-portrait/character-portrait.workflow.ts
 * 角色定妆视觉规范微观子工作流 (Character Portrait Micro Sub-Workflow SSOT)
 * 
 * 核心架构特性：
 * 1. 细粒度断点恢复 (Resume & Skip)：自动检测已渲染落盘的角色定妆照，断网/重跑时跳过已完成项，绝不重复烧卡；
 * 2. 角色级靶向回退 (Single-Character Rollback)：支持 targetCharacterNames 靶向重跑指定角色，其余角色定妆严格保全；
 * 3. Mastra 原生 DAG 微工作流：状态机拆解为 审计核验 ➔ 并发渲染 ➔ 归并落盘 3 大原子 Step。
 */

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { ProposalStore } from '../../project-store/ProposalStore.js';
import { LLMRegistry } from '../../llm/LLMRegistry.js';
import { CharacterRenderer } from './character.renderer.js';
import { asyncPoolSettled } from '../../utils/concurrency.js';
import { WorkflowStage } from '../../types/index.js';
import {
  CHARACTER_VISUAL_SPEC_SYSTEM_PROMPT,
  buildCharacterVisualSpecPrompt,
  REFINE_CHARACTER_SYSTEM_PROMPT,
  buildRefineCharacterPrompt,
} from './prompt.js';
import {
  CharacterSheetItemSchema,
  CharacterPortraitArtifactSchema,
  CharacterVisualSpecsListSchema,
  RefineCharacterVisualPromptSchema,
  type CharacterSheetItem,
  type CharacterPortraitArtifact,
  type CharacterVisualSpecsListOutput,
  type RefineCharacterVisualPromptOutput,
} from './schema.js';

// 子工作流输入契约
export const CharacterSubWorkflowInputSchema = z.object({
  projectId: z.string().describe('项目唯一标识 ID'),
  sessionId: z.string().optional().describe('当前交互会话 ID'),
  styleOverride: z.string().optional().describe('覆盖视觉影调风格'),
  targetCharacterNames: z.array(z.string()).optional().describe('指定微调/回退的角色姓名列表'),
  userFeedback: z.string().optional().describe('角色外貌微调指令'),
  forceRegenerate: z.boolean().optional().describe('是否强制全量重跑（忽略断点缓存）'),
  proposalId: z.string().optional().describe('关联的人在回路提案 ID (细粒度进度反馈)'),
  isMock: z.boolean().optional().describe('是否为 Mock 模拟测试'),
});

export type CharacterSubWorkflowInput = z.infer<typeof CharacterSubWorkflowInputSchema>;

// 中间审计步骤上下文
const CharacterAuditContextSchema = z.object({
  projectId: z.string(),
  sessionId: z.string().optional(),
  proposalId: z.string().optional(),
  style: z.string(),
  targetCharacterNames: z.array(z.string()).optional(),
  userFeedback: z.string().optional(),
  isMock: z.boolean().optional(),
  effectiveConstraints: z.array(z.string()),
  cachedCharacters: z.array(CharacterSheetItemSchema),
  pendingCharacters: z.array(z.any()),
  rawCharacters: z.array(z.any()),
  existingCreatedAt: z.string().optional(),
});

// Step 1: 角色状态审计与断点恢复计算
export const auditCharactersStep = createStep({
  id: 'step-audit-characters',
  description: '核验物理定妆照与已有资产，计算断点复用角色与需要执行/回退的待渲染角色',
  inputSchema: CharacterSubWorkflowInputSchema,
  outputSchema: CharacterAuditContextSchema,
  execute: async ({ inputData }) => {
    const {
      projectId,
      sessionId,
      styleOverride,
      targetCharacterNames,
      userFeedback,
      forceRegenerate,
      proposalId,
      isMock,
    } = inputData;

    const store = ProjectStore.getInstance();
    const project = store.getProject(projectId);
    const projectDir = store.getProjectDir(projectId);

    // 1. 获取故事圣经前序角色资产
    const narrativeArtifact = store.getArtifact<any>(projectId, WorkflowStage.NARRATIVE_DESIGN);
    const rawCharacters = narrativeArtifact?.characters || [];

    if (!rawCharacters || rawCharacters.length === 0) {
      throw new Error('[CharacterSubWorkflow] 缺少前序故事圣经角色数据，请先推进第一阶段【叙事架构】生成角色小传');
    }

    const style = styleOverride || narrativeArtifact.style || project?.meta?.style || '电影质感，冷色调，高对比度光影';

    // 2. 提取白板中的刚性禁忌与偏好红线 (SSOT)
    let effectiveConstraints: string[] = [];
    if (sessionId) {
      const session = store.getSession(projectId, sessionId);
      if (session?.scratchpad?.userConstraints && session.scratchpad.userConstraints.length > 0) {
        effectiveConstraints = session.scratchpad.userConstraints;
      }
    }
    if (effectiveConstraints.length === 0 && project?.meta?.userConstraints) {
      effectiveConstraints = project.meta.userConstraints;
    }

    // 3. 检查既有角色定妆资产与本地物理磁盘文件 (Resume & Skip 核心判据)
    const existingArtifact = store.getArtifact<CharacterPortraitArtifact>(projectId, WorkflowStage.CHARACTER_DESIGN);
    const existingCharacters = Array.isArray(existingArtifact?.characters) ? existingArtifact.characters : [];

    const rollbackSet = new Set<string>(targetCharacterNames || []);
    const cachedCharacters: CharacterSheetItem[] = [];
    const pendingCharacters: any[] = [];

    for (const char of rawCharacters) {
      const isTargetRollback = rollbackSet.has(char.name);
      const existingChar = existingCharacters.find((c) => c.name === char.name);

      let isPhysicalFileValid = false;
      if (existingChar?.imageUrl) {
        if (isMock) {
          isPhysicalFileValid = true;
        } else if (existingChar.imageUrl.startsWith(`/media/${projectId}/`)) {
          const relPath = existingChar.imageUrl.replace(`/media/${projectId}/`, '');
          const absPath = path.join(projectDir, relPath);
          isPhysicalFileValid = fs.existsSync(absPath) && fs.statSync(absPath).size > 0;
        } else {
          // 外部合法 URL 或相对路径
          isPhysicalFileValid = true;
        }
      }

      // 如果未指定重跑、未强制刷新、且物理资产真实存在 ➔ 毫秒级断点复用
      if (!forceRegenerate && !isTargetRollback && existingChar && isPhysicalFileValid) {
        cachedCharacters.push(existingChar);
      } else {
        // 待渲染或靶向回退的角色
        pendingCharacters.push({
          ...char,
          _existing: existingChar,
          _isRollback: isTargetRollback,
        });
      }
    }

    return {
      projectId,
      sessionId,
      proposalId,
      style,
      targetCharacterNames,
      userFeedback,
      isMock,
      effectiveConstraints,
      cachedCharacters,
      pendingCharacters,
      rawCharacters,
      existingCreatedAt: existingArtifact?.createdAt,
    };
  },
});

// Step 2: 并发渲染待生成的角色定妆图
export const renderPendingCharactersStep = createStep({
  id: 'step-render-pending-characters',
  description: '对未完成或指定回退重做的角色，执行提示词推演/微调并并发生成高清定妆照',
  inputSchema: CharacterAuditContextSchema,
  outputSchema: z.object({
    projectId: z.string(),
    sessionId: z.string().optional(),
    proposalId: z.string().optional(),
    style: z.string(),
    targetCharacterNames: z.array(z.string()).optional(),
    userFeedback: z.string().optional(),
    isMock: z.boolean().optional(),
    effectiveConstraints: z.array(z.string()),
    cachedCharacters: z.array(CharacterSheetItemSchema),
    renderedCharacters: z.array(CharacterSheetItemSchema),
    rawCharacters: z.array(z.any()),
    existingCreatedAt: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    const {
      projectId,
      sessionId,
      proposalId,
      style,
      targetCharacterNames,
      userFeedback,
      isMock,
      effectiveConstraints,
      cachedCharacters,
      pendingCharacters,
      rawCharacters,
      existingCreatedAt,
    } = inputData;

    if (pendingCharacters.length === 0) {
      // 细粒度断点全命中，无需任何生图计算
      return {
        projectId,
        sessionId,
        proposalId,
        style,
        targetCharacterNames,
        userFeedback,
        isMock,
        effectiveConstraints,
        cachedCharacters,
        renderedCharacters: [],
        rawCharacters,
        existingCreatedAt,
      };
    }

    const proposalStore = ProposalStore.getInstance();
    const llm = LLMRegistry.get();

    // 1. 生成或融合提示词 (如果是回退微调且有旧角色，使用语义微调模型；否则全量/批量推演)
    const specsMap = new Map<string, string>();

    // 区分微调单角色 vs 批量新角色
    const charactersNeedingBatchSpec = pendingCharacters.filter(
      (c) => !(c._isRollback && c._existing && userFeedback)
    );

    if (charactersNeedingBatchSpec.length > 0) {
      try {
        const batchPrompt = buildCharacterVisualSpecPrompt(
          style,
          charactersNeedingBatchSpec,
          userFeedback,
          effectiveConstraints
        );
        const specsResult = await llm.generateObject<CharacterVisualSpecsListOutput>(
          batchPrompt,
          CharacterVisualSpecsListSchema,
          CHARACTER_VISUAL_SPEC_SYSTEM_PROMPT,
          { stage: 'character_visual_spec', temperature: 0.3 }
        );
        for (const s of specsResult.specs || []) {
          specsMap.set(s.name, s.visualPrompt);
        }
      } catch (err) {
        console.warn('[CharacterSubWorkflow] 批量推演提示词失败，将使用兜底提示词:', err);
      }
    }

    // 2. 并发渲染定妆图 (限制并发度为 3)
    let completedCount = 0;
    const totalCount = pendingCharacters.length;

    const renderResults = await asyncPoolSettled<any, CharacterSheetItem>(
      3,
      pendingCharacters,
      async (char: any) => {
        if (proposalId) {
          proposalStore.updateProposalStatus(projectId, proposalId, 'running', {
            lastMessage: `⚡ [${completedCount}/${totalCount}] 正在渲染角色【${char.name}】定妆照...`,
          });
        }

        let visualPrompt = specsMap.get(char.name);

        // 如果是单角色回退微调，进行精确微调融合
        if (char._isRollback && char._existing && userFeedback) {
          try {
            const refinePrompt = buildRefineCharacterPrompt(
              char._existing,
              userFeedback,
              style,
              effectiveConstraints
            );
            const refineRes = await llm.generateObject<RefineCharacterVisualPromptOutput>(
              refinePrompt,
              RefineCharacterVisualPromptSchema,
              REFINE_CHARACTER_SYSTEM_PROMPT,
              { stage: 'character_refine', temperature: 0.3 }
            );
            visualPrompt = refineRes.refinedVisualPrompt || char._existing.visualPrompt;
          } catch (e) {
            console.warn(`[CharacterSubWorkflow] 微调角色【${char.name}】提示词重写失败，保持原提示词微调:`, e);
            visualPrompt = `${char._existing.visualPrompt}，${userFeedback}`;
          }
        }

        if (!visualPrompt) {
          visualPrompt = `${char.appearance || char.name}，电影级高精度人物定妆照，${style}`;
        }

        const renderRes = await CharacterRenderer.renderCharacterPortrait(
          projectId,
          char.name,
          visualPrompt,
          {
            isMock,
            referenceImageUrl: char._existing?.imageUrl,
          }
        );

        completedCount++;
        if (proposalId) {
          proposalStore.updateProposalStatus(projectId, proposalId, 'running', {
            lastMessage: `⚡ [${completedCount}/${totalCount}] 角色【${char.name}】定妆照渲染完成`,
          });
        }

        return {
          name: char.name,
          role: char.role || '主要角色',
          gender: char.gender,
          age: char.age,
          appearance: char.appearance,
          personality: char.personality,
          motivation: char.motivation,
          visualPrompt,
          imageUrl: renderRes.url,
          referenceImageUrl: renderRes.url,
          selected: true,
          isDegraded: renderRes.isDegraded,
          degradedReason: renderRes.degradedReason,
        };
      }
    );

    const renderedCharacters: CharacterSheetItem[] = [];
    for (const r of renderResults) {
      if (r.status === 'fulfilled' && r.value) {
        renderedCharacters.push(r.value);
      } else {
        console.error('[CharacterSubWorkflow] 渲染角色定妆失败:', r.reason);
      }
    }

    return {
      projectId,
      sessionId,
      proposalId,
      style,
      targetCharacterNames,
      userFeedback,
      isMock,
      effectiveConstraints,
      cachedCharacters,
      renderedCharacters,
      rawCharacters,
      existingCreatedAt,
    };
  },
});

// Step 3: 归并切片并安全落盘 (SSOT + 物理磁盘)
export const aggregatePortraitArtifactStep = createStep({
  id: 'step-aggregate-portrait-artifact',
  description: '将断点复用角色与新渲染角色按剧本顺序归并，落盘 ProjectStore SSOT 与物理磁盘',
  inputSchema: z.object({
    projectId: z.string(),
    sessionId: z.string().optional(),
    proposalId: z.string().optional(),
    style: z.string(),
    targetCharacterNames: z.array(z.string()).optional(),
    userFeedback: z.string().optional(),
    isMock: z.boolean().optional(),
    effectiveConstraints: z.array(z.string()),
    cachedCharacters: z.array(CharacterSheetItemSchema),
    renderedCharacters: z.array(CharacterSheetItemSchema),
    rawCharacters: z.array(z.any()),
    existingCreatedAt: z.string().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: CharacterPortraitArtifactSchema,
    summary: z.string(),
    cachedCount: z.number(),
    renderedCount: z.number(),
  }),
  execute: async ({ inputData }) => {
    const {
      projectId,
      sessionId,
      style,
      targetCharacterNames,
      cachedCharacters,
      renderedCharacters,
      rawCharacters,
      existingCreatedAt,
    } = inputData;

    const store = ProjectStore.getInstance();
    const allMap = new Map<string, CharacterSheetItem>();

    // 录入复用项
    for (const c of cachedCharacters) {
      allMap.set(c.name, c);
    }
    // 录入新渲染项 (覆盖回退项)
    for (const c of renderedCharacters) {
      allMap.set(c.name, c);
    }

    // 严格按照原故事圣经角色顺序装配
    const orderedCharacters: CharacterSheetItem[] = [];
    for (const raw of rawCharacters) {
      const item = allMap.get(raw.name);
      if (item) {
        orderedCharacters.push(item);
      }
    }

    const isRefinement = Boolean(targetCharacterNames && targetCharacterNames.length > 0);
    const artifact: CharacterPortraitArtifact = {
      characters: orderedCharacters,
      totalCharacters: rawCharacters.length,
      completedCharacters: orderedCharacters.length,
      style,
      isRefinement,
      targetCharacterNames,
      createdAt: existingCreatedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 1. SSOT 黑板落盘
    store.setArtifact(projectId, WorkflowStage.CHARACTER_DESIGN, artifact);

    // 2. 本地物理磁盘持久化 characters/character_sheets.json
    exportToLocalDisk(projectId, artifact);

    // 3. 备忘录白板同步
    if (sessionId) {
      const visualAnchorsSummary = orderedCharacters
        .map((c) => `- ${c.name}: ${(c.appearance || '').slice(0, 40)}... (定妆Prompt: ${c.visualPrompt.slice(0, 60)}...)`)
        .join('\n');
      store.updateScratchpad(projectId, sessionId, {
        characterVisualAnchors: visualAnchorsSummary,
      });
    }

    const cachedCount = cachedCharacters.length;
    const renderedCount = renderedCharacters.length;

    let summary = '';
    if (isRefinement) {
      summary = `✨ 角色【${targetCharacterNames?.join('、')}】微调定妆照交付完成！(复用 ${cachedCount} 个，重绘 ${renderedCount} 个)`;
    } else if (cachedCount > 0 && renderedCount === 0) {
      summary = `⚡ 断点恢复：全剧 ${cachedCount} 位角色定妆照物理切片均完整，已毫秒级全部复用！`;
    } else if (cachedCount > 0) {
      summary = `🎨 角色视觉定妆完成！(断点秒级复用 ${cachedCount} 个，增量渲染 ${renderedCount} 个)`;
    } else {
      summary = `🎨 全剧 ${orderedCharacters.length} 位核心角色视觉定妆照生成并永久化落盘完毕！`;
    }

    return {
      success: true,
      data: artifact,
      summary,
      cachedCount,
      renderedCount,
    };
  },
});

function exportToLocalDisk(projectId: string, artifact: CharacterPortraitArtifact) {
  try {
    const store = ProjectStore.getInstance();
    const projectDir = store.getProjectDir(projectId);
    const charDir = path.join(projectDir, 'characters');
    if (!fs.existsSync(charDir)) {
      fs.mkdirSync(charDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(charDir, 'character_sheets.json'),
      JSON.stringify(artifact, null, 2),
      'utf-8'
    );
  } catch (e) {
    console.warn('[CharacterSubWorkflow] 本地物理落盘异常 (非致命):', e);
  }
}

// 导出纯粹的 Mastra 微观子工作流实例 (SSOT)
export const characterPortraitSubWorkflow = createWorkflow({
  id: 'subwf-character-portrait',
  description: '角色视觉定妆照微观生产子工作流：具备细粒度断点恢复 (Resume & Skip) 与单角色靶向回退 (Single-Character Rollback) 能力',
  inputSchema: CharacterSubWorkflowInputSchema,
  outputSchema: z.object({
    success: z.boolean(),
    data: CharacterPortraitArtifactSchema,
    summary: z.string(),
    cachedCount: z.number(),
    renderedCount: z.number(),
  }),
})
  .then(auditCharactersStep)
  .then(renderPendingCharactersStep)
  .then(aggregatePortraitArtifactStep)
  .commit();
