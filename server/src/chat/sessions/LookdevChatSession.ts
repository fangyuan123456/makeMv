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
import { assetExtractionTool, characterPortraitTool, propLookdevTool, sceneAtmosphereTool } from '../../tools/film-production/index.js';
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
        toolName: assetExtractionTool.toolName,
        title: '新增或删除角色/场景资产',
        description: assetExtractionTool.description,
        schema: assetExtractionTool.inputSchema || z.any(),
      },
      {
        toolName: propLookdevTool.toolName,
        title: '渲染核心道具特写',
        description: propLookdevTool.description,
        schema: propLookdevTool.inputSchema || z.any(),
      },
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

    const pendingChars = characters.filter((c: any) => !c.imageUrl);
    const pendingLocs = locations.filter((l: any) => !l.imageUrl);
    const pendingCharIds = pendingChars.map((c: any) => c.characterId || c.id);
    const pendingLocIds = pendingLocs.map((l: any) => l.locationId || l.id);

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

【当前待定妆实体清单（动态实时计算）】：
- 待定妆角色 (${pendingChars.length} 个): ${pendingChars.map((c: any) => `${c.name}(ID: ${c.characterId || c.id})`).join('、') || '全部已定妆'}
- 待定妆场景 (${pendingLocs.length} 个): ${pendingLocs.map((l: any) => `${l.name}(ID: ${l.locationId || l.id})`).join('、') || '全部已出图'}

### 批量与多实体调度铁律（Single-Task Multi-Entity SSOT）：
1. 单次对话中【有且仅能调用一次 emit_director_intent 产生一张卡片与一个物理任务】。
2. 底层物理工具已支持在单次任务中批量并发渲染多个实体！绝对严禁在对话正文中口头宣称“我将并行出具多张卡片”或“另外几张仍在渲染”，严禁反事实幻觉与虚假承诺！
3. 当创作者要求批量处理多个实体（如指定两个角色、或要求全量定妆）时：
   - 角色工具 (film.character_portrait)：
     * 指定多个角色时，params.characterId 必须是包含所有目标角色 ID 的数组，例如 ["id_1", "id_2"]；
     * 全量待定妆角色时，params.characterId 可直接传入 [${pendingCharIds.map((id: string) => `"${id}"`).join(', ')}]，或者直接省略 characterId（底层工具会自动为所有未定妆角色生成）；
   - 场景工具 (film.scene_atmosphere)：
     * 指定多个场景时，params.locationId 必须是包含所有目标场景 ID 的数组，例如 ["loc_1", "loc_2"]；
     * 全量待定妆场景时，params.locationId 可直接传入 [${pendingLocIds.map((id: string) => `"${id}"`).join(', ')}]，或者直接省略 locationId（底层工具会自动为所有未定妆场景生成）；
4. 语言承诺与 params 参数必须 100% 物理真实对齐，严禁 params 里只填单个 ID，对白中却声称处理了全部或多个！

### 决策与执行协议
你持有官方意图决策工具【emit_director_intent】。在流式自然语言回复中，严格根据资产清单、意图决策漏斗与当前挂载的能力编目，调用该工具发射决策信号：
- 必须输出对话正文（Mandatory Speech）：在调用 emit_director_intent 的同时，必须在对话正文中先阐明微调思路或确认对白，严禁正文留空；
- propose: 出具针对角色立绘或场景氛围的微调渲染方案卡片（params 包含 characterId [支持单角色 ID 字符串或多角色 ID 数组例如 ["char_1", "char_2"] 批量定妆] / locationId [支持单场景 ID 字符串或多场景 ID 数组批量出图], instruction, force: true）；
- 当创作者要求生成核心道具特写时，targetTool 使用 ${propLookdevTool.toolName}，params 提供 itemId、force: true；只有剧情关键、反复出现或需要连续性的道具才进入定妆。
- 当创作者要求新增或删除角色/场景时，targetTool 使用 ${assetExtractionTool.toolName}，params 使用 mode=modify 和 modifications 数组；新增提供 entityType、name、entity 设定，删除提供 entityId 或 name。若创作者说“重新读剧本补齐/检查漏掉的角色或场景”，则使用 mode=modify + instruction，让工具结合剧本与 PRD 增量重提取。该操作只修改资产清单，不自动生成图片。
- approve: 识别创作者认可授权指令（如“同意/准了/开跑/开始吧”），直接授权执行；
- modify: 吸收创作者修改意见，重塑微调参数；
- chat_only: 纯审美讨论或多方案权衡探讨时使用，无需发起微调方案。

