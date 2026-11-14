/**
 * agents/film-production/index.ts
 * 互动影游视听生成总域总装出口 (Film Production SSOT)
 *
 * 架构三步法分层：
 * 1. 01-asset-extraction/     : Step 1 视觉资产提取 (纯文本提取实物与场景，零算力出图)
 * 2. 02-storyboard-planning/  : Step 2 分镜台本规划 (纯文本拆解全剧各幕分镜切片清单，零算力出图出视频)
 * 3. 03-video-studio/         : Step 3 视频制作工坊 (专职做图片和视频，纯物理硬件媒体算力工厂)
 *    - lookdev/               : 定妆子系统 (角色立绘、道具特写、场景空镜)
 *    - cinema-act/            : 按幕分镜视听子系统 (镜头关键帧高清图与视频渲染)
 *    - studio-master          : 视频工坊总调度流水线
 */

export * from './film-production.agent.js';
export * from './01-asset-extraction/index.js';
export * from './02-storyboard-planning/index.js';
export * from './03-video-studio/index.js';
