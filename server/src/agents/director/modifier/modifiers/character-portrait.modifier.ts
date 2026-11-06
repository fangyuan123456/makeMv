/**
 * agents/modifier/modifiers/character-portrait.modifier.ts
 * 角色定妆增量微调、历史版本压栈与锁定原图修改引擎 (Character Portrait Modifier SSOT)
 */

import type { LLMService } from '../../../../llm/LLMService.js';
import { CharacterRenderer } from '../../../../media/index.js';
import { ProjectStore } from '../../../../project-store/ProjectStore.js';
import { WorkflowStage } from '../../../../types/index.js';
import {
  REFINE_CHARACTER_SYSTEM_PROMPT,
  buildRefineCharacterPrompt,
} from '../../generator/steps/character-portrait/prompt.js';
import {
  RefineCharacterVisualPromptSchema,
  type RefineCharacterVisualPromptOutput,
  type CharacterSheetItem,
  type PortraitHistoryRecord,
  type CharacterPortraitArtifact,
} from '../../generator/steps/character-portrait/schema.js';

export interface RefineCharacterPromptOptions {
  existingChar: CharacterSheetItem;
  userFeedback: string;
  style: string;
  effectiveConstraints?: string[];
  projectId?: string;
}

export async function refineCharacterVisualPrompt(
  llm: LLMService,
  options: RefineCharacterPromptOptions
): Promise<string> {
  const { existingChar, userFeedback, style, effectiveConstraints, projectId } = options;
  try {
    const refinePrompt = buildRefineCharacterPrompt(
      existingChar,
      userFeedback,
      style,
      effectiveConstraints
    );
    const refineRes = await llm.generateObject<RefineCharacterVisualPromptOutput>(
      refinePrompt,
      RefineCharacterVisualPromptSchema,
      REFINE_CHARACTER_SYSTEM_PROMPT,
      { stage: 'character_refine', projectId, temperature: 0.3 }
    );
    return refineRes.refinedVisualPrompt || existingChar.visualPrompt;
  } catch (err) {
    console.warn(`[character-portrait.modifier] 微调角色【${existingChar.name}】提示词重写失败，保持原提示词微调:`, err);
    return `${existingChar.visualPrompt}，${userFeedback}`;
  }
}

export function archiveHistoryAndPrepareRefine(existingChar: CharacterSheetItem | undefined): {
  history: PortraitHistoryRecord[];
  referenceImageUrl?: string;
  useReference: boolean;
} {
  const history: PortraitHistoryRecord[] = Array.isArray(existingChar?.history)
    ? [...existingChar.history]
    : [];

  let referenceImageUrl: string | undefined = undefined;
  let useReference = false;

  if (existingChar?.imageUrl) {
    const alreadyInHistory = history.some((h) => h.imageUrl === existingChar.imageUrl);
    if (!alreadyInHistory) {
      history.push({
        id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        imageUrl: existingChar.imageUrl,
        visualPrompt: existingChar.visualPrompt || '',
        createdAt: new Date().toISOString(),
      });
    }
    referenceImageUrl = existingChar.imageUrl;
    useReference = true;
  }

  return {
    history,
    referenceImageUrl,
    useReference,
  };
}

export async function renderModifiedCharacter(
  projectId: string,
  char: any,
  visualPrompt: string,
  options: {
    useReference?: boolean;
    referenceImageUrl?: string;
    isMock?: boolean;
    history?: PortraitHistoryRecord[];
  } = {}
): Promise<CharacterSheetItem> {
  const { useReference = true, referenceImageUrl, isMock, history = [] } = options;
  const effectiveRefUrl = useReference ? referenceImageUrl : undefined;

  const renderRes = await CharacterRenderer.renderCharacterPortrait(
    projectId,
    char.name,
    visualPrompt,
    {
      isMock,
      referenceImageUrl: effectiveRefUrl,
      mode: effectiveRefUrl ? 'character_ref2i' : 'character_t2i',
    }
  );

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
    referenceImageUrl: referenceImageUrl || renderRes.url,
    useReference,
    history,
    isNew: false,
  };
}

export interface ModifyCharacterPortraitOptions {
  projectId: string;
  targetName?: string;
  userFeedback: string;
  llm: LLMService;
  isMock?: boolean;
}

export interface ModifyCharacterPortraitResult {
  success: boolean;
  data?: CharacterPortraitArtifact;
  summary?: string;
  error?: string;
}

export async function modifyCharacterPortrait(
  options: ModifyCharacterPortraitOptions
): Promise<ModifyCharacterPortraitResult> {
  const { projectId, targetName, userFeedback, llm, isMock } = options;
  const store = ProjectStore.getInstance();
  const existingArtifact = store.getArtifact<CharacterPortraitArtifact>(
    projectId,
    WorkflowStage.CHARACTER_DESIGN
  );

  if (!existingArtifact || !Array.isArray(existingArtifact.characters) || existingArtifact.characters.length === 0) {
    return {
      success: false,
      error: `项目 [${projectId}] 尚未生成角色定妆照，无法执行局部精修`,
    };
  }

  // 1. 定位目标角色 (若未指定，默认取第 1 个角色)
  const characters = [...existingArtifact.characters];
  const targetIndex = targetName
    ? characters.findIndex(
        (c) =>
          c.name.toLowerCase() === targetName.toLowerCase() ||
          c.name.includes(targetName) ||
          targetName.includes(c.name)
      )
    : 0;

  if (targetIndex < 0) {
    return {
      success: false,
      error: `未在已有定妆照中找到角色【${targetName}】`,
    };
  }

  const targetChar = characters[targetIndex];
  const project = store.getProject(projectId);
  const narrative = store.getArtifact<any>(projectId, WorkflowStage.NARRATIVE_DESIGN);
  const style = narrative?.style || project?.meta?.style || '电影质感，写实光影';

  // 2. 局部提示词重写
  const refinedPrompt = await refineCharacterVisualPrompt(llm, {
    existingChar: targetChar,
    userFeedback,
    style,
    projectId,
  });

  // 3. 历史记录压栈准备
  const { history, referenceImageUrl, useReference } = archiveHistoryAndPrepareRefine(targetChar);

  // 4. 单点渲染新定妆照
  const updatedChar = await renderModifiedCharacter(projectId, targetChar, refinedPrompt, {
    useReference,
    referenceImageUrl,
    isMock,
    history,
  });

  // 5. 单点替换目标角色，其余角色 100% 物理保全
  characters[targetIndex] = updatedChar;

  const updatedArtifact: CharacterPortraitArtifact = {
    ...existingArtifact,
    characters,
    updatedAt: new Date().toISOString(),
  };

  store.setArtifact(projectId, WorkflowStage.CHARACTER_DESIGN, updatedArtifact);

  return {
    success: true,
    data: updatedArtifact,
    summary: `已完成角色【${targetChar.name}】的局部微调精修，定妆照已重新生成并压入版本历史。其余 ${characters.length - 1} 位角色 100% 物理保持原状。`,
  };
}
