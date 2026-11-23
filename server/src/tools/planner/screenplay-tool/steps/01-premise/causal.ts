import { z } from 'zod';
import type { PremiseOutput } from './schema.js';

export const FactSchema = z.object({key:z.string().regex(/^[a-z][a-z0-9_]*$/), meaning:z.string(), values:z.array(z.string()).min(2).max(8), initial:z.string(), scope:z.enum(['shared','branch']).optional().describe('shared 是各路线保持一致的场景位置、在场角色、公共时钟；branch 是选择留下的证据、代价或关系差异')});
export type Fact = z.infer<typeof FactSchema>;
export type World = Record<string,string>;
export type Route = {history:Record<string,boolean>; world:World;events?:string[]};
export const ActionSchema = z.object({
  summary:z.string().describe('只写本场确定发生的行动；涉及可变事实必须在 requires/effects 声明'),
  requires:z.record(z.string()).describe('行动所需的已有事实，必须在每条入路成立'),
  effects:z.record(z.string()).describe('本场通过可见行动造成的变化；未列出的事实原样保留'),
});
export type Action = z.infer<typeof ActionSchema>;
export function initialWorld(facts:Fact[]):World {
  if(new Set(facts.map(f=>f.key)).size!==facts.length) throw new Error('重复事实 key');
  const world=Object.fromEntries(facts.map(f=>[f.key,f.initial]));
  checkValues(facts,world); return world;
}
function checkValues(facts:Fact[],values:World) {
  for(const [key,value] of Object.entries(values)) {
    if(!facts.find(f=>f.key===key)?.values.includes(value)) throw new Error(`未注册的事实或值 ${key}=${value}`);
  }
}
export function sharedWorld(routes:Route[]):World {
  if(!routes.length) throw new Error('没有可达入路');
  return Object.fromEntries(Object.entries(routes[0].world).filter(([k,v])=>routes.every(r=>r.world[k]===v)));
}
export function applyAction(facts:Fact[],routes:Route[],action:Action):Route[] {
  checkValues(facts,action.requires); checkValues(facts,action.effects);
  for(const r of routes) for(const [k,v] of Object.entries(action.requires)) {
    if(r.world[k]!==v) throw new Error(`行动前提不成立 ${k}=${v}，实际 ${r.world[k]}`);
  }
  // Changing a divergent value would erase a branch result without a known starting state.
  const common=sharedWorld(routes);
  for(const k of Object.keys(action.effects)) {
    if(!(k in common)) throw new Error(`修改 ${k} 没有所有入路共有的原值，不能重置分支差异`);
  }
  return routes.map(r=>({history:{...r.history},world:{...r.world,...action.effects},events:[...(r.events||[]),action.summary]}));
}
export function describeWorld(facts:Fact[],world:World):string[] {
  return facts.filter(f=>f.key in world).map(f=>`${f.meaning}：${world[f.key]}`);
}
export function groupEndings(facts:Fact[],routes:Route[],endings:{requires:World}[]):Route[][] {
  for(const e of endings) checkValues(facts,e.requires);
  const groups=endings.map(()=>[] as Route[]);
  for(const r of routes) {
    const matches=endings.map((e,i)=>Object.entries(e.requires).every(([k,v])=>r.world[k]===v)?i:-1).filter(i=>i>=0);
    if(matches.length!==1) throw new Error(`结局前提必须唯一覆盖所有可达事实，当前匹配 ${matches.length} 个`);
    groups[matches[0]].push(r);
  }
  if(groups.some(g=>!g.length)) throw new Error('结局不可达');
  return groups;
}
export function causalNode(facts:Fact[],id:string,actNumber:number,role:'common'|'branch'|'ending',routes:Route[],action:Action):PremiseOutput['storyNodes'][number] {
  const after=applyAction(facts,routes,action);
  return {id,actNumber,kind:role==='ending'?'ending':'scene',contextRole:role,summary:action.summary,
    establishedEvents:(routes[0].events||[]).filter(event=>routes.every(route=>route.events?.includes(event))),
    entryConditions:describeWorld(facts,sharedWorld(routes)),exitConditions:describeWorld(facts,sharedWorld(after)),
    causalContract:{before:sharedWorld(routes),after:sharedWorld(after),requires:{...Object.fromEntries(Object.keys(action.effects).map(k=>[k,sharedWorld(routes)[k]])),...action.requires},effects:action.effects,unavailableFacts:facts.filter(f=>!(f.key in sharedWorld(routes))).map(f=>f.meaning)},choices:[]};
}

/** 按真实事实取值构造互斥、穷尽的分区，不让模型填写路由表。 */
export function partitionEndings(routes:Route[],key:string):Route[][] {
  if(!routes.length || routes.some(r=>!(key in r.world))) throw new Error('终局分组缺少事实');
  const buckets=new Map<string,Route[]>();
  for(const route of routes) {
    const value=route.world[key];
    buckets.set(value,[...(buckets.get(value)||[]),route]);
  }
  if(buckets.size<2) throw new Error('终局事实没有分歧');
  const groups=[...buckets.values()];
  // 保持最多三个终局；第三组只使用剩余路线的交集，不能假定某一个值。
  return groups.length<=3?groups:[groups[0],groups[1],groups.slice(2).flat()];
}
