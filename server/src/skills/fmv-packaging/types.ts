/**
 * skills/fmv-packaging/types.ts
 * 互动影游母带装配业务强类型契约 (FMV Packaging Types SSOT)
 *
 * 严格 1:1 对齐前端 FMVInteractivePlayer 影游运行时规范
 */

export interface FMVChoice {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  choiceText: string;
  timeoutSeconds?: number;
  isTimeoutDefault?: boolean;
  conditions?: {
    requiredClues?: string[];
    minAffinity?: Record<string, number>;
    flagsRequired?: Record<string, boolean>;
  };
  effects?: {
    affinityDelta?: Record<string, number>;
    gainItems?: string[];
    setFlags?: Record<string, boolean>;
  };
}

export interface FMVNodeAsset {
  nodeId: string;
  title: string;
  videoUrl: string;
  localPath?: string;
  durationSec: number;
  decisionTimeSec?: number;
  holdImageUrl?: string;
  loopVideoUrl?: string;
  isDecisionPoint: boolean;
  choices?: FMVChoice[];
}

export interface FMVManifest {
  gameTitle: string;
  startNodeId: string;
  totalDurationSec: number;
  nodes: Record<string, FMVNodeAsset>;
}

export interface FmvPackagingParams {
  userFeedback?: string;
}

export interface FmvPackagingArtifact {
  title: string;
  gameManifestUrl: string;
  fmvManifest: FMVManifest; // 🌟 直透挂载在产物根层级，供前端视窗直接消费
  totalNodes: number;
  totalClips: number;
  totalEndings: number;
  playableDurationSec: number;
  status: 'packaged';
  createdAt: string;
}
