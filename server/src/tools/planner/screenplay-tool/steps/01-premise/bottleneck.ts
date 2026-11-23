import { z } from 'zod';
import { PremiseOutputSchema, type StoryBible, type PremiseOutput } from './schema.js';

// 先确定过去发生了什么，再设计玩家能改变什么。所有路线共享这份事实。
const scene = z.object({summary:z.string(), facts:z.array(z.string()).min(1)});
export function stateCombinations(bible:StoryBible):Record<string,Record<string,boolean>> {
  return Object.fromEntries(Array.from({length:2**bible.states.length},(_,mask)=>[
    's'+mask,Object.fromEntries(bible.states.map((s,i)=>[s.key,Boolean(mask & (1<<i))])),
  ]));
}
export function buildBottleneckSchema(acts:number, bible:StoryBible) {
  const decisions=Math.max(3,acts);
  const endingIds=bible.endings.map((_,i)=>'ending_'+(i+1)) as [string,...string[]];
  return z.object({
    endingAssignments:z.object(Object.fromEntries(Object.keys(stateCombinations(bible)).map(key=>[key,z.enum(endingIds)]))).describe('每个给定状态组合指定唯一结局，不遗漏、不改写组合；所有结局至少使用一次'),
    actOutlines: PremiseOutputSchema.shape.actOutlines.length(acts),
    beats:z.array(z.object({
      actNumber:z.number().int().min(1).max(acts),
      decision:z.object({trueAction:z.string(),falseAction:z.string()}).describe('本节拍两种有代价的具体行动，两者都能到达 afterChoiceMerge；不能用进入/不进入控制之后必到的地点，不能用获救/死亡控制之后共同在场的人。状态只记录选择过哪项。'),
      common:scene.describe('共用选择前场景；仅可使用各条入路都成立的事实'),
      afterChoiceMerge:scene.optional().describe('仅前面的局部选择使用；最后的选择直接进入结局，此字段省略。时间严格在两个选项各自执行完之后！只写共同后续，绝非选择前铺垫。人物已结束此次行动，不能重置为尚未拿取、尚未动手。明确共有地点/时刻/在场人/知识；不要引用可变物品归属。'),
      branches:z.array(z.object({
        text:z.string(), consequence:scene.describe('落实选择的即时后果，明确如何到达本幕 afterChoiceMerge，不写未来结局'),
      })).length(2),
    })).length(decisions),
  });
}
export function buildSharedBeatsSchema(acts:number,bible:StoryBible) {
  const full=buildBottleneckSchema(acts,bible);
  return full.omit({endingAssignments:true}).extend({beats:z.array(full.shape.beats.element.omit({branches:true})).length(Math.max(3,acts))});
}
export function buildLocalBranchesSchema(acts:number,bible:StoryBible) {
  const full=buildBottleneckSchema(acts,bible);
  return full.pick({endingAssignments:true}).extend({branchesByBeat:z.array(z.object({branches:z.array(z.object({consequence:scene})).length(2)})).length(bible.states.length)});
}
type Plan = z.infer<ReturnType<typeof buildBottleneckSchema>>;

