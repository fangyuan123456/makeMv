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
  // 用「非终局」的末幕节点做样本：终局节点的出边会被新规则直接清空
  g.nodes[3].choices = [{ targetNodeId: 'node_ghost', text: '逃亡' }];
  repairStoryGraphDanglingRefs(g);
  assert(g.nodes[3].choices[0].targetNodeId === 'node_5', '末幕悬空兜底到下一幕首节点');
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

console.log('场景 6：结局节点自环（线上 node_15→node_15 客户端卡死案例）');
{
  const g = makeGraph();
  g.nodes[1].choices[0].targetNodeId = 'node_3';
  g.nodes[4].choices = [{ targetNodeId: 'node_5', text: '留在原地' }]; // node_5 是终局却带自环
  const n = repairStoryGraphDanglingRefs(g);
  assert(n === 1, '自环被剔除 1 处', `实际修复 ${n} 处`);
  assert(g.nodes[4].choices.length === 0, '终局节点出边被清空');
  let threw = false;
  try { validateStoryGraph(g); } catch { threw = true; }
  assert(!threw, '修复后通过契约校验（无自环）');
}

console.log('场景 7：非终局节点自环 → 仅剔除自环边，保留其它分支');
{
  const g = makeGraph();
  g.nodes[1].choices[0].targetNodeId = 'node_3'; // 先消除底图悬空，隔离出自环这一处
  g.nodes[0].choices = [
    { targetNodeId: 'node_1', text: '原地打转' },
    { targetNodeId: 'node_2', text: '继续潜入' },
  ];
  const n = repairStoryGraphDanglingRefs(g);
  assert(n === 1, '剔除 1 条自环边', `实际修复 ${n} 处`);
  assert(g.nodes[0].choices.length === 1, '保留合法分支', JSON.stringify(g.nodes[0].choices));
  assert(g.nodes[0].choices[0].targetNodeId === 'node_2', '保留的是非自环分支');
}

console.log('场景 8：终局节点携带指向他人的出边 → 清空');
{
  const g = makeGraph();
  g.nodes[1].choices[0].targetNodeId = 'node_3';
  g.nodes[4].choices = [{ targetNodeId: 'node_1', text: '回到开头' }]; // 终局回头
  const n = repairStoryGraphDanglingRefs(g);
  assert(n === 1, '清洗 1 处终局出边', `实际修复 ${n} 处`);
  assert(g.nodes[4].choices.length === 0, '终局分支被清空');
}

console.log(`\n结果: ${pass} 过, ${fail} 挂`);
process.exit(fail > 0 ? 1 : 0);
