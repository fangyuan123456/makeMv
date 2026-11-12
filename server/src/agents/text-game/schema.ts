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
 * 单条视听对白台词契约
 */
export const SceneDialogueLineSchema = z.object({
  speaker: z.string().describe('说话人名牌，如 "独白", "林烬", "薇拉"'),
  line: z.string().describe('精炼台词字幕，如 "（咳出一口带铁锈味的血沫）...第七秒才沉下去。"'),
  emotion: z.string().optional().describe('情绪与语气神态，如 "虚弱痛苦", "冷峻警惕"'),
  audioClipPath: z.string().optional().describe('未来 TTS 语音合成落盘后的本地音频切片路径'),
});

export type SceneDialogueLine = z.infer<typeof SceneDialogueLineSchema>;

/**
 * 分支选项与自驱动指针契约
 */
export const SceneChoiceItemSchema = z.object({
  choiceId: z.string().describe('选项唯一标识，如 "I_S1_A"'),
  text: z.string().describe('玩家按钮展示文本，如 "主动递出随身钥匙"'),
  nextSceneJson: z.string().describe('目标场景 JSON 文件名，如 "S2.json" 或 "S1.1.json"'),
  stateChange: PrdStateChangeSchema.optional().describe('流外状态变更 ({ add, set })，100% 对齐 PRD'),
  condition: z.string().nullable().optional().describe('可选前置条件表达式'),
});

export type SceneChoiceItem = z.infer<typeof SceneChoiceItemSchema>;

/**
 * 单幕自包含原子 JSON 契约 (1:1 锚定未来的单个 MP4 视频切片)
 */
export const SingleSceneJsonSchema = z.object({
  sceneId: z.string().describe('场景唯一标识，严格对齐 PRD clips[].id，如 "S1" 或 "S1.1"'),
  level: z.number().describe('拓扑层级 (1 到 n)'),
  title: z.string().describe('本幕标题'),
  targetVideoClipName: z.string().describe('1:1 锚定的未来视频文件名，如 "S1.mp4"'),
  estimatedDurationSeconds: z.number().default(8).describe('预估视频切片时长 (秒)'),
  entityIds: z
    .array(z.string())
    .optional()
    .describe('本幕出场的角色/道具 ID，值必须来自 GlobalEntities 的 characterId / itemId；用于注入生图参考图与素材包引用'),
  entityRefs: z
    .record(z.string())
    .optional()
    .describe('本幕实体母本图的 /media/... URL 映射 (entityId -> url)，落盘后随本幕 JSON 自包含，可人工替换'),

  // 1. 视觉母本 (每一段尾帧定格场景图，须融入本幕全部所需角色与道具)
  visualAnchor: z.object({
    endFrameMoment: z.string().describe('本幕播完定格瞬间的尾帧画面描述（角色站位、动作神态与关键道具交互状态，与 onEnded 交互完全对位）'),
    cameraAngle: z.string().describe('摄影机机位与景别描述，如 "中景特写，微俯视角度，机位慢速推进"'),
    lighting: z.string().describe('光影与色彩氛围描述，贴合原作题材基调'),
    promptZh: z.string().describe('尾帧场景中文生图提示词（须将本幕 entityIds 中全部角色与道具融入同一连贯画面，严禁拼贴分格）'),
    promptEn: z.string().describe('尾帧场景英文高清生图提示词 (忠实原作题材美术风格与光线质感)'),
    assembledPrompt: z.string().optional().describe('生图时实际拼装的多定妆参考图绑定提示词（含 <image1>..<imageN> 映射说明）'),
    sceneImagePath: z.string().optional().describe('物理生图落盘后的真实本地路径，如 "assets/scenes/S1_end.png"'),
    sceneImageUrl: z.string().optional().describe('可直接展示或喂给下游工具的 /media/<projectId>/... URL'),
  }),

  // 2. 视听演播 (当前逐句字幕，未来 TTS 语音与 I2V 动作描述)
  screenplay: z.object({
    storyContext: z.string().describe('场景核心背景与叙事情境'),
    videoActionDescription: z.string().describe('专门供未来图生视频 (I2V) 消费的动态动作与运镜描述词'),
    dialogues: z.array(SceneDialogueLineSchema).min(1).describe('逐句对白字幕列表'),
  }),

  // 3. 交互与自驱动状态机接线 (onEnded)
  interaction: z.object({
    steps: z
      .array(PrdInteractionNodeSchema)
      .default([])
      .describe('本幕播完(onEnded)按序执行的互动节点清单（完整对齐 PRD interactions）'),
    wiring: z
      .array(PrdWiringEdgeSchema)
      .default([])
      .describe('本幕及所属互动点的有序接线出边（按数组顺序匹配首条满足 condition 的连线）'),
    endings: z
      .array(PrdEndingNodeSchema)
      .default([])
      .describe('本幕接线可抵达的结局定义列表'),
    choices: z.array(SceneChoiceItemSchema).describe('分支/承接选项列表，直接指向 nextSceneJson'),
    isEnding: z.boolean().default(false).describe('是否为无后续视频片段的收敛终局'),
    endingType: z.enum(['HE', 'BE', 'NE', 'TE', 'SE']).optional().describe('默认结局分类标识'),
    endingTitle: z.string().optional().describe('默认结局名称'),
    verdict: z.string().optional().describe('深刻命运判词'),
    rewindTargetScene: z.string().optional().describe('若为负向/BE 结局，回溯重选目标 JSON 文件名，如 "S1.json"'),
  }),
});

export type SingleSceneJson = z.infer<typeof SingleSceneJsonSchema>;

/**
 * 全局实体（角色与道具定妆）与统一美术画风契约
 */
export const GlobalEntitiesSchema = z.object({
  artStyle: z
    .string()
    .describe('全剧统一视觉美术风格与摄影质感描述（人物定妆、道具定妆与尾帧场景图共用，确保画风零割裂）'),
  characters: z.array(
    z.object({
      characterId: z.string().describe('角色标识，如 "char_lin_jin"'),
      name: z.string().describe('角色名称'),
      identity: z.string().describe('身份与立场'),
      appearanceSummary: z.string().describe('固定外观特征描述，锁死长相、发型、服饰与随身配饰'),
      promptZh: z.string().describe('中文单人定妆生图提示词（单人正面全身站姿、纯中性浅灰无缝背景、无场景元素、无文字水印）'),
      promptEn: z.string().describe('英文单人定妆生图提示词'),
      referenceImageUrl: z.string().optional().describe('角色定妆母本图落盘后的 /media/... URL，可人工替换'),
    })
  ).describe('全剧登场核心角色列表'),
  items: z.array(
    z.object({
      itemId: z.string().describe('道具标识，如 "item_charred_badge"'),
      name: z.string().describe('道具名称'),
      description: z.string().describe('道具关键剧情作用与交互点'),
      appearanceSummary: z.string().describe('道具固定视觉外观特征（材质、造型、色彩、刻字或破损细节）'),
      promptZh: z.string().describe('中文道具定妆特写生图提示词（单个完整道具居中特写、无手部人物入镜、纯中性浅灰无缝背景、无文字水印）'),
      promptEn: z.string().describe('英文道具定妆特写生图提示词'),
      referenceImageUrl: z.string().optional().describe('道具定妆母本图落盘后的 /media/... URL，可人工替换'),
    })
  ).describe('全剧关键信物与道具字典'),
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