${BaseChatSession.renderFunnelPromptMatrix()}
`;
  }

  /**
   * 覆写意图解析器：基于动态资产清单进行多实体对齐与防漏校准 (Defense in Depth)
   * 零硬编码任何题材、角色名或场景名，完全依据当前项目动态 entities 清单双向反查
   */
  protected override resolveDirectorIntent(args: any): any {
    const intent = super.resolveDirectorIntent(args);
    if (!intent || !intent.params || typeof intent.params !== 'object') {
      return intent;
    }

    const store = ProjectStore.getInstance();
    const entities = (store.getArtifact(this.projectId, 'lookdev_entities') as any) || {};
    const characters: any[] = Array.isArray(entities.characters) ? entities.characters : [];
    const locations: any[] = Array.isArray(entities.locations) ? entities.locations : [];

    // 1. 角色立绘工具多实体校验与纠偏
    if (intent.tool === characterPortraitTool.toolName) {
      intent.params = this.alignMultiEntityParams({
        params: intent.params,
        paramKey: 'characterId',
        entities: characters,
        idGetter: (c) => c.characterId || c.id,
        nameGetter: (c) => c.name,
        contextText: `${args.reasoning || ''} ${args.title || ''} ${intent.params.instruction || ''} ${args.summary || ''}`,
      });
    }

    // 2. 场景氛围工具多实体校验与纠偏
    if (intent.tool === sceneAtmosphereTool.toolName) {
      intent.params = this.alignMultiEntityParams({
        params: intent.params,
        paramKey: 'locationId',
        entities: locations,
        idGetter: (l) => l.locationId || l.id,
        nameGetter: (l) => l.name,
        contextText: `${args.reasoning || ''} ${args.title || ''} ${intent.params.instruction || ''} ${args.summary || ''}`,
      });
    }

    return intent;
  }

  /**
   * 通用多实体参数对齐器 (无题材与具体名字硬编码，动态清单驱动)
   */
  private alignMultiEntityParams(options: {
    params: Record<string, any>;
    paramKey: 'characterId' | 'locationId';
    entities: any[];
    idGetter: (item: any) => string;
    nameGetter: (item: any) => string;
    contextText: string;
  }): Record<string, any> {
    const { params, paramKey, entities, idGetter, nameGetter, contextText } = options;
    if (entities.length === 0) return params;

    const currentVal = params[paramKey];

    // 获取当前已在 params 中的实体 ID 集合
    let currentIds: string[] = [];
    if (Array.isArray(currentVal)) {
      currentIds = currentVal.filter((id) => typeof id === 'string' && id.trim());
    } else if (typeof currentVal === 'string' && currentVal.trim()) {
      currentIds = currentVal.split(',').map((s) => s.trim()).filter(Boolean);
    }

    // 1. 动态反查：从大模型输出文本（reasoning / title / instruction）以及最新创作者输入中，动态比对当前项目中哪些实体被提及
    const mentionedIds = new Set<string>(currentIds);

    const messages = this.getMessages();
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    const userText = lastUserMsg?.content || '';
    const fullSearchText = `${contextText} ${userText}`;

    for (const entity of entities) {
      const eName = nameGetter(entity);
      const eId = idGetter(entity);
      if (eName && fullSearchText.includes(eName)) {
        mentionedIds.add(eId);
      }
    }

    // 如果通过动态实体名称反查发现提及了多个实体，且比当前已传的 ID 更多，自动补齐为数组
    if (mentionedIds.size > 1 && mentionedIds.size > currentIds.length) {
      return {
        ...params,
        [paramKey]: Array.from(mentionedIds),
      };
    }

    // 2. 检查全量/批量未完成项调度：
    // 若创作者或模型表达了全量意图，且当前有多个未定妆项，而 params 仅填了 1 项或遗漏，自动对齐为全部未完成项 ID 列表
    const pendingEntities = entities.filter((e) => !e.imageUrl);
    const pendingIds = pendingEntities.map(idGetter).filter(Boolean);

    // 动态检查创作者发言或模型说明是否包含全量批处理意图（全部/所有/剩余/未定妆/都定）
    const isBatchAllIntent = /全部|所有|剩余|未定妆|都定|批量/.test(fullSearchText);
    if (isBatchAllIntent && pendingIds.length > 1 && currentIds.length <= 1) {
      return {
        ...params,
        [paramKey]: pendingIds,
      };
    }

    return params;
  }
}
