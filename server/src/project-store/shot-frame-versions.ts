/**
 * project-store/shot-frame-versions.ts
 * 分镜镜头首/末帧与视频的历史版本清单与标准命名规范 (Shot Media Version Ledger SSOT)
 *
 * 工业标准影视资产命名规范：
 * shot_{两位镜头号}_{first|last|video}_v{序号}.{png|mp4}
 * 例：shot_02_first_v1.png, shot_02_video_v1.mp4
 */

export type ShotFrameKind = 'first' | 'last';
export type ShotMediaKind = 'first' | 'last' | 'video';

export interface VisualDirectiveSnapshot {
  presetId?: string;
  label?: string;
  instruction?: string;
  icon?: string;
  category?: string;
  intensity?: number;
}

export interface ShotFrameVersion {
  versionId: string;
  imageUrl: string;
  fileName?: string;
  numericCode?: string;
  prompt?: string;
  /** 微调指令（仅基于当前图定向修改时记录） */
  instruction?: string;
  createdAt: string;
  source: 'generate' | 'refine' | 'upscale' | 'continuity_preceding' | 'detached_composition';
  continuityMode?: 'auto' | 'linked' | 'detached';
  cameraDirective?: VisualDirectiveSnapshot;
  colorDirective?: VisualDirectiveSnapshot;
  poseDirective?: VisualDirectiveSnapshot;
  nameSegments?: {
    frameKind: string;
    continuity: string;
    visualCode: string;
    versionSeq: string;
  };
  upscale?: { multiplier: number; upscaledAt: string };
}

export interface ShotVideoVersion {
  versionId: string;
  videoUrl: string;
  fileName?: string;
  numericCode?: string;
  prompt?: string;
  instruction?: string;
  createdAt: string;
  source: 'generate' | 'upscale';
  continuityMode?: 'auto' | 'linked' | 'detached';
  motionDirective?: VisualDirectiveSnapshot;
  dynamicDirective?: VisualDirectiveSnapshot;
  focusDirective?: VisualDirectiveSnapshot;
  nameSegments?: {
    frameKind: string;
    continuity: string;
    visualCode?: string;
    motionCode?: string;
    versionSeq: string;
  };
}

export function cleanFrameUrl(url?: string): string {
  return url ? String(url).split('?')[0].trim() : '';
}

export function frameVersionsKey(frame: ShotFrameKind): 'firstFrameVersions' | 'lastFrameVersions' {
  return frame === 'last' ? 'lastFrameVersions' : 'firstFrameVersions';
}

/**
 * 提取镜头当前生效的关键帧 URL (SSOT 优先)
 */
export function activeFrameUrl(shot: any, frame: ShotFrameKind): string {
  if (frame === 'last') {
    return cleanFrameUrl(shot?.lastFrameImageUrl || shot?.lastFrameUrl);
  }
  return cleanFrameUrl(shot?.firstFrameImageUrl || shot?.keyframeUrl);
}

/**
 * 提取镜头当前生效的视频 URL (SSOT 优先)
 */
export function activeVideoUrl(shot: any): string {
  return cleanFrameUrl(shot?.videoUrl || shot?.video);
}

