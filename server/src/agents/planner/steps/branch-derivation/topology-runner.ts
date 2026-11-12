/**
 * agents/planner/steps/branch-derivation/topology-runner.ts
 * 反向拓扑层级优先分支推演调度引擎 (Max-Depth Reverse Topological Derivation Runner)
 *
 * 核心设计：
 * 1. 优先队列 (Max-Heap on level n): 每次取出拓扑层级 n 最大的未处理切口；
 * 2. 单切口 100% 聚焦调用：专职编剧 Agent 逐个精雕细琢，彻底杜绝一锅炖偷懒；
 * 3. 刚性成功闭环判据：达成终局 (ENDING) 或 接上之前已处理好的节点 (REJOIN 且 targetClipId ∈ S_resolved) 即为成功！
 * 4. 纯强类型图流转：0 正则匹配，0 字符串猜测。
 */

import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { SlicedClipNode } from '../interaction-slicing/schema.js';
import {
  type DerivedBranchNode,
  DerivedBranchNodeSchema,
} from './schema.js';
import {
  buildSingleBranchUserPrompt,
} from './prompt.js';

const SingleBranchStructuredOutputSchema = z.object({
  branchTitle: z.string().describe('分支剧情标题'),
  narrativeText: z.string().describe('300~500字支线文学剧情正文，立足当下现场，严禁多年后快进'),
  resolutionType: z.enum(['ENDING', 'REJOIN']),
  targetClipId: z.string().optional(),
  rejoinConsequence: z.string().optional(),
  endingType: z.enum(['BE', 'NE', 'SE']).optional(),
  endingTitle: z.string().optional(),
  verdict: z.string().optional(),
  rewindTargetClipId: z.string().optional(),
});

interface QueueCut {
  cutId: string;
  sourceClipId: string;
  level: number;
  choiceText: string;
  conflictSummary?: string;
  sceneContext: string;
}

/**
 * 运行反向拓扑优先调度推演
 */
