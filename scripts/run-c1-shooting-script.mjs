import { taskToolRegistry } from '../server/dist/task-engine/task-registry.js';
import { syncTaskResultToProjectStore } from '../server/dist/task-engine/asset-sync.js';
import { ProjectStore } from '../server/dist/project-store/ProjectStore.js';
import { safeReadJsonSync } from '../server/dist/utils/atomicFile.js';
import path from 'node:path';
import fs from 'node:fs';

async function main() {
  const projectId = 'proj_1795370334832_mzzw';
  const clipId = 'c1';
  const store = ProjectStore.getInstance();
  const projectDir = store.getProjectDir(projectId);

  console.log('Project dir:', projectDir);
  const storyboards = safeReadJsonSync(path.join(projectDir, 'storyboards.json')) || [];
  const targetClip = storyboards.find(c => c.clipId === clipId) || storyboards[0];
  if (!targetClip) {
    throw new Error('找不到分幕 c1');
  }

  const entities = safeReadJsonSync(path.join(projectDir, 'scenes', 'entities.json')) || {};
  const prd = safeReadJsonSync(path.join(projectDir, 'prd.json')) || {};
  const prdClip = (prd.clips || []).find(c => c.id === clipId || c.clipId === clipId);

  const narrativeText = prdClip?.narrativeText || `【场景：村口——黄昏，薄雾笼罩。陈默背着旧背包，手持录音机，站在刻有村名的石碑前。】
[陈默]：“十年没回来了……妈，我回来了。”
(他绕到石碑背面，镜头特写：碑面密密麻麻刻着人名，每一个都被粗暴地划掉，划痕深及石骨。最新一个名字是“陈秀兰”——他母亲。)
[陈默]：“这些名字……都是死人？”
【场景：灵堂——夜，白烛摇曳，母亲的黑白遗照摆在正中。三叔公佝偻着背，摩挲词戒。】
[三叔公]：“默娃，今晚你守夜。规矩不多，但条条要命——不回头，不吹烛，不细听磁带里的杂音。”
[陈默]：“为什么？”
[三叔公]：“守阴人的规矩，破了，魂就没了。”
(三叔公点燃三根白烛，烛火突然同时一暗，随即恢复。他眼神闪烁，退到门口。)
[三叔公]：“记住，烛灭之前，别出灵堂。”
(三叔公离开。陈默独自面对灵堂，录音机放在供桌上，磁带缓缓转动。)
【场景：灵堂——深夜，长镜头从陈默背后缓慢推近。】
(呼吸声渐重。录音机磁带的沙沙杂音中，隐约浮出一个沙哑的女声：“……默……别回头……”)
(陈默脊背僵直。白烛的火苗开始不规则跳动，其中一根突然“噗”地自灭，一缕青烟升起。)`;

  console.log('Target clip:', targetClip.clipId, targetClip.title);

  const tool = taskToolRegistry.getTool('film.shooting_script');
  if (!tool) throw new Error('Tool film.shooting_script 未找到');

  console.log('开始执行 film.shooting_script 升级...');
  const input = {
    projectId,
    clipId,
    clipTitle: targetClip.title || '第 1 幕《归乡夜忌》',
    narrativeText,
    characters: (entities.characters || []).map(c => ({
      characterId: c.characterId || c.id,
      name: c.name,
      promptZh: c.promptZh || c.appearanceSummary,
    })),
    locations: (entities.locations || []).map(l => ({
      locationId: l.locationId || l.id,
      name: l.name,
      promptZh: l.promptZh || l.appearanceSummary,
    })),
  };

  let executionResult = null;
  await tool.dispatch(
    input,
    {
      onTaskId: async (taskId) => {
        console.log(`[film.shooting_script] 任务 ID 分配: ${taskId}`);
      },
      onProgress: ({ percent, note }) => {
        console.log(`[进度 ${percent}%] ${note}`);
      },
      onResult: async (res) => {
        executionResult = res;
      },
    }
  );

  if (!executionResult || !executionResult.success) {
    throw new Error(`执行未成功: ${executionResult?.error || '无返回结果'}`);
  }

  const output = executionResult.data;
  console.log('生成完成！环境锁:', JSON.stringify(output.environmentLock, null, 2));
  console.log(`生成纯物理动作节拍数: ${output.actionBeats?.length}`);

  // 执行资产同步落盘
  const taskRecord = {
    taskId: `task_shooting_${Date.now()}`,
    projectId,
    toolName: 'film.shooting_script',
    status: 'completed',
    input,
    output,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };

  syncTaskResultToProjectStore(taskRecord);
  console.log('资产同步落盘完成！');

  // 验证验证落盘内容
  const updatedSb = safeReadJsonSync(path.join(projectDir, 'storyboards.json'));
  const c1Updated = updatedSb.find(c => c.clipId === clipId);
  console.log('storyboards.json 中的 c1.shootingScript 存在:', !!c1Updated?.shootingScript);
  if (c1Updated?.shootingScript) {
    console.log('Environment lock:', c1Updated.shootingScript.environmentLock);
    console.log('Action beats count:', c1Updated.shootingScript.actionBeats?.length);
  }

  const updatedFilmSpec = safeReadJsonSync(path.join(projectDir, 'film_spec.json'));
  console.log('film_spec.json 存在:', !!updatedFilmSpec);
}

main().catch(err => {
  console.error('执行失败:', err);
  process.exit(1);
});
