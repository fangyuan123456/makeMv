import assert from 'node:assert/strict';
import {planCausalStory} from '../src/tools/planner/screenplay-tool/steps/01-premise/causal-planner.js';
import {bindDraft,compileBundle,resolveEndingGroups,extendFactRegistry} from '../src/tools/planner/screenplay-tool/steps/01-premise/dramatic-plan.js';
import {expandStoryPaths} from '../src/tools/planner/screenplay-tool/steps/02-screenplay/expand-paths.js';
import {buildNodeScriptPrompt} from '../src/tools/planner/screenplay-tool/steps/02-screenplay/prompt.js';
import {initialWorld,type Fact} from '../src/tools/planner/screenplay-tool/steps/01-premise/causal.js';
const facts:Fact[]=[
 {key:'fact_1',meaning:'调查员位置',values:['门厅','档案室','走廊','出口'],initial:'门厅'},
 {key:'fact_2',meaning:'证据',values:['无','原件'],initial:'无'},
 {key:'fact_3',meaning:'同伴',values:['未救','获救'],initial:'未救'},
 {key:'fact_4',meaning:'行动自由',values:['自由','受困'],initial:'自由'},
 {key:'fact_5',meaning:'工具',values:['完好','损坏'],initial:'完好'},
 {key:'fact_6',meaning:'通信',values:['未发','已发'],initial:'未发'},
 {key:'fact_7',meaning:'电源',values:['有','耗尽'],initial:'有'},
 {key:'fact_8',meaning:'安全门',values:['关','开'],initial:'关'},
];
const extended=extendFactRegistry(facts,[{key:'fact_5',values:['已分配但未消耗']}],[{meaning:'同伴伤势',values:['无伤','受伤'],initial:'无伤'}]);
assert.equal(extended.find(f=>f.key==='fact_5')!.initial,'完好');
assert(extended.find(f=>f.key==='fact_5')!.values.includes('已分配但未消耗'));
assert.equal(extended[8].key,'fact_9');
assert.equal(extended[8].scope,'branch');
assert.equal(initialWorld(extended).fact_9,'无伤');
assert(!facts[4].values.includes('已分配但未消耗'));
assert.throws(()=>extendFactRegistry(facts,[{key:'unknown',values:['新值']}],[]),/只能扩展/);
const action=(summary:string,effects:Record<string,string>,uses:string[]=[])=>({summary,effects,uses});
const take={text:'冒险取证',gain:'拿到原件',cost:'损坏工具并一度受困',payoff:'配合通信恢复才能公开原件',consequence:action('破门取原件，工具卡断，门扇回落堵住归路',{fact_1:'档案室',fact_2:'原件',fact_4:'受困',fact_5:'损坏'},['fact_4','fact_5']),landing:action('借固定木架撑开通风口，带原件退到走廊',{fact_1:'走廊',fact_4:'自由'},['fact_1','fact_4'])};
const escort={text:'护送同伴',gain:'同伴获救',cost:'放弃取原件',payoff:'同伴能活着撤离',consequence:action('搀同伴退出危险区来到走廊',{fact_1:'走廊',fact_3:'获救',fact_4:'自由'},['fact_4']),landing:null};
const start=[{history:{},world:initialWorld(facts)}];
assert.throws(()=>compileBundle(facts,start,{...take,landing:null},'bad',1,{fact_1:'走廊',fact_4:'自由'}),/尚未到达/);
const taken=compileBundle(facts,start,take,'take',1,{fact_1:'走廊',fact_4:'自由'});
assert.equal(taken.nodes.length,2);
assert.equal(taken.routes[0].world.fact_5,'损坏');
assert.equal(taken.routes[0].world.fact_2,'原件');
const compact=compileBundle(facts,start,take,'compact',1,{fact_1:'走廊',fact_4:'自由'},{combineLanding:true});
assert.equal(compact.nodes.length,1);
assert.deepEqual(compact.routes,taken.routes);
assert(compact.nodes[0].summary.includes(take.consequence.summary));
assert(compact.nodes[0].summary.includes(take.landing!.summary));
assert.equal(compact.nodes[0].causalContract!.requires.fact_4,'自由');
assert.equal(compact.nodes[0].causalContract!.after.fact_5,'损坏');