export async function runTopologyBranchDerivation(
  title: string,
  clips: SlicedClipNode[],
  agent: Agent,
  spineScript: string = ''
): Promise<DerivedBranchNode[]> {
  // 1. 初始化已收敛集合 S_resolved：仅主干片段允许作为 REJOIN 合流目标，防止误指其他支线引起跳线撕裂
  const mainlineIds = new Set(clips.map((c) => c.clipId));
  const clipById = new Map(clips.map((c) => [c.clipId, c]));
  const resolvedMap = new Map<string, { clipId: string; title: string; level: number; isEnding?: boolean }>();
  for (const c of clips) {
    resolvedMap.set(c.clipId, {
      clipId: c.clipId,
      title: c.title,
      level: c.level,
      isEnding: c.isEnding,
    });
  }

  // 2. 收集所有 CHOICE 切口入队 Q_unprocessed（ACTION 单线互动点不生支线，保留在 resolvedMap 供 REJOIN）
  const queue: QueueCut[] = [];
  for (const c of clips) {
    if (!c.isEnding && c.interaction?.category === 'CHOICE') {
      queue.push({
        cutId: c.interaction.cutId || `${c.clipId}.1`,
        sourceClipId: c.clipId,
        level: c.level,
        choiceText: c.interaction.branchChoice || c.interaction.conflictSummary || '分支抉择',
        conflictSummary: c.interaction.conflictSummary,
        sceneContext: c.narrativeText,
      });
    }
  }
  const totalCuts = queue.length;

  const resolvedBranches: DerivedBranchNode[] = [];
  let iterations = 0;
  const MAX_ITERATIONS = Math.max(10, queue.length * 3);

  // 3. 核心优先队列调度循环
  while (queue.length > 0 && iterations < MAX_ITERATIONS) {
    iterations++;

    // 核心算法：严格按拓扑层级 level (n) 降序排序，永远弹出 n 最大的切口！
    queue.sort((a, b) => b.level - a.level);
    const currentCut = queue.shift()!;

    // 筛选下游已处理好的合法主干落点：
    // 严格限定只允许 REJOIN 至下游非终局主干片段（禁止互指支线或直连大结局），并附带目标首段前情供无缝接戏
    const finaleClipId = clips[clips.length - 1]?.clipId;
    const availableTargets = Array.from(resolvedMap.values())
      .filter(
        (t) =>
          mainlineIds.has(t.clipId) &&
          t.level > currentCut.level &&
          t.clipId !== currentCut.sourceClipId &&
          !t.isEnding &&
          t.clipId !== finaleClipId
      )
      .sort((a, b) => a.level - b.level)
      .map((t) => ({
        ...t,
        openingPreview: (clipById.get(t.clipId)?.narrativeText || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 140),
      }));

    const rejoinCount = resolvedBranches.filter((b) => b.resolutionType === 'REJOIN').length;
    const endingCount = resolvedBranches.filter((b) => b.resolutionType === 'ENDING').length;

    // 单切口独立调用编剧 Agent，注入全剧主线剧本记忆防止失忆吃书
    const spineContext = spineScript.trim().length > 0
      ? `【全剧黄金主干剧本全文（请严格基于此全文记忆推演，严禁让已死亡角色复生，严禁捏造未出现的人物，所有角色姓名、生死状态与事件必须与此完全一致）】\n${
          spineScript.length > 3000 ? spineScript.slice(0, 3000) + '\n…（后略）' : spineScript
        }\n\n`
      : '';
    const prompt = spineContext + buildSingleBranchUserPrompt({
      cutId: currentCut.cutId,
      sourceClipId: currentCut.sourceClipId,
      level: currentCut.level,
      choiceText: currentCut.choiceText,
      conflictSummary: currentCut.conflictSummary,
      sceneContext: currentCut.sceneContext,
      availableResolvedTargets: availableTargets,
      branchStats: { rejoinCount, endingCount, totalCuts },
    });

    const response = await agent.generate(prompt, {
      output: SingleBranchStructuredOutputSchema,
    });

    const parsed = response.object || {
      branchTitle: '突发支线',
      narrativeText: (response as any).text || currentCut.choiceText,
      resolutionType: 'ENDING',
      endingType: 'BE',
      endingTitle: '未解的死局',
      verdict: '一念之差，陷入迷途。',
      rewindTargetClipId: currentCut.sourceClipId,
    };

    // 成功判据判定与规范化：
    let finalResolutionType = parsed.resolutionType;
    let finalTargetClipId = parsed.targetClipId;

    if (finalResolutionType === 'REJOIN') {
      // 判据 B：目标必须在可用非终局下游集合内
      const targetExists = finalTargetClipId && availableTargets.some((t) => t.clipId === finalTargetClipId);
      if (!targetExists) {
        // 如果给定的目标不合法，自动锚定到最近的合法非终局下游片段
        const fallbackTarget = availableTargets[0];
        if (fallbackTarget) {
          finalTargetClipId = fallbackTarget.clipId;
        } else {
          // 下游无可用非终局目标时，自动转为独立终局 NE
          finalResolutionType = 'ENDING';
          parsed.endingType = parsed.endingType || 'NE';
          parsed.endingTitle = parsed.endingTitle || '终局断点';
        }
      }
    }

    const derivedNode: DerivedBranchNode = {
      cutId: currentCut.cutId,
      sourceClipId: currentCut.sourceClipId,
      level: currentCut.level,
      choiceText: currentCut.choiceText,
      branchTitle: parsed.branchTitle,
      narrativeText: parsed.narrativeText,
      resolutionType: finalResolutionType,
      targetClipId: finalResolutionType === 'REJOIN' ? finalTargetClipId : undefined,
      rejoinConsequence: finalResolutionType === 'REJOIN' ? parsed.rejoinConsequence : undefined,
      endingType: finalResolutionType === 'ENDING' ? parsed.endingType || 'BE' : undefined,
      endingTitle: finalResolutionType === 'ENDING' ? parsed.endingTitle || '迷途终局' : undefined,
      verdict: finalResolutionType === 'ENDING' ? parsed.verdict || '一念之差，抱憾终身。' : undefined,
      rewindTargetClipId: finalResolutionType === 'ENDING' ? parsed.rewindTargetClipId || currentCut.sourceClipId : undefined,
    };

    // 标记成功！并入收敛集合 S_resolved
    resolvedBranches.push(derivedNode);
    resolvedMap.set(derivedNode.cutId, {
      clipId: derivedNode.cutId,
      title: derivedNode.branchTitle,
      level: currentCut.level,
      isEnding: finalResolutionType === 'ENDING',
    });
  }

  // 4. 按发源片段的 level 升序排列输出，方便阅读
  resolvedBranches.sort((a, b) => a.level - b.level);

  return resolvedBranches;
}
