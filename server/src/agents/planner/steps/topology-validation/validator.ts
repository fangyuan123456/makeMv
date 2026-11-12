/**
 * agents/planner/steps/topology-validation/validator.ts
 * 静态图论拓扑、100% 通用 PRD 语义与数值可达性校验器
 * (Static Topology, Wiring Integrity & Reachability Validator)
 */

import { z } from 'zod';
import type { GDDArtifact, NarrativeBeat, PlannerNodeSchema } from '../../schema.js';
import type { UniversalPrdSpec } from '../prd-synthesis/schema.js';
import type {
  TopologyValidationInput,
  TopologyValidationMetrics,
} from './schema.js';

export interface TopologyValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  metrics: TopologyValidationMetrics;
}

/**
 * 从 story.md 提取所有片段 ID（匹配 `## S1` 或 `## S1｜标题`）
 */
export function extractClipIdsFromStoryMarkdown(storyMarkdown: string): string[] {
  const ids: string[] = [];
  for (const line of storyMarkdown.split(/\r?\n/)) {
    const match = line.match(/^##\s+([^\s｜|]+)(?:[｜|].*)?$/);
    if (match && match[1]) {
      ids.push(match[1].trim());
    }
  }
  return ids;
}

/**
 * 从 prd.md 提取第 3 章内嵌 JSON 代码块并解析校验
 */
export function parsePrdEmbeddedJson(prdMarkdown: string): { ok: true; data: any } | { ok: false; error: string } {
  const match = prdMarkdown.match(/```json\s*\r?\n([\s\S]*?)\r?\n```/);
  if (!match) {
    return { ok: false, error: 'prd.md 中未找到 ```json``` 接线代码块' };
  }
  try {
    return { ok: true, data: JSON.parse(match[1]) };
  } catch (err: any) {
    return { ok: false, error: `prd.md 内嵌 JSON 解析失败: ${err?.message || '语法错误'}` };
  }
}

/**
 * 提取条件表达式里引用到的变量名（过滤字面量与运算符关键字）
 */
function extractConditionIdentifiers(expr: string): string[] {
  const strippedStrings = expr.replace(/'[^']*'|"[^"]*"/g, ' ');
  const tokens = strippedStrings.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
  const reserved = new Set(['true', 'false', 'null', 'undefined', 'default', 'vars', 'state', 'Math']);
  return [...new Set(tokens.filter((t) => !reserved.has(t)))];
}

type CmpOp = '===' | '!==' | '==' | '!=' | '>=' | '>' | '<=' | '<';

type CondAtom =
  | { kind: 'num'; varName: string; op: CmpOp; value: number }
  | { kind: 'bool'; varName: string; expected: boolean }
  | { kind: 'opaque' };

type CondNode =
  | { kind: 'atom'; atom: CondAtom }
  | { kind: 'not'; inner: CondNode }
  | { kind: 'and'; left: CondNode; right: CondNode }
  | { kind: 'or'; left: CondNode; right: CondNode };

type CondToken =
  | { type: 'lparen' | 'rparen' | 'not' | 'and' | 'or' }
  | { type: 'op'; val: CmpOp }
  | { type: 'num'; val: number }
  | { type: 'bool'; val: boolean }
  | { type: 'ident'; val: string }
  | { type: 'other' };

function tokenizeCondition(expr: string): CondToken[] {
  const tokens: CondToken[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(') { tokens.push({ type: 'lparen' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'rparen' }); i++; continue; }
    if (expr.startsWith('&&', i)) { tokens.push({ type: 'and' }); i += 2; continue; }
    if (expr.startsWith('||', i)) { tokens.push({ type: 'or' }); i += 2; continue; }
    if (expr.startsWith('===', i)) { tokens.push({ type: 'op', val: '===' }); i += 3; continue; }
    if (expr.startsWith('!==', i)) { tokens.push({ type: 'op', val: '!==' }); i += 3; continue; }
    if (expr.startsWith('==', i)) { tokens.push({ type: 'op', val: '==' }); i += 2; continue; }
    if (expr.startsWith('!=', i)) { tokens.push({ type: 'op', val: '!=' }); i += 2; continue; }
    if (expr.startsWith('>=', i)) { tokens.push({ type: 'op', val: '>=' }); i += 2; continue; }
    if (expr.startsWith('<=', i)) { tokens.push({ type: 'op', val: '<=' }); i += 2; continue; }
    if (ch === '>') { tokens.push({ type: 'op', val: '>' }); i++; continue; }
    if (ch === '<') { tokens.push({ type: 'op', val: '<' }); i++; continue; }
    if (ch === '!') { tokens.push({ type: 'not' }); i++; continue; }
    if (ch === '\'' || ch === '"') {
      const quote = ch;
      i++;
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === '\\') i++;
        i++;
      }
      i++;
      tokens.push({ type: 'other' });
      continue;
    }
    const numMatch = expr.slice(i).match(/^-?\d+(?:\.\d+)?/);
    if (numMatch) {
      tokens.push({ type: 'num', val: Number(numMatch[0]) });
      i += numMatch[0].length;
      continue;
    }
    const idMatch = expr.slice(i).match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
    if (idMatch) {
      if (idMatch[0] === 'true') tokens.push({ type: 'bool', val: true });
      else if (idMatch[0] === 'false') tokens.push({ type: 'bool', val: false });
      else tokens.push({ type: 'ident', val: idMatch[0] });
      i += idMatch[0].length;
      continue;
    }
    tokens.push({ type: 'other' });
    i++;
  }
  return tokens;
}

