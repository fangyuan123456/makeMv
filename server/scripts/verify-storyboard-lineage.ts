/**
 * scripts/verify-storyboard-lineage.ts
 * 分镜挂靠实盘校验（会调用 1 次真实 LLM）
 *
 * 目的：单测只能证明「字段存在时逻辑正确」，证明不了「模型会按 prompt 把字段吐出来」。
 * 这个脚本拿真实项目的故事圣经、合成两场戏，跑一次分镜生成，然后检查：
 *   1. characterNames 字段覆盖率；
 *   2. 角色名是否真的取自故事圣经（有没有幻觉新名 / 代词）；
 *   3. syncShotCharacterIds 能否把姓名换成稳定 id；
 *   4. buildLineage / queryImpact 能否据此算出镜头级影响面。
 *
 *   npx tsx scripts/verify-storyboard-lineage.ts [projectId]
 *
 * 只读项目数据，不写盘、不落产物、不触发图片或视频生成。
 */

import fs from 'fs';
import path from 'path';
import '../src/utils/config.js'; // 导入即加载 .env
import { RealLLMService } from '../src/llm/RealLLMService.js';
import { generateStoryboardBatch } from '../src/agents/director/generator/steps/storyboard/generator.js';
import { syncShotCharacterIds } from '../src/agents/director/lineage/character-identity.js';
import { buildLineage, queryImpact } from '../src/agents/director/lineage/lineage.js';

const PROJECTS_ROOT = path.resolve(process.cwd(), 'data/projects');

function main() {
  const projectId = process.argv[2] || 'proj_1794129711028_9gjm';
  const file = path.join(PROJECTS_ROOT, projectId, 'project.json');
  if (!fs.existsSync(file)) {
    console.error(`未找到项目: ${file}`);
    process.exit(1);
  }
  const project = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const bible = project.stageArtifacts?.narrative_design;
  if (!bible?.storyGraph?.nodes?.length) {
    console.error('项目没有故事图谱，无法构造分场剧本');
    process.exit(1);
  }

  // 取两个剧情节点，合成最小分场剧本（只为验证 prompt 契约，不追求剧本质量）
  const picked = bible.storyGraph.nodes.slice(0, 2);
  const scenes = picked.map((n: any, i: number) => ({
    nodeId: n.id,
    act: 1,
    sceneTitle: n.title || `场景 ${i + 1}`,
    location: n.location || '室内',
    timeOfDay: '日内',
    actionSummary: n.summary || '剧情推进',
    dialogues: (n.characterNames || []).slice(0, 2).map((name: string) => ({
      speaker: name,
      line: '这里到底发生了什么？',
    })),
  }));

  const knownNames = new Set<string>(
    (bible.characterNames || bible.characters?.map((c: any) => c.name) || []).filter(Boolean)
  );

  console.log(`项目：${projectId}`);
  console.log(`角色表：${Array.from(knownNames).join('、')}`);
  console.log(`测试场次：${scenes.map((s: any) => s.nodeId).join('、')}`);
  console.log('调用分镜生成（1 次 LLM）…\n');

  run(project, bible, scenes, knownNames).catch((err) => {
    console.error(`校验失败: ${err?.message || err}`);
    process.exit(1);
  });
}

async function run(
  project: any,
  bible: any,
  scenes: any[],
  knownNames: Set<string>
) {
  const llm = new RealLLMService();
  const { shots, totalDurationSec } = await generateStoryboardBatch(llm, {
    title: project.title || '挂靠校验',
    scenes,
    projectId: 'verify-lineage',
    chunkSize: scenes.length, // 一个 chunk，只调一次
  });

  const withField = shots.filter((s: any) => Array.isArray(s.characterNames));
  const emptyShots = withField.filter((s: any) => s.characterNames.length === 0);
  const unknown: string[] = [];
  for (const s of withField) {
    for (const name of s.characterNames) {
      if (!knownNames.has(name)) unknown.push(String(name));
    }
  }

  console.log('── 1. prompt 契约 ──');
  console.log(`镜头数：${shots.length}，总时长 ${totalDurationSec}s`);
  console.log(`带 characterNames：${withField.length}/${shots.length}（${Math.round((withField.length / shots.length) * 100)}%）`);
  console.log(`其中空镜：${emptyShots.length}`);
  console.log(`不在角色表里的名字：${unknown.length ? Array.from(new Set(unknown)).join('、') : '无'}`);

  const storyboard = { shots };
  const touched = syncShotCharacterIds(bible, storyboard);
  const withIds = shots.filter((s: any) => Array.isArray(s.characterIds));
  console.log('\n── 2. 身份归一 ──');
  console.log(`补写 characterIds 的镜头：${touched}/${shots.length}`);
  console.log(`落地 characterIds：${withIds.length}/${shots.length}`);

  const artifacts = {
    ...(project.stageArtifacts || {}),
    storyboard,
  };
  const graph = buildLineage(artifacts);
  console.log('\n── 3. 血缘图 ──');
  console.log(`节点数：${graph.nodes.size}，镜头级精度：${graph.preciseShotCount}/${graph.totalShotCount}`);
  console.log(`缺失产物：${graph.missing.join('、') || '无'}`);

  const target = Array.from(knownNames)[0];
  const r = queryImpact(graph, { characters: [target] });
  console.log(`\n── 4. 影响面（改「${target}」）──`);
  console.log(r.summary);
  console.log(`命中镜头：${r.shots.map((s) => s.id).join('、') || '无'}`);
  const sample = r.clips[0] || r.keyframes[0] || r.shots[0];
  if (sample) {
    console.log(`归因示例：${sample.chain.join(' ← ')}`);
  }

  const ok = withField.length === shots.length && unknown.length === 0 && withIds.length === shots.length;
  console.log(`\n${ok ? '✅ 实盘校验通过' : '⚠️ 实盘校验发现问题，需调整 prompt'}`);
  if (!ok) process.exitCode = 1;
}

main();
