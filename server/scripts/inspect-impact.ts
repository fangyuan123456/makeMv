/**
 * scripts/inspect-impact.ts
 * 影响面查询命令行工具：给定项目与改动对象，打印哪些下游资产会失效。
 *
 *   npx tsx scripts/inspect-impact.ts <projectId> 李明
 *   npx tsx scripts/inspect-impact.ts <projectId> --node node_2
 *   npx tsx scripts/inspect-impact.ts <projectId> --shot shot_3
 *   npx tsx scripts/inspect-impact.ts <projectId> --stale
 *   npx tsx scripts/inspect-impact.ts <projectId> --plan 李明
 *   npx tsx scripts/inspect-impact.ts <projectId> --plan --json
 *
 * --plan 打印增量重算清单（dry-run），--json 输出可直接序列化的清单结构。
 * 全部只读，不触发任何重渲或写盘。
 */

import fs from 'fs';
import path from 'path';
import { buildLineage, queryImpact } from '../src/agents/director/lineage.js';
import type { ImpactQuery } from '../src/agents/director/lineage.js';
import { findStaleAssets } from '../src/agents/director/fingerprint.js';
import {
  buildRecomputePlan,
  formatRecomputePlan,
} from '../src/agents/director/recompute-plan.js';

const PROJECTS_ROOT = path.resolve(process.cwd(), 'data/projects');

function loadProject(projectId: string): Record<string, any> | null {
  const file = path.join(PROJECTS_ROOT, projectId, 'project.json');
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  return raw.stageArtifacts || {};
}

function parseQuery(rest: string[]): ImpactQuery {
  return rest[0] === '--node'
    ? { nodeIds: [rest[1]] }
    : rest[0] === '--shot'
      ? { shotIds: [rest[1]] }
      : { characters: rest };
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

  if (rest[0] === '--plan') {
    const flags = rest.slice(1);
    const asJson = flags.includes('--json');
    const targets = flags.filter((f) => f !== '--json');
    const plan = buildRecomputePlan(artifacts, targets.length ? { query: parseQuery(targets) } : {});
    console.log(asJson ? JSON.stringify(plan, null, 2) : formatRecomputePlan(plan));
    return;
  }

  if (rest[0] === '--stale') {
    const r = findStaleAssets(artifacts);
    console.log(`产物层: ${Object.keys(artifacts).join(', ') || '（空）'}`);
    console.log(`\n${r.summary}\n`);
    for (const [label, list] of [
      ['陈旧首帧图', r.staleKeyframes],
      ['陈旧视频片段', r.staleClips],
      ['无指纹首帧图（老资产）', r.unknownKeyframes],
      ['无指纹片段（老资产）', r.unknownClips],
      ['一致的首帧图', r.freshKeyframes],
      ['一致的片段', r.freshClips],
    ] as const) {
      if (list.length) console.log(`【${label}】${list.length}  ${list.slice(0, 12).join('、')}${list.length > 12 ? ' …' : ''}`);
    }
    return;
  }

  const graph = buildLineage(artifacts);
  console.log(`产物层: ${Object.keys(artifacts).join(', ') || '（空）'}`);
  console.log(`图规模: ${graph.nodes.size} 个节点，镜头精度 ${graph.preciseShotCount}/${graph.totalShotCount}`);
  if (graph.missing.length) console.log(`缺失: ${graph.missing.join('、')}`);

  const r = queryImpact(graph, parseQuery(rest));
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
