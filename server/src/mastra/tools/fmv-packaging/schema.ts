/**
 * mastra/tools/fmv-packaging/schema.ts
 * 互动影游母带装配与打包 Zod 契约规约 (FMV Packaging Zod SSOT)
 *
 * 严格 1:1 对齐前端 FMVInteractivePlayer 影游运行时规范
 */

import { z } from 'zod';

// 1. 分支抉择项契约
export const FMVChoiceSchema = z.object({
  id: z.string().describe('选项唯一标识'),
  fromNodeId: z.string().describe('出发剧情节点 ID'),
  toNodeId: z.string().describe('导向目标剧情节点 ID'),
  choiceText: z.string().describe('选项呈现文案'),
  timeoutSeconds: z.number().optional().describe('倒计时秒数'),
  isTimeoutDefault: z.boolean().optional().describe('倒计时结束时是否为默认选择'),
  conditions: z.object({
    requiredClues: z.array(z.string()).optional(),
    minAffinity: z.record(z.string(), z.number()).optional(),
    flagsRequired: z.record(z.string(), z.boolean()).optional(),
  }).optional(),
  effects: z.object({
    affinityDelta: z.record(z.string(), z.number()).optional(),
    gainItems: z.array(z.string()).optional(),
    setFlags: z.record(z.string(), z.boolean()).optional(),
  }).optional(),
});

export type FMVChoice = z.infer<typeof FMVChoiceSchema>;

// 2. 单个剧情节点资产契约
export const FMVNodeAssetSchema = z.object({
  nodeId: z.string().describe('节点 ID'),
  title: z.string().describe('节点标题'),
  videoUrl: z.string().describe('视频回放 URL'),
  localPath: z.string().optional().describe('本地媒体路径'),
  durationSec: z.number().describe('视频时长秒数'),
  decisionTimeSec: z.number().optional().describe('决策等待秒数'),
  holdImageUrl: z.string().optional().describe('暂停画面首选图'),
  loopVideoUrl: z.string().optional().describe('等待决策时的循环背景短视频'),
  isDecisionPoint: z.boolean().describe('是否为需要玩家抉择的关键交互点'),
  choices: z.array(FMVChoiceSchema).optional().describe('下游分支选项清单'),
  isMissing: z.boolean().optional().describe('当前节点是否缺失视频素材'),
});

export type FMVNodeAsset = z.infer<typeof FMVNodeAssetSchema>;

// 3. 完整 FMV 播放器 Manifest 契约
export const FMVManifestSchema = z.object({
  gameTitle: z.string(),
  startNodeId: z.string(),
  totalDurationSec: z.number(),
  nodes: z.record(z.string(), FMVNodeAssetSchema),
});

export type FMVManifest = z.infer<typeof FMVManifestSchema>;

// 4. 工序入参与最终落盘产物契约
export const FmvPackagingParamsSchema = z.object({
  projectId: z.string().describe('项目唯一 ID'),
  userFeedback: z.string().optional().describe('打包配置或发布偏好'),
});

export type FmvPackagingParams = z.infer<typeof FmvPackagingParamsSchema>;

export const FmvPackagingArtifactSchema = z.object({
  title: z.string(),
  gameManifestUrl: z.string(),
  fmvManifest: FMVManifestSchema, // 直透挂载在产物根层级，供前端视窗直接消费
  totalNodes: z.number(),
  totalClips: z.number(),
  totalEndings: z.number(),
  playableDurationSec: z.number(),
  isDegraded: z.boolean().optional(),
  degradedReason: z.string().optional(),
  missingNodeIds: z.array(z.string()).optional(),
  status: z.literal('packaged'),
  createdAt: z.string(),
});

export type FmvPackagingArtifact = z.infer<typeof FmvPackagingArtifactSchema>;

export const FmvPackagingToolOutputSchema = z.object({
  success: z.boolean(),
  artifact: FmvPackagingArtifactSchema,
  summary: z.string(),
});

export type FmvPackagingToolOutput = z.infer<typeof FmvPackagingToolOutputSchema>;
