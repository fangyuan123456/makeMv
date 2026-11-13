/**
 * agents/text-game/schema.ts
 * 互动文游分幕原子化强类型契约 (Per-Scene Atomic Contract SSOT)
 *
 * 核心哲学：
 * 1. 分幕物理独立：每一个 SingleSceneJson 文件 1:1 严格对标未来生成的一段独立视频切片 (如 S1.mp4, S1.1.mp4)；
 * 2. 契约复用不重造：直接复用 Stage 1 通用 PRD 的 `PrdInteractionNode` / `PrdWiringEdge` / `PrdStateChange` / `PrdEndingNode`；
 * 3. 自驱动图指针：所有 `onEnded` 交互步、条件接线、状态增改与结局定义随本幕 JSON 落盘。
 */

import { z } from 'zod';
import {
  PrdStateChangeSchema,
  PrdInteractionNodeSchema,
  PrdWiringEdgeSchema,
  PrdEndingNodeSchema,
  PrdStateValueSchema,
} from '../planner/steps/prd-synthesis/schema.js';

/**
 * 剧幕所属场景（地点）引用
 *
 * 只带编号与已落盘的场景空镜，不在每幕里重复描述空间——空间由 locationId 唯一确定，
 * 同一地点跨幕共用同一张母本图，改一次全剧生效。
 */
export const SceneLocationRefSchema = z.object({
  locationId: z.string().describe('场景编号，取自 GlobalEntities.locations[].locationId，如 "loc_living_room"'),
  name: z.string().describe('场景名称，如 "客厅"'),
  imagePath: z.string().optional().describe('场景空镜母本的本地相对路径，如 "assets/locations/loc_living_room.png"'),
  imageUrl: z.string().optional().describe('场景空镜母本的 /media/... URL，前端直接用作背景'),
});

export type SceneLocationRef = z.infer<typeof SceneLocationRefSchema>;

/**
 * 单幕素材文件契约（scenes/S1.json）
 *
 * 把它当成一个「特别格式的视频文件」：里面只有画面和台词，没有任何玩法。
 * 播放顺序、选择按钮、互动点、状态、结局全部属于播放器逻辑，落在 StoryScript 与代码里，
 * 不写进这个文件——换图片、改文案时完全不用碰游戏逻辑。
 */
export const SingleSceneJsonSchema = z.object({
  sceneId: z.string().describe('幕号，与文件名一致，如 "S1" / "S6.1"'),
  title: z.string().describe('本幕标题，HUD 上显示'),
  background: z.string().describe('画面底图 URL（/media/...），整幕就用这一张'),
  text: z.string().describe('本幕台词正文，\\n 分段'),
});

export type SingleSceneJson = z.infer<typeof SingleSceneJsonSchema>;

/**
 * 播放器剧本（scenes/script.json）
 *
 * 素材文件不含玩法，玩法在这里：每一幕播完之后玩家能干什么、往哪走。
 * 播放器只认三件事：interaction（一处介入）、choices（岔口）、ending（终局），没有就是直接 next。
 */
export const ScriptInteractionSchema = z.object({
  kind: z.string().describe('介入类型：CLICK / HOLD / 其它未知类型由播放器降级为点击确认'),
  prompt: z.string().describe('给玩家看的一句操作提示'),
  feedback: z.string().optional().describe('操作完成后的即时反馈文案'),
  stateChange: PrdStateChangeSchema.optional().describe('完成后的状态变更 { add, set }'),
});

export const ScriptChoiceSchema = z.object({
  text: z.string().describe('按钮文案'),
  to: z.string().describe('目标幕号，如 "S7"'),
  stateChange: PrdStateChangeSchema.optional().describe('选择后的状态变更'),
});

export const ScriptEndingSchema = z.object({
  type: z.enum(['HE', 'BE', 'NE', 'TE', 'SE']).optional().describe('结局分类'),
  title: z.string().describe('结局名'),
  verdict: z.string().optional().describe('结局判词'),
  rewindTo: z.string().optional().describe('可回溯重选的幕号'),
});

