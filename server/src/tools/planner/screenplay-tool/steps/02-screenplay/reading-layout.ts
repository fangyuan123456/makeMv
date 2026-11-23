import type { PremiseOutput } from '../01-premise/schema.js';

type Node = PremiseOutput['storyNodes'][number];
type Route = { when: Record<string, boolean>; targetNodeId: string };
const json = (value: unknown) => JSON.stringify(value).replace(/>/g, '\\u003e');
const letter = (index: number) => String.fromCharCode(65 + index);
const inline = (value: string) => value.replace(/\s+/g, ' ').trim();

/** 阅读标签只描述既有接线；真实 ID、条件和状态保留在隐藏契约中。 */
export function renderReadingScript(premise: PremiseOutput, texts: Map<string, string>): string {
  const nodes = premise.storyNodes;
  const labels = new Map<string, string>();
  const endingNodes = nodes.filter(node => node.kind === 'ending');
  const choices = nodes.filter(node => node.choices.length);
  const choiceNames = new Map<string, Set<string>>();
  for (const node of choices) node.choices.forEach((choice, index) => {
    for (const [key, value] of Object.entries(choice.stateChange?.set || {})) {
      const token = `${key}:${value}`;
      const names = choiceNames.get(token) || new Set<string>();
      names.add(`第 ${node.actNumber} 幕选 ${letter(index)}`);
      choiceNames.set(token, names);
    }
  });
  const condition = (when: Record<string, boolean>) => Object.entries(when).map(([key, value]) => {
    const names = choiceNames.get(`${key}:${value}`);
    if (names?.size === 1) return [...names][0];
    const meaning = premise.storyBible?.states.find(state => state.key === key)?.meaning;
    return `${meaning || '前情状态'}：${value ? '成立' : '不成立'}`;
  }).join('，且') || '任意前情';

  for (const node of choices) {
    labels.set(node.id, `第 ${node.actNumber} 幕正文`);
    node.choices.forEach((choice, index) => {
      const targets = [...new Set(choice.nextRoutes?.map(route => route.targetNodeId) || [choice.targetNodeId])];
      targets.forEach((id, variant) => labels.set(id, `分支 ${node.actNumber}-${letter(index)}${targets.length > 1 ? `（版本 ${variant + 1}）` : ''}`));
    });
  }
  endingNodes.forEach((ending, index) => {
    labels.set(ending.id, `结局 ${index + 1} · ${inline(ending.summary)}`);
    const resolutions = nodes.filter(node => node.endingResolution && node.nextNodeId === ending.id);
    resolutions.forEach((node, variant) => labels.set(node.id, `结局 ${index + 1} · 收束${resolutions.length > 1 ? `版本 ${variant + 1}` : ''}`));
  });
  for (const node of nodes) if (!labels.has(node.id)) labels.set(node.id, `第 ${node.actNumber} 幕 · 续段 ${nodes.filter(n => n.actNumber === node.actNumber).indexOf(node) + 1}`);
  const anchor = (id: string) => `story-${encodeURIComponent(id)}`;
  const link = (id: string) => `[${labels.get(id) || id}](#${anchor(id)})`;
  const routesText = (routes: Route[]) => routes.map(route => `- 此前${condition(route.when)} → ${link(route.targetNodeId)}`).join('\n');

  // 同一分支的前情版本紧邻排列；结局收束集中在最后，避免穿插进第三幕。
  const ordered: Node[] = [];
  const add = (node: Node | undefined) => { if (node && !ordered.includes(node)) ordered.push(node); };
  const actNumbers = [...new Set(nodes.filter(n => n.kind !== 'ending' && !n.endingResolution).map(n => n.actNumber))].sort((a, b) => a - b);
  for (const act of actNumbers) {
    const actNodes = nodes.filter(n => n.actNumber === act && n.kind !== 'ending' && !n.endingResolution);
    for (const node of actNodes.filter(n => n.choices.length)) {
      add(node);
      for (const choice of node.choices) for (const id of choice.nextRoutes?.map(r => r.targetNodeId) || [choice.targetNodeId]) add(actNodes.find(n => n.id === id));
    }
    actNodes.forEach(add);
  }
  for (const ending of endingNodes) {
    nodes.filter(n => n.endingResolution && n.nextNodeId === ending.id).forEach(add);
    add(ending);
  }
  nodes.forEach(add);

  const incoming = new Map<string, string[]>();
  const register = (target: string, description: string) => {
    incoming.set(target, [...new Set([...(incoming.get(target) || []), description])]);
  };
  for (const node of nodes) {
    node.choices.forEach((choice, index) => {
      const source = `第 ${node.actNumber} 幕选 ${letter(index)}`;
      if (choice.nextRoutes?.length) for (const route of choice.nextRoutes) register(route.targetNodeId, `${source}；此前${condition(route.when)}`);
      else register(choice.targetNodeId, source);
    });
    for (const route of node.nextRoutes || []) register(route.targetNodeId, `此前${condition(route.when)}`);
  }

  let section = '';
  const blocks = ordered.map(node => {
    const sectionKey = node.kind === 'ending' || node.endingResolution ? 'endings' : String(node.actNumber);
    const sectionHeading = sectionKey === section ? '' : sectionKey === 'endings'
      ? '## 结局\n\n'
      : `## 第 ${node.actNumber} 幕《${inline(premise.actOutlines.find(act => act.actNumber === node.actNumber)?.title || '剧情')}》\n\n`;
    section = sectionKey;
    const caption = labels.get(node.id)!;
    const applicability = incoming.get(node.id);
    const intro = applicability?.length && !node.choices.length ? `> 阅读条件：${applicability.join('；或：')}。${caption.includes('版本') ? '只读符合前情的这一版。' : ''}\n\n` : '';
    const flow = node.kind === 'ending' ? '【全剧终】'
      : node.choices.length
        ? `【互动抉择点 ${node.actNumber}】\n\n${node.choices.map((choice, index) => `- 选项 ${letter(index)}：${inline(choice.text)}${choice.nextRoutes?.length ? `\n\n${routesText(choice.nextRoutes).split('\n').map(line => `  ${line}`).join('\n')}` : ` → ${link(choice.targetNodeId)}`}`).join('\n\n')}`
        : node.nextRoutes?.length ? `【本段结束后，按此前选择继续】\n\n${routesText(node.nextRoutes)}`
        : `【本段结束 → ${link(node.nextNodeId!)}】`;
    const actTitle = premise.actOutlines.find(act => act.actNumber === node.actNumber)?.title || '剧情';
    const endingTitle = node.endingResolution ? nodes.find(next => next.id === node.nextNodeId)?.summary : undefined;
    const title = inline(node.kind === 'ending' ? node.summary : endingTitle || (node.choices.length ? actTitle : node.continuationAction || actTitle));
    const contract = { id: node.id, title, kind: node.kind, endingType: node.endingType, choices: node.choices, nextNodeId: node.nextNodeId, nextRoutes: node.nextRoutes };
    return `${sectionHeading}<a id="${anchor(node.id)}"></a>\n\n### ${caption}\n\n${intro}<!-- makemv-node:${json(contract)} -->\n\n${texts.get(node.id)}\n\n<!-- makemv-flow -->\n\n${flow}`;
  });
  const metadata = { title: premise.title, startNodeId: premise.startNodeId, initialState: premise.initialState, choices: Object.fromEntries(choices.map(n => [n.id, n.choices.map(c => c.stateChange)])), storyBible: premise.storyBible };
  return `# 《${premise.title}》互动影游剧本\n\n<!-- makemv-screenplay:v4 -->\n\n<!-- makemv-state:${json(metadata)} -->\n\n从${link(premise.startNodeId)}开始。每幕读完正文后选择 A 或 B，按链接阅读对应分支，再按段尾指引继续。带“版本”的分支只读符合此前选择的一版。\n\n${blocks.join('\n\n---\n\n')}`;
}
