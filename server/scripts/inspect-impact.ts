/**
 * scripts/inspect-impact.ts
 * 影响面查询命令行工具：给定项目与改动对象，打印哪些下游资产会失效。
 *
 *   npx tsx scripts/inspect-impact.ts <projectId> 李明
 *   npx tsx scripts/inspect-impact.ts <projectId> --node node_2
 *   npx tsx scripts/inspect-impact.ts <projectId> --shot shot_3
 *
 * 只读，不触发任何重渲或写盘。
 */

import fs from 'fs';
import path from 'path';
import { buildLineage, queryImpact } from '../src/agents/director/lineage.js';

const PROJECTS_ROOT = path.resolve(process.cwd(), 'data/projects');

function loadProject(projectId: string): Record<string, any> | null {
  const file = path.join(PROJECTS_ROOT, projectId, 'project.json');
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  return raw.stageArtifacts || {};
}

function main() {
  const [projectId, ...rest] = process.argv.slice(2);
  if (!projectId) {
    console.error('用法: npx tsx scripts/inspect-impact.ts <projectId> [角色名 | --node <id> | --shot <id>]');
    process.exit(1);
  }

  const artifacts = loadProject(projectId);
  if (!artifacts) {
    console.error(`未找到项目: ${projectId}`);
    process.exit(1);
  }

  const graph = buildLineage(artifacts);
  console.log(`产物层: ${Object.keys(artifacts).join(', ') || '（空）'}`);
  console.log(`图规模: ${graph.nodes.size} 个节点，镜头精度 ${graph.preciseShotCount}/${graph.totalShotCount}`);
  if (graph.missing.length) console.log(`缺失: ${graph.missing.join('、')}`);

  const query =
    rest[0] === '--node'
      ? { nodeIds: [rest[1]] }
      : rest[0] === '--shot'
        ? { shotIds: [rest[1]] }
        : { characters: rest };

  const r = queryImpact(graph, query);
  console.log(`\n${r.summary}\n`);
  for (const [label, list] of [
    ['角色', r.characters],
    ['剧情节点', r.nodes],
    ['场次', r.scenes],
    ['镜头', r.shots],
    ['首帧图', r.keyframes],
    ['视频片段', r.clips],
  ] as const) {
    if (list.length === 0) continue;
    console.log(`【${label}】${list.length}`);
    for (const hit of list.slice(0, 20)) console.log(`  ${hit.id}  ←  ${hit.chain.join(' ← ')}`);
    if (list.length > 20) console.log(`  … 另有 ${list.length - 20} 项`);
  }
}

main();
