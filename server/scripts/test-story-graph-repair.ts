/**
 * scripts/test-story-graph-repair.ts
 * 复现线上案例：分支指向幻觉节点 node_i7 → 确定性自愈重映射。
 * 同时守卫：真正的结构错误（节点不足/根缺失合法化后仍悬空/ID 重复）仍刚性拦截。
 */
import {
  repairStoryGraphDanglingRefs,
  validateStoryGraph,
} from '../src/agents/director/generator/steps/story-bible/generator.js';

let pass = 0;
let fail = 0;
function assert(cond: boolean, name: string, extra?: string) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.error(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

function makeGraph() {
  return {
    rootNodeId: 'node_1',
    nodes: [
      { id: 'node_1', act: 1, title: '潜入', summary: '...', location: '财阀大厦', characterNames: ['杰克'], isEnding: false, choices: [{ targetNodeId: 'node_2', text: '继续潜入' }] },
      { id: 'node_2', act: 1, title: '遭遇监控', summary: '...', location: '走廊', characterNames: ['杰克'], isEnding: false, choices: [{ targetNodeId: 'node_i7', text: '强行突破' }] },
      { id: 'node_3', act: 2, title: '深入阴谋', summary: '...', location: '实验室', characterNames: ['杰克'], isEnding: false, choices: [{ targetNodeId: 'node_5', text: '对峙' }] },
      { id: 'node_4', act: 2, title: '结识盟友', summary: '...', location: '安全屋', characterNames: ['杰克'], isEnding: false, choices: [] },
      { id: 'node_5', act: 3, title: '终极对决', summary: '...', location: '核心机房', characterNames: ['杰克'], isEnding: true, choices: [] },
      { id: 'node_6', act: 3, title: '真相揭露', summary: '...', location: '天台', characterNames: ['杰克'], isEnding: true, choices: [] },
    ],
    endingsCount: 2,
    estimatedBranches: 4,
  } as any;
}

console.log('场景 1：线上案例——分支指向幻觉节点 node_i7');
{
  const g = makeGraph();
  const n = repairStoryGraphDanglingRefs(g);
  assert(n === 1, '恰好修复 1 处', `实际 ${n}`);
  const fixed = g.nodes[1].choices[0].targetNodeId;
  assert(fixed === 'node_3', '重映射到下一幕(node_2 后第一幕>1)的首个节点 node_3', `实际 ${fixed}`);
  assert(g.nodes[1].choices[0].text === '强行突破', '分支文案原样保留');
  let threw = false;
  try { validateStoryGraph(g); } catch { threw = true; }
  assert(!threw, '修复后刚性校验通过');
}

console.log('场景 2：根节点悬空 + 全图无终局');
{
  const g = makeGraph();
  g.rootNodeId = 'node_x';
  g.nodes.forEach((x: any) => (x.isEnding = false));
  const n = repairStoryGraphDanglingRefs(g);
  assert(g.rootNodeId === 'node_1', '根节点重映射到首个节点');
  assert(g.nodes[g.nodes.length - 1].isEnding === true, '最后一个节点被标为终局');
  let threw = false;
  try { validateStoryGraph(g); } catch { threw = true; }
  assert(!threw, '修复后刚性校验通过');
  assert(n >= 2, '修复计数 >= 2', `实际 ${n}`);
}

console.log('场景 3：末幕悬空兜底到最后节点');
{
  const g = makeGraph();
  g.nodes[4].choices = [{ targetNodeId: 'node_ghost', text: '逃亡' }];
  repairStoryGraphDanglingRefs(g);
  assert(g.nodes[4].choices[0].targetNodeId === 'node_6', '末幕悬空兜底到最后节点');
}

console.log('场景 4：结构真错误仍刚性拦截（自愈不背锅）');
{
  const g = makeGraph();
  g.nodes = g.nodes.slice(0, 2);
  let threw = false;
  try { repairStoryGraphDanglingRefs(g); validateStoryGraph(g); } catch { threw = true; }
  assert(threw, '节点数 < 3 必须失败');

  const g2 = makeGraph();
  g2.nodes.push({ ...g2.nodes[0] });
  threw = false;
  try { repairStoryGraphDanglingRefs(g2); validateStoryGraph(g2); } catch { threw = true; }
  assert(threw, '节点 ID 重复必须失败');
}

console.log('场景 5：健康图谱零修复');
{
  const g = makeGraph();
  g.nodes[1].choices[0].targetNodeId = 'node_3'; // 消除底图中的悬空引用
  const n = repairStoryGraphDanglingRefs(g);
  assert(n === 0, '健康图谱不做任何改动', `实际修复 ${n} 处`);
}

console.log(`\n结果: ${pass} 过, ${fail} 挂`);
process.exit(fail > 0 ? 1 : 0);
