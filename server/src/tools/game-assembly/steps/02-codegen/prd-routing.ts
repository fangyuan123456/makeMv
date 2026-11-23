import type { UniversalPrdSpec } from '../../../../project-store/contracts/planner/index.js';

/** PRD 是路由源，输入 scenes 只补充媒体和正文，不能覆盖选择及终局。 */
export function buildPrdScenes(prd:UniversalPrdSpec, media:any[] = [], texts:Record<string,string> = {}) {
  const outgoing=(id:string,outcome:string)=>prd.wiring.filter(w=>w.from===id&&w.onOutcome===outcome).map(w=>({to:w.to,condition:w.condition}));
  return [
    ...prd.clips.map(c=>{
      const asset=media.find(s=>(s.sceneId || s.id)===c.id) || {};
      const routes=outgoing(c.id,'onEnded');
      const interaction=routes.length===1 && !routes[0].condition ? prd.interactions.find(i=>i.id===routes[0].to) : undefined;
      if(interaction && interaction.kind!=='CHOICE') throw new Error(`暂不支持总装互动类型：${interaction.kind}`);
      return {...asset,sceneId:c.id,title:c.title,text:asset.text || texts[c.id] || c.title,
        background:asset.background || '',videoUrl:asset.clipUrl || asset.videoUrl,
        ending:undefined,next:undefined,
        routes:interaction?undefined:routes,
        choices:interaction?.outcomes.map(o=>({text:o.label || o.key,stateChange:o.stateChange,routes:outgoing(interaction.id,o.key)})) || [],
      };
    }),
    ...prd.endings.map(e=>({sceneId:e.id,title:e.title,text:e.summary,background:'',choices:[],
      ending:{type:e.endingType,title:e.title,verdict:e.summary}})),
  ];
}
