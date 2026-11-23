import type { ExtractedScriptStructure } from './schema.js';
import { parseGeneratedScreenplay } from './parse-generated.js';

/** 新格式的流程标记是确定性契约；旧版文学剧本仍走语义抽取。 */
export function validateExtractedRouting(script: string, extracted: ExtractedScriptStructure): void {
  if (script.includes('<!-- makemv-screenplay:v4 -->')) {
    const expected = parseGeneratedScreenplay(script)!;
    if (JSON.stringify(expected) !== JSON.stringify(extracted)) throw new Error('抽取内容与可读剧本契约不一致');
    return;
  }
  const blocks = [...script.matchAll(/^### 【节点：([^】]+)】[^\n]*\n([^]*?)(?=^### 【节点：|$(?![^]))/gm)];
  if (!blocks.length) return;
  const entry = script.match(/【入口：([^】]+)】/)?.[1];
  if (!entry || extracted.startNodeId !== entry) throw new Error('抽取入口与剧本流程标记不一致');
  const ids = new Set(blocks.map(b => b[1]));
  const extractedIds = [...extracted.clips, ...extracted.endings].map(n => n.id);
  if (ids.size !== blocks.length || extractedIds.length !== ids.size ||
      new Set(extractedIds).size !== ids.size || extractedIds.some(id => !ids.has(id))) {
    throw new Error('抽取节点与剧本流程标记不一致');
  }
  for (const [, id, body] of blocks) {
    if (/【终局：/.test(body)) {
      if (!extracted.endings.some(e => e.id === id)) throw new Error(`终局节点被误抽取：${id}`);
      continue;
    }
    const clip = extracted.clips.find(c => c.id === id);
    if (!clip) throw new Error(`剧情节点被误抽取：${id}`);
    const conditionalChoices=[...body.matchAll(/^- 选项 [A-Z]：(.+?) ➔ 【条件走向：([^】]+)】/gm)];
    if(conditionalChoices.length) {
      if(clip.choices.length!==conditionalChoices.length || conditionalChoices.some((m,i)=>clip.choices[i].text!==m[1] || JSON.stringify(clip.choices[i].nextRoutes)!==JSON.stringify(JSON.parse(m[2])))) throw new Error('条件选项路由被改变');
      continue;
    }
    const choices = [...body.matchAll(/^- 选项 [A-Z]：(.+?) ➔ 【走向节点：([^】]+)】/gm)];
    const next = body.match(/【后继：([^】]+)】/)?.[1];
    const routes = body.match(/^【条件后继：(.+)】$/m)?.[1];
    if (routes) {
      if(choices.length || next || JSON.stringify(clip.nextRoutes)!==JSON.stringify(JSON.parse(routes))) throw new Error('条件路由被改变');
      continue;
    }
    if (choices.length) {
      if (clip.nextNodeId || clip.choices.length !== choices.length || choices.some((choice, i) =>
        clip.choices[i].text !== choice[1] || (clip.choices[i].targetNodeId || clip.choices[i].targetEndingId) !== choice[2])) {
        throw new Error(`选项抽取改变了大纲连接：${id}`);
      }
    } else if (!next || clip.choices.length || clip.nextNodeId !== next) {
      throw new Error(`后继抽取改变了大纲连接：${id}`);
    }
  }
}
