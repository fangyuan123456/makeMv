/**
 * server/tests/unit/real-render-video-test.ts
 * 真实运行 ComfyUI 图生视频验证
 */
import { ComfyUIMediaProvider } from '../../src/media/providers/ComfyUIMediaProvider.js';
import { MediaDownloader } from '../../src/media/MediaDownloader.js';
import path from 'node:path';
import fs from 'node:fs';

async function main() {
  const projectId = 'proj_1795483074481_bprz';
  const firstFramePath = path.resolve('server/data/projects/proj_1795483074481_bprz/keyframes/shot_101_first_v1.png');

  if (!fs.existsSync(firstFramePath)) {
    throw new Error(`首帧图片不存在: ${firstFramePath}`);
  }

  const prompt = '从起幅定格连贯演进：摄影机以低角度广角全景固定机位，自灵堂入口方向纵深拍摄，画面稳定。陈小满双手抱紧布老虎，身体微微后缩；陈建国身体微侧，目光低垂瞥向供桌下方幽深缝隙里的铁盒；李秀兰手持三炷香，手腕轻抬。香炉青烟袅袅上升，在暖黄底光中翻卷；冷蓝月光与烛火暖橙对撞。';

  console.log('[RealVideo] 启动真实 ComfyUI 图生视频 (H3 8-step)...');
  console.log('[RealVideo] 首帧图片输入:', firstFramePath);
  console.log('[RealVideo] 动态提示词:', prompt);

  const provider = new ComfyUIMediaProvider();
  const startTime = Date.now();

  const rawVideoUrl = await provider.generateVideo(prompt, {
    referenceImageUrl: firstFramePath,
    duration: 3, // 3 秒视频
  });

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[RealVideo] 视频生成完成！耗时: ${durationSec}s`);
  console.log('[RealVideo] 原始产物 URL:', rawVideoUrl);

  // 下载持久化到项目目录
  const persistentUrl = await MediaDownloader.getInstance().downloadToProject(
    projectId,
    rawVideoUrl,
    'videos',
    'shot_101_video_v1.mp4'
  );

  console.log('[RealVideo] 本地持久化落盘 URL:', persistentUrl);
}

main().catch((err) => {
  console.error('[RealVideo] 生成失败:', err);
  process.exit(1);
});
