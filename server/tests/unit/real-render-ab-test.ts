/**
 * server/tests/unit/real-render-ab-test.ts
 * 真实运行 ComfyUI 对比两个版本的生图效果 (AB Test)
 */
import fs from 'fs';
import path from 'path';
import { ProjectStore } from '../../src/project-store/ProjectStore.js';
import { imageGenerateTool } from '../../src/tools/media/image-generate.tool.js';
import { MediaResolver } from '../../src/media/MediaResolver.js';

const PROMPT_A = `35mm电影定焦微仰侧拍灵堂群像，深焦大景深，高反差冷暖阴翳。画左近景处，李秀兰侧立面向画左，双手执三炷细香悬停在烛火上一寸，头部微俯四分之三侧转，双眼视线沿视轴斜向下死死锁定烛芯火苗，下颌在下方暖黄火光中紧绷咬合；身侧陈小满抱紧旧布老虎正面朝向大门，双肩内扣低头瑟缩，双眼视线怯生生斜垂向青铜香炉；画右侧柱石阴影中，陈建国侧身微转朝向画左，双手僵直贴腿，目光阴鸷斜向下锁定供桌底缝深处的旧铁盒；后堂高悬遗照旁，陈明芳面朝正前方仰望相框玻璃，右手紧攥衣袖；远景门廊边缘，陈明辉半背对众人面向门外，单手下垂按着发光手机低头斜睨。五人身体各自防备微倾，视线彼此绝对避开、无一人目光对视交汇。供桌青烟袅袅，画左下方烛台火光单独打亮李秀兰面庞，画右幽冷月光切过陈建国与后景众人的冷峻后背，挽联在深处阴风中微摆，整幅画面弥漫着极度压抑的静默对峙感。`;

const PROMPT_B = `【核心前景主体 · 李秀兰】：位于画左前方视觉中心，身体完全呈侧身朝向画左供桌（Facing Camera Left），双手执三炷细香前伸，香头悬停在烛火上方一寸处。头部呈四分之三侧面，视线斜向下 35 度死死锁定火苗，下颌线条在下方烛火暖光照耀下坚毅冷峻。
【中景近身位 · 陈小满】：位于李秀兰身侧画中偏左位置，身体正面朝向大门方向，双肩内扣，双手将旧布老虎死死贴紧胸口，低垂头部，视线斜向下怯生生地盯着香炉边缘。
【中景右侧暗部 · 陈建国】：伫立在画右侧方的柱石阴影中，身体呈侧身微转朝向画左（Facing Left Towards Table），双手下垂贴腿，双眼目光阴鸷地斜向下投射，视线死死锁定供桌底缝深处的旧铁盒。
【后景遗照旁 · 陈明芳】：立于后堂黑白遗照左后侧阴影边缘，身体朝向正前方，头部微侧，视线死死盯向高悬的遗照相框，右手袖口半遮胸口，手指紧攥。
【远景门廊边缘 · 陈明辉】：倚立在画右后方的远景门廊阴影中，身体侧背对众人面向门外，单手下垂握持手机，拇指悬在屏幕上方，视线斜向下瞥着微弱的手机屏冷光。
【光影与空间物理】：画左下方烛火作为局部强主光，自下而上勾勒李秀兰的面庞与香炉轮廓；画右木格窗棂透入的凄冷幽蓝月光切过陈建国的后背轮廓，在潮湿青石板地上投下斑驳斜影，冷暖两极对撞，挽联在深处阴风中微摆，全员各怀鬼胎，空间层次极为深邃。`;

async function main() {
  const projectId = 'proj_1795483074481_bprz';
  const store = ProjectStore.getInstance();
  const entities = store.getArtifact(projectId, 'lookdev_entities');
  const artifactDir = 'C:/Users/Administrator/.gemini/antigravity/brain/de7e6801-50a2-4ee5-8c7c-62f32b6387ff';

  // 1. 生成版本 A
  console.log('\n[AB-Test] ================= 正在生成版本 A（连贯纯物理流）=================');
  const startA = Date.now();
  const resA: any = await (imageGenerateTool.execute as any)({
    context: {
      projectId,
      prompt: PROMPT_A,
      entities,
      size: '1280*720',
      subfolder: 'keyframes',
      customFilename: 'shot_c1_02_ab_version_a',
    },
  });
  const durA = ((Date.now() - startA) / 1000).toFixed(1);
  console.log(`[AB-Test] 版本 A 完成！耗时: ${durA}s`);
  console.log(`[AB-Test] 版本 A 产物: ${resA?.mediaUrl}`);

  if (resA?.mediaUrl) {
    const diskA = MediaResolver.resolveDiskPath(resA.mediaUrl).diskPath;
    if (fs.existsSync(diskA)) {
      const targetA = path.join(artifactDir, 'shot_c1_02_ab_version_a.png');
      fs.copyFileSync(diskA, targetA);
      console.log(`[AB-Test] 已复制版本 A 到 artifacts: ${targetA}`);
    }
  }

  // 2. 生成版本 B
  console.log('\n[AB-Test] ================= 正在生成版本 B（结构化标签版）=================');
  const startB = Date.now();
  const resB: any = await (imageGenerateTool.execute as any)({
    context: {
      projectId,
      prompt: PROMPT_B,
      entities,
      size: '1280*720',
      subfolder: 'keyframes',
      customFilename: 'shot_c1_02_ab_version_b',
    },
  });
  const durB = ((Date.now() - startB) / 1000).toFixed(1);
  console.log(`[AB-Test] 版本 B 完成！耗时: ${durB}s`);
  console.log(`[AB-Test] 版本 B 产物: ${resB?.mediaUrl}`);

  if (resB?.mediaUrl) {
    const diskB = MediaResolver.resolveDiskPath(resB.mediaUrl).diskPath;
    if (fs.existsSync(diskB)) {
      const targetB = path.join(artifactDir, 'shot_c1_02_ab_version_b.png');
      fs.copyFileSync(diskB, targetB);
      console.log(`[AB-Test] 已复制版本 B 到 artifacts: ${targetB}`);
    }
  }

  console.log('\n[AB-Test] 全部生成完毕！');
}

main().catch((err) => {
  console.error('[AB-Test] 失败:', err);
  process.exit(1);
});
