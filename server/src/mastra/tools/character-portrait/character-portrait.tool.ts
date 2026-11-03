/**
 * mastra/tools/character-portrait/character-portrait.tool.ts
 * Mastra 原生 Tool: 角色视觉定妆照生成与微调自愈 (Character Portrait Tool SSOT)
 * 
 * 核心机制：
 * 1. 纯中文影视提示词工程：通过 prompt.ts 推演电影级特写定妆生图提示词；
 * 2. 意图 100% 透传：将 generatedPrompt 透传给 VisualMediaRenderer 执行渲染与本地持久化；
 * 3. 单角色微调与自愈重绘：支持 targetCharacterNames，专职模型语义重写；
 * 4. 产物双向落盘：ProjectStore SSOT 状态黑板 + 本地工程 characters/ 物理目录；
 * 5. 原生标记 requireApproval: true 践行人在回路。
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../../project-store/ProjectStore.js';
import { LLMRegistry } from '../../../llm/LLMRegistry.js';
import { VisualMediaRenderer } from '../../../media/VisualMediaRenderer.js';
import { asyncPool } from '../../../utils/concurrency.js';
import { WorkflowStage } from '../../../types/index.js';
import {
  CHARACTER_VISUAL_SPEC_SYSTEM_PROMPT,
  buildCharacterVisualSpecPrompt,
  REFINE_CHARACTER_SYSTEM_PROMPT,
  buildRefineCharacterPrompt,
} from './prompt.js';
import {
  CharacterPortraitArtifactSchema,
  CharacterVisualSpecsListSchema,
  RefineCharacterVisualPromptSchema,
  type CharacterSheetItem,
  type CharacterPortraitArtifact,
  type CharacterVisualSpecsListOutput,
  type RefineCharacterVisualPromptOutput,
} from './schema.js';

export const characterPortraitTool = createTool({
  id: 'character-portrait-generator',
  description: '为故事圣经中确立的所有核心主角与重要配角推演影视级视觉定妆提示词并批量生成高清人物定妆照，支持单角色靶向微调自愈',
  inputSchema: z.object({
    projectId: z.string().describe('项目全局唯一 ID (Project ID)'),
    sessionId: z.string().optional().describe('当前交互会话 ID'),
    styleOverride: z.string().optional().describe('覆盖视觉影调风格'),
    targetCharacterNames: z.array(z.string()).optional().describe('指定微调的角色姓名列表 (单点重绘自愈)'),
    userFeedback: z.string().optional().describe('角色外貌微调指令'),
    isMock: z.boolean().optional().describe('是否为 Mock 模拟测试执行 (防扣费)'),
  }).strict(),
  outputSchema: z.object({
    success: z.boolean(),
    data: CharacterPortraitArtifactSchema.optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
  }),
  requireApproval: true,
  execute: async (params) => {
    try {
      const { projectId, sessionId, styleOverride, targetCharacterNames, userFeedback, isMock } = params;
      const store = ProjectStore.getInstance();
      const project = store.getProject(projectId);

      const narrativeArtifact = store.getArtifact<any>(projectId, WorkflowStage.NARRATIVE_DESIGN);
      const rawCharacters = narrativeArtifact?.characters || [];

      if (!rawCharacters || rawCharacters.length === 0) {
        throw new Error('缺少前序故事圣经角色数据，请先推进第一阶段【叙事架构】生成角色小传');
      }

      const style = styleOverride || narrativeArtifact.style || project?.meta?.style || '电影质感，冷色调，高对比度光影';
      const llm = LLMRegistry.get();

      const existingArtifact = store.getArtifact<CharacterPortraitArtifact>(projectId, WorkflowStage.CHARACTER_DESIGN);

      // 分支一：单角色靶向微调自愈
      if (targetCharacterNames && targetCharacterNames.length > 0) {
        if (!existingArtifact || !Array.isArray(existingArtifact.characters) || existingArtifact.characters.length === 0) {
          throw new Error('当前项目尚无既有角色定妆资产，无法执行指定角色微调，请先执行全量角色定妆生成');
        }

        const updatedList = [...existingArtifact.characters];
        let refinedCount = 0;

        for (const targetName of targetCharacterNames) {
          const charIdx = updatedList.findIndex((c) => c.name === targetName);
          if (charIdx === -1) continue;

          refinedCount++;
          const currentChar = updatedList[charIdx];
          const refinePrompt = buildRefineCharacterPrompt(currentChar, userFeedback || '优化五官精细度与电影质感', style);

          const refineRes = await llm.generateObject<RefineCharacterVisualPromptOutput>(
            refinePrompt,
            RefineCharacterVisualPromptSchema,
            REFINE_CHARACTER_SYSTEM_PROMPT,
            { stage: 'character_refine', temperature: 0.3 }
          );

          const newPrompt = refineRes.refinedVisualPrompt || currentChar.visualPrompt;
          const renderRes = await VisualMediaRenderer.renderCharacterPortrait(
            projectId,
            currentChar.name,
            newPrompt,
            { isMock }
          );

          updatedList[charIdx] = {
            ...currentChar,
            visualPrompt: newPrompt,
            imageUrl: renderRes.url,
            referenceImageUrl: renderRes.url,
            isDegraded: renderRes.isDegraded,
            degradedReason: renderRes.degradedReason,
          };
        }

        if (refinedCount === 0) {
          throw new Error(`未在既有定妆资产中找到指定微调的目标角色 [${targetCharacterNames.join(', ')}]`);
        }

        const updatedArtifact: CharacterPortraitArtifact = {
          characters: updatedList,
          totalCharacters: updatedList.length,
          completedCharacters: updatedList.length,
          style,
          isRefinement: true,
          targetCharacterNames,
          createdAt: existingArtifact.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        store.setArtifact(projectId, WorkflowStage.CHARACTER_DESIGN, updatedArtifact);
        exportToLocalDisk(projectId, updatedArtifact);

        return {
          success: true,
          data: updatedArtifact,
          summary: `✨ 角色【${targetCharacterNames.join('、')}】微调定妆照交付完成！剧照已落盘锁定。`,
        };
      }

      // 分支二：全量角色视觉定妆生成
      const prompt = buildCharacterVisualSpecPrompt(style, rawCharacters, userFeedback);
      const specsResult = await llm.generateObject<CharacterVisualSpecsListOutput>(
        prompt,
        CharacterVisualSpecsListSchema,
        CHARACTER_VISUAL_SPEC_SYSTEM_PROMPT,
        { stage: 'character_visual_spec', temperature: 0.3 }
      );

      const specsMap = new Map<string, string>();
      for (const s of specsResult.specs || []) {
        specsMap.set(s.name, s.visualPrompt);
      }

      // 3路并发执行生图渲染
      const characters = await asyncPool<any, CharacterSheetItem>(
        3,
        rawCharacters,
        async (char: any) => {
          const generatedPrompt = specsMap.get(char.name) || `${char.appearance}，电影级高精度人物定妆照，${style}`;
          const renderRes = await VisualMediaRenderer.renderCharacterPortrait(
            projectId,
            char.name,
            generatedPrompt,
            { isMock }
          );

          return {
            name: char.name,
            role: char.role || '主要角色',
            gender: char.gender,
            age: char.age,
            appearance: char.appearance,
            personality: char.personality,
            motivation: char.motivation,
            visualPrompt: generatedPrompt,
            imageUrl: renderRes.url,
            referenceImageUrl: renderRes.url,
            selected: true,
            isDegraded: renderRes.isDegraded,
            degradedReason: renderRes.degradedReason,
          };
        }
      );

      const artifact: CharacterPortraitArtifact = {
        characters,
        totalCharacters: characters.length,
        completedCharacters: characters.length,
        style,
        createdAt: new Date().toISOString(),
      };

      store.setArtifact(projectId, WorkflowStage.CHARACTER_DESIGN, artifact);
      exportToLocalDisk(projectId, artifact);

      // 同步回写会话备忘录白板 (Scratchpad Memory)
      if (sessionId) {
        const visualAnchorsSummary = characters
          .map((c) => `- ${c.name}: ${c.appearance.slice(0, 40)}... (定妆Prompt: ${c.visualPrompt.slice(0, 60)}...)`)
          .join('\n');
        store.updateScratchpad(projectId, sessionId, {
          characterVisualAnchors: visualAnchorsSummary,
        });
      }

      const summary = `🎨 全剧 ${characters.length} 位核心角色视觉定妆照生成并永久化落盘完毕！`;
      return {
        success: true,
        data: artifact,
        summary,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || '角色定妆生成失败',
      };
    }
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
    console.warn('[characterPortraitTool] 本地物理落盘异常 (非致命):', e);
  }
}