assert.throws(()=>bindDraft([...taken.routes,...compileBundle(facts,start,escort,'escort',1,{}).routes],action('假装人人有证据',{},['fact_2'])),/非共有事实/);
let calls=0;
const premise=await planCausalStory(async(schema:any,_prompt:string,label:string)=>{
 if(label==='补齐行动大纲所需的事实')return schema.parse({extensions:[],additions:[]});
 const n=calls++;
 if(n===4){assert.equal(schema.safeParse(action('错误的共有取证',{fact_2:'原件'})).success,false);assert.equal(schema.safeParse(action('错误的共有前提',{},['fact_2'])).success,false);}
 const responses:any[]=[
  {title:'雨夜档案室',genre:'悬疑',logline:'取证或救人',causalBackground:'档案记录了一起旧案。',characters:[{name:'调查员',role:'主角',motivation:'救人并揭露旧案',appearance:'雨衣'}],objectiveTruth:['档案记录旧案'],chronology:['旧案已发生'],rules:['只有一套工具'],secrets:[],facts:facts.map(({key,...f})=>({...f,scope:['fact_1','fact_4'].includes(key)?'shared':'branch'}))},
  {beats:[{title:'取舍',decisionPurpose:'在救人与取证间作出行动',coreConflict:'救人还是取证',suspense:'门将关闭',eventBeforeChoice:'大雨淹入门厅',entryBeforeScene:{fact_1:'门厅',fact_4:'自由'}},{title:'传出',decisionPurpose:'兑现证据并决定如何外发',coreConflict:'供电与安全门',suspense:'失去外联窗口',eventBeforeChoice:'走廊等待撤离',entryBeforeScene:{fact_1:'走廊',fact_4:'自由'}}],finalEntry:{fact_1:'出口',fact_4:'自由'},conditionalEndings:[{title:'公开',endingType:'HE',themeAnswer:'证据与传播缺一不可',necessaryCause:'有原件且通信恢复',whenAny:[{fact_2:'原件',fact_6:'已发'}]}],fallbackEnding:{title:'未证',endingType:'NE',themeAnswer:'保住性命但证据未成闭环',necessaryCause:'原件与传送条件至少一项缺失'}},
  action('水漫门厅，面临救人或取证',{}),
  {branches:[take,escort]},
  action('在走廊发现通信柜和安全门',{}),
  {branches:[{text:'耗电恢复通信',gain:'向外传送',cost:'耗尽备用电',payoff:'只有持有原件才能公开完整真相',consequence:action('接通通信并耗尽备用电',{fact_6:'已发',fact_7:'耗尽'},['fact_7']),landing:action('沿楼梯抵达出口',{fact_1:'出口',fact_4:'自由'},['fact_4'])},{text:'开启安全门',gain:'开通撤离通道',cost:'放弃恢复通信',payoff:'未形成远程证据闭环',consequence:action('手动开启安全门走到出口',{fact_8:'开',fact_1:'出口',fact_4:'自由'},['fact_4']),landing:null}]},
  {action:action('在出口确认原件已经传出',{},['fact_2','fact_6']),resolution:{decisiveAction:'确认送达',protagonistFate:'调查员撤离',conflictOutcome:'旧案得到证据支持',finalImage:'接收回执亮起'}},
  {action:action('调查员撤离，旧案证据链未能闭合',{},['fact_1']),resolution:{decisiveAction:'离开危险建筑',protagonistFate:'调查员生还',conflictOutcome:'案件尚无法证实',finalImage:'门关闭'}},
 ];
 let response=responses[n];
 if(n===1){const invalid=structuredClone(response);invalid.beats[1].entryBeforeScene.fact_2='原件';assert.equal(schema.safeParse(invalid).success,false);assert.equal(schema.safeParse(response).success,true);}
 if(n===3 || n===5) {
   const branches=response.branches;
   response={choices:branches.map(({text,gain,cost,payoff}:any)=>({text,gain,cost,payoff})),variants:Object.fromEntries((n===3?['v0']:['v0','v1']).map(id=>[id,branches.map(({consequence,landing}:any)=>({consequence,landing}))]))};
 }
 if(n===3){const invalid=structuredClone(response);invalid.variants.v0[0].landing.effects.fact_1='档案室';assert.equal(schema.safeParse(invalid).success,false);assert.equal(schema.safeParse(response).success,true);}
 if(n===6)return schema.parse({endings:[{title:'公开',endingType:'HE',themeAnswer:'证据与传播缺一不可',necessaryCause:'有原件且通信恢复',worldIds:['w0']},{title:'未证',endingType:'NE',themeAnswer:'保住性命但证据未成闭环',necessaryCause:'证据与通信至少一项缺失',worldIds:['w1','w2','w3']}]});
 if(n>=7)response=responses[n===7?6:7];
 return schema.parse(response);
},'测试需求','测试需求',2);
assert.equal(calls,11);
assert.equal(premise.storyBible!.endings.length,2);
assert.equal(premise.storyBible!.endings[0].when.length,1);
assert.equal(premise.storyBible!.endings[1].when.length,3);
assert.equal(premise.storyNodes.find(n=>n.id==='beat_2')!.choices[0].nextRoutes!.length,2);
assert.notEqual(premise.storyNodes.find(n=>n.id==='beat_2')!.choices[0].nextRoutes![0].targetNodeId,premise.storyNodes.find(n=>n.id==='beat_2')!.choices[0].nextRoutes![1].targetNodeId);
assert.deepEqual(premise.storyBible!.endings[0].when[0],{decision_1:true,decision_2:true});
assert.equal(premise.storyNodes.find(n=>n.id==='beat_1_1')!.nextNodeId,'beat_2');
assert(!premise.storyNodes.some(n=>n.id.endsWith('_bridge')));
assert(premise.storyNodes.find(n=>n.id==='beat_1_1')!.summary.includes(take.landing!.summary));
assert.equal(premise.storyNodes.find(n=>n.id==='beat_1_2')!.nextNodeId,'beat_2');
const merge=premise.storyNodes.find(n=>n.id==='beat_2')!;
assert(!merge.entryConditions.some(f=>f.startsWith('证据：')));
assert.equal(merge.causalContract!.before.fact_4,'自由');
assert(!merge.establishedEvents!.includes(take.consequence.summary));
assert.equal(premise.storyNodes.find(n=>n.id==='beat_1_1')!.causalContract!.before.fact_4,'自由');
assert.equal(premise.storyNodes.find(n=>n.id==='beat_1_1')!.causalContract!.after.fact_4,'自由');
assert.equal(premise.storyNodes.find(n=>n.id==='beat_1_1')!.causalContract!.after.fact_5,'损坏');
assert(Object.keys(premise.storyNodes.find(n=>n.id==='beat_1_2')!.causalContract!.effects).length>1);
const prompt=buildNodeScriptPrompt({premise,node:merge,userPrompt:'测试',history:[]});
assert(!prompt.includes('initialFacts'));
assert(prompt.includes('unavailableFacts'));
const expanded=await expandStoryPaths(premise,async(node,history)=>{
 assert(!node.fixedNarrative,'共用字幕不应调用扩写模型');
 if(node.id==='beat_1_1')assert.deepEqual(history.map(h=>h.node.id),['beat_1']);
 if(node.id==='beat_2')assert.equal(history.length,0);
 if(node.id==='beat_2_1_v1')assert.equal(history[0].chosenAction,'耗电恢复通信');
 return node.summary;
});
assert(expanded.nodes.find(n=>n.id==='ending_1')!.narrativeText.includes('结局字幕'));
const resolutions=premise.storyNodes.filter(n=>n.id.startsWith('ending_2_resolution_'));
assert.equal(resolutions.length,3);
assert(resolutions.every(n=>'fact_2' in n.causalContract!.before));
assert(resolutions.some(n=>n.causalContract!.before.fact_2==='原件'));
const evidenceResolution=resolutions.find(n=>n.causalContract!.before.fact_2==='原件')!;
assert(evidenceResolution.establishedEvents!.includes(take.consequence.summary));
assert(buildNodeScriptPrompt({premise,node:evidenceResolution,userPrompt:'测试',history:[]}).includes(take.consequence.summary));
assert(resolutions.some(n=>n.causalContract!.before.fact_2==='无'));
const overlap=resolveEndingGroups([{history:{},world:{a:'yes',b:'yes'}},{history:{},world:{a:'no',b:'no'}}],[[{a:'yes',b:'yes'}],[{a:'yes'}]]);
assert.deepEqual(overlap.map(g=>g.length),[1,0,1]);
console.log('dramatic action bundles, explicit bridges and multi-fact endings passed');

