/**
 * project-store/contracts/film-production/film-spec.ts
 * 影视视听切片资产订单强类型 Zod 契约 (Film Asset Order Schema SSOT)
 *
 * 核心设计：
 * 1. 与文游节点一对一锚定；
 * 2. 包含可直接喂给物理工具 (SD/Runway/ComfyUI/TTS) 的精确参数；
 * 3. 包含时间轴交互激活窗口与无缝剪辑接点 (Match Cut)。
 */

import { z } from 'zod';

export const VisualDirectiveSchema = z.object({
  label: z.string().describe('视听属性显示名称，如 "极低机位仰拍"、"御剑腾空"、"好莱坞青橙"'),
  instruction: z.string().describe('对应的生图或运镜微调指令'),
  presetId: z.string().optional().describe('若匹配到经典标准库，记录其预设 ID'),
});

export type VisualDirective = z.infer<typeof VisualDirectiveSchema>;

/** 场景时空环境锁契约 (Scene Environment Lock SSOT) */
export const ShootingScriptEnvironmentLockSchema = z.object({
  timeOfDay: z.string().describe('时段，如 黄昏/深夜/清晨/正午'),
  weatherDirective: VisualDirectiveSchema.describe('天气环境硬约束（如：深秋黄昏，薄雾笼罩）'),
  lightingDirective: VisualDirectiveSchema.describe('光照影调硬约束（如：低角度橙黄余晖，冷蓝贴地阴影）'),
  colorTone: VisualDirectiveSchema.optional().describe('整体影调与色温倾向'),
});

export type ShootingScriptEnvironmentLock = z.infer<typeof ShootingScriptEnvironmentLockSchema>;

/** 纯物理动作节拍契约 (Action Beat SSOT，按空间划分、镜头级单任务视听摄制单元) */
export const ShootingScriptActionBeatSchema = z.object({
  beatId: z.string().describe('节拍编号，如 b1, b2 或 s1_01'),
  beatTitle: z.string().describe('节拍标题，如 镜头 01（远景定场 · 归乡入画 · 5s）'),
  space: z.string().optional().describe('所属空间场景段落，如 空间一：外景 · 村口石碑前 · 黄昏薄雾'),
  shotNumber: z.number().int().positive().optional().describe('对应镜头序号，如 1, 2, ...'),
  shotType: z.string().optional().describe('景别与机位，如 远景定场 / 中景跟拍 / 微距特写'),
  actionDescription: z.string().describe('画面纯粹的物理动作与表演时序（角色走位、视线、手势与道具交互细节）'),
  cinematicIntent: z.string().describe('视听机位建议与运镜设计（如：远景低角度仰拍，突出石碑压迫感与人物渺小感）'),
  characterIds: z.array(z.string()).default([]).describe('入画角色 ID 清单'),
  itemIds: z.array(z.string()).default([]).describe('交互道具 ID 清单'),
  dialogue: z.string().optional().describe('角色对白或台词（严格保留原剧情台词）'),
  audioAmbience: z.string().optional().describe('现场拟音与动作音效（如脚步沙沙声、录音机咔嗒声）'),
  estimatedSeconds: z.number().positive().default(3).describe('预估拍摄时长（秒）'),
});

export type ShootingScriptActionBeat = z.infer<typeof ShootingScriptActionBeatSchema>;

/** 导演摄制台本切片契约 (Shooting Script SSOT) */
export const ShootingScriptSchema = z.object({
  clipId: z.string().describe('分幕唯一标识，如 S1'),
  clipTitle: z.string().describe('分幕标题'),
  environmentLock: ShootingScriptEnvironmentLockSchema.describe('本幕场景时空与光影环境锁'),
  actionBeats: z.array(ShootingScriptActionBeatSchema).min(1).describe('按时序演进的连续视听动作节拍序列'),
  generatedAt: z.string().optional().describe('生成时间戳'),
});

export type ShootingScript = z.infer<typeof ShootingScriptSchema>;

