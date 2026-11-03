/**
 * skills/character-portrait/CharacterPortraitSkill.ts
 * 角色视觉定妆照生成技能包 (Character Portrait Skill SSOT)
 *
 * 核心机制（法典 0.2 全链路意图透传 & 4.1 提示词微调自愈）：
 * 1. 纯中文提示词工程：通过独立 prompt.ts 推演高保真 8K 影视定妆生图提示词；
 * 2. 意图 100% 全量透传：将 generatedPrompt 作为渲染提示词直透给 VisualMediaRenderer；
 * 3. 单角色微调与自愈重绘：支持指定 targetCharacterNames，调用 refine_prompt 专职模型语义重写；
 * 4. 产物双向落盘：ProjectStore 状态黑板 + 本地工程 characters/ 物理文件。
 */

import fs from 'fs';
import path from 'path';
import { BaseSkill } from '../BaseSkill.js';
import type { SkillManifest, SkillContext } from '../types.js';
import { WorkflowStage } from '../../types/index.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { LLMRegistry } from '../../llm/LLMRegistry.js';
import { VisualMediaRenderer } from '../../media/VisualMediaRenderer.js';
import { asyncPool } from '../../utils/concurrency.js';
import {
  CHARACTER_VISUAL_SPEC_SYSTEM_PROMPT,
  buildCharacterVisualSpecPrompt,
  REFINE_CHARACTER_SYSTEM_PROMPT,
  buildRefineCharacterPrompt,
} from './prompt.js';
import {
  RefineCharacterVisualPromptSchema,
  CharacterVisualSpecsListSchema,
  type CharacterSheetItem,
  type CharacterPortraitArtifact,
  type RefineCharacterVisualPromptOutput,
  type CharacterVisualSpecsListOutput,
} from './schema.js';

export interface CharacterPortraitParams {
  styleOverride?: string;
  targetCharacterNames?: string[];
  userFeedback?: string;
  isMock?: boolean;
}

export { type CharacterSheetItem, type CharacterPortraitArtifact } from './schema.js';

export class CharacterPortraitSkill extends BaseSkill<CharacterPortraitParams, CharacterPortraitArtifact> {
  public readonly manifest: SkillManifest = {
    name: 'character-portrait',
    displayName: '全剧核心角色定妆照生成',
    description: '为故事圣经中确立的所有核心主角与重要配角推演影视级视觉定妆提示词并批量生成 9:16 高清人物定妆照',
    category: 'character',
    targetStage: WorkflowStage.CHARACTER_DESIGN,
    parameters: {
      styleOverride: { type: 'string', description: '覆盖视觉影调风格' },
      targetCharacterNames: { type: 'array', description: '指定微调的角色姓名列表' },
      userFeedback: { type: 'string', description: '角色外貌微调指令' },
      isMock: { type: 'boolean', description: '是否为 Mock 模拟测试执行 (防扣费)' },
    },
  };