export function compileBottleneck(sourceBible:StoryBible, plan:Plan, sourcePrompt:string):PremiseOutput {
  const combinations=stateCombinations(sourceBible);
  if(Object.keys(plan.endingAssignments).length!==Object.keys(combinations).length || Object.keys(combinations).some(key=>!plan.endingAssignments[key])) throw new Error('终局分配须覆盖每个状态组合');
  const bible={...sourceBible,endings:sourceBible.endings.map((e,i)=>({...e,when:Object.entries(combinations).filter(([key])=>plan.endingAssignments[key]==='ending_'+(i+1)).map(([,state])=>state)}))};
  const initialState = Object.fromEntries(bible.states.map(s=>[s.key,s.initial]));
  if (Object.keys(initialState).length !== bible.states.length) throw new Error('故事状态键重复');
  const nodes:PremiseOutput['storyNodes']=[];
  let reachable = [initialState];
  const matches = (state:Record<string,boolean>, rule:Record<string,boolean>) =>
    Object.entries(rule).every(([key,value])=>state[key]===value);
  for (const ending of bible.endings) for (const rule of ending.when) {
    if (Object.keys(rule).some(key=>!(key in initialState))) throw new Error('结局引用未知状态');
  }
  if(plan.beats.length!==bible.states.length) throw new Error('每个关键事实对应一个选择节拍');
  plan.beats.forEach((rawBeat,i)=>{
    const beat={...rawBeat,branches:rawBeat.branches.map((branch,j)=>({...branch,set:{[bible.states[i].key]:j===0}}))};
    if (i && beat.actNumber < plan.beats[i-1].actNumber) throw new Error('幕次不能倒退');
    const id=`beat_${i+1}`, mergeId=`${id}_merge`;
    const final=i===plan.beats.length-1;
    if(!final && !beat.afterChoiceMerge) throw new Error('局部选择缺少后继汇合契约');
    const entry = i ? plan.beats[i-1].afterChoiceMerge!.facts : bible.initialFacts;
    nodes.push({id,actNumber:beat.actNumber,kind:'scene',contextRole:'common',summary:beat.common.summary,
      entryConditions:entry,exitConditions:beat.common.facts,
      choices:final ? [true,false].map((value,j)=>{
        const nextRoutes=bible.endings.flatMap((e,k)=>e.when.filter(when=>when[bible.states[i].key]===value).map(when=>({when,targetNodeId:`ending_${k+1}`})));
        return {text:j===0?beat.decision.trueAction:beat.decision.falseAction,targetNodeId:nextRoutes[0].targetNodeId,stateChange:{set:{[bible.states[i].key]:value}},nextRoutes};
      }) : beat.branches.map((b,j)=>({text:b.text,targetNodeId:`${id}_${j+1}`,stateChange:{set:b.set}}))});
    if(final) {
      reachable=reachable.flatMap(s=>[true,false].map(value=>({...s,[bible.states[i].key]:value})));
      return;
    }
    beat.branches.forEach((b,j)=>{
      if (!Object.keys(b.set).length || Object.keys(b.set).some(k=>!(k in initialState))) throw new Error('选择须改变已定义的事实状态');
      nodes.push({id:`${id}_${j+1}`,actNumber:beat.actNumber,kind:'scene',contextRole:'branch',
        summary:b.consequence.summary,continuationAction:b.text,entryConditions:beat.common.facts,
        exitConditions:b.consequence.facts,mergeContract:beat.afterChoiceMerge!.facts,choices:[],nextNodeId:mergeId});
    });
    nodes.push({id:mergeId,actNumber:beat.actNumber,kind:'scene',contextRole:'common',summary:beat.afterChoiceMerge!.summary,
      entryConditions:beat.afterChoiceMerge!.facts,exitConditions:beat.afterChoiceMerge!.facts,choices:[],
      ...(i<plan.beats.length-1 ? {nextNodeId:`beat_${i+2}`} : {
        nextRoutes:bible.endings.flatMap((e,j)=>e.when.map(when=>({when,targetNodeId:`ending_${j+1}`}))),
      })});
    reachable = reachable.flatMap(s=>beat.branches.map(b=>({...s,...b.set})));
  });
  if (new Set(plan.beats.map(b=>b.actNumber)).size !== plan.actOutlines.length) throw new Error('每幕须有戏剧节拍');
  const reached = new Set<number>();
  for (const state of reachable) {
    const matching=bible.endings.flatMap((e,i)=>e.when.filter(r=>matches(state,r)).map(()=>i));
    if (matching.length!==1) throw new Error(`终局条件必须唯一覆盖可达状态：${JSON.stringify(state)}`);
    reached.add(matching[0]);
  }
  if(reached.size!==bible.endings.length) throw new Error('存在不可达结局');
  bible.endings.forEach((ending,i)=>nodes.push({id:`ending_${i+1}`,actNumber:plan.actOutlines.length,kind:'ending',
    contextRole:'ending',endingType:ending.endingType,summary:ending.outcome,
    entryConditions:plan.beats.at(-1)!.common.facts,continuationAction:ending.necessaryCause,exitConditions:[ending.outcome],choices:[]}));
  return PremiseOutputSchema.parse({...bible,storyBible:bible,initialState,sourcePrompt,startNodeId:'beat_1',storyNodes:nodes,actOutlines:plan.actOutlines});
}
