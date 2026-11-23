import { ExtractedScriptStructureSchema, type ExtractedScriptStructure } from './schema.js';

/** 代码生成的流程标记直接消费；旧版自由文本仍由语义抽取处理。 */
export function parseGeneratedScreenplay(script: string): ExtractedScriptStructure | null {
  if (script.includes('<!-- makemv-screenplay:v4 -->')) return parseReadingScript(script);
  const v3=script.includes('<!-- makemv-screenplay:v3 -->');
  if (!v3 && !script.includes('<!-- makemv-screenplay:v2 -->')) return null;
  const stateText = script.match(/<!-- makemv-state:([^]*?) -->/)?.[1];
  if(v3 && !stateText) throw new Error('v3 剧本缺少状态契约');
  const metadata = stateText ? JSON.parse(stateText) : {};
  if(v3 && (!metadata.initialState || !metadata.choices)) throw new Error('v3 状态契约不完整');
  const title = script.match(/^# 《(.+)》互动影游剧本/m)?.[1];
  const startNodeId = script.match(/^【入口：([^】]+)】/m)?.[1];
  const blocks = [...script.matchAll(/^### 【节点：([^】]+)】第 \d+ 幕 · ([^\r\n]+)\r?\n([\s\S]*?)(?=^### 【节点：|(?![\s\S]))/gm)];
  if (!title || !startNodeId || !blocks.length) throw new Error('生成剧本缺少入口或节点标记');
  const endings: ExtractedScriptStructure['endings'] = [];
  const clips: ExtractedScriptStructure['clips'] = [];
  for (const [, id, nodeTitle, body] of blocks) {
    const ending = body.match(/^【终局：(HE|BE|NE) (.+)】\s*$/m);
    const narrativeText = body.split(/^【(?:终局|互动抉择点|后继|条件后继)[：\s]/m)[0].trim();
    if (!narrativeText) throw new Error(`节点缺少正文：${id}`);
    if (ending) {
      endings.push({ id, title: nodeTitle, endingType: ending[1] as 'HE' | 'BE' | 'NE', summary: narrativeText });
      continue;
    }
    const choices = [...body.matchAll(/^- 选项 ([A-Z])：(.+?) ➔ 【(走向节点|条件走向)：([^】]+)】\s*$/gm)]
      .map((m,i) => { const nextRoutes=m[3]==='条件走向'?JSON.parse(m[4]):undefined; return { stateChange:metadata.choices?.[id]?.[i], id: `${id}_${m[1]}`, text:m[2], targetNodeId:nextRoutes?nextRoutes[0].targetNodeId:m[4],nextRoutes}; });
    if(v3 && choices.length && (!Array.isArray(metadata.choices[id]) || metadata.choices[id].length!==choices.length || metadata.choices[id].some((change:unknown)=>!change))) throw new Error('选择的状态契约缺失');
    clips.push({ nextRoutes:body.match(/^【条件后继：(.+)】$/m)?.[1] ? JSON.parse(body.match(/^【条件后继：(.+)】$/m)![1]) : undefined, id, title: nodeTitle, narrativeText, choices, nextNodeId: body.match(/^【后继：([^】]+)】/m)?.[1] });
  }
  const endingIds = new Set(endings.map(e => e.id));
  for (const clip of clips) {
    clip.choices = clip.choices.map(choice => endingIds.has(choice.targetNodeId!)
      ? { id: choice.id, text: choice.text, stateChange:choice.stateChange, nextRoutes:choice.nextRoutes, targetEndingId: choice.targetNodeId }
      : choice);
  }
  return ExtractedScriptStructureSchema.parse({ title, startNodeId, clips, endings, initialState:metadata.initialState });
}

/** 可读稿的正文可直接编辑，接线读取隐藏契约，不从阅读提示反推条件。 */
function parseReadingScript(script: string): ExtractedScriptStructure {
  const stateText = script.match(/<!-- makemv-state:([^]*?) -->/)?.[1];
  if (!stateText) throw new Error('v4 剧本缺少状态契约');
  const metadata = JSON.parse(stateText);
  if (!metadata.initialState || !metadata.choices) throw new Error('v4 状态契约不完整');
  const markers = [...script.matchAll(/<!-- makemv-node:([^]*?) -->/g)];
  if (!markers.length) throw new Error('v4 剧本缺少节点契约');
  const endings: ExtractedScriptStructure['endings'] = [];
  const clips: ExtractedScriptStructure['clips'] = [];
  const ids = new Set<string>();
  markers.forEach((marker, index) => {
    const node = JSON.parse(marker[1]);
    if (ids.has(node.id)) throw new Error(`重复节点：${node.id}`);
    ids.add(node.id);
    const body = script.slice(marker.index! + marker[0].length, markers[index + 1]?.index ?? script.length);
    const divider = body.indexOf('<!-- makemv-flow -->');
    if (divider < 0) throw new Error(`节点缺少流程分隔：${node.id}`);
    const narrativeText = body.slice(0, divider).trim();
    if (node.kind === 'ending') {
      endings.push({ id: node.id, title: node.title, endingType: node.endingType, summary: narrativeText });
      return;
    }
    if (!Array.isArray(node.choices)) throw new Error(`节点缺少选项契约：${node.id}`);
    if (node.choices.length && JSON.stringify(node.choices.map((choice: any) => choice.stateChange)) !== JSON.stringify(metadata.choices[node.id])) throw new Error('选择的状态契约缺失或不一致');
    clips.push({ id: node.id, title: node.title, narrativeText, choices: node.choices.map((choice: any, i: number) => ({ ...choice, id: `${node.id}_${String.fromCharCode(65 + i)}` })), nextNodeId: node.nextNodeId, nextRoutes: node.nextRoutes });
  });
  const endingIds = new Set(endings.map(ending => ending.id));
  for (const clip of clips) clip.choices = clip.choices.map(choice => endingIds.has(choice.targetNodeId!)
    ? { ...choice, targetNodeId: undefined, targetEndingId: choice.targetNodeId } : choice);
  return ExtractedScriptStructureSchema.parse({ title: metadata.title, startNodeId: metadata.startNodeId, initialState: metadata.initialState, clips, endings });
}