export const ScriptSceneSchema = z.object({
  sceneId: z.string().describe('对应 scenes/<sceneId>.json'),
  title: z.string().describe('幕标题，HUD 显示用（与素材里的 title 同值）'),
  interaction: ScriptInteractionSchema.nullable().optional().describe('本幕播完后的介入点，可缺省'),
  next: z.string().nullable().optional().describe('介入结束后去的幕号；与 choices / ending 三选一'),
  choices: z.array(ScriptChoiceSchema).optional().describe('岔口选项，没有这个字段就是没有岔口'),
  ending: ScriptEndingSchema.nullable().optional().describe('本幕即终局时的结局信息'),
});

export const StoryScriptSchema = z.object({
  startSceneId: z.string().describe('起始幕号'),
  initialState: z.record(PrdStateValueSchema).default({}).describe('玩家状态初值'),
  scenes: z.array(ScriptSceneSchema).describe('按幕号组织的播放表'),
});

export type ScriptInteraction = z.infer<typeof ScriptInteractionSchema>;
export type ScriptChoice = z.infer<typeof ScriptChoiceSchema>;
export type ScriptScene = z.infer<typeof ScriptSceneSchema>;
export type StoryScript = z.infer<typeof StoryScriptSchema>;

/**
 * 全局实体（角色与道具定妆）与统一美术画风契约
 */
export const GlobalEntitiesSchema = z.object({
  artStyle: z
    .string()
    .describe('全剧统一视觉美术风格与摄影质感描述（角色、道具与场景母本共用，确保画风零割裂）'),
  characters: z.array(
    z.object({
      characterId: z.string().describe('角色标识，如 "char_lin_jin"'),
      name: z.string().describe('角色名称'),
      identity: z.string().describe('身份与立场'),
      appearanceSummary: z.string().describe('固定外观特征描述，锁死长相、发型、服饰与随身配饰'),
      promptZh: z.string().describe('单人定妆生图提示词（单人正面全身站姿、纯中性浅灰无缝背景、无场景元素、无文字水印）'),
      referenceImageUrl: z.string().optional().describe('角色定妆母本图落盘后的 /media/... URL，可人工替换'),
    })
  ).describe('全剧登场核心角色列表'),
  items: z.array(
    z.object({
      itemId: z.string().describe('道具标识，如 "item_charred_badge"'),
      name: z.string().describe('道具名称'),
      description: z.string().describe('道具关键剧情作用与交互点'),
      appearanceSummary: z.string().describe('道具固定视觉外观特征（材质、造型、色彩、刻字或破损细节）'),
      promptZh: z.string().describe('道具定妆特写生图提示词（单个完整道具居中特写、无手部人物入镜、纯中性浅灰无缝背景、无文字水印）'),
      referenceImageUrl: z.string().optional().describe('道具定妆母本图落盘后的 /media/... URL，可人工替换'),
    })
  ).describe('全剧关键信物与道具字典'),
  locations: z
    .array(
      z.object({
        locationId: z
          .string()
          .describe('场景编号，同一物理空间全剧只能有一个（如 "loc_living_room"），供每一幕按编号引用'),
        name: z.string().describe('场景名称，如 "客厅"'),
        atmosphere: z.string().describe('该空间的光线基调与氛围（潮湿幽闭、冷白顶灯、锈迹反光等）'),
        appearanceSummary: z
          .string()
          .describe('固定空间布局：出入口位置、主要设施与家具方位、墙面管线材质、光源位置，锁死后不得随幕变化'),
        promptZh: z
          .string()
          .describe('空镜场景生图提示词（必须无人物、无剧情动作，只画空间与陈设）'),
        sceneIds: z
          .array(z.string())
          .describe(
            '属于该场景的剧幕编号（如 ["S1","S4","S8"]）。通常一幕只归一处；只有该幕确实跨两个空间时才两处都列，且第一个是开场所在空间'
          ),
        referenceImageUrl: z
          .string()
          .optional()
          .describe('场景空镜母本图落盘后的 /media/... URL，可人工替换'),
      })
    )
    .default([])
    .describe('全剧场景（地点）清单：只列物理空间，同一空间跨幕共用一条，不按幕重复'),
});