export const CinematicShotOrderSchema = z.object({
  shotId: z.string().describe('镜头唯一标识，如 S1-01'),
  clipId: z.string().describe('所属伪视频/分幕 ID，如 S1'),
  shotIndex: z.number().int().nonnegative().describe('镜头在分幕内的顺序，从 0 开始'),
  durationSec: z.number().positive().describe('镜头目标时长（秒）'),
  shotType: z.string().describe('景别与机位，如 CLOSE_UP / MEDIUM_SHOT / WIDE_SHOT'),
  cameraMovement: z.string().describe('拍摄方式与运镜，如 locked-off / dolly in / tracking'),
  generationMode: z.enum(['first_frame', 'first_last_frame']).describe('关键帧生成模式'),
  characters: z.array(z.string()).default([]).describe('本镜头出场角色 ID'),
  items: z.array(z.string()).default([]).describe('本镜头使用道具 ID'),
  // 视听工业级开放元数据体系 (SSOT，开放无边界，拒绝客户端静态枚举绑架 AI)
  cameraDirective: VisualDirectiveSchema.optional().describe('开放机位视角元数据'),
  colorDirective: VisualDirectiveSchema.optional().describe('开放电影调色元数据'),
  poseDirective: VisualDirectiveSchema.optional().describe('开放角色姿态元数据'),
  weatherDirective: VisualDirectiveSchema.optional().describe('开放天气与环境光影元数据 (如：深秋黄昏、薄雾笼罩、冷暖光交织)'),
  sceneSubject: z.string().optional().describe('纯净剧情叙事主体描述，剥离机位与全局色调修饰语'),
  sliceSummary: z.string().optional().describe('外显动作切片简述，用于在分镜卡片外部直接展示该镜头的实操动作'),
  // 视频专属开放元数据体系 (SSOT，运镜方式、动态幅度、焦点跟踪)
  motionDirective: VisualDirectiveSchema.optional().describe('开放视频运镜元数据 (如：缓缓推近、环绕巡视、手持呼吸)'),
  dynamicDirective: VisualDirectiveSchema.optional().describe('开放视频动态幅度元数据 (如：电影级平缓 5/10、微幅呼吸感 2/10)'),
  focusDirective: VisualDirectiveSchema.optional().describe('开放视频焦点跟踪元数据 (如：锁定主体、环视环境、特写聚焦)'),
  backgroundImageUrl: z.string().optional().describe('本镜头使用的场景母本图'),
  characterReferenceImageUrls: z.array(z.string()).default([]).describe('本镜头角色定妆图'),
  firstFramePrompt: z.string().describe('首帧图片生成描述词'),
  lastFramePrompt: z.string().optional().describe('首尾帧模式的尾帧图片生成描述词'),
  videoPrompt: z.string().describe('从关键帧生成视频的动作、表演与运镜描述词'),
  audioPrompt: z.string().describe('与视频同步生成的环境声、动作声、音乐氛围与对白表现描述词'),
  firstFrameImageUrl: z.string().optional().describe('生成后的首帧图片 URL'),
  lastFrameImageUrl: z.string().optional().describe('生成后的尾帧图片 URL'),
  firstFrameUpscale: z
    .object({
      multiplier: z.number(),
      upscaledAt: z.string(),
    })
    .optional()
    .describe('首帧 SeedVR2 高清超分记录'),
  lastFrameUpscale: z
    .object({
      multiplier: z.number(),
      upscaledAt: z.string(),
    })
    .optional()
    .describe('末帧 SeedVR2 高清超分记录'),
  videoUrl: z.string().optional().describe('生成后的镜头视频 URL'),
  dialogue: z.string().default('').describe('本镜头对白或旁白'),
  ambience: z.string().default('').describe('本镜头环境声与氛围音'),
  transitionAnchor: z.string().describe('与前后镜头衔接的动作、视线或构图锚点'),
});

export const CinematicClipOrderSchema = z.object({
  clipId: z.string().describe('切片唯一标识，与剧本/文游节点 1:1 锚定，如 S1, S1.1'),
  sourceNodeId: z.string().describe('对应的文游节点 ID'),
  targetDurationSec: z.number().default(5.0).describe('分幕目标总时长（秒）'),
  shots: z.array(CinematicShotOrderSchema).min(1).describe('该伪视频拆出的镜头清单'),
  shootingScript: ShootingScriptSchema.optional().describe('本幕专属导演摄制台本 (时空环境锁与连续视听动作流)'),
  videoUrl: z.string().optional().describe('该分幕最终合成视频 URL，供 game-assembly 播放'),
});

export const FilmAdapterArtifactSchema = z.object({
  projectId: z.string().optional(),
  schemaVersion: z.string().default('1.0.0'),
  projectTitle: z.string().describe('作品名称'),
  clips: z.array(CinematicClipOrderSchema).min(1).describe('全量待渲染视听切片需求清单'),
});

export type CinematicClipOrder = z.infer<typeof CinematicClipOrderSchema>;
export type CinematicShotOrder = z.infer<typeof CinematicShotOrderSchema>;
export type FilmAdapterArtifact = z.infer<typeof FilmAdapterArtifactSchema>;
