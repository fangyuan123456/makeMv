/**
 * server/tests/unit/render-spatial-unified-shot.ts
 * 真实运行 ComfyUI 验证空间拓扑纠偏后的最新画面
 */
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { imageGenerateTool } from '../../src/tools/media/image-generate.tool.js';
import { MediaResolver } from '../../src/media/MediaResolver.js';

const PROMPT_SPATIAL_UNIFIED = `深夜老宅正厅灵堂，阴风骤起，窗外树影狂乱晃动，纸灰与香灰微粒被风卷起。摄影机略低于视平线微仰，中景侧拍构图。穿过案头青铜香炉翻卷的青烟，供桌作为李秀兰身前的物理依托面从她身侧向画面纵深延展。李秀兰位于画左前方，正侧身面向画右，双手持三炷香举至额前，手腕微抬，香头靠近烛台火苗，身体微向前倾，重心落在前脚，神情专注凝重，面部受烛火暖光自下而上勾勒。陈小满位于画右前方，身体正对镜头微侧，双手紧抱布老虎贴于胸口，视线斜向上锁定李秀兰手中香火。陈建国位于画右中景阴影中，身体面向画左，头部低垂，目光斜向下锁定供桌下铁盒。陈明芳位于画左后方，身体面向画右，袖口靠近遗照玻璃，手指微曲，视线落于遗照。陈明辉位于画右后景门廊边缘，身体面向画左，手机握于手中，拇指轻触屏幕，视线落于手机。全员身体各自防备微倾，视线彼此绝对避开，无一人目光对视交汇。高反差阴翳影调，香火暖黄底光与画右窗棂冷蓝月光对撞，阴郁青灰主调，烛火暖橙点缀，石板地面漫水光反射。`;

async function main() {
  const projectId = 'proj_1795483074481_bprz';
  const store = ProjectStore.getInstance();
  const entities = store.getArtifact(projectId, 'lookdev_entities');
  const artifactDir = 'C:/Users/Administrator/.gemini/antigravity/brain/de7e6801-50a2-4ee5-8c7c-62f32b6387ff';

  console.log('[RenderSpatialUnified] 正在连接云端 RTX 5090 生成空间拓扑纠偏后的最新画面...');
  const start = Date.now();
  const res: any = await (imageGenerateTool.execute as any)({
    context: {
      projectId,
      prompt: PROMPT_SPATIAL_UNIFIED,
      entities,
      size: '1280*720',
      subfolder: 'keyframes',
      customFilename: 'shot_c1_02_spatial_unified',
    },
  });

  const dur = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[RenderSpatialUnified] 生成完毕！耗时: ${dur}s`);
  console.log('[RenderSpatialUnified] 媒体路径:', res?.mediaUrl);

  if (res?.mediaUrl) {
    const diskPath = MediaResolver.resolveDiskPath(res.mediaUrl).diskPath;
    if (fs.existsSync(diskPath)) {
      const target = path.join(artifactDir, 'shot_c1_02_spatial_unified.png');
      fs.copyFileSync(diskPath, target);
      console.log(`[RenderSpatialUnified] 已同步到 artifacts: ${target}`);
    }
  }
}

main().catch((err) => {
  console.error('[RenderSpatialUnified] 失败:', err);
  process.exit(1);
});