  protected async run(
    context: SkillContext<CharacterPortraitParams>
  ): Promise<{ data: CharacterPortraitArtifact; summary: string }> {
    const { projectId, params, abortSignal } = context;
    const store = ProjectStore.getInstance();
    const project = context.project || store.getProject(projectId);

    await this.notifyProgress(context, 10, '正在读取叙事架构故事圣经中的角色小传...');

    const narrativeArtifact = context.artifacts?.[WorkflowStage.NARRATIVE_DESIGN] || store.getArtifact<any>(projectId, WorkflowStage.NARRATIVE_DESIGN);
    const rawCharacters = narrativeArtifact?.characters || [];

    if (rawCharacters.length === 0) {
      throw new Error('缺少前序故事圣经角色数据，请先推进第一阶段【叙事架构】生成角色小传');
    }

    const style = params.styleOverride || narrativeArtifact.style || project?.meta?.style || '电影质感，冷色调，高对比度光影';
    const llm = LLMRegistry.get();

    // 🌟 单角色微调自愈分支：如果指定了目标角色且已有历史产物
    const existingArtifact = context.artifacts?.[WorkflowStage.CHARACTER_DESIGN] || store.getArtifact<CharacterPortraitArtifact>(projectId, WorkflowStage.CHARACTER_DESIGN);
    const targetNames = params.targetCharacterNames;

    if (targetNames && targetNames.length > 0) {
      if (!existingArtifact || !Array.isArray(existingArtifact.characters) || existingArtifact.characters.length === 0) {
        throw new Error('当前项目尚无既有角色定妆资产，无法执行指定角色微调，请先执行全量角色定妆生成');
      }

      await this.notifyProgress(context, 30, `正在为指定的 ${targetNames.join(', ')} 执行语义微调自愈与提示词重塑...`);

      const updatedList = [...existingArtifact.characters];

      let refinedCount = 0;
      for (const targetName of targetNames) {
        const charIdx = updatedList.findIndex((c) => c.name === targetName);
        if (charIdx === -1) continue;

        refinedCount++;
        const currentChar = updatedList[charIdx];
        const refinePrompt = buildRefineCharacterPrompt(currentChar, params.userFeedback || '优化五官精细度与电影质感', style);

        const refineRes = await llm.generateObject<RefineCharacterVisualPromptOutput>(
          refinePrompt,
          RefineCharacterVisualPromptSchema,
          REFINE_CHARACTER_SYSTEM_PROMPT,
          { stage: 'character_refine', abortSignal, temperature: 0.3 }
        );

        const newPrompt = refineRes.refinedVisualPrompt || currentChar.visualPrompt;
        // 🌟 100% 意图透传：将微调后的大模型提示词透传给渲染器并接收降级标记
        const renderRes = await VisualMediaRenderer.renderCharacterPortrait(
          projectId,
          currentChar.name,
          newPrompt,
          { isMock: params.isMock, abortSignal }
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
        throw new Error(`未在既有定妆资产中找到指定微调的目标角色 [${targetNames.join(', ')}]`);
      }

      const updatedArtifact: CharacterPortraitArtifact = {
        characters: updatedList,
        totalCharacters: updatedList.length,
        completedCharacters: updatedList.length,
        style,
        isRefinement: true,
        targetCharacterNames: targetNames,
        createdAt: existingArtifact.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      this.exportToLocalDisk(projectId, updatedArtifact);

      const degradedChars = updatedList.filter((c) => c.isDegraded);
      const summaryNote = degradedChars.length > 0
        ? ` (⚠️ 其中 ${degradedChars.length} 位角色因 [${degradedChars[0].degradedReason}] 降级为本地预演占位)`
        : ' (✔ 真实模型电影级生成)';

      return {
        data: updatedArtifact,
        summary: `✨ 角色【${targetNames.join('、')}】微调定妆照交付完成！${summaryNote}。提示词已自愈更新，新版剧照已落盘锁定。`,
      };
    }

    // 🌟 全量角色定妆推演分支
    await this.notifyProgress(context, 30, `正在为 ${rawCharacters.length} 位核心角色推演影视级视觉锚点提示词...`);

    const prompt = buildCharacterVisualSpecPrompt(style, rawCharacters, params.userFeedback);

    const specsResult = await llm.generateObject<CharacterVisualSpecsListOutput>(
      prompt,
      CharacterVisualSpecsListSchema,
      CHARACTER_VISUAL_SPEC_SYSTEM_PROMPT,
      {
        stage: 'character_visual_spec',
        abortSignal,
        temperature: 0.3,
      }
    );

    await this.notifyProgress(context, 70, '正在为角色渲染物理定妆照基准图片并建立视觉锚点...');

    const specsMap = new Map<string, string>();
    for (const s of specsResult.specs || []) {
      specsMap.set(s.name, s.visualPrompt);
    }

    // 🌟 3路并发控制与原子断点落盘
    const characters = await asyncPool<any, CharacterSheetItem>(
      3,
      rawCharacters,
      async (c: any) => {
        const generatedPrompt = specsMap.get(c.name) || `${c.appearance}，电影质感，超清8K剧照，大师级电影布光，真实人物特写`;
        // 🌟 核心修复：透传提示词与 abortSignal，并准确捕获降级标记
        const renderRes = await VisualMediaRenderer.renderCharacterPortrait(
          projectId,
          c.name,
          generatedPrompt,
          { isMock: params.isMock, abortSignal }
        );

        return {
          name: c.name,
          role: c.role,
          gender: c.gender,
          age: c.age,
          appearance: c.appearance,
          personality: c.personality,
          motivation: c.motivation,
          visualPrompt: generatedPrompt,
          imageUrl: renderRes.url,
          referenceImageUrl: renderRes.url,
          selected: true,
          isDegraded: renderRes.isDegraded,
          degradedReason: renderRes.degradedReason,
        };
      },
      (completed, total, item) => {
        const percent = 70 + Math.round((completed / total) * 25);
        this.notifyProgress(context, percent, `正在并发渲染角色定妆照 (${completed}/${total}): ${item.name}`);
      },
      abortSignal
    );

    if (characters.length === 0) {
      throw new Error('全量角色定妆推演失败，未产生有效角色定妆照');
    }

    const artifact: CharacterPortraitArtifact = {
      characters,
      totalCharacters: characters.length,
      completedCharacters: characters.length,
      style,
      createdAt: new Date().toISOString(),
    };

    // 本地磁盘持久化
    this.exportToLocalDisk(projectId, artifact);

    const degradedCount = characters.filter((c) => c.isDegraded).length;
    const realCount = characters.length - degradedCount;
    const degradedNote = degradedCount > 0
      ? ` ⚠️ 注意：其中 ${degradedCount} 位角色由于 [${characters.find((c) => c.isDegraded)?.degradedReason}] 降级为本地预演占位，真实渲染 ${realCount} 位。`
      : ` (全员 ${realCount} 位角色全部由真实模型渲染就绪)`;

    const summary = `🎨 全剧 ${artifact.characters.length} 位核心角色定妆视觉锚点已生成完成！${degradedNote}。各角色视觉特写、服装质感与光影规范已锁定，项目已推进至【分场剧本】阶段。`;

    return {
      data: artifact,
      summary,
    };
  }

  private exportToLocalDisk(projectId: string, artifact: CharacterPortraitArtifact): void {
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

      let md = `# 全剧核心角色定妆档案集 (Character Lookbook)\n\n> **生成时间**: ${artifact.createdAt}\n> **统一视觉风格**: ${artifact.style}\n\n`;
      for (const c of artifact.characters) {
        md += `## ${c.name} (${c.role})\n\n`;
        md += `- **外貌特征**: ${c.appearance}\n`;
        md += `- **定妆提示词**: \`${c.visualPrompt}\`\n\n`;
      }

      fs.writeFileSync(path.join(charDir, 'character_lookbook.md'), md, 'utf-8');
    } catch (err) {
      console.warn('[CharacterPortraitSkill] 本地落盘警告:', err);
    }
  }
}