function flipComparisonOp(op: CmpOp): CmpOp {
  switch (op) {
    case '>': return '<';
    case '>=': return '<=';
    case '<': return '>';
    case '<=': return '>=';
    default: return op;
  }
}

function negateComparisonOp(op: CmpOp): CmpOp {
  switch (op) {
    case '===': return '!==';
    case '!==': return '===';
    case '==': return '!=';
    case '!=': return '==';
    case '>=': return '<';
    case '>': return '<=';
    case '<=': return '>';
    case '<': return '>=';
  }
}

function parseConditionAst(expr: string): CondNode | null {
  const tokens = tokenizeCondition(expr);
  if (tokens.length === 0) return null;
  let pos = 0;

  function parseOr(): CondNode {
    let node = parseAnd();
    while (pos < tokens.length && tokens[pos].type === 'or') {
      pos++;
      node = { kind: 'or', left: node, right: parseAnd() };
    }
    return node;
  }

  function parseAnd(): CondNode {
    let node = parseUnary();
    while (pos < tokens.length && tokens[pos].type === 'and') {
      pos++;
      node = { kind: 'and', left: node, right: parseUnary() };
    }
    return node;
  }

  function parseUnary(): CondNode {
    if (pos < tokens.length && tokens[pos].type === 'not') {
      pos++;
      return { kind: 'not', inner: parseUnary() };
    }
    if (pos < tokens.length && tokens[pos].type === 'lparen') {
      pos++;
      const inner = parseOr();
      if (pos < tokens.length && tokens[pos].type === 'rparen') pos++;
      return inner;
    }
    return parseAtom();
  }

  function parseAtom(): CondNode {
    const start = pos;
    let depth = 0;
    while (pos < tokens.length) {
      const t = tokens[pos];
      if (depth === 0 && (t.type === 'and' || t.type === 'or' || t.type === 'rparen')) break;
      if (t.type === 'lparen') depth++;
      else if (t.type === 'rparen') depth--;
      pos++;
    }
    const slice = tokens.slice(start, pos);
    if (slice.length === 3 && slice[1].type === 'op') {
      const [l, opTok, r] = slice;
      if (l.type === 'ident' && r.type === 'num') {
        return { kind: 'atom', atom: { kind: 'num', varName: l.val, op: opTok.val, value: r.val } };
      }
      if (l.type === 'num' && r.type === 'ident') {
        return { kind: 'atom', atom: { kind: 'num', varName: r.val, op: flipComparisonOp(opTok.val), value: l.val } };
      }
      if (l.type === 'ident' && r.type === 'bool' && (opTok.val === '===' || opTok.val === '==' || opTok.val === '!==' || opTok.val === '!=')) {
        const expected = opTok.val === '===' || opTok.val === '==' ? r.val : !r.val;
        return { kind: 'atom', atom: { kind: 'bool', varName: l.val, expected } };
      }
      if (l.type === 'bool' && r.type === 'ident' && (opTok.val === '===' || opTok.val === '==' || opTok.val === '!==' || opTok.val === '!=')) {
        const expected = opTok.val === '===' || opTok.val === '==' ? l.val : !l.val;
        return { kind: 'atom', atom: { kind: 'bool', varName: r.val, expected } };
      }
    }
    if (slice.length === 1 && slice[0].type === 'ident') {
      return { kind: 'atom', atom: { kind: 'bool', varName: slice[0].val, expected: true } };
    }
    return { kind: 'atom', atom: { kind: 'opaque' } };
  }

  try {
    return parseOr();
  } catch {
    return null;
  }
}

function toDnfClauses(node: CondNode, negated = false): CondAtom[][] {
  if (node.kind === 'not') {
    return toDnfClauses(node.inner, !negated);
  }
  if (node.kind === 'atom') {
    if (!negated) return [[node.atom]];
    if (node.atom.kind === 'num') {
      return [[{ kind: 'num', varName: node.atom.varName, op: negateComparisonOp(node.atom.op), value: node.atom.value }]];
    }
    if (node.atom.kind === 'bool') {
      return [[{ kind: 'bool', varName: node.atom.varName, expected: !node.atom.expected }]];
    }
    return [[{ kind: 'opaque' }]];
  }
  const isOr = negated ? node.kind === 'and' : node.kind === 'or';
  const leftClauses = toDnfClauses(node.left, negated);
  const rightClauses = toDnfClauses(node.right, negated);
  if (isOr) {
    return [...leftClauses, ...rightClauses];
  }
  const combined: CondAtom[][] = [];
  for (const lc of leftClauses) {
    for (const rc of rightClauses) {
      combined.push([...lc, ...rc]);
      if (combined.length >= 64) return combined;
    }
  }
  return combined;
}

