import { shotKeyframeTool } from '../src/tools/film-production/shot-keyframe-tool/index.js';

async function main() {
  const projectId = 'proj_1794992643492_3fys';
  const clipId = 'c1';
  const shotId = 'c1-01';

  const customPrompt =
    '微仰角纵深全景，冷蓝屏幕光与周期性旋转扫射的血红警报形成强烈冷暖对撞，前景带控制台边缘虚化微光。视觉核心为韩道允，他双手撑在主控台边缘上身急迫前倾，眉头紧锁死死盯着断崖下跌的生命红线。在其侧后方三步外，徐雅凛正快步冲向控制台，神情焦急，后景深处雅典娜·K的半透明冷蓝全息投影正在闪烁凝聚。严禁对称排排站，沿用定妆参考图与冷色调分级。';

  console.log(`🎬 开始为项目 [${projectId}] 镜头 [${shotId}] 派发电影级三句式首帧重绘任务...`);

  await new Promise<void>((resolve, reject) => {
    shotKeyframeTool
      .dispatch(
        {
          projectId,
          clipId,
          shotId,
          frame: 'first',
          force: true,
          customPrompt,
          // 严禁传 instruction，避免误触旧图垫图模式
        },
        {
          onTaskId: (taskId) => {
            console.log(`[Task Created] 任务 ID: ${taskId}`);
          },
          onResult: (result) => {
            console.log(`[Task Finished] 执行结果:`, result);
            if (result.success) {
              resolve();
            } else {
              reject(new Error(result.error || '首帧生成失败'));
            }
          },
        }
      )
      .catch(reject);
  });

  console.log('🎉 镜头 c1-01 首帧已成功生成并落盘！');
}

main().catch((err) => {
  console.error('❌ 执行失败:', err);
  process.exit(1);
});
