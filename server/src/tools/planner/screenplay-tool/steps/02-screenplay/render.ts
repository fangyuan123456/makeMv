import type { PremiseOutput } from '../01-premise/schema.js';
import type { FullScriptTextOutput } from './schema.js';
import { renderReadingScript } from './reading-layout.js';

/** 扩写只能填充节点正文，连接与前提来自已验证的大纲。 */
export function renderScreenplay(premise: PremiseOutput, expanded: FullScriptTextOutput): string {
  const texts = new Map(expanded.nodes.map(n => [n.id, n.narrativeText]));
  if (texts.size !== expanded.nodes.length || texts.size !== premise.storyNodes.length ||
      premise.storyNodes.some(n => !texts.get(n.id)?.trim())) {
    throw new Error('扩写节点与大纲不一致：存在重复、缺失或额外节点');
  }
  for (const [id, text] of texts) {
    if (/【(?:节点|后继|条件后继|合流|互动抉择点|走向分支|终局)[：\s]|<!--\s*makemv-/u.test(text)) {
      throw new Error(`扩写节点 ${id} 正文包含流程标记，不能覆盖大纲连接`);
    }
  }
  if (premise.storyBible) return renderReadingScript(premise, texts);
  const blocks = premise.storyNodes.map(node => {
    const summary = node.summary.replace(/\s+/g, ' ').trim();
    const actTitle = premise.actOutlines.find(act => act.actNumber === node.actNumber)?.title || '剧情';
    const endingTitle = node.endingResolution ? premise.storyNodes.find(next => next.id === node.nextNodeId)?.summary : undefined;
    // 详细大纲保留在 premise；成稿标题不重复粘贴整段行动描述。
    const caption = premise.storyBible && node.kind !== 'ending'
      ? (endingTitle || (node.choices.length ? actTitle : node.continuationAction || actTitle)).replace(/\s+/g, ' ').trim()
      : summary;
    const flow = node.kind === 'ending'
      ? `【终局：${node.endingType ? `${node.endingType} ` : ''}${summary}】`
      : node.choices.length
        ? `【互动抉择点 ${node.id}】\n${node.choices.map((c, i) => `- 选项 ${String.fromCharCode(65 + i)}：${c.text.replace(/\s+/g, ' ').trim()} ➔ ${c.nextRoutes ? `【条件走向：${JSON.stringify(c.nextRoutes)}】` : `【走向节点：${c.targetNodeId}】`}`).join('\n')}`
        : node.nextRoutes?.length ? `【条件后继：${JSON.stringify(node.nextRoutes)}】` : `【后继：${node.nextNodeId}】`;
    return `### 【节点：${node.id}】第 ${node.actNumber} 幕 · ${caption}\n\n${texts.get(node.id)}\n\n${flow}`;
  });
  const metadata = premise.storyBible ? `<!-- makemv-state:${JSON.stringify({initialState:premise.initialState,choices:Object.fromEntries(premise.storyNodes.filter(n=>n.choices.length).map(n=>[n.id,n.choices.map(c=>c.stateChange)])),storyBible:premise.storyBible}).replace(/-->/g,'--\\u003e')} -->\n\n` : '';
  const version = premise.storyNodes.filter(n => n.kind === 'ending').every(n => n.endingType)
    ? `<!-- makemv-screenplay:${premise.storyBible ? 'v3' : 'v2'} -->\n\n` : '';
  return `# 《${premise.title}》互动影游剧本\n\n${version}${metadata}【入口：${premise.startNodeId}】\n\n${blocks.join('\n\n---\n\n')}`;
}