function isConjunctionSatisfiable(
  clause: CondAtom[],
  numericBounds: Map<string, { min: number; max: number }>
): boolean {
  const intervals = new Map<
    string,
    { min: number; max: number; minInc: boolean; maxInc: boolean; neq: Set<number> }
  >();
  const boolExpectations = new Map<string, boolean>();

  for (const atom of clause) {
    if (atom.kind === 'opaque') continue;
    if (atom.kind === 'bool') {
      const prev = boolExpectations.get(atom.varName);
      if (prev !== undefined && prev !== atom.expected) return false;
      boolExpectations.set(atom.varName, atom.expected);
      continue;
    }
    const base = numericBounds.get(atom.varName);
    if (!base) continue;

    const cur = intervals.get(atom.varName) || {
      min: base.min,
      max: base.max,
      minInc: true,
      maxInc: true,
      neq: new Set<number>(),
    };

    const { op, value } = atom;
    if (op === '>=' || op === '>') {
      const inc = op === '>=';
      if (value > cur.min) {
        cur.min = value;
        cur.minInc = inc;
      } else if (value === cur.min) {
        cur.minInc = cur.minInc && inc;
      }
    } else if (op === '<=' || op === '<') {
      const inc = op === '<=';
      if (value < cur.max) {
        cur.max = value;
        cur.maxInc = inc;
      } else if (value === cur.max) {
        cur.maxInc = cur.maxInc && inc;
      }
    } else if (op === '===' || op === '==') {
      if (value > cur.min) {
        cur.min = value;
        cur.minInc = true;
      }
      if (value < cur.max) {
        cur.max = value;
        cur.maxInc = true;
      }
    } else if (op === '!==' || op === '!=') {
      cur.neq.add(value);
    }

    if (cur.min > cur.max || (cur.min === cur.max && (!cur.minInc || !cur.maxInc))) {
      return false;
    }
    if (cur.min === cur.max && cur.neq.has(cur.min)) {
      return false;
    }
    intervals.set(atom.varName, cur);
  }
  return true;
}

export function isConditionExprReachable(
  expr: string,
  numericBounds: Map<string, { min: number; max: number }>
): { reachable: boolean; relevantBoundsSummary: string } {
  const ast = parseConditionAst(expr);
  if (!ast) return { reachable: true, relevantBoundsSummary: '' };
  const clauses = toDnfClauses(ast);
  const reachable = clauses.some((clause) => isConjunctionSatisfiable(clause, numericBounds));
  if (reachable) return { reachable: true, relevantBoundsSummary: '' };

  const vars = extractConditionIdentifiers(expr).filter((v) => numericBounds.has(v));
  const summary = vars
    .map((v) => {
      const b = numericBounds.get(v)!;
      return `${v}: [${b.min}, ${b.max}]`;
    })
    .join(', ');
  return { reachable: false, relevantBoundsSummary: summary };
}

/**
 * 校验 100% 通用 PRD（节点闭环、防伪分叉、变量声明、数值阈值可达性、`story.md` 1:1 对齐）
 */
