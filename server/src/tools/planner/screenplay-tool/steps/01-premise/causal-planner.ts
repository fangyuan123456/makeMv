import { z } from 'zod';
import { StoryBibleSchema, PremiseOutputSchema } from './schema.js';
import { FactSchema, initialWorld, sharedWorld, applyAction, causalNode, describeWorld, type Route, type Fact } from './causal.js';
import { worldSchema, draftActionSchema, bindDraft, compileBundle, extendFactRegistry } from './dramatic-plan.js';

type Generate=<T extends z.ZodTypeAny>(schema:T,prompt:string,label:string)=>Promise<z.infer<T>>;
const EndingDirection=z.object({title:z.string(),endingType:z.enum(['HE','BE','NE']),themeAnswer:z.string(),necessaryCause:z.string()});
const Resolution=z.object({decisiveAction:z.string(),protagonistFate:z.string(),conflictOutcome:z.string(),finalImage:z.string()});

export async function planCausalStory(generate:Generate,prompt:string,sourcePrompt:string,acts:number) {
  const seed=await generate(StoryBibleSchema.omit({states:true,endings:true,initialFacts:true}).extend({
    causalBackground:z.string().max(700).describe('固定的往事真相与物理规则，不包含未来路线的结果'),
    facts:z.array(FactSchema.omit({key:true,scope:true}).extend({scope:z.enum(['shared','branch']).describe('shared 只用于下一场必须共同到达的位置、在场或行动自由；证据、伤势、关系、资源、知情和目标成果必须为 branch，禁止作为强制汇合条件')})).min(4).max(12),
  }),prompt+'\n先确定角色、不可变真相和少量真正影响后续的事实。事实必须覆盖关键资源归属、行动自由/位置及核心目标进度；只登记故事需要的事实，不为凑数字增加变量。每个事实提供完整的有限值域与正确初始值。初始值表示故事开场，尚未取得的证据应为待取/柜中，不得把未来可能的损毁当成开场状态；进度应有尚未决定的状态。必须登记主角/同伴当前地点、行动自由、关键资源可用性。不可变规则明确可用关键设施和重要限制，不凭空增加备用设施。', '固定故事设定');
  let facts:Fact[]=seed.facts.map((f,i)=>({...f,key:'fact_'+(i+1)}));
  const lore={causalBackground:seed.causalBackground,title:seed.title,genre:seed.genre,logline:seed.logline,characters:seed.characters,objectiveTruth:seed.objectiveTruth,chronology:seed.chronology,rules:seed.rules,secrets:seed.secrets};
  const setting=lore;
  const anchorWorld=worldSchema(facts.filter(f=>f.scope==='shared'));
  const blueprint=await generate(z.object({
    beats:z.array(z.object({title:z.string(),coreConflict:z.string(),suspense:z.string(),decisionPurpose:z.string().describe('本次选择独有的戏剧作用与新增信息；不得重复前一幕的问题或撤销已兑现的成果'),eventBeforeChoice:z.string().describe('仅写场景开始后、玩家作决定之前发生的共同事件；禁止包含选项执行、救出、取走或选定供电等结果'),entryBeforeScene:anchorWorld.describe('本幕场景尚未开始时，人物已经身处的地点、在场和自由状态。不是本幕结束地点，不规定可选证据和伤势。第一幕须与初始事实一致')})).length(acts),
    finalEntry:anchorWorld.describe('终局前必需的共有处境，不抹掉选择的代价和收获'),
    conditionalEndings:z.array(EndingDirection).min(1).max(2),
    fallbackEnding:EndingDirection.describe('剩余状态的收束方向，不可预设剩余路线全部死亡或全部没有证据'),
  }),prompt+'\n先设计紧凑的戏剧骨架和2–3个有限结局方向，再倒推各幕两难。默认单路线正文约1200–1800字；每幕只安排一个推进故事的事件与一次重要选择。各幕必须解决不同层次的问题，后续幕揭示新信息、兑现代价或迫使最终取舍，禁止反复询问同一问题、反复索取同一物品或把上次选项重新问一遍。beats 是先后共同事件，不是一条预先选过A的主线。entryBeforeScene 是本幕开始前的处境，不是本幕执行完的结果；eventBeforeChoice 只写玩家作决定之前。入场条件只允许 shared 的空间/在场/自由事实，不得约束选择成果；第一幕 entryBeforeScene 必须符合初始事实，后面的 entryBeforeScene 由前一幕支线承接到达。结局方向是倒推行动的创作目标，不预先猜测事实取值组合；实际结果在全部行动大纲完成后按真实终态确定。每个结局方向必须说明行动与代价为何导致结果，不得把有证据机械等同于能逃生。区别尽量涵盖核心冲突的多种合理回答。\n设定：'+JSON.stringify(setting)+'\n事实字典：'+JSON.stringify(facts), '设计戏剧骨架与有限终局');
  const branchKeys=facts.filter(fact=>fact.scope==='branch').map(fact=>fact.key);
  const registry=await generate(z.object({
    extensions:z.array(z.object({key:z.enum(branchKeys as [string,...string[]]),values:z.array(z.string().min(1)).min(1).max(8)})).max(facts.length),
    additions:z.array(FactSchema.omit({key:true,scope:true})).max(4),
  }),prompt+'\n骨架已确定，尚未生成任何行动或正文。补齐事实字典，使各幕选择的实际收益、不可逆代价及后续回报都可表达。已有值域不足时只补充必要值；确实缺少独立维度时再添加事实。不要改变旧初始值、重定义旧编号或增加场景/人物/资源。特别核对资源分配或承诺是否已经造成不可逆变化；单纯说要去做而没有实际后果，不能当作有效分支。不要添加只表示选了A/B的伪事实。无需补充时返回空数组。\n固定设定：'+JSON.stringify(setting)+'\n完整骨架：'+JSON.stringify(blueprint)+'\n现有事实：'+JSON.stringify(facts),'补齐行动大纲所需的事实');
  facts=extendFactRegistry(facts,registry.extensions,registry.additions);
  let routes:Route[]=[{history:{},world:initialWorld(facts)}];
  const nodes:ReturnType<typeof causalNode>[]=[];
  const tails:{node:ReturnType<typeof causalNode>;routes:Route[]}[]=[];
  const states:{key:string;meaning:string;initial:boolean}[]=[];
  const actionSchema=draftActionSchema(facts);
  const plannedDirections=[...blueprint.conditionalEndings,blueprint.fallbackEnding];
  const context=()=>JSON.stringify({setting,events:(routes[0].events||[]).filter(event=>routes.every(route=>route.events?.includes(event))),current:describeWorld(facts,sharedWorld(routes)),unavailable:facts.filter(f=>!(f.key in sharedWorld(routes))).map(f=>({key:f.key,meaning:f.meaning}))});
  for(let i=0;i<acts;i++) {
    const beat=blueprint.beats[i],number=i+1,key='decision_'+number;
    // 先前分支已经各自走完承接；这里只从真实入场事实推进共同事件。
    for(const r of routes) for(const [k,v] of Object.entries(beat.entryBeforeScene)) if(r.world[k]!==v) throw new Error('共同事件入场不一致：'+k);
    const common=await generate(draftActionSchema(facts,sharedWorld(routes)),prompt+'\n写本幕抉择前的共同事件动作大纲，不选择任何选项。只使用 current；unavailable 不可作为已发生事实。所有状态变化登记 effects，uses 只写实际使用的事实编号。开场可以通过明确动作进入本幕场景；后续不要重复前一幕或重置已经取得的成果。\n本幕：'+JSON.stringify(beat)+'\n上下文：'+context(), '规划共同事件 '+number);
    const commonAction=bindDraft(routes,common);
    const commonNode=causalNode(facts,'beat_'+number,number,'common',routes,commonAction);
    const incoming=applyAction(facts,routes,commonAction);
    nodes.push(commonNode);
    const anchor=i+1<acts?blueprint.beats[i+1].entryBeforeScene:blueprint.finalEntry;
    // 每种真实入场世界由代码编号；模型不能把可选伤势/证据当成所有历史共有。
    const incomingByWorld=new Map<string,Route[]>();
    for(const route of incoming) {
      const signature=JSON.stringify(route.world);
      incomingByWorld.set(signature,[...(incomingByWorld.get(signature)||[]),route]);
    }
    const variants=[...incomingByWorld.values()].map((group,v)=>({id:'v'+v,routes:group,current:describeWorld(facts,group[0].world),events:(group[0].events||[]).filter(event=>group.every(route=>route.events?.includes(event)))}));
    const arrivalAction=draftActionSchema(facts,undefined,anchor);
    const variantSchema=z.union([z.object({consequence:arrivalAction,landing:z.null().optional()}),z.object({consequence:actionSchema,landing:arrivalAction})]);
    const local=await generate(z.object({
      choices:z.array(z.object({text:z.string().min(1).max(60),gain:z.string().min(1),cost:z.string().min(1),payoff:z.string().min(1)})).length(2),
      variants:z.object(Object.fromEntries(variants.map(v=>[v.id,z.array(variantSchema).length(2)]))).strict(),
    }),prompt+'\n为眼前两难设计两个都有理由选择的行动组合，两项都可改变多个事实。choices 的文案与意图对全部入场历史一致；variants 按代码给出的真实世界分别写这两个行动的具体后果，不自行分配历史。未拿到证据的变体不能写上传了原件；已经重伤的变体不能无故痊愈；events 是已经完成的真实行动，伤势部位、证据保存和通道使用必须沿用，不能更换受伤部位或重演撤离。相同行动可以因前面选择而有不同结果，明确解释原因。consequence 在一个紧凑场景内落实收益、代价和到达下一事件的必要动作；普通走动、交接用一句动作带过，不为换地点新增障碍或对白。landing 仅用于确有独立脱困过程的承接，代码会在扩写前将它并入同一后果场景，不增加游玩片段。必要的逃脱与物品转移必须写清。相同动作不受此前差异影响时，使用相同摘要与事实依赖，不为每种历史另写一套画面。最后一段的 effects 必须明确写出下一事件到达条件指定的值；不需要承接时 consequence 自身就要满足到达条件，不要越过下一幕去更远的地点。不要为了合流清零差异。payoff 指明后续如何兑现，禁止纯自伤或无收益选项。\n已完成的重要选择（本幕必须推进而不重问）：'+JSON.stringify(states.map(state=>state.meaning))+'\n本次选择独有的戏剧作用：'+beat.decisionPurpose+'\n刚发生的共同事件：'+JSON.stringify(common)+'\n各变体真实入场：'+JSON.stringify(variants.map(({id,current,events})=>({id,current,events})))+'\n下一事件到达条件：'+JSON.stringify(anchor)+'\n后续骨架和有限终局：'+JSON.stringify({beats:blueprint.beats.slice(i+1),endings:plannedDirections})+'\n设定与事实字典：'+JSON.stringify({setting,facts}), '规划行动组合与承接 '+number);
    const next:Route[]=[];
    const targets=[[],[]] as {when:Record<string,boolean>;targetNodeId:string}[][];
    for(const variant of variants) {
      const bundles=local.variants[variant.id];
      const compiled=bundles.map((b,j)=>compileBundle(facts,variant.routes.map(r=>({...r,history:{...r.history,[key]:j===0}})),{...local.choices[j],...b,landing:b.landing??null},'beat_'+number+'_'+(j+1)+(variants.length>1?'_'+variant.id:''),number,anchor,{combineLanding:true}));
      if(compiled[0].routes.every((r,n)=>JSON.stringify(r.world)===JSON.stringify(compiled[1].routes[n].world))) throw new Error('两个选择在承接后全部后果被抹平');
      for(let j=0;j<2;j++) {
        const branch=compiled[j];
        targets[j].push(...variant.routes.map(r=>({when:r.history,targetNodeId:branch.nodes[0].id})));
        if(i+1<acts) branch.tail.nextNodeId='beat_'+(number+1); else tails.push({node:branch.tail,routes:branch.routes});
        nodes.push(...branch.nodes);next.push(...branch.routes);
      }
    }
    for(let j=0;j<2;j++) commonNode.choices.push({text:local.choices[j].text,targetNodeId:targets[j][0].targetNodeId,...(variants.length>1?{nextRoutes:targets[j]}:{}),stateChange:{set:{[key]:j===0}}});
    routes=next;
    states.push({key,meaning:'true：'+local.choices[0].text+'；false：'+local.choices[1].text,initial:false});
  }
  // 结局仍在大纲阶段确定：只从已经规划出的真实世界收束，不能猜测未来会达到的任意条件。
  const finalWorlds=new Map<string,Route[]>();
  for(const route of routes){const signature=JSON.stringify(route.world);finalWorlds.set(signature,[...(finalWorlds.get(signature)||[]),route]);}
  const outcomes=[...finalWorlds.values()].map((incoming,i)=>({id:'w'+i,incoming,current:describeWorld(facts,incoming[0].world),events:(incoming[0].events||[]).filter(event=>incoming.every(route=>route.events?.includes(event)))}));
  const worldIds=outcomes.map(outcome=>outcome.id) as [string,...string[]];
  const realized=await generate(z.object({endings:z.array(EndingDirection.extend({worldIds:z.array(z.enum(worldIds)).min(1)})).min(2).max(3)}),
    prompt+'\n全部行动大纲已经确定，尚未开始正文扩写。将真实终态归纳为2–3个可兑现的结局方向。优先兑现原先的创作目标；原目标若没有成立的事实基础，应说明实际能实现的结果，不能捏造获得证据、救援成功或死亡。按事实组合与选择代价归纳，禁止仅按最后一次选择分组。每个worldId恰好归属一次，相同方向可以包含不同证据/伤势的收束变体，绝不能抹掉这些差异。necessaryCause和themeAnswer必须适用于该组全部世界，不把部分路线独有的损毁、死亡或伤残写成共有结果。后续各世界会独立扩写具体收束。\n原先结局创作目标：'+JSON.stringify(plannedDirections)+'\n实际终态与已发生动作：'+JSON.stringify(outcomes.map(({id,current,events})=>({id,current,events})))+'\n固定设定：'+JSON.stringify(setting),'根据真实终态完成结局大纲');
  const assigned=new Set<string>();
  const groups=realized.endings.map(ending=>ending.worldIds.flatMap(id=>{if(assigned.has(id))throw new Error('终态重复分配：'+id);assigned.add(id);return outcomes.find(outcome=>outcome.id===id)!.incoming;}));
  if(assigned.size!==outcomes.length)throw new Error('结局大纲遗漏实际终态');
  const directions=realized.endings;
  const endings:z.infer<typeof StoryBibleSchema>['endings']=[];
  const resolutionTarget=new Map<string,string>();
  for(const [i,group] of groups.entries()) {
    const direction=directions[i];
    const byWorld=new Map<string,Route[]>();
    for(const route of group) {const signature=JSON.stringify(route.world);byWorld.set(signature,[...(byWorld.get(signature)||[]),route]);}
    const variants=[...byWorld.values()].map((incoming,v)=>({id:'v'+v,incoming,current:describeWorld(facts,incoming[0].world),events:(incoming[0].events||[]).filter(e=>incoming.every(r=>r.events?.includes(e)))}));
    const resolved:Route[]=[];
    for(const variant of variants) {
      // 每次只提供一个真实入场世界，避免同一请求中的互斥历史相互污染。
      const terminalVariant=await generate(z.object({action:actionSchema,resolution:Resolution}),
        prompt+'\n为当前一个真实入场世界写一场紧凑的结局收束。只呈现决定性结果、必要的最后行动和最后画面，不重复争论、重新选择或从头介绍资源限制。action 从当前处境开始，resolution 写最终命运与事件结果，不重复执行已经完成的选择。没有外发不代表原件一定毁损；伤势部位沿用动作记录。不新增备用设施或救援条件。末尾会接共用结局字幕，因此必须实际完成必要脱困与核心结果；不能把同方向其他路线的历史混入本场。\n结局方向：'+JSON.stringify(direction)+'\n唯一真实入场与已发生动作：'+JSON.stringify({current:variant.current,events:variant.events})+'\n设定与字典：'+JSON.stringify({setting,facts}), '收束结局 '+(i+1)+' '+variant.id);
      const action=bindDraft(variant.incoming,terminalVariant.action);
      const node=causalNode(facts,'ending_'+(i+1)+'_resolution_'+variant.id,acts,'ending',variant.incoming,action);
      node.kind='scene';node.nextNodeId='ending_'+(i+1);node.endingResolution=terminalVariant.resolution;
      nodes.push(node);
      resolved.push(...applyAction(facts,variant.incoming,action));
      for(const route of variant.incoming) resolutionTarget.set(JSON.stringify(route.history),node.id);
    }
    const card=causalNode(facts,'ending_'+(i+1),acts,'ending',resolved,{summary:direction.title,requires:{},effects:{}});
    card.endingType=direction.endingType;card.fixedNarrative='【结局字幕】'+direction.title+'\n'+direction.themeAnswer;nodes.push(card);
    endings.push({title:direction.title,endingType:direction.endingType,necessaryCause:direction.necessaryCause,outcome:direction.themeAnswer,when:group.map(r=>r.history)});
  }
  for(const tail of tails) {
    tail.node.nextRoutes=tail.routes.map(r=>({when:r.history,targetNodeId:resolutionTarget.get(JSON.stringify(r.history))!}));
  }
  return PremiseOutputSchema.parse({...lore,sourcePrompt,storyBible:{...lore,initialFacts:describeWorld(facts,initialWorld(facts)),states,endings},initialState:Object.fromEntries(states.map(s=>[s.key,false])),startNodeId:'beat_1',storyNodes:nodes,actOutlines:blueprint.beats.map((b,i)=>({actNumber:i+1,title:b.title,coreConflict:b.coreConflict,suspense:b.suspense}))});
}
