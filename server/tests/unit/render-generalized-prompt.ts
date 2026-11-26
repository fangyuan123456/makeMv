/**
 * server/tests/unit/render-generalized-prompt.ts
 * 真实运行 ComfyUI 渲染通用推演产出的提示词
 */
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { imageGenerateTool } from '../../src/tools/media/image-generate.tool.js';
import { MediaResolver } from '../../src/media/MediaResolver.js';

const PROMPT_GENERALIZED = `深夜老宅正厅灵堂，阴风骤起，窗外树影狂乱晃动，冷蓝月光从窗棂渗入，与烛火暖橙对撞。摄影机略低于视平线微仰，中景侧拍构图，以供桌与李秀兰为视觉中心。李秀兰位于画左前方，身体面向画左，双手持三炷香，手腕微抬，香头靠近烛台火苗，面部受暖黄底光勾勒，神情专注凝重，视线锁定香头。陈小满位于画右前方，双手紧抱布老虎贴在胸口，身体微缩，面向画左，视线斜向上追随李秀兰手部动作。陈建国位于画右中景，身体微侧面向画左，目光低垂斜向下瞥向供桌下方幽深缝隙。陈明芳位于画左后方，身体面向画右，袖口靠近遗照玻璃，手指微曲，视线落在遗照上。陈明辉位于画右后景门廊边缘，身体面向画左，手机握在手中，拇指轻触屏幕，视线落在手机屏幕上。全员身体各自防备微倾，视线彼此错开避让，无一人目光对视交汇。供桌居中，遗照高悬，香炉青烟袅袅，石板地面漫着水光反射，梁柱间暗影浮动。`;

async function main() {
  const projectId = 'proj_1795483074481_bprz';
  const store = ProjectStore.getInstance();
  const entities = store.getArtifact(projectId, 'lookdev_entities');
  const artifactDir = 'C:/Users/Administrator/.gemini/antigravity/brain/de7e6801-50a2-4ee5-8c7c-62f32b6387ff';

  console.log('[RenderGeneralized] 正在连接云端 RTX 5090 生成通用规则推演的最新画面...');
  const start = Date.now();
  const res: any = await (imageGenerateTool.execute as any)({
    context: {
      projectId,
      prompt: PROMPT_GENERALIZED,
      entities,
      size: '1280*720',
      subfolder: 'keyframes',
      customFilename: 'shot_c1_02_generalized',
    },
  });

  const dur = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[RenderGeneralized] 生成完毕！耗时: ${dur}s`);
  console.log('[RenderGeneralized] 媒体路径:', res?.mediaUrl);

  if (res?.mediaUrl) {
    const diskPath = MediaResolver.resolveDiskPath(res.mediaUrl).diskPath;
    if (fs.existsSync(diskPath)) {
      const target = path.join(artifactDir, 'shot_c1_02_generalized.png');
      fs.copyFileSync(diskPath, target);
      console.log(`[RenderGeneralized] 已同步到 artifacts: ${target}`);
    }
  }
}

main().catch((err) => {
  console.error('[RenderGeneralized] 失败:', err);
  process.exit(1);
});
