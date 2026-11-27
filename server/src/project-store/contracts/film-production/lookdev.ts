import { z } from 'zod';

export const PoseConstraintSchema = z.object({
  stance: z.enum(['neutral', 'feet_together']).describe('neutral=自然直立；feet_together=双脚并拢、脚踝贴合'),
});

export type PoseConstraint = z.infer<typeof PoseConstraintSchema>;

export const ImageUpscaleMetaSchema = z.object({
  multiplier: z.number().describe('超分放大倍率，如 2 或 4'),
  upscaledAt: z.string().describe('超分完成 ISO 时间戳'),
  sourceVersionId: z.string().optional().describe('超分前源版本 ID'),
});

export type ImageUpscaleMeta = z.infer<typeof ImageUpscaleMetaSchema>;

export const LookdevVersionSchema = z.object({
  versionId: z.string().describe('版本唯一标识符，如 v_1794739200000'),
  imageUrl: z.string().describe('持久化媒体访问路径'),
  promptZh: z.string().optional().describe('生成该版本时使用的中文提示词'),
  referenceImageUrl: z.string().optional().describe('生成该版本时使用的参考图'),
  instruction: z.string().optional().describe('该版本的定向修改或超分说明'),
  reviewStatus: z.enum(['pending', 'accepted']).optional().describe('视觉修改候选版本的验收状态；旧版本无此字段'),
  poseConstraint: PoseConstraintSchema.optional().describe('该版本生成时使用的姿态约束'),
  upscale: ImageUpscaleMetaSchema.optional().describe('高清超分记录（SeedVR2），随版本绑定'),
  createdAt: z.string().describe('版本创建时间戳'),
});

export type LookdevVersion = z.infer<typeof LookdevVersionSchema>;

export const SpatialLayoutSchema = z.string().describe(
  '场景客观三维相对拓扑蓝图（以核心地标为原点，连贯交代正面通路、左右翼立面及顶空光影的相对空间关系，纯文本自然语言，专供下游分镜拍摄视锥调度）'
);

export type SpatialLayout = z.infer<typeof SpatialLayoutSchema>;

export const CharacterSpecSchema = z.object({
  characterId: z.string().describe('角色唯一标识符，格式如 char_xxx'),
  name: z.string().describe('角色姓名'),
  identity: z.string().describe('身份定位与背景'),
  appearanceSummary: z.string().describe('角色基础外貌特征概况（年龄、体态、面部特征、服饰）'),
  voiceStyle: z.string().optional().describe('角色专属声色与说话风格（如年龄音域、嗓音质感、语速节奏，专供下游视频台词配音保持音色一致）'),
  promptZh: z.string().describe('角色本体纯净物理特征（严格80~120汉字，一段纯中文连贯自然语言）：生理年龄、五官骨相、发型发色、标志服装款式与剪裁面料、常驻随身配饰。严禁包含任何姿态动作（如立姿、站姿、双手下垂）、严禁包含任何构图背景与排版外壳、严禁输出任何结构小标题或标号。'),
  poseConstraint: PoseConstraintSchema.optional(),
  referenceImageUrl: z.string().optional(),
  imageUrl: z.string().optional(),
  versions: z.array(LookdevVersionSchema).optional().default([]),
  selectedVersionId: z.string().optional(),
});
export type CharacterSpec = z.infer<typeof CharacterSpecSchema>;

export const ItemSpecSchema = z.object({
  itemId: z.string().describe('道具唯一标识符，格式如 item_xxx'),
  name: z.string().describe('道具名称'),
  description: z.string().describe('道具剧情功能与作用'),
  appearanceSummary: z.string().describe('道具外观描述与材质质感'),
  promptZh: z.string().describe('道具纯净实物外观特征（严格60~100汉字，一段纯中文连贯自然语言）：实物几何构型与比例、专属物理材质工艺（如手工构皮纸/素银锻打/竹木织物）、使用痕迹与包浆质感。严禁包含单体棚拍、居中陈列、微距静物、干净中性影调、无手部无背景等下游渲染外壳，严禁输出任何结构小标题或标号。'),
  referenceImageUrl: z.string().optional(),
  imageUrl: z.string().optional(),
  versions: z.array(LookdevVersionSchema).optional().default([]),
  selectedVersionId: z.string().optional(),
});
export type ItemSpec = z.infer<typeof ItemSpecSchema>;

export const LocationSpecSchema = z.object({
  locationId: z.string().describe('场景空间唯一标识符，格式如 loc_xxx'),
  name: z.string().describe('场景空间名称'),
  atmosphere: z.string().describe('空间情绪与氛围影调'),
  appearanceSummary: z.string().describe('场景空间物理外观概况'),
  spatialLayout: SpatialLayoutSchema.optional(),
  promptZh: z.string().describe('场景空间纯净视觉质感（严格100~130汉字，一段纯中文连贯自然语言）：建筑风貌形制、核心视觉地标置景、真实PBR物理材质（老木开裂/夯土斑驳/石板漫水光）、主导冷暖光影色彩与阴翳层次。严禁包含任何“面向某物时左侧/右侧/后方/原点”等空间几何结构坐标（此类信息归属 spatialLayout）、严禁包含相机焦段等下游渲染外壳、严禁输出结构小标题或标号。'),
  subScenes: z.array(z.string()).optional().default([]).describe('该母场景涵盖的剧本场次子机位/偏房角落列表（如：["主大堂/会客区", "侧廊/内室"]）'),
  sceneIds: z.array(z.string()).default([]),
  referenceImageUrl: z.string().optional(),
  imageUrl: z.string().optional(),
  versions: z.array(LookdevVersionSchema).optional().default([]),
  selectedVersionId: z.string().optional(),
});
export type LocationSpec = z.infer<typeof LocationSpecSchema>;

export const GlobalEntitiesSchema = z.object({
  artStyle: z.string().describe('全剧统一电影级视觉美学基调（如电影写实摄影、自然真实光照、胶片质感与色彩倾向）'),
  characters: z.array(CharacterSpecSchema),
  items: z.array(ItemSpecSchema),
  locations: z.array(LocationSpecSchema).default([]),
});

export const ExtractedEntitiesSchema = GlobalEntitiesSchema.extend({
  characters: z.array(GlobalEntitiesSchema.shape.characters.element.extend({
    poseConstraint: PoseConstraintSchema,
  })),
});

export type GlobalEntities = z.infer<typeof GlobalEntitiesSchema>;
