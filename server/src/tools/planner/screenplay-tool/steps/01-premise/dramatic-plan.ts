import { z } from 'zod';
import { FactSchema, applyAction, causalNode, sharedWorld, type Action, type Fact, type Route, type World } from './causal.js';

/** 状态值域来自本故事；不含题材、道具名或预制剧情。 */
export function worldSchema(facts:Fact[],required:World={}) {
  return z.object(Object.fromEntries(facts.map(f=>[f.key,(f.key in required ? z.literal(required[f.key]) : z.enum(f.values as [string,...string[]]).optional()).describe(f.meaning)]))).strict().transform(value=>Object.fromEntries(Object.entries(value).filter((entry):entry is [string,string]=>entry[1]!==undefined)));
}
export function draftActionSchema(facts:Fact[],available?:World,arrival:World={}) {
  const usable=facts.filter(f=>!available || f.key in available);
  return z.object({
    summary:z.string().min(1).max(350).describe('可拍摄的动作与因果过程；物品如何取得、阻碍如何解除必须写出'),
    uses:z.array(usable.length?z.enum(usable.map(f=>f.key) as [string,...string[]]):z.never()).describe('行动依赖的已有事实编号；前提值由代码从当前路线绑定'),
    effects:worldSchema(usable,arrival).describe('本段行动实际造成的全部变化，可同时改变多个事实'),
  });
}
export type DraftAction={summary:string;uses:string[];effects:World};
export type ActionBundle={text:string;gain:string;cost:string;payoff:string;consequence:DraftAction;landing:DraftAction|null};
export function bindDraft(routes:Route[],draft:DraftAction):Action {
  const before=sharedWorld(routes),requires:World={};
  for(const key of draft.uses) {
    if(!(key in before)) throw new Error(`行动依赖非共有事实 ${key}，不能假定某条支线已发生`);
    requires[key]=before[key];
  }
  return {summary:draft.summary,requires,effects:draft.effects};
}
export function assertArrival(routes:Route[],anchor:World) {
  for(const route of routes) for(const [key,value] of Object.entries(anchor)) {
    if(route.world[key]!==value) throw new Error(`尚未到达共同事件：${key} 应为 ${value}，实际 ${route.world[key]}；必须在该支线写明承接动作`);
  }
}
export function compileBundle(facts:Fact[],incoming:Route[],bundle:ActionBundle,id:string,act:number,anchor:World,options:{combineLanding?:boolean}={}) {
  const consequence=bindDraft(incoming,bundle.consequence);
  const first=causalNode(facts,id,act,'branch',incoming,consequence);
  first.continuationAction=bundle.text;
  first.choiceIntent={gain:bundle.gain,cost:bundle.cost,payoff:bundle.payoff};
  let routes=applyAction(facts,incoming,consequence);
  const nodes=[first];
  if(bundle.landing) {
    const landing=bindDraft(routes,bundle.landing);
    const bridge=causalNode(facts,id+'_bridge',act,'branch',routes,landing);
    bridge.continuationAction=bundle.landing.summary;
    first.nextNodeId=bridge.id;
    nodes.push(bridge);
    routes=applyAction(facts,routes,landing);
  }
  if(bundle.landing && options.combineLanding) {
    // 中间动作依旧逐步验证；扩写时在同一场内呈现后果及必要转移。
    const landing=bindDraft(applyAction(facts,incoming,consequence),bundle.landing);
    const combined:Action={
      summary:consequence.summary+'\n'+landing.summary,
      requires:{...consequence.requires,...Object.fromEntries(Object.entries(landing.requires).filter(([key])=>!(key in consequence.effects)))},
      effects:{...consequence.effects,...landing.effects},
    };
    const scene=causalNode(facts,id,act,'branch',incoming,combined);
    scene.continuationAction=bundle.text;
    scene.choiceIntent=first.choiceIntent;
    assertArrival(routes,anchor);
    return {nodes:[scene],routes,tail:scene};
  }
  assertArrival(routes,anchor);
  return {nodes,routes,tail:nodes[nodes.length-1]};
}
/** 有明确优先级的复合事实条件；末项兜底确保每条历史恰好落入一个有限结局。 */
export function resolveEndingGroups(routes:Route[],conditions:World[][]):Route[][] {
  const groups=Array.from({length:conditions.length+1},()=>[] as Route[]);
  for(const route of routes) {
    const index=conditions.findIndex(any=>any.some(all=>Object.entries(all).every(([k,v])=>route.world[k]===v)));
    groups[index<0?conditions.length:index].push(route);
  }
  return groups;
}

/** 骨架确定后、任何动作生成前，补足可表达真实收益与代价的事实；不改写开场。 */
export function extendFactRegistry(facts:Fact[],extensions:{key:string;values:string[]}[],additions:Omit<Fact,'key'|'scope'>[]):Fact[] {
  const updated=facts.map(fact=>({...fact,values:[...fact.values]}));
  for(const extension of extensions){
    const fact=updated.find(item=>item.key===extension.key);
    if(!fact || fact.scope==='shared')throw new Error('只能扩展已有的分支事实：'+extension.key);
    fact.values=[...new Set([...fact.values,...extension.values])];
  }
  for(const addition of additions)updated.push({...addition,key:'fact_'+(updated.length+1),scope:'branch'});
  const result=updated.map(fact=>FactSchema.parse(fact));
  for(const fact of result)if(!fact.values.includes(fact.initial))throw new Error('新增事实初始值不在值域内：'+fact.key);
  return result;
}
