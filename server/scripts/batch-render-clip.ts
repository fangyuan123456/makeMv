/**
 * scripts/batch-render-clip.ts
 * 批量驱动单幕全量镜头视听资产全自动贯通渲染 (Agent SOP Pipeline Automator)
 *
 * 用法: npx tsx scripts/batch-render-clip.ts <projectId> <clipId> [startShotIndex] [maxShots]
 */

import { ProjectStore } from '../src/project-store/ProjectStore.js';
import { taskDispatcher, taskStore } from '../src/task-engine/index.js';

const projectId = process.argv[2] || 'proj_1795518708769_kpqv';
const clipId = process.argv[3] || 'c1';
const startIdx = parseInt(process.argv[4] || '0', 10);
const maxShots = parseInt(process.argv[5] || '999', 10);

async function waitTask(taskId: string, label: string): Promise<any> {
  process.stdout.write(`  ⏳ [${label}] 任务 ${taskId} 运行中...`);
  const t0 = Date.now();
  while (true) {
    const task = taskStore.getTask(taskId);
    if (!task) {
      console.log(' 未找到任务记录');
      throw new Error(`Task ${taskId} not found`);
    }
    if (task.status === 'succeeded' || task.status === 'completed') {
      const sec = Math.round((Date.now() - t0) / 1000);
      console.log(` 达成 (${sec}s)`);
      return task.output;
    }
    if (task.status === 'failed') {
      console.log(` 失败: ${task.error}`);
      throw new Error(`Task ${taskId} failed: ${task.error}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function main() {
  console.log(`\n=======================================================`);
  console.log(`  makeMv 分幕全量镜头视频渲染流水线 (Agent SOP Pipeline)`);
  console.log(`  项目: ${projectId} | 分幕: ${clipId}`);
  console.log(`=======================================================\n`);

  const store = ProjectStore.getInstance();
  const filmSpec = store.getArtifact<any>(projectId, 'film_spec');
  if (!filmSpec) {
    throw new Error(`项目 [${projectId}] 缺少 film_spec.json`);
  }

  const clip = (filmSpec.clips || []).find((c: any) => c.clipId === clipId);
  if (!clip || !Array.isArray(clip.shots) || clip.shots.length === 0) {
    throw new Error(`分幕 [${clipId}] 未找到有效镜头清单`);
  }

  const allShots = clip.shots;
  const targetShots = allShots.slice(startIdx, startIdx + maxShots);

  console.log(`共 ${allShots.length} 个镜头，本次处理 ${targetShots.length} 个镜头 (从第 ${startIdx + 1} 镜开始):\n`);

  for (let i = 0; i < targetShots.length; i++) {
    const globalIdx = startIdx + i;
    const shot = targetShots[i];
    const shotId = shot.shotId;
    const shotTitle = shot.sliceSummary || shot.title || shotId;

    console.log(`\n-------------------------------------------------------`);
    console.log(`▶ [${globalIdx + 1}/${allShots.length}] 处理镜头: ${shotId} · ${shotTitle} (${shot.durationSec || 3}s)`);
    console.log(`-------------------------------------------------------`);

    // 重新从 store 获取最新 shot 状态
    const freshSpec = store.getArtifact<any>(projectId, 'film_spec');
    const freshClip = freshSpec.clips.find((c: any) => c.clipId === clipId);
    const freshShot = freshClip?.shots?.find((s: any) => s.shotId === shotId) || shot;

    // 步骤 1: 首帧视觉推演 (shot_frame_prompt)
    if (!freshShot.firstFramePrompt) {
      console.log(`\n1️⃣  推演首帧空间提示词...`);
      const task = await taskDispatcher.dispatch({
        projectId,
        toolName: 'film.shot_frame_prompt',
        input: { projectId, clipId, shotId },
      });
      await waitTask(task.taskId, '首帧推演');
    } else {
      console.log(`1️⃣  首帧提示词已有，跳过推演`);
    }

    // 步骤 2: 首帧关键帧生图 (shot_keyframe)
    if (!freshShot.firstFrameImageUrl && !freshShot.keyframeUrl) {
      console.log(`\n2️⃣  渲染首帧关键帧图片 (ComfyUI)...`);
      const task = await taskDispatcher.dispatch({
        projectId,
        toolName: 'film.shot_keyframe',
        input: { projectId, clipId, shotId },
      });
      await waitTask(task.taskId, '首帧出图');
    } else {
      console.log(`2️⃣  首帧图片已有 (${freshShot.firstFrameImageUrl || freshShot.keyframeUrl})，跳过生图`);
    }

    // 步骤 3: 视频动态提示词推演 (shot_motion_prompt)
    if (!freshShot.videoPrompt) {
      console.log(`\n3️⃣  推演时序运镜提示词 (LOD 动能)...`);
      const task = await taskDispatcher.dispatch({
        projectId,
        toolName: 'film.shot_motion_prompt',
        input: { projectId, clipId, shotId },
      });
      await waitTask(task.taskId, '运镜推演');
    } else {
      console.log(`3️⃣  运镜提示词已有，跳过推演`);
    }

    // 步骤 4: 渲染镜头动态视频 (shot_video)
    if (!freshShot.videoUrl) {
      console.log(`\n4️⃣  渲染镜头视频 (ComfyUI FastH3)...`);
      const task = await taskDispatcher.dispatch({
        projectId,
        toolName: 'film.shot_video',
        input: { projectId, clipId, shotId },
      });
      await waitTask(task.taskId, '视频渲染');
    } else {
      console.log(`4️⃣  视频已有 (${freshShot.videoUrl})，跳过渲染`);
    }

    console.log(`✔ 镜头 [${shotId}] 视频全流程已达成！`);
  }

  console.log(`\n=======================================================`);
  console.log(`🎉 批量视频渲染流水线执行完成！`);
  console.log(`=======================================================\n`);
}

main().catch((err) => {
  console.error(`\n❌ 流水线执行异常:`, err);
  process.exit(1);
});
