import type { PremiseOutput } from '../01-premise/schema.js';
import type { FullScriptTextOutput } from './schema.js';

type Node = PremiseOutput['storyNodes'][number];
export interface PathBeat { node: Node; narrativeText: string; chosenAction: string }

/** 每次扩写仅接收真实祖先正文及已选行动，兄弟分支不进入上下文。 */
export async function expandStoryPaths(
  premise: PremiseOutput,
  write: (node: Node, history: PathBeat[]) => Promise<string>,
): Promise<FullScriptTextOutput> {
  if (premise.storyBible) {
    const texts=new Map<string,string>();
    const incoming=new Map<string,Node[]>();
    for(const node of premise.storyNodes) {
      const targets=node.choices.length ? node.choices.flatMap(c=>c.nextRoutes?.map(r=>r.targetNodeId) || [c.targetNodeId]) : node.nextRoutes?.map(r=>r.targetNodeId) || (node.nextNodeId?[node.nextNodeId]:[]);
      for(const target of new Set(targets)) incoming.set(target,[...(incoming.get(target)||[]),node]);
    }
    while(texts.size<premise.storyNodes.length) {
      const ready=premise.storyNodes.filter(n=>!texts.has(n.id)&&(incoming.get(n.id)||[]).every(p=>texts.has(p.id))).slice(0,3);
      if(!ready.length) throw new Error('场景依赖不能形成向前推进的流程');
      const batch=await Promise.allSettled(ready.map(async node=>{
        const parents=incoming.get(node.id)||[];
        // 分支及其短承接携带唯一前场；汇合节点绝不选择某条支线当作历史。
        const parent=parents.length===1?parents[0]:undefined;
        const history:PathBeat[]=parent?[{node:parent,narrativeText:texts.get(parent.id)!,chosenAction:parent.choices.find(c=>c.targetNodeId===node.id || c.nextRoutes?.some(r=>r.targetNodeId===node.id))?.text || node.continuationAction || '继续剧情'}]:[];
        return {id:node.id,narrativeText:node.fixedNarrative || await write(node,history)};
      }));
      for(const result of batch) {
        if(result.status==='rejected') throw result.reason;
        if(!result.value.narrativeText.trim()) throw new Error('节点正文为空');
        texts.set(result.value.id,result.value.narrativeText);
      }
    }
    return {nodes:premise.storyNodes.map(n=>({id:n.id,narrativeText:texts.get(n.id)!}))};
  }
  const byId = new Map(premise.storyNodes.map(n => [n.id, n]));
  const texts = new Map<string, string>();
  let frontier: { id: string; history: PathBeat[] }[] = [{ id: premise.startNodeId, history: [] }];
  while (frontier.length) {
    const next: typeof frontier = [];
    // 限定同层批量，避免宽树一次创建大量远程调用。
    for (let offset = 0; offset < frontier.length; offset += 3) {
      const batch = frontier.slice(offset, offset + 3);
      for (const { id } of batch) {
        if (!byId.has(id) || texts.has(id)) throw new Error(`路径树节点重复或不存在：${id}`);
        texts.set(id, '');
      }
      const results = await Promise.allSettled(batch.map(async ({ id, history }) => {
        const node = byId.get(id)!;
        const narrativeText = await write(node, history);
        if (!narrativeText.trim()) throw new Error(`节点正文为空：${id}`);
        texts.set(id, narrativeText);
        const links = node.choices.length ? node.choices.map(c => ({ id: c.targetNodeId, action: c.text }))
          : node.nextNodeId ? [{ id: node.nextNodeId, action: node.continuationAction || '继续剧情' }] : [];
        return links.map(link => ({ id: link.id, history: [...history, { node, narrativeText, chosenAction: link.action }] }));
      }));
      for (const result of results) {
        if (result.status === 'rejected') throw result.reason;
        next.push(...result.value);
      }
    }
    frontier = next;
  }
  return { nodes: premise.storyNodes.map(n => ({ id: n.id, narrativeText: texts.get(n.id) || '' })) };
}
