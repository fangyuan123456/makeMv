/**
 * 回归测试：故事图谱 DAG 分层必须对自环/环免疫
 *
 * 背景：proj_1794101364300_lcbs 的 node_15（结局节点）带出自环 node_15→node_15，
 * 旧「最长路径 BFS」在该输入下 while 永不退出，浏览器主线程被锁死（客户端卡死）。
 */
import { computeDagRanks } from '../../client/src/components/stages/dagLayout';
import fs from 'node:fs';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: any) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}`, extra ?? '');
  }
}

const t0 = Date.now();

/* 1. 真实故障样本：15 节点 + 结局自环 + 重复边 */
console.log('\n[1] 真实故障项目（node_15 自环）');
{
  const ids = Array.from({ length: 15 }, (_, i) => `node_${i + 1}`);
  const edges: Array<{ from: string; to: string }> = [
    ['node_1', 'node_2'], ['node_1', 'node_3'],
    ['node_2', 'node_4'], ['node_2', 'node_5'],
    ['node_3', 'node_6'], ['node_3', 'node_7'],
    ['node_4', 'node_8'], ['node_4', 'node_9'],
    ['node_5', 'node_6'], ['node_5', 'node_7'],
    ['node_6', 'node_10'], ['node_6', 'node_11'],
    ['node_7', 'node_10'], ['node_7', 'node_11'],
    ['node_8', 'node_12'], ['node_8', 'node_13'],
    ['node_9', 'node_14'], ['node_9', 'node_15'],
    ['node_10', 'node_15'], ['node_10', 'node_15'],
    ['node_11', 'node_15'], ['node_11', 'node_15'],
    ['node_12', 'node_15'], ['node_12', 'node_15'],
    ['node_13', 'node_15'], ['node_13', 'node_15'],
    ['node_14', 'node_15'], ['node_14', 'node_15'],
    ['node_15', 'node_15'],
  ].map(([from, to]) => ({ from, to }));

  const rank = computeDagRanks(ids, edges, 'node_1');
  check('15 个节点全部分层', rank.size === 15, rank.size);
  check('起点 rank = 0', rank.get('node_1') === 0, rank.get('node_1'));
  check('node_2 / node_3 在第 1 列', rank.get('node_2') === 1 && rank.get('node_3') === 1);
  check(
    '结局 node_15 落在最深列（5）',
    rank.get('node_15') === 5,
    rank.get('node_15')
  );
  check(
    '所有 rank 为有限非负数',
    [...rank.values()].every((v) => Number.isFinite(v) && v >= 0),
    [...rank.values()]
  );
}

/* 2. 纯环（A→B→C→A）：旧实现必死循环 */
console.log('\n[2] 三元环 + 入口');
{
  const rank = computeDagRanks(
    ['a', 'b', 'c', 'd'],
    [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a' },
      { from: 'c', to: 'd' },
    ],
    'a'
  );
  check('环不会挂死且四节点均有 rank', rank.size === 4);
  check('d 可达（rank ≥ 1）', (rank.get('d') ?? 0) >= 1, rank.get('d'));
}

/* 3. 全环无入口 */
console.log('\n[3] 两个互不相连的自环');
{
  const rank = computeDagRanks(['x', 'y'], [{ from: 'x', to: 'x' }, { from: 'y', to: 'y' }], 'x');
  check('自环被剔除，均兜底到第 1 列', rank.get('x') === 0 && rank.get('y') === 1, [...rank]);
}

/* 4. 悬空边与重复边 */
console.log('\n[4] 悬空目标 / 重复边 / 起点前驱');
{
  const rank = computeDagRanks(
    ['a', 'b', 'c'],
    [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'b' },
      { from: 'a', to: 'ghost' },
      { from: 'ghost', to: 'c' },
      { from: 'c', to: 'a' },
    ],
    'a'
  );
  check('悬空边被忽略，c 兜底第 1 列', rank.get('c') === 1, rank.get('c'));
  check('起点 rank 固定 0（不被回边覆盖）', rank.get('a') === 0, rank.get('a'));
  check('b 正常第 1 列', rank.get('b') === 1, rank.get('b'));
}

/* 5. 规模护栏：2000 节点链 + 随机回边，必须在 100ms 内返回 */
console.log('\n[5] 2000 节点压力');
{
  const ids = Array.from({ length: 2000 }, (_, i) => `n${i}`);
  const edges: Array<{ from: string; to: string }> = [];
  for (let i = 0; i < 1999; i++) edges.push({ from: `n${i}`, to: `n${i + 1}` });
  for (let i = 0; i < 200; i++) edges.push({ from: `n${1500 + i}`, to: `n${i}` });
  const s = Date.now();
  const rank = computeDagRanks(ids, edges, 'n0');
  const cost = Date.now() - s;
  check(`2000 节点耗时 ${cost}ms < 100ms`, cost < 100, cost);
  check('全部分层', rank.size === 2000);
  check('末端 rank 较大', (rank.get('n1999') ?? 0) > 0, rank.get('n1999'));
}

/* 6. 线上真实项目文件（若存在）也必须秒级出结果 */
console.log('\n[6] 线上项目真实数据');
{
  const projFile =
    'D:/fangyuan/gitWorkSpace/makeMv/server/data/projects/proj_1794101364300_lcbs/project.json';
  if (fs.existsSync(projFile)) {
    const json = JSON.parse(fs.readFileSync(projFile, 'utf8'));
    const graph = json?.stageArtifacts?.narrative_design?.storyGraph;
    if (graph?.nodes?.length) {
      const edges: Array<{ from: string; to: string }> = [];
      graph.nodes.forEach((n: any) =>
        (n.choices || []).forEach((c: any) => {
          const to = c.targetNodeId || c.toNodeId;
          if (to) edges.push({ from: n.id, to });
        })
      );
      const s = Date.now();
      const rank = computeDagRanks(
        graph.nodes.map((n: any) => n.id),
        edges,
        graph.rootNodeId
      );
      const cost = Date.now() - s;
      check(`真实图 ${graph.nodes.length} 节点 / ${edges.length} 边，${cost}ms 完成`, cost < 50, cost);
      check('全部分层', rank.size === graph.nodes.length);
      check('根节点 rank = 0', rank.get(graph.rootNodeId) === 0);
    } else {
      console.log('  (跳过：项目内无 storyGraph)');
    }
  } else {
    console.log('  (跳过：项目文件不存在)');
  }
}

console.log(`\n总计 ${pass} 通过 / ${fail} 失败，用时 ${Date.now() - t0}ms`);
if (fail > 0) process.exit(1);