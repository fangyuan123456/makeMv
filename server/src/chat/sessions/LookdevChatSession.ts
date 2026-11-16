/**
 * server/src/chat/sessions/LookdevChatSession.ts
 * 专职视觉定妆空间机器人微内核 (Lookdev Specialist Chat Session SSOT)
 *
 * 核心架构模式：
 * 1. 声明式工序能力规范 (getIntentToolSpecs SSOT)：
 *    直连 characterPortraitTool 与 sceneAtmosphereTool；
 * 2. 基类内置官方意图决策工具 (emit_director_intent) 与 P0 ➔ P5 漏斗；
 * 3. 外部提示词纯业务化，零硬编码具体工具名。
 */

import { z } from 'zod';
import { BaseChatSession } from '../BaseChatSession.js';
import { ProjectStore } from '../../project-store/ProjectStore.js';
import { characterPortraitTool, sceneAtmosphereTool } from '../../tools/film-production/index.js';
import type { SubmittableToolSpec } from '../types.js';

export interface LookdevActionIntent {
  action: 'run_tool' | 'approve' | 'modify' | 'next_stage';
  tool: 'film.character_portrait' | 'film.scene_atmosphere';
  title: string;
  params: Record<string, any>;
  description?: string;
  reasoning?: string;
}

export class LookdevChatSession extends BaseChatSession<LookdevActionIntent> {
  constructor(options: { projectId: string; sessionId?: string }) {
    super({
      projectId: options.projectId,
      sessionId: options.sessionId || 'lookdev',
    });
  }

  /**
   * 声明视觉定妆空间支持的法定物理工具清单 (SSOT)
   */
  protected getIntentToolSpecs(): SubmittableToolSpec[] {
    return [
      {
        toolName: characterPortraitTool.toolName,
        title: '微调角色立绘定妆',
        description: characterPortraitTool.description,
        schema: characterPortraitTool.inputSchema || z.any(),
      },
      {
        toolName: sceneAtmosphereTool.toolName,
        title: '重新渲染场景概念图',
        description: sceneAtmosphereTool.description,
        schema: sceneAtmosphereTool.inputSchema || z.any(),
      },
    ];
  }

  /**
   * 组装视觉定妆专属 System Prompt
   */
  protected assembleSystemPrompt(): string {
    const store = ProjectStore.getInstance();
    const project = store.getProject(this.projectId) as any;
    const entities = (store.getArtifact(this.projectId, 'lookdev_entities') as any) || project?.entities || {};
    const prd = (store.getArtifact(this.projectId, 'universal_prd') as any) || (store.getArtifact(this.projectId, 'prd') as any) || project?.prd || {};

    const characters = Array.isArray(entities.characters) ? entities.characters : [];
    const locations = Array.isArray(entities.locations) ? entities.locations : [];

    const charSummary = characters
      .map(
        (c: any) =>
          `- 角色[${c.name}](ID: ${c.characterId || c.id}): 身份=${c.identity || '未知'}, 外貌=${c.appearanceSummary || '未定'}, 定妆图=${c.imageUrl ? '已定妆' : '待定妆'}`
      )
      .join('\n');

    const locSummary = locations
      .map(
        (l: any) =>
          `- 场景[${l.name}](ID: ${l.locationId || l.id}): 氛围=${l.atmosphere || '未知'}, 概念图=${l.imageUrl ? '已出图' : '待定妆'}`
      )
      .join('\n');

    return `你是一名享誉业界的顶级电影视觉总监与定妆空间大师（Lookdev & Production Designer）。
你现在正在工序 2【全剧视觉定妆工坊】中，专职协助创作者把控全剧的角色定妆、服装设计与场景空间光影美学。

【你的专注领域（仅限角色与场景视觉资产）】：
1. 角色定妆：发型、面容特征、体态神情、服装材质、伤痕与配件细节；
2. 场景空间：空间结构、建筑材质、天气、冷暖光影、室内陈设与视听氛围；
3. 全局美术风格：保持全片光影质感与影调一致性（如电影级高对比、自然冷峻写实）。
你【不负责】分镜镜头切分与运镜，若创作者询问分镜，请引导创作者在分镜台本页面与分镜导演交流。

【当前项目视觉资产清单】：
- 项目标题：${project?.meta?.title || prd?.gameTitle || '未命名短剧'}
- 全局艺术风格：${entities?.artStyle || '电影级写实摄影质感，真实光影'}

[1. 角色资产库] (${characters.length} 个角色):
${charSummary || '暂无角色'}

[2. 场景空间库] (${locations.length} 个场景):
${locSummary || '暂无场景'}

### 决策与执行协议
你持有官方意图决策工具【emit_director_intent】。在流式自然语言回复中，严格根据资产清单、意图决策漏斗与当前挂载的能力编目，调用该工具发射决策信号：
- 必须输出对话正文（Mandatory Speech）：在调用 emit_director_intent 的同时，必须在对话正文中先阐明微调思路或确认对白，严禁正文留空；
- propose: 出具针对角色立绘或场景氛围的微调渲染方案卡片（params 包含 characterId/locationId, instruction, force: true）；
- approve: 识别创作者认可授权指令（如“同意/准了/开跑/开始吧”），直接授权执行；
- modify: 吸收创作者修改意见，重塑微调参数；
- chat_only: 纯审美讨论或多方案权衡探讨时使用，无需发起微调方案。

${BaseChatSession.renderFunnelPromptMatrix()}
`;
  }
}