export type GlobalEntities = z.infer<typeof GlobalEntitiesSchema>;

// ==========================================
// 兼容与过渡契约 (Legacy / Companion Schemas)
// ==========================================

export const TextGameChoiceSchema = z.object({
  id: z.string().describe('选项唯一标识'),
  text: z.string().describe('选项文本'),
  condition: z.string().nullable().optional().describe('可选前置条件表达式'),
  requiredFlags: z.array(z.string()).default([]),
  requiredItems: z.array(z.string()).optional().default([]),
  requiredVariables: z.record(z.any()).optional().default({}),
  stateMutation: z
    .object({
      variables: z.record(z.number()).optional().default({}),
      setVariables: z.record(z.number()).optional().default({}),
      flags: z.record(z.boolean()).optional().default({}),
      inventoryAdd: z.array(z.string()).optional().default([]),
      inventoryRemove: z.array(z.string()).optional().default([]),
    })
    .default({}),
  targetNodeId: z.string().describe('选择后跳转的下一个文游节点 ID'),
});

export const SceneVisualSchema = z.object({
  scenePrompt: z.string().describe('场景环境、光影色调与空间细节描写'),
  characterPrompt: z.string().describe('出场角色外貌、着装细节与当下的肢体动作微表情'),
  composition: z.string().describe('第一视角机位构图'),
  imagePromptEn: z.string().describe('标准文生图纯英文母本 Prompt'),
  imageUrl: z.string().optional(),
  perspective: z.string().optional(),
  entityNames: z.array(z.string()).optional(),
});

export const TextGameNodeSchema = z.object({
  id: z.string().describe('节点唯一标识'),
  beatId: z.string().optional(),
  title: z.string().describe('场景标题'),
  visual: SceneVisualSchema.optional(),
  narrativeText: z.string().describe('文学演出正文'),
  choices: z.array(TextGameChoiceSchema).default([]),
  audioCue: z.string().optional(),
  isEnding: z.boolean().optional().default(false),
  endingType: z.string().optional(),
});

export const TextGameArtifactSchema = z.object({
  schemaVersion: z.string().default('1.0.0'),
  title: z.string().describe('文游作品名'),
  startNodeId: z.string().describe('文游起始节点 ID'),
  initialState: z.record(PrdStateValueSchema).optional().default({}),
  nodes: z.array(TextGameNodeSchema).min(1).describe('文游全量可交互节点图谱'),
});

export type TextGameChoice = z.infer<typeof TextGameChoiceSchema>;
export type SceneVisual = z.infer<typeof SceneVisualSchema>;
export type TextGameNode = z.infer<typeof TextGameNodeSchema>;
export type TextGameArtifact = z.infer<typeof TextGameArtifactSchema>;

export const EntityAssetSchema = z.object({
  name: z.string(),
  summary: z.string(),
  visualPrompt: z.string(),
});
export type EntityAsset = z.infer<typeof EntityAssetSchema>;

export const SpaceAssetSchema = z.object({
  name: z.string(),
  atmosphere: z.string(),
  visualPrompt: z.string(),
});
export type SpaceAsset = z.infer<typeof SpaceAssetSchema>;

export const DialogueMomentSchema = z.object({
  speaker: z.string().optional(),
  line: z.string().optional(),
  action: z.string().optional(),
  subtext: z.string().optional(),
  theme: z.string().optional(),
  lines: z.array(z.any()).optional(),
});
export type DialogueMoment = z.infer<typeof DialogueMomentSchema>;

export const ProductionBibleSchema = z.object({
  title: z.string().optional(),
  entities: z.array(EntityAssetSchema).default([]),
  locations: z.array(SpaceAssetSchema).default([]),
  keyMoments: z.array(DialogueMomentSchema).default([]),
});
export type ProductionBible = z.infer<typeof ProductionBibleSchema>;

export const TextGameGenerationSchema = z.object({
  artifact: TextGameArtifactSchema,
  bible: ProductionBibleSchema.optional(),
});
export type TextGameGeneration = z.infer<typeof TextGameGenerationSchema>;

