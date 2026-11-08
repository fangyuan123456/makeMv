/**
 * 存量脏数据清理：剔除故事图谱里的自环边与终局节点出边。
 *
 * 背景：proj_1794101364300_lcbs 的结局节点 node_15 携带自环 node_15→node_15，
 * 让客户端拓扑分层算法无限循环、页面卡死。生成端已加自愈，此脚本用于修复历史项目。
 *
 * 用法：npx tsx scripts/repair-story-graph-data.ts <projectId> [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.resolve(__dirname, '../data/projects');

const projectId = process.argv[2];
const dryRun = process.argv.includes('--dry');

if (!projectId) {
  console.error('用法: npx tsx scripts/repair-story-graph-data.ts <projectId> [--dry]');
  process.exit(1);
}

const projectDir = path.join(DATA_ROOT, projectId);
if (!fs.existsSync(projectDir)) {
  console.error(`项目目录不存在: ${projectDir}`);
  process.exit(1);
}

interface RepairStat {
  selfLoops: number;
  endingEdges: number;
}

function cleanGraph(graph: any): RepairStat {
  const stat: RepairStat = { selfLoops: 0, endingEdges: 0 };
  if (!graph || !Array.isArray(graph.nodes)) return stat;

  for (const node of graph.nodes) {
    if (!Array.isArray(node.choices) || node.choices.length === 0) continue;

    if (node.isEnding) {
      stat.endingEdges += node.choices.length;
      console.warn(`  · 结局节点 [${node.id}] 清空 ${node.choices.length} 条出边`);
      node.choices = [];
      continue;
    }

    const kept = node.choices.filter((c: any) => {
      const target = c.targetNodeId || c.toNodeId;
      if (target && target === node.id) {
        stat.selfLoops++;
        console.warn(`  · 节点 [${node.id}] 剔除自环分支「${c.text || ''}」`);
        return false;
      }
      return true;
    });
    node.choices = kept;
  }
  return stat;
}

const total: RepairStat = { selfLoops: 0, endingEdges: 0 };

function processFile(file: string, getGraphs: (json: any) => any[]) {
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, 'utf8');
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    console.warn(`  ! 解析失败，跳过: ${path.basename(file)}`);
    return;
  }

  let changed = false;
  for (const graph of getGraphs(json)) {
    const stat = cleanGraph(graph);
    if (stat.selfLoops || stat.endingEdges) {
      total.selfLoops += stat.selfLoops;
      total.endingEdges += stat.endingEdges;
      changed = true;
    }
  }

  if (!changed) return;
  if (dryRun) {
    console.log(`  ~ [dry] 需要修改: ${path.relative(projectDir, file)}`);
    return;
  }
  const backup = `${file}.bak_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(file, backup);
  fs.writeFileSync(file, JSON.stringify(json, null, 2), 'utf8');
  console.log(`  ✓ 已修复并备份: ${path.relative(projectDir, file)}`);
}

console.log(`清理项目 ${projectId}${dryRun ? '（dry-run）' : ''}`);

// 1. project.json：每个 stageArtifact 下可能挂 storyGraph
processFile(path.join(projectDir, 'project.json'), (json) => {
  const out: any[] = [];
  const arts = json?.stageArtifacts || {};
  for (const key of Object.keys(arts)) {
    if (arts[key]?.storyGraph) out.push(arts[key].storyGraph);
  }
  if (json?.storyGraph) out.push(json.storyGraph);
  return out;
});

// 2. narrative/story_bible.json
processFile(path.join(projectDir, 'narrative', 'story_bible.json'), (json) =>
  json?.storyGraph ? [json.storyGraph] : []
);

console.log(
  `完成：剔除自环 ${total.selfLoops} 条，清空终局出边 ${total.endingEdges} 条` +
    (total.selfLoops + total.endingEdges === 0 ? '（数据本就干净）' : '')
);
