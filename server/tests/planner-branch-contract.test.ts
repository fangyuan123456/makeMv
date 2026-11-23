import assert from 'node:assert/strict';
import { synthesizePrdStep } from '../src/tools/planner/script-to-prd-tool/steps/02-synthesize/step.js';
import { validateStoryGraph } from '../src/tools/planner/validate-story-graph.js';
import { renderScreenplay } from '../src/tools/planner/screenplay-tool/steps/02-screenplay/render.js';
import { PremiseOutputSchema } from '../src/tools/planner/screenplay-tool/steps/01-premise/schema.js';
import { buildNodeScriptPrompt } from '../src/tools/planner/screenplay-tool/steps/02-screenplay/prompt.js';
import { buildBranchPremiseSchema, compileBranchPremise } from '../src/tools/planner/screenplay-tool/steps/01-premise/branch-tree.js';
import { expandStoryPaths } from '../src/tools/planner/screenplay-tool/steps/02-screenplay/expand-paths.js';
import { parseGeneratedScreenplay } from '../src/tools/planner/script-to-prd-tool/steps/01-extract/parse-generated.js';
import { validateExtractedRouting } from '../src/tools/planner/script-to-prd-tool/steps/01-extract/validate-routing.js';

const raw = {
  title: '合流回归', startNodeId: 'c1',
  clips: [
    { id: 'c1', title: '选择', narrativeText: '共同开场', choices: [
      { id: 'a', text: '留在原地', targetNodeId: 'a' },
      { id: 'b', text: '离开房间', targetNodeId: 'b' },
    ] },
    { id: 'a', title: 'A', narrativeText: '等待后前往大厅', choices: [], nextNodeId: 'c2' },
    { id: 'b', title: 'B', narrativeText: '直接前往大厅', choices: [], nextNodeId: 'c2' },
    { id: 'c2', title: '合流', narrativeText: '在大厅见面', choices: [], nextNodeId: 'end' },
  ],
  endings: [{ id: 'end', title: '结束', endingType: 'NE', summary: '交谈结束' }],
};
const run = (context: unknown) => (synthesizePrdStep as any).execute({ context });
const result = await run(raw);
assert.equal(result.prd.wiring.find((e: any) => e.from === 'a').to, 'c2');
assert.equal(result.prd.wiring.find((e: any) => e.from === 'b').to, 'c2');
const reordered = structuredClone(raw);
reordered.clips.reverse();
assert.deepEqual((await run(reordered)).prd.wiring.sort((a: any,b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  result.prd.wiring.sort((a: any,b: any) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
for (const mutate of [
  (v: any) => delete v.clips[1].nextNodeId,
  (v: any) => v.clips[0].choices[0].targetNodeId = 'missing',
  (v: any) => v.clips[0].choices[0].targetEndingId = 'end',
  (v: any) => v.clips[1].id = 'b',
  (v: any) => v.clips.push({ id: 'orphan', choices: [], nextNodeId: 'end' }),
  (v: any) => v.clips[3].nextNodeId = 'c2',
  (v: any) => v.endings = [],
]) {
  const bad = structuredClone(raw); mutate(bad);
  await assert.rejects(() => run(bad));
}
assert.throws(() => validateStoryGraph('x', [{ id:'x', terminal:false, targets:['x'] }]));
const premise = PremiseOutputSchema.parse({
  title:'合流回归', genre:'剧情', logline:'见面', characters:[],
  actOutlines:[{actNumber:1,title:'见面',coreConflict:'选择',suspense:'去向'}],
  startNodeId:'c1', storyNodes:[
    ...raw.clips.map(c => ({id:c.id,actNumber:1,kind:'scene',summary:c.title,
      entryConditions:['人物存活'],exitConditions:['到达大厅'],
      choices:c.choices.map(ch=>({text:ch.text,targetNodeId:ch.targetNodeId})),nextNodeId:c.nextNodeId || null})),
    {id:'end',actNumber:1,kind:'ending',summary:'中性结局',entryConditions:[],exitConditions:[],choices:[],nextNodeId:null},
  ],
});
const expanded = { nodes:premise.storyNodes.map(n=>({id:n.id,narrativeText:`场景正文 ${n.id}`})) };
// 模型适配层会剥离 null：选择节点和终局允许省略 nextNodeId。
const withoutNulls = JSON.parse(JSON.stringify(premise, (_key, value) => value === null ? undefined : value));
assert.doesNotThrow(() => PremiseOutputSchema.parse(withoutNulls));
const markdown = renderScreenplay(premise, expanded);
assert.match(markdown,/【入口：c1】/);
assert.equal((markdown.match(/【后继：c2】/g)||[]).length,2);
validateExtractedRouting(markdown, raw as any);
const wrongRoute = structuredClone(raw); wrongRoute.clips[1].nextNodeId = 'b';
assert.throws(()=>validateExtractedRouting(markdown, wrongRoute as any));
validateExtractedRouting('旧版剧本无节点标记', raw as any);
assert.match(buildNodeScriptPrompt({premise,node:premise.storyNodes[0],history:[],userPrompt:'测试'}),/人物存活/);
assert.throws(()=>renderScreenplay(premise,{nodes:expanded.nodes.slice(1)}));
assert.throws(()=>renderScreenplay(premise,{nodes:[...expanded.nodes,expanded.nodes[0]]}));
const injected = structuredClone(expanded); injected.nodes[0].narrativeText='【后继：b】';
assert.throws(()=>renderScreenplay(premise,injected));

// 从生成表示上分开互斥路线：相似终局也不共用节点，入场事实只能继承父路线。
const ending = (summary: string) => ({kind:'ending' as const,actNumber:2,summary,endingType:'NE' as const,exitConditions:[summary]});
const draft = buildBranchPremiseSchema(2).parse({
  title:'路径隔离',genre:'悬疑',logline:'选择去留',characters:[],
  actOutlines:[1,2].map(actNumber=>({actNumber,title:'场',coreConflict:'去留',suspense:'后果'})),
  root:{kind:'scene',actNumber:1,summary:'共同开场',exitConditions:['两人都在大厅'],branches:[
    {text:'独自离开',next:{kind:'scene',actNumber:2,summary:'独自来到车站',exitConditions:['主角独自一人在车站'],branches:[
      {text:'离城',next:ending('独自离城')},
    ]}},
    {text:'留下救同伴',next:{kind:'scene',actNumber:2,summary:'救出同伴',exitConditions:['同伴已获救'],branches:[
      {text:'两人离城',next:ending('两人离城')},
    ]}},
  ]},
});
const tree = compileBranchPremise(draft,'选择去留');
assert.equal(tree.storyNodes.length,5);
assert.deepEqual(tree.storyNodes.find(n=>n.id==='n1_1_1')!.entryConditions,['主角独自一人在车站']);
assert.deepEqual(tree.storyNodes.find(n=>n.id==='n1_2_1')!.entryConditions,['同伴已获救']);
const texts = await expandStoryPaths(tree,async(node,history)=>{
  const prompt = buildNodeScriptPrompt({premise:tree,node,history,userPrompt:'选择去留'});
  if(node.id==='n1_1_1') {
    assert.match(prompt,/独自离开/);
    assert.match(prompt,/实际拍摄：独自来到车站/);
    assert.doesNotMatch(prompt,/同伴已获救|实际拍摄：救出同伴/);
    assert.equal(history.at(-1)!.chosenAction,'离城');
  }
  return `实际拍摄：${node.summary}`;
});
const generated = renderScreenplay(tree,texts);
const extracted = parseGeneratedScreenplay(generated)!;
assert.ok(extracted);
validateExtractedRouting(generated,extracted);
const compiled = await run(extracted);
assert.equal(compiled.prd.endings.length,2);
assert.equal(compiled.prd.wiring.find((e:any)=>e.from==='n1_1').to,'n1_1_1');
assert.equal(compiled.prd.wiring.find((e:any)=>e.from==='n1_2').to,'n1_2_1');
assert.equal(parseGeneratedScreenplay(markdown),null,'旧格式继续使用已有语义抽取');
console.log('planner branch contract tests passed');

// 瓶颈结构：早期证据状态穿过共同场景，终局仍受它影响。
const { compileBottleneck } = await import('../src/tools/planner/screenplay-tool/steps/01-premise/bottleneck.js');
const { StoryBibleSchema } = await import('../src/tools/planner/screenplay-tool/steps/01-premise/schema.js');
const { buildPrdScenes } = await import('../src/tools/game-assembly/steps/02-codegen/prd-routing.js');
const { generateMainJs } = await import('../src/tools/game-assembly/steps/02-codegen/step.js');
const { resolveRoute } = await import('../src/tools/game-assembly/steps/02-codegen/runtime/routing.js');
const vm = await import('node:vm');
const bible=StoryBibleSchema.parse({title:'证据',genre:'悬疑',logline:'三次选择',characters:[{name:'甲',role:'主角',motivation:'查明真相',appearance:'外套'}],
 objectiveTruth:['乙伪造了事故'],chronology:['昨晚乙篡改日志'],rules:['物品必须交接'],secrets:[],initialFacts:['甲在门口'],
 states:[{key:'proof',meaning:'已备份证据',initial:false},{key:'trust',meaning:'取得证人信任',initial:false},{key:'publish',meaning:'决定公开',initial:false}],
 endings:[{title:'公开真相',endingType:'HE',necessaryCause:'证据已备份且决定公开',outcome:'公开日志',when:[{proof:true,publish:true}]},
 {title:'保留秘密',endingType:'NE',necessaryCause:'未公开证据',outcome:'离开',when:[{proof:false},{proof:true,publish:false}]}]});
const plan={endingAssignments:Object.fromEntries(Array.from({length:8},(_,m)=>['s'+m,(m&1)&&(m&4)?'ending_1':'ending_2'])),actOutlines:[1,2,3].map(actNumber=>({actNumber,title:'调查',coreConflict:'取舍',suspense:'代价'})),
 beats:['proof','trust','publish'].map((key,i)=>({actNumber:i+1,decision:{trueAction:key+'true',falseAction:key+'false'},common:{summary:'共同场景'+i,facts:['甲在大厅']},afterChoiceMerge:{summary:'会合'+i,facts:['甲在大厅，下一扇门开启']},
 branches:[true,false].map(value=>({text:key+value,consequence:{summary:key+value,facts:['甲回到大厅']},set:{[key]:value}}))}))};
const bounded=compileBottleneck(bible,plan,'测试');
assert.equal(bounded.storyNodes.filter(n=>n.kind==='ending').length,2);
assert.equal(bounded.storyNodes.length,11);
const boundedTexts=await expandStoryPaths(bounded,async(node,history)=>{
 assert.ok(history.every(h=>h.node.contextRole==='common'),'共用节点不能继承任一条分支的正文');
 if(node.contextRole==='common') assert.doesNotMatch(buildNodeScriptPrompt({premise:bounded,node,history,userPrompt:'测试'}),/公开日志|prooftrue|prooffalse|publishtrue|publishfalse|targetNodeId|nextRoutes/);
 return '实际拍摄：'+node.summary;
});
const boundedMd=renderScreenplay(bounded,boundedTexts);
const extractedBounded=parseGeneratedScreenplay(boundedMd)!;
validateExtractedRouting(boundedMd,extractedBounded);
const prdBounded=(await run(extractedBounded)).prd;
assert.deepEqual(prdBounded.initialState,{proof:false,trust:false,publish:false});
assert.deepEqual(prdBounded.interactions[0].outcomes[0].stateChange,{set:{proof:true}});
const runtimeScenes=buildPrdScenes(prdBounded,[{sceneId:'beat_1',text:'开场',choices:[{to:'wrong'}]}]);
const generatedJs=generateMainJs({title:'测试',startSceneId:'beat_1',initialState:prdBounded.initialState,scenes:runtimeScenes});
const sandbox:any={resolveRoute,document:{addEventListener(){}},play(){}};
vm.runInNewContext(generatedJs.replace(/^import .*;$/gm,'')+'\nglobalThis.Cockpit=InteractiveGameCockpit;',sandbox);
for(let mask=0;mask<8;mask++) {
 const cockpit=new sandbox.Cockpit({}, {startSceneId:'beat_1',initialState:prdBounded.initialState,scenes:runtimeScenes});
 cockpit.interactionEl={querySelectorAll:()=>[]};cockpit.updateHud=()=>{};
 let id='beat_1',decision=0,finished='';
 cockpit.playScene=(next:string)=>{id=next;};cockpit.renderEnding=(ending:any)=>{finished=ending.title;};
 cockpit.renderChoices=(choices:any[])=>cockpit.handleChoice(choices[(mask>>decision++)&1]);
 for(let step=0;step<20&&!finished;step++) cockpit.onSceneEnded(runtimeScenes.find(s=>s.sceneId===id));
 assert.equal(finished,(!(mask&1)&&!(mask&4))?'公开日志':'离开');
 assert.equal(decision,3);
}
assert.throws(()=>resolveRoute([{to:'a',condition:'{}'},{to:'b',condition:'{}'}],{}));
const badPlan=structuredClone(plan);delete badPlan.endingAssignments.s0;
assert.throws(()=>compileBottleneck(bible,badPlan,'测试'),/覆盖每个状态组合/);
console.log('bottleneck generation, persistence and actual runtime routing tests passed');


// 直接验证实际总装工序落盘，不依赖未适配的技术规划 mock。
const { executeCodegenStep }=await import('../src/tools/game-assembly/steps/02-codegen/step.js');
const { ProjectStore }=await import('../src/project-store/ProjectStore.js');
const fs=await import('node:fs');
const path=await import('node:path');
const projectId='test_bottleneck_runtime_'+process.pid+'_'+Date.now();
const projectDir=ProjectStore.getInstance().getProjectDir(projectId);
assert.equal(path.basename(projectDir),projectId);
assert.equal(fs.readdirSync(projectDir).length,0,'不能覆盖已有工程');
try {
 const packed=await executeCodegenStep({projectId,prd:prdBounded,scenes:[]});
 assert.ok(packed.success);
 assert.ok(fs.existsSync(path.join(projectDir,'game-assembly/runtime/routing.js')));
 const main=fs.readFileSync(path.join(projectDir,'game-assembly/js/main.js'),'utf8');
 assert.match(main,/resolveRoute/);
 assert.match(main,/beat_1_merge/);
 assert.match(main,/ending_2/);
} finally {
 fs.rmSync(projectDir,{recursive:true,force:true});
}
assert.throws(()=>parseGeneratedScreenplay(boundedMd.replace(/<!-- makemv-state:[^]*? -->/,'')),/缺少状态契约/);
console.log('production codegen packaging test passed');

// 大纲推理开关仅作用于该模型变体，正文仍使用全局默认。
const { LLMProvider }=await import('../src/llm/provider.js');
const { config }=await import('../src/utils/config.js');
const { Agent }=await import('@mastra/core/agent');
const { generateStructured, dumpStructuredFailure }=await import('../src/utils/llm-diagnostics.js');
const authFailure=dumpStructuredFailure({stage:'test',step:'api-diagnostic',label:'auth diagnostic'},{name:'AI_APICallError',message:'Invalid token',statusCode:401},'test');
assert(authFailure.summary.includes('Invalid token'));
assert(!authFailure.summary.includes('没有返回文本'));
const quotaFailure=dumpStructuredFailure({stage:'test',step:'api-diagnostic',label:'quota diagnostic'},{name:'AI_APICallError',message:'user quota is not enough',statusCode:403},'test');
assert(quotaFailure.summary.includes('user quota is not enough'));
assert(!quotaFailure.summary.includes('没有返回文本'));

const { z }=await import('zod');
const originalConfig={...config.llm};
const originalFetch=globalThis.fetch;
const thinkingRequests:boolean[]=[];
let mockContent=['{"ok":true}'];
try {
 Object.assign(config.llm,{provider:'openai',apiKey:'test-only',baseURL:'https://api.siliconflow.cn/v1',model:'test-model',enableThinking:false});
 globalThis.fetch=async (_url:any,init:any)=>{
   thinkingRequests.push(JSON.parse(init.body).enable_thinking);
   return new Response(JSON.stringify({id:'test',object:'chat.completion',created:0,model:'test-model',choices:[{index:0,message:{role:'assistant',content:mockContent.length>1?mockContent.shift():mockContent[0]},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}),{headers:{'content-type':'application/json'}});
 };
 LLMProvider.reset();
 const options:any={mode:{type:'regular'},inputFormat:'prompt',prompt:[{role:'user',content:[{type:'text',text:'test'}]}]};
 await LLMProvider.getModel({enableThinking:true}).doGenerate(options);
 await LLMProvider.getModel().doGenerate(options);
 const agent=new Agent({name:'reasoning-test',instructions:'Return JSON',model:LLMProvider.getModel({enableThinking:true})});
 const object=await generateStructured({agent,prompt:'test',schema:z.object({ok:z.boolean()}),stage:'test',step:'model-resolution',label:'model resolution'});
 assert.deepEqual(object,{ok:true});
 assert.deepEqual(thinkingRequests,[true,false,true]);
 assert.equal(config.llm.enableThinking,false);
 const retryParams={agent,prompt:'test',schema:z.object({ok:z.boolean()}),stage:'test',step:'empty-retry',label:'empty-retry',retryEmptyResponse:true};
 mockContent=['','{"ok":true}'];
 assert.deepEqual(await generateStructured(retryParams),{ok:true});
 mockContent=['',''];
 const beforeEmpty=thinkingRequests.length;
 await assert.rejects(()=>generateStructured(retryParams));
 assert.equal(thinkingRequests.length-beforeEmpty,2);
 mockContent=['{"ok":"bad"}'];
 const beforeInvalid=thinkingRequests.length;
 await assert.rejects(()=>generateStructured(retryParams));
 assert.equal(thinkingRequests.length-beforeInvalid,1);
 const {writeSceneText}=await import('../src/tools/planner/screenplay-tool/steps/02-screenplay/write-node.js');
 mockContent=['【场景：出口】\n人物带着原件离开。'];
 assert.equal(await writeSceneText({prompt:'扩写本场'}),'【场景：出口】\n人物带着原件离开。');
 mockContent=['','正文'];
 const beforePlainEmpty=thinkingRequests.length;
 assert.equal(await writeSceneText({prompt:'扩写本场'}),'正文');
 assert.equal(thinkingRequests.length-beforePlainEmpty,2);


} finally {
 globalThis.fetch=originalFetch;Object.assign(config.llm,originalConfig);LLMProvider.reset();
}
console.log('per-stage reasoning isolation test passed');

import './planner-causal.test.js';