export function validateUniversalPrdTopology(params: {
  prd: UniversalPrdSpec;
  storyMarkdown?: string;
  prdMarkdown?: string;
}): TopologyValidationResult {
  const { prd, storyMarkdown, prdMarkdown } = params;
  const errors: string[] = [];
  const warnings: string[] = [];

  const clipIds = new Set<string>();
  const interactionIds = new Set<string>();
  const endingIds = new Set<string>();
  const allNodeIds = new Set<string>();

  for (const c of prd.clips) {
    if (clipIds.has(c.id)) errors.push(`存在重复的视频片段 ID: [${c.id}]`);
    clipIds.add(c.id);
    allNodeIds.add(c.id);
  }
  for (const inter of prd.interactions) {
    if (allNodeIds.has(inter.id)) errors.push(`互动节点 ID 冲突或重复: [${inter.id}]`);
    interactionIds.add(inter.id);
    allNodeIds.add(inter.id);
  }
  for (const end of prd.endings) {
    if (allNodeIds.has(end.id)) errors.push(`结局节点 ID 冲突或重复: [${end.id}]`);
    endingIds.add(end.id);
    allNodeIds.add(end.id);
  }

  if (prd.clips.length === 0) {
    errors.push('clips 不能为空，至少包含 1 个视频片段');
  }
  if (!clipIds.has(prd.startNodeId)) {
    errors.push(`起始节点 startNodeId [${prd.startNodeId}] 不存在于 clips 中`);
  }
  if (prd.endings.length === 0) {
    errors.push('endings 不能为空，至少需要 1 个结局节点');
  }

  // 1. 接线引用完整性校验
  const declaredVarKeys = new Set(Object.keys(prd.initialState || {}));
  const outgoingByFrom = new Map<string, typeof prd.wiring>();
  const inboundCount = new Map<string, number>();

  for (const edge of prd.wiring) {
    if (!clipIds.has(edge.from) && !interactionIds.has(edge.from)) {
      errors.push(`wiring 边起点 [${edge.from}] 不是合法的视频或互动节点`);
    }
    if (!allNodeIds.has(edge.to)) {
      errors.push(`wiring 边目标 [${edge.to}] 不存在于 clips / interactions / endings 中`);
    }

    const list = outgoingByFrom.get(edge.from) || [];
    list.push(edge);
    outgoingByFrom.set(edge.from, list);
    inboundCount.set(edge.to, (inboundCount.get(edge.to) || 0) + 1);

    // 校验条件表达式里的变量名已在 initialState 中声明
    if (edge.condition && edge.condition !== 'default') {
      for (const id of extractConditionIdentifiers(edge.condition)) {
        if (!declaredVarKeys.has(id)) {
          errors.push(
            `wiring 条件 [${edge.from} -> ${edge.to}] 引用了未在 initialState 中声明的变量: [${id}]`
          );
        }
      }
    }
  }

  // 2. 校验交互 stateChange 引用变量已声明
  for (const inter of prd.interactions) {
    for (const outcome of inter.outcomes) {
      if (outcome.stateChange?.add) {
        for (const k of Object.keys(outcome.stateChange.add)) {
          if (!declaredVarKeys.has(k)) {
            errors.push(`互动 [${inter.id}.${outcome.key}] 的 stateChange.add 引用了未声明变量 [${k}]`);
          }
        }
      }
      if (outcome.stateChange?.set) {
        for (const k of Object.keys(outcome.stateChange.set)) {
          if (!declaredVarKeys.has(k)) {
            errors.push(`互动 [${inter.id}.${outcome.key}] 的 stateChange.set 引用了未声明变量 [${k}]`);
          }
        }
      }
    }
  }

  // 3. 校验非终局节点必有出边，且带条件的 (from, onOutcome) 组必须有 null 兜底边
  for (const cid of clipIds) {
    if ((outgoingByFrom.get(cid) || []).length === 0) {
      errors.push(`视频节点 [${cid}] 没有任何出边（断头路）`);
    }
  }
  for (const iid of interactionIds) {
    if ((outgoingByFrom.get(iid) || []).length === 0) {
      errors.push(`互动节点 [${iid}] 没有任何出边（断头路）`);
    }
  }
  for (const [fromId, edges] of outgoingByFrom.entries()) {
    const byOutcome = new Map<string, typeof edges>();
    for (const e of edges) {
      const group = byOutcome.get(e.onOutcome) || [];
      group.push(e);
      byOutcome.set(e.onOutcome, group);
    }
    for (const [outcomeKey, group] of byOutcome.entries()) {
      const hasConditioned = group.some((e) => e.condition !== null && e.condition !== 'default');
      const hasFallback = group.some((e) => e.condition === null || e.condition === 'default');
      if (hasConditioned && !hasFallback) {
        errors.push(
          `节点 [${fromId}] 在触发 [${outcomeKey}] 上配置了条件分支，但缺少 condition: null 的兜底连线`
        );
      }
    }
  }

  // 4. 从 startNodeId 做 BFS 可达性与循环检测
  const visited = new Set<string>();
  const queue: string[] = clipIds.has(prd.startNodeId) ? [prd.startNodeId] : [];
  let hasLoop = false;
  const activeStack = new Set<string>();
  const permDone = new Set<string>();

  function dfsLoop(u: string) {
    if (permDone.has(u)) return;
    activeStack.add(u);
    for (const e of outgoingByFrom.get(u) || []) {
      if (activeStack.has(e.to)) hasLoop = true;
      else if (allNodeIds.has(e.to)) dfsLoop(e.to);
    }
    activeStack.delete(u);
    permDone.add(u);
  }
  if (clipIds.has(prd.startNodeId)) dfsLoop(prd.startNodeId);

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (visited.has(curr)) continue;
    visited.add(curr);
    for (const e of outgoingByFrom.get(curr) || []) {
      if (allNodeIds.has(e.to) && !visited.has(e.to)) {
        queue.push(e.to);
      }
    }
  }

  for (const id of allNodeIds) {
    if (!visited.has(id)) {
      errors.push(`节点 [${id}] 从起点 [${prd.startNodeId}] 不可达（孤岛节点）`);
    }
  }

  // 5. 真分叉度量与伪分叉拦截
  let branchCount = 0;
  let divergentCount = 0;
  for (const iid of interactionIds) {
    const inter = prd.interactions.find((i) => i.id === iid);
    if (!inter || inter.kind.toUpperCase() !== 'CHOICE') continue;
    branchCount++;
    const distinctTargets = new Set(
      (outgoingByFrom.get(iid) || []).map((e) => e.to)
    );
    if (distinctTargets.size >= 2) divergentCount++;
  }

  const reachableEndings = [...endingIds].filter((id) => visited.has(id)).length;
  if (branchCount > 0 && divergentCount === 0 && reachableEndings <= 1 && !hasLoop) {
    errors.push('伪分叉：所有抉择分支最终都汇流到同一路径，既没有不同结局也没有循环');
  }
  if (prd.clips.length >= 2 && branchCount === 0 && !hasLoop) {
    warnings.push('全剧未配置抉择切口，玩家处于单线顺序观看状态');
  }

  // 6. 数值阈值可达性静态校验（单局每个互动节点最多累加一次：幂等上界估算）
  const numericBounds = new Map<string, { min: number; max: number }>();
  for (const [k, v] of Object.entries(prd.initialState || {})) {
    if (typeof v === 'number') {
      numericBounds.set(k, { min: v, max: v });
    }
  }
  for (const inter of prd.interactions) {
    if (!visited.has(inter.id)) continue;
    const perKeyDelta = new Map<string, { minDelta: number; maxDelta: number; sets: number[] }>();
    for (const o of inter.outcomes) {
      if (o.stateChange?.add) {
        for (const [k, delta] of Object.entries(o.stateChange.add)) {
          const cur = perKeyDelta.get(k) || { minDelta: 0, maxDelta: 0, sets: [] };
          cur.minDelta = Math.min(cur.minDelta, delta);
          cur.maxDelta = Math.max(cur.maxDelta, delta);
          perKeyDelta.set(k, cur);
        }
      }
      if (o.stateChange?.set) {
        for (const [k, val] of Object.entries(o.stateChange.set)) {
          if (typeof val === 'number') {
            const cur = perKeyDelta.get(k) || { minDelta: 0, maxDelta: 0, sets: [] };
            cur.sets.push(val);
            perKeyDelta.set(k, cur);
          }
        }
      }
    }
    for (const [k, d] of perKeyDelta.entries()) {
      const bound = numericBounds.get(k);
      if (!bound) continue;
      bound.min += d.minDelta;
      bound.max += d.maxDelta;
      for (const s of d.sets) {
        bound.min = Math.min(bound.min, s);
        bound.max = Math.max(bound.max, s);
      }
    }
  }

  for (const edge of prd.wiring) {
    if (!edge.condition || edge.condition === 'default') continue;
    const { reachable, relevantBoundsSummary } = isConditionExprReachable(
      edge.condition,
      numericBounds
    );
    if (!reachable) {
      errors.push(
        `条件不可达（死局）：连线 [${edge.from} -> ${edge.to}] 条件 "${edge.condition}" 在全剧理论可达范围 (${relevantBoundsSummary || '逻辑冲突'}) 内恒不成立`
      );
    }
  }

  // 7. story.md 片段编号与 prd.clips 1:1 对齐校验
  if (storyMarkdown) {
    const storyIds = extractClipIdsFromStoryMarkdown(storyMarkdown);
    const storySet = new Set(storyIds);
    for (const cid of clipIds) {
      if (!storySet.has(cid)) {
        errors.push(`prd.md 中的视频片段 [${cid}] 在 story.md 中缺失对应章节`);
      }
    }
    for (const sid of storySet) {
      if (!clipIds.has(sid)) {
        errors.push(`story.md 中的章节 [${sid}] 在 prd.md 的 clips 清单中未定义`);
      }
    }
  }

  // 8. prd.md 内嵌 JSON 可解析校验
  if (prdMarkdown) {
    const parsedJson = parsePrdEmbeddedJson(prdMarkdown);
    if (!parsedJson.ok) {
      errors.push(parsedJson.error);
    }
  }

  // 9. 通用流外状态分化度与必经节点反向代价告警（100% 数学/图论判定，零硬编码）
  const mutatedKeys = new Set<string>();
  const condReferencedVars = new Set<string>();
  const distinctBoolValues = new Map<string, Set<boolean>>();
  const condNeedsIncrease = new Set<string>();
  const condNeedsDecrease = new Set<string>();

  for (const [k, v] of Object.entries(prd.initialState || {})) {
    if (typeof v === 'boolean') {
      distinctBoolValues.set(k, new Set([v]));
    }
  }

  for (const inter of prd.interactions) {
    if (!visited.has(inter.id)) continue;
    for (const o of inter.outcomes) {
      if (o.stateChange?.add) {
        for (const k of Object.keys(o.stateChange.add)) mutatedKeys.add(k);
      }
      if (o.stateChange?.set) {
        for (const [k, val] of Object.entries(o.stateChange.set)) {
          mutatedKeys.add(k);
          if (typeof val === 'boolean') {
            const setVals = distinctBoolValues.get(k) || new Set<boolean>();
            setVals.add(val);
            distinctBoolValues.set(k, setVals);
          }
        }
      }
    }
  }

  for (const edge of prd.wiring) {
    if (!edge.condition || edge.condition === 'default') continue;
    for (const id of extractConditionIdentifiers(edge.condition)) {
      condReferencedVars.add(id);
    }
    const ast = parseConditionAst(edge.condition);
    if (!ast) continue;
    for (const clause of toDnfClauses(ast)) {
      for (const atom of clause) {
        if (atom.kind !== 'num') continue;
        if (atom.op === '>=' || atom.op === '>') condNeedsIncrease.add(atom.varName);
        if (atom.op === '<=' || atom.op === '<') condNeedsDecrease.add(atom.varName);
      }
    }
  }

  for (const [k, initVal] of Object.entries(prd.initialState || {})) {
    if (!mutatedKeys.has(k) && !condReferencedVars.has(k)) {
      warnings.push(`流外状态 [${k}] 已在 initialState 声明，但全剧既未被修改也未参与条件判断（空转状态）`);
    } else if (typeof initVal === 'boolean' && (distinctBoolValues.get(k)?.size ?? 1) <= 1) {
      warnings.push(`布尔旗标 [${k}] 全剧始终保持 ${String(initVal)}，未在不同分支中产生真假分化`);
    } else if (mutatedKeys.has(k) && !condReferencedVars.has(k)) {
      warnings.push(`流外状态 [${k}] 虽被 stateChange 修改，但全剧从未被任何 wiring condition 读取判别（只写不读空转）`);
    }
  }

  // 同源同一 (from, onOutcome) 组内若仅靠条件同时连向 isVictory: true 与 false，提示检查视觉情绪兼容性
  const endingMapById = new Map(prd.endings.map((e) => [e.id, e]));
  const outcomeGroups = new Map<string, typeof prd.wiring>();
  for (const edge of prd.wiring) {
    const gk = `${edge.from}\u0000${edge.onOutcome}`;
    const list = outcomeGroups.get(gk) || [];
    list.push(edge);
    outcomeGroups.set(gk, list);
  }
  for (const [gk, edges] of outcomeGroups.entries()) {
    let hasWin = false;
    let hasLose = false;
    for (const e of edges) {
      const endNode = endingMapById.get(e.to);
      if (!endNode) continue;
      if (endNode.isVictory) hasWin = true;
      else hasLose = true;
    }
    if (hasWin && hasLose) {
      const [fromId, outcomeKey] = gk.split('\u0000');
      warnings.push(
        `同源出口 [${fromId} (${outcomeKey})] 仅靠状态条件同时连向胜利 (isVictory: true) 与失败 (isVictory: false) 结局，请确认该片段画面情绪能否兼容两极结算`
      );
    }
  }

  for (const inter of prd.interactions) {
    if (!visited.has(inter.id)) continue;
    const isMandatorySingleOutcome = inter.timeoutSec === null && inter.outcomes.length === 1;
    if (!isMandatorySingleOutcome) continue;
    const onlyOutcome = inter.outcomes[0];
    for (const [v, delta] of Object.entries(onlyOutcome.stateChange?.add || {})) {
      const onlyUp = condNeedsIncrease.has(v) && !condNeedsDecrease.has(v);
      const onlyDown = condNeedsDecrease.has(v) && !condNeedsIncrease.has(v);
      if ((onlyUp && delta < 0) || (onlyDown && delta > 0)) {
        warnings.push(
          `必经单出口互动 [${inter.id}] 对 [${v}] 施加了与结局门槛反向的变动 (${delta > 0 ? '+' : ''}${delta})，可能挤压玩家容错`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metrics: {
      totalBeats: prd.clips.length,
      branchCount,
      midStoryForkCount: divergentCount,
      finaleForkCount: reachableEndings > 1 ? 1 : 0,
      endingCount: reachableEndings,
      hasLoop,
    },
  };
}

/**
 * 针对 GDD 节拍骨架与微观节点进行图论一致性静态校验
 */
export function validateGddTopology(gdd: GDDArtifact): TopologyValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const metrics: TopologyValidationMetrics = {
    totalBeats: gdd.beatOutline?.length || 0,
    branchCount: 0,
    midStoryForkCount: 0,
    finaleForkCount: 0,
    endingCount: 0,
    hasLoop: false,
  };

  if (!gdd.title || gdd.title.trim() === '') {
    errors.push('作品标题 (title) 不得为空');
  }

  if (!gdd.characters || gdd.characters.length < 1) {
    errors.push('角色列表 (characters) 至少需要 1 位核心角色或实体');
  }

  if (gdd.beatOutline && gdd.beatOutline.length === 1) {
    errors.push('节拍骨架 (beatOutline) 至少需要 2 个节拍才能构成完整的叙事弧线');
  }

  if (gdd.beatOutline && gdd.beatOutline.length > 0) {
    const beatMap = new Map<string, NarrativeBeat>();
    for (const beat of gdd.beatOutline) {
      if (beatMap.has(beat.beatId)) {
        errors.push(`存在重复的节拍 ID: [${beat.beatId}]`);
      }
      beatMap.set(beat.beatId, beat);
    }

    let branchyBeatCount = 0;
    let divergentBeatCount = 0;
    let missingGameplayTaskCount = 0;

    for (const beat of gdd.beatOutline) {
      if (beat.isEnding || !beat.branchExpectations || beat.branchExpectations.length === 0) {
        metrics.endingCount++;
      } else {
        if (beat.branchExpectations.length >= 2) {
          branchyBeatCount++;
          const distinctTargets = new Set(
            beat.branchExpectations.map((b) => b.targetBeatId).filter(Boolean)
          );
          if (distinctTargets.size >= 2) {
            divergentBeatCount++;
            const nonEndingTargets = [...distinctTargets].filter((id) => {
              const target = beatMap.get(id);
              return target ? !target.isEnding : false;
            });
            if (nonEndingTargets.length >= 2) {
              metrics.midStoryForkCount++;
            } else if (nonEndingTargets.length === 0) {
              metrics.finaleForkCount++;
            }
          }
        }
        for (const branch of beat.branchExpectations) {
          if (!beatMap.has(branch.targetBeatId)) {
            errors.push(
              `节拍 [${beat.beatId}] 引用的目标节拍不存在: [${branch.targetBeatId}]`
            );
          }
          if (branch.isLoopBack) {
            metrics.hasLoop = true;
          }
        }
      }

      if (!beat.gameplayTask || beat.gameplayTask.trim() === '') {
        missingGameplayTaskCount++;
      }
    }

    metrics.branchCount = branchyBeatCount;

    if (metrics.endingCount === 0 && !metrics.hasLoop) {
      errors.push('节拍骨架中缺少终局收束节拍或回溯循环结构');
    }

    if (branchyBeatCount > 0 && divergentBeatCount === 0) {
      errors.push(
        '伪分叉：所有多分支节拍的分支最终都汇流到同一个目标节拍，分支只改变了数值而没改变场景序列。' +
          '至少一处非终局节拍的分支必须指向 ≥2 个不同的目标节拍（纺锤形：分开各走 1~2 拍后再汇流）'
      );
    }

    const startBeatId = gdd.beatOutline[0]?.beatId;
    const inboundBeatIds = new Set<string>();
    for (const beat of gdd.beatOutline) {
      for (const branch of beat.branchExpectations || []) {
        if (branch.targetBeatId) inboundBeatIds.add(branch.targetBeatId);
      }
    }
    for (const beat of gdd.beatOutline) {
      if (beat.beatId !== startBeatId && !inboundBeatIds.has(beat.beatId)) {
        errors.push(
          `节拍 [${beat.beatId}]（${beat.title}）没有任何入边，玩家永远到不了。请从上游节拍补一条分支指向它，或删除该节拍`
        );
      }
    }

    if (branchyBeatCount === 0 && !metrics.hasLoop) {
      warnings.push(
        '全剧没有任何非终局节拍具备真分叉（≥2 个流向不同后果的分支），互动性不足，玩家将处于纯线性观看状态'
      );
    }

    if (metrics.midStoryForkCount === 0 && metrics.finaleForkCount > 0 && !metrics.hasLoop) {
      warnings.push(
        `全剧只有终局一处抉择：${metrics.finaleForkCount} 处分叉的支路全部直接通向结局，玩家在到达终局之前没有任何改变走向的选择（哑铃形）。`
      );
    }

    if (missingGameplayTaskCount > 0) {
      warnings.push(
        `${missingGameplayTaskCount} 个节拍缺少玩法任务 (gameplayTask)，策划案必须先回答"玩家在这一拍玩什么"`
      );
    }
  }

  if (gdd.flowchartNodes && gdd.flowchartNodes.length > 0) {
    const nodeMap = new Map<string, z.infer<typeof PlannerNodeSchema>>();
    for (const node of gdd.flowchartNodes) {
      if (nodeMap.has(node.nodeId)) {
        errors.push(`存在重复的节点 ID: [${node.nodeId}]`);
      }
      nodeMap.set(node.nodeId, node);
    }

    let endingNodeCount = 0;
    let hasLoopBack = false;

    for (const node of gdd.flowchartNodes) {
      if (!node.choices || node.choices.length === 0) {
        endingNodeCount++;
      } else {
        for (const choice of node.choices) {
          if (!nodeMap.has(choice.nextNodeId)) {
            errors.push(
              `节点 [${node.nodeId}] 的选项 [${choice.choiceId}] 引用了不存在的跳转节点: [${choice.nextNodeId}]`
            );
          }
          if (choice.isLoopBack) hasLoopBack = true;
        }
      }
    }

    if (endingNodeCount === 0 && !hasLoopBack) {
      errors.push('流程树中缺少终止/结局节点');
    }
  }

  if (
    (!gdd.beatOutline || gdd.beatOutline.length === 0) &&
    (!gdd.flowchartNodes || gdd.flowchartNodes.length === 0)
  ) {
    errors.push('策划案必须包含三幕节拍骨架 (beatOutline) 或流程节点 (flowchartNodes)');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metrics,
  };
}

export const validateGdd = validateGddTopology;

/**
 * 通用剧情接戏与分支均衡告警（零硬编码，纯文本重播与比例度量）
 */
export function collectStoryContinuityWarnings(
  clips: TopologyValidationInput['clips'] = [],
  branches: TopologyValidationInput['branches'] = []
): string[] {
  const warnings: string[] = [];
  if (!clips.length || !branches.length) return warnings;

  const rejoinBranches = branches.filter((b) => b.resolutionType === 'REJOIN');
  const endingBranches = branches.filter((b) => b.resolutionType === 'ENDING');
  if (
    branches.length >= 4 &&
    endingBranches.length <= 1 &&
    rejoinBranches.length / branches.length > 0.75
  ) {
    warnings.push(
      `全剧 ${branches.length} 条分支中有 ${rejoinBranches.length} 条走 REJOIN 合流且仅 ${endingBranches.length} 条独立结局，前中段分流后果感可能偏弱`
    );
  }

  const normalizeText = (s: string) =>
    s.replace(/[\s，。！？、；：“”"'‘’（）()—…\-,.!?;:]/g, '');
  const splitSentences = (s: string) =>
    s
      .split(/[\r\n。！？!?]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  const extractQuotes = (s: string) => {
    const out: string[] = [];
    for (const m of s.matchAll(/[“"]([^”"\r\n]{6,})[”"]/g)) {
      if (m[1]) out.push(normalizeText(m[1]));
    }
    return out;
  };

  const clipMap = new Map(clips.map((c) => [c.clipId, c]));
  for (const b of rejoinBranches) {
    if (!b.targetClipId) continue;
    const target = clipMap.get(b.targetClipId);
    if (!target) continue;

    const tailSentences = splitSentences(b.narrativeText || '').slice(-2);
    const headSentences = splitSentences(target.narrativeText || '').slice(0, 2);
    if (tailSentences.length === 0 || headSentences.length === 0) continue;

    let duplicateSnippet: string | null = null;
    const tailQuotes = extractQuotes(tailSentences.join(' '));
    const headQuotes = new Set(extractQuotes(headSentences.join(' ')));
    for (const q of tailQuotes) {
      if (q.length >= 6 && headQuotes.has(q)) {
        duplicateSnippet = q;
        break;
      }
    }

    if (!duplicateSnippet) {
      for (const ts of tailSentences) {
        const nTail = normalizeText(ts);
        if (nTail.length < 12) continue;
        for (const hs of headSentences) {
          const nHead = normalizeText(hs);
          if (nHead.length < 12) continue;
          if (nTail === nHead || nTail.includes(nHead) || nHead.includes(nTail)) {
            duplicateSnippet = hs.slice(0, 24);
            break;
          }
        }
        if (duplicateSnippet) break;
      }
    }

    if (duplicateSnippet) {
      warnings.push(
        `REJOIN 支线 [${b.cutId}] 结尾与目标主干 [${target.clipId}] 开头存在动作/台词重复演播风险（重叠：“${duplicateSnippet}”）`
      );
    }
  }

  return warnings;
}

/**
 * 针对流水线工序输入执行统一图论与通用 PRD 校验
 */
export function validatePipelineInputTopology(input: TopologyValidationInput): TopologyValidationResult {
  const continuityWarnings = collectStoryContinuityWarnings(input.clips || [], input.branches || []);

  if (input.prd) {
    const prdRes = validateUniversalPrdTopology({
      prd: input.prd,
      storyMarkdown: input.storyMarkdown,
      prdMarkdown: input.prdMarkdown,
    });
    if (!input.gdd) {
      return {
        ...prdRes,
        warnings: [...new Set([...prdRes.warnings, ...continuityWarnings])],
      };
    }

    const gddRes = validateGddTopology(input.gdd);
    return {
      valid: prdRes.valid && gddRes.valid,
      errors: [...new Set([...prdRes.errors, ...gddRes.errors])],
      warnings: [...new Set([...prdRes.warnings, ...gddRes.warnings, ...continuityWarnings])],
      metrics: prdRes.metrics,
    };
  }

  if (input.gdd) {
    const gddRes = validateGddTopology(input.gdd);
    return {
      ...gddRes,
      warnings: [...new Set([...gddRes.warnings, ...continuityWarnings])],
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [...continuityWarnings];

  const clips = input.clips || [];
  const branches = input.branches || [];
  const endingBranches = branches.filter((b) => b.resolutionType === 'ENDING');
  const rejoinBranches = branches.filter((b) => b.resolutionType === 'REJOIN');

  const metrics: TopologyValidationMetrics = {
    totalBeats: clips.length + branches.length,
    branchCount: clips.filter((c) => c.interaction?.category === 'CHOICE').length,
    midStoryForkCount: rejoinBranches.length,
    finaleForkCount: endingBranches.length,
    endingCount: endingBranches.length + clips.filter((c) => Boolean(c.isEnding)).length,
    hasLoop: false,
  };

  if (!input.title || input.title.trim() === '') {
    errors.push('作品标题 (title) 不得为空');
  }

  if (clips.length < 2) {
    errors.push('主干切片 (clips) 至少需要 2 幕才能构成起承转合');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metrics,
  };
}