export function newFrameVersionId(): string {
  return `v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 镜头标准影视资产命名规范 (Clean Shot Media Filename SSOT)
 * 格式：shot_{两位镜头号}_{first|last|video}_v{序号}.{png|mp4}
 * 例：shot_04_first_v1.png, shot_04_video_v1.mp4
 */
export function buildShotMediaFileName(params: {
  shotId: string;
  kind: ShotMediaKind;
  versionSeq: number;
  continuityMode?: 'auto' | 'linked' | 'detached';
  visualOrMotionTag?: string;
  ext?: string;
}): {
  fileName: string;
  numericCode?: string;
  nameSegments?: any;
} {
  const rawNum = params.shotId.replace(/\D/g, '') || '1';
  const shotNum = String(parseInt(rawNum, 10) || 1).padStart(2, '0');
  const verNum = String(params.versionSeq);
  const ext = params.ext
    ? params.ext.startsWith('.')
      ? params.ext
      : `.${params.ext}`
    : params.kind === 'video'
    ? '.mp4'
    : '.png';

  const fileName = `shot_${shotNum}_${params.kind}_v${verNum}${ext}`;
  return { fileName };
}

/**
 * 读取图片版本清单（只读归一化）：保障未记录历史的项目可平滑升级
 */
export function readFrameVersions(shot: any, frame: ShotFrameKind): ShotFrameVersion[] {
  const key = frameVersionsKey(frame);
  const rawList: ShotFrameVersion[] = Array.isArray(shot?.[key]) ? [...shot[key]] : [];
  const seenIds = new Set<string>();
  const versions = rawList.map((v) => {
    let vid = v?.versionId;
    if (!vid || seenIds.has(vid)) {
      vid = newFrameVersionId();
    }
    seenIds.add(vid);
    return vid === v?.versionId ? v : { ...v, versionId: vid };
  });
  const active = activeFrameUrl(shot, frame);
  if (active && !versions.some((v) => cleanFrameUrl(v?.imageUrl) === active)) {
    const rawName = active.split('/').pop() || '';
    const baseId = `v_base_${shot?.shotId || shot?.id || 'shot'}_${frame}`;
    versions.push({
      versionId: seenIds.has(baseId) ? newFrameVersionId() : baseId,
      imageUrl: active,
      fileName: rawName,
      prompt: frame === 'last' ? shot?.lastFramePrompt : shot?.firstFramePrompt,
      continuityMode: shot?.continuityMode || 'auto',
      cameraDirective: shot?.cameraDirective,
      colorDirective: shot?.colorDirective,
      poseDirective: shot?.poseDirective,
      createdAt: new Date(0).toISOString(),
      source: 'generate',
      upscale: frame === 'last' ? shot?.lastFrameUpscale : shot?.firstFrameUpscale,
    });
  }
  return versions;
}

/**
 * 把某个版本设为当前生效帧（首末帧分轨独立存储，互不污染）
 */
export function applyFrameVersion(shot: any, frame: ShotFrameKind, version: ShotFrameVersion): void {
  const url = cleanFrameUrl(version.imageUrl);
  if (frame === 'last') {
    shot.lastFrameImageUrl = url;
    shot.selectedLastFrameVersionId = version.versionId;
    if (version.upscale) shot.lastFrameUpscale = version.upscale;
    else delete shot.lastFrameUpscale;

    // 尾帧独立字段存储，绝不污染首帧
    if (version.continuityMode) shot.lastFrameContinuityMode = version.continuityMode;
    if (version.cameraDirective !== undefined) shot.lastFrameCameraDirective = version.cameraDirective;
    if (version.colorDirective !== undefined) shot.lastFrameColorDirective = version.colorDirective;
    if (version.poseDirective !== undefined) shot.lastFramePoseDirective = version.poseDirective;
  } else {
    shot.firstFrameImageUrl = url;
    shot.keyframeUrl = url;
    shot.selectedFirstFrameVersionId = version.versionId;
    if (version.upscale) shot.firstFrameUpscale = version.upscale;
    else delete shot.firstFrameUpscale;

    // 首帧独立字段存储
    if (version.continuityMode) shot.continuityMode = version.continuityMode;
    if (version.cameraDirective !== undefined) {
      shot.firstFrameCameraDirective = version.cameraDirective;
      shot.cameraDirective = version.cameraDirective;
    }
    if (version.colorDirective !== undefined) {
      shot.firstFrameColorDirective = version.colorDirective;
      shot.colorDirective = version.colorDirective;
    }
    if (version.poseDirective !== undefined) {
      shot.firstFramePoseDirective = version.poseDirective;
      shot.poseDirective = version.poseDirective;
    }
  }
}

/**
 * 追加一个新版本并立即设为生效版本（供出图 / 重绘调用）
 */
export function appendFrameVersion(
  shot: any,
  frame: ShotFrameKind,
  payload: Omit<ShotFrameVersion, 'versionId' | 'createdAt'>
): ShotFrameVersion {
  const versions = readFrameVersions(shot, frame);
  const { prompt: latestPrompt, ...restPayload } = payload;
  if (latestPrompt) {
    if (frame === 'last') shot.lastFramePrompt = latestPrompt;
    else shot.firstFramePrompt = latestPrompt;
  }
  const version: ShotFrameVersion = {
    ...restPayload,
    imageUrl: cleanFrameUrl(payload.imageUrl),
    versionId: newFrameVersionId(),
    createdAt: new Date().toISOString(),
  };
  versions.push(version);
  shot[frameVersionsKey(frame)] = versions;
  applyFrameVersion(shot, frame, version);
  return version;
}

/**
 * 原地升级关键帧版本（专供超分 Upscale 使用，保持版本语义纯粹，原地替换当前版本的画质，不新增平行版本）
 * 若传入 versionId 则升级该版本；否则升级当前生效的最新版本。
 */
export function upgradeFrameVersion(
  shot: any,
  frame: ShotFrameKind,
  payload: {
    imageUrl: string;
    upscale: { multiplier: number; upscaledAt: string };
    versionId?: string;
  }
): ShotFrameVersion {
  const versions = readFrameVersions(shot, frame);
  const cleanUrl = cleanFrameUrl(payload.imageUrl);

  let targetIndex = -1;
  if (payload.versionId) {
    targetIndex = versions.findIndex((v) => v.versionId === payload.versionId);
  }
  if (targetIndex === -1) {
    const active = activeFrameUrl(shot, frame);
    if (active) {
      targetIndex = versions.findIndex((v) => cleanFrameUrl(v.imageUrl) === active);
    }
  }
  if (targetIndex === -1 && versions.length > 0) {
    targetIndex = versions.length - 1;
  }

  let targetVersion: ShotFrameVersion;
  if (targetIndex >= 0) {
    targetVersion = versions[targetIndex];
    targetVersion.imageUrl = cleanUrl;
    targetVersion.upscale = payload.upscale;
  } else {
    targetVersion = {
      versionId: newFrameVersionId(),
      imageUrl: cleanUrl,
      createdAt: new Date().toISOString(),
      source: 'upscale',
      upscale: payload.upscale,
    };
    versions.push(targetVersion);
  }

  shot[frameVersionsKey(frame)] = versions;
  applyFrameVersion(shot, frame, targetVersion);
  return targetVersion;
}

/**
 * 读取视频版本清单（只读归一化）
 */
export function readVideoVersions(shot: any): ShotVideoVersion[] {
  const rawList: ShotVideoVersion[] = Array.isArray(shot?.videoVersions) ? [...shot.videoVersions] : [];
  const seenIds = new Set<string>();
  const versions = rawList.map((v) => {
    let vid = v?.versionId;
    if (!vid || seenIds.has(vid)) {
      vid = newFrameVersionId();
    }
    seenIds.add(vid);
    return vid === v?.versionId ? v : { ...v, versionId: vid };
  });
  const active = activeVideoUrl(shot);
  if (active && !versions.some((v) => cleanFrameUrl(v?.videoUrl) === active)) {
    const rawName = active.split('/').pop() || '';
    const baseId = `v_base_${shot?.shotId || shot?.id || 'shot'}_video`;
    versions.push({
      versionId: seenIds.has(baseId) ? newFrameVersionId() : baseId,
      videoUrl: active,
      fileName: rawName,
      prompt: shot?.videoPrompt || shot?.prompt,
      continuityMode: shot?.continuityMode || 'auto',
      motionDirective: shot?.motionDirective,
      dynamicDirective: shot?.dynamicDirective,
      focusDirective: shot?.focusDirective,
      createdAt: new Date(0).toISOString(),
      source: 'generate',
    });
  }
  return versions;
}

/**
 * 把某个视频版本设为当前生效视频（同步所有字段及参数快照）
 */
export function applyVideoVersion(shot: any, version: ShotVideoVersion): void {
  const url = cleanFrameUrl(version.videoUrl);
  shot.videoUrl = url;
  shot.selectedVideoVersionId = version.versionId;
  if (version.continuityMode) shot.continuityMode = version.continuityMode;
  if (version.motionDirective !== undefined) shot.motionDirective = version.motionDirective;
  if (version.dynamicDirective !== undefined) shot.dynamicDirective = version.dynamicDirective;
  if (version.focusDirective !== undefined) shot.focusDirective = version.focusDirective;
}

/**
 * 追加一个视频新版本并立即设为生效版本
 */
export function appendVideoVersion(
  shot: any,
  payload: Omit<ShotVideoVersion, 'versionId' | 'createdAt'>
): ShotVideoVersion {
  const versions = readVideoVersions(shot);
  const { prompt: latestPrompt, ...restPayload } = payload;
  if (latestPrompt) {
    shot.videoPrompt = latestPrompt;
  }
  const version: ShotVideoVersion = {
    ...restPayload,
    videoUrl: cleanFrameUrl(payload.videoUrl),
    versionId: newFrameVersionId(),
    createdAt: new Date().toISOString(),
  };
  versions.push(version);
  shot.videoVersions = versions;
  applyVideoVersion(shot, version);
  return version;
}
