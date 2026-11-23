import { z } from 'zod';
import { PremiseOutputSchema, type PremiseOutput } from './schema.js';

export interface BranchOutline {
  kind: 'scene' | 'ending';
  actNumber: number;
  summary: string;
  exitConditions: string[];
  endingType?: 'HE' | 'BE' | 'NE';
  branches?: { text: string; next: BranchOutline }[];
}

/** 有界嵌套结构不向模型提供跨路径目标 ID，从生成表示上消除任意合流。 */
export function buildBranchPremiseSchema(acts: number) {
  if (!Number.isInteger(acts) || acts < 2 || acts > 6) throw new Error('分幕数量须为 2 至 6');
  const endingSchema = z.object({
    kind: z.literal('ending'),
    actNumber: z.number().int().min(1).max(acts),
    endingType: z.enum(['HE', 'BE', 'NE']),
    summary: z.string().min(1).describe('只根据本路径经历写出的终局，不补回未救出的人或未获得的物品'),
    exitConditions: z.array(z.string()).describe('本路径结束时的人物、物品、信息状态'),
  });
  const scene = (level: number): z.ZodType<BranchOutline> => z.object({
    kind: z.literal('scene'),
    actNumber: z.number().int().min(1).max(acts).describe('所属幕次，与树深度独立，同一幕可有多个场景'),
    summary: z.string().min(1).describe('承接父选项的实际行动与直接后果，停在下一次决定之前'),
    exitConditions: z.array(z.string()).describe('本场结束时完整的当前事实：人物位置与存亡、道具持有人、已知信息'),
    branches: z.array(z.object({
      text: z.string().min(1).describe('从本场结束状态出发的行动；只有一条时作为自动续接'),
      next: level === acts * 2 ? endingSchema : z.union([endingSchema, scene(level + 1)]),
    })).min(level === 1 ? 2 : 1).max(3),
  });
  return PremiseOutputSchema.omit({ startNodeId: true, storyNodes: true, sourcePrompt: true }).extend({
    actOutlines: PremiseOutputSchema.shape.actOutlines.length(acts),
    root: scene(1).describe('分支剧情树，子节点只属于所在选项，不引用或复用其他路线'),
  });
}

export function compileBranchPremise(
  draft: Omit<PremiseOutput, 'startNodeId' | 'storyNodes'> & { root: BranchOutline },
  sourcePrompt: string,
): PremiseOutput {
  if (draft.actOutlines.some((act, i) => act.actNumber !== i + 1)) throw new Error('分幕必须按顺序从 1 编号');
  const storyNodes: PremiseOutput['storyNodes'] = [];
  const visit = (node: BranchOutline, id: string, inherited: string[]) => {
    const branches = node.branches || [];
    const targets = branches.map((_, i) => `${id}_${i + 1}`);
    storyNodes.push({
      id, actNumber: node.actNumber, kind: node.kind,
      summary: node.summary, entryConditions: [...inherited], exitConditions: node.exitConditions,
      endingType: node.endingType,
      choices: branches.length > 1 ? branches.map((b, i) => ({ text: b.text, targetNodeId: targets[i] })) : [],
      nextNodeId: branches.length === 1 ? targets[0] : undefined,
      continuationAction: branches.length === 1 ? branches[0].text : undefined,
    });
    branches.forEach((b, i) => visit(b.next, targets[i], node.exitConditions));
  };
  visit(draft.root, 'n1', []);
  const { root: _root, ...meta } = draft;
  return PremiseOutputSchema.parse({ ...meta, sourcePrompt, startNodeId: 'n1', storyNodes });
}