for(let mask=0;mask<4;mask++) {
 const state={...premise.initialState};let id=premise.startNodeId,choiceIndex=0;
 for(let guard=0;guard<30;guard++) {
   const node=premise.storyNodes.find(n=>n.id===id)!;assert(node);
   if(node.kind==='ending') {assert.equal(id,mask===0?'ending_1':'ending_2');break;}
   let links=node.nextRoutes;
   if(node.choices.length) {const choice=node.choices[(mask>>choiceIndex++)&1];Object.assign(state,choice.stateChange?.set);links=choice.nextRoutes;if(!links){id=choice.targetNodeId;continue;}}
   if(links){const match=links.filter(r=>Object.entries(r.when).every(([k,v])=>state[k]===v));assert.equal(match.length,1);id=match[0].targetNodeId;}else id=node.nextNodeId!;
   assert(guard<29);
 }
}
console.log('all four histories select their own action variants and terminate');
import {renderScreenplay} from '../src/tools/planner/screenplay-tool/steps/02-screenplay/render.js';
import {parseGeneratedScreenplay} from '../src/tools/planner/script-to-prd-tool/steps/01-extract/parse-generated.js';
import {synthesizePrdStep} from '../src/tools/planner/script-to-prd-tool/steps/02-synthesize/step.js';
const markdown=renderScreenplay(premise,{nodes:premise.storyNodes.map(n=>({id:n.id,narrativeText:n.summary}))});
const extracted=parseGeneratedScreenplay(markdown)!;
assert(markdown.includes('<!-- makemv-screenplay:v4 -->'));
const visible=markdown.replace(/<!--[^]*?-->/g,'');
assert(visible.includes('## 第 1 幕《取舍》'));
assert(visible.includes('分支 1-A'));
assert(visible.includes('此前第 1 幕选 A'));
assert(visible.includes('本段结束 → [第 2 幕正文]'));
assert(!visible.includes('decision_') && !visible.includes('【节点：') && !visible.includes('targetNodeId'));
const anchors=new Set([...markdown.matchAll(/<a id="([^"]+)"><\/a>/g)].map(match=>match[1]));
for(const match of markdown.matchAll(/\]\(#([^\)]+)\)/g))assert(anchors.has(match[1]),'每个阅读链接必须有目标');
assert(markdown.indexOf('### 分支 2-A（版本 2）')<markdown.indexOf('### 分支 2-B（版本 1）'));
assert.equal(extracted.clips.length+extracted.endings.length,premise.storyNodes.length);
for(const node of premise.storyNodes){
 const parsed=extracted.clips.find(clip=>clip.id===node.id);
 if(node.kind==='ending'){assert.equal(extracted.endings.find(ending=>ending.id===node.id)!.summary,node.summary);continue;}
 assert.equal(parsed!.narrativeText,node.summary,'阅读指引不得混入正文');
 assert.deepEqual(parsed!.nextRoutes,node.nextRoutes);
 assert.equal(parsed!.nextNodeId??null,node.nextNodeId??null);
 node.choices.forEach((choice,index)=>{assert.deepEqual(parsed!.choices[index].nextRoutes,choice.nextRoutes);assert.deepEqual(parsed!.choices[index].stateChange,choice.stateChange);});
}
assert(!markdown.split('\n').filter(line=>line.startsWith('###')).some(line=>line.includes(take.consequence.summary)));
assert(markdown.includes(take.consequence.summary));
const output=await (synthesizePrdStep as any).execute({context:extracted});
assert.equal(output.prd.endings.length,2);
const wiring=output.prd.wiring.filter((e:any)=>e.to.startsWith('beat_2_') && e.condition);
assert(wiring.length>=4);
assert(!output.prd.clips.some((c:any)=>c.id.endsWith('_bridge')));
console.log('action variants and bridge nodes round-trip through production PRD');
