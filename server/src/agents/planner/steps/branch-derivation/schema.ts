/**
 * agents/planner/steps/branch-derivation/schema.ts
 * 分支剧本推演工序契约 (Branch Derivation Schema SSOT)
 *
 * 核心哲学：
 * 纯粹认知计算，零 projectId 基础设施污染！
 * 纯图元拓扑流转：输入主干 clips ➔ 拓扑优先推演 ➔ 输出结构化 branches 数组。
 * 附纯代码 Markdown 格式化器供人类审查。
 */

import { z } from 'zod';
import { SlicedClipNodeSchema } from '../interaction-slicing/schema.js';

export const DerivedBranchNodeSchema = z.object({
  cutId: z.string().describe('对应的分支切口及支线片段唯一标识，统一使用 S1.1, S2.1...'),
  sourceClipId: z.string().describe('发源的片段标识，如 S1'),
  level: z.number().describe('拓扑层级 n'),
  choiceText: z.string().describe('触发该分支的玩家选项文本'),
  branchTitle: z.string().describe('分支剧情标题'),
  narrativeText: z.string().describe('300~500字文学剧情正文，立足当下剧情现场，严禁多年后快进，冲突饱满且结尾自然停顿'),
  resolutionType: z.enum(['ENDING', 'REJOIN']).describe('收敛类型：ENDING=独立结局; REJOIN=在前提完全自洽下付出代价接回主干片段'),
  targetClipId: z.string().optional().describe('当 REJOIN 时，必须指向前提不矛盾的下游合法片段标识，如 S3'),
  rejoinConsequence: z.string().optional().describe('当 REJOIN 时，描述以何种代价/状态无缝接回该主干片段'),
  endingType: z.enum(['BE', 'NE', 'SE']).optional().describe('当 ENDING 时，结局类型 (BE=悲剧死局, NE=遗憾残缺, SE=暗线反转)'),
  endingTitle: z.string().optional().describe('当 ENDING 时，结局名称，如【BE：封坛之约】'),
  verdict: z.string().optional().describe('当 ENDING 时，充满戏剧张力与哲思的一句话命运判词'),
  rewindTargetClipId: z.string().optional().describe('当 ENDING 时，回溯返回重新抉择的片段标识'),
});

export type DerivedBranchNode = z.infer<typeof DerivedBranchNodeSchema>;

export const BranchDerivationInputSchema = z.object({
  title: z.string().describe('短剧中文标题'),
  clips: z.array(SlicedClipNodeSchema).describe('Step 2 产出的结构化视听演播片段清单'),
  spineScript: z.string().optional().describe('Step 1 产出的黄金主干剧本全文（供分支编剧 Agent 注入全剧记忆，防止失忆吃书、死人复活、捏造人物）'),
});

export const BranchDerivationOutputSchema = z.object({
  title: z.string().describe('短剧中文标题'),
  clips: z.array(SlicedClipNodeSchema).optional().describe('Step 2 产出的结构化视听演播片段清单'),
  branches: z.array(DerivedBranchNodeSchema).describe('推演出的完整分支结构列表'),
});

export type BranchDerivationInput = z.infer<typeof BranchDerivationInputSchema>;
export type BranchDerivationOutput = z.infer<typeof BranchDerivationOutputSchema>;

/**
 * 纯代码渲染器：0 token 开销、0 幻觉、100% 确定性拼装人类友好的 Markdown 分支台本
 */
export function formatBranchesToMarkdown(title: string, branches: DerivedBranchNode[]): string {
  const lines: string[] = [
    `# 《${title}》分支剧本与死局推演`,
    '',
    `> **支线推演总览**：共闭环推演 ${branches.length} 个分支切口（单层闭环无递归）`,
    `> **拓扑调度机制**：反向拓扑优先算法（Max-n Topological Priority Loop）`,
    '',
    '---',
    '',
  ];

  for (let i = 0; i < branches.length; i++) {
    const b = branches[i];
    lines.push(`## 🔀 分支 ${String(i + 1).padStart(2, '0')}：${b.branchTitle}（源自片段 ${b.sourceClipId}）`);
    lines.push(`- **触发选项**：${b.choiceText}`);
    lines.push(`- **归宿类型**：${b.resolutionType === 'REJOIN' ? '【殊途同归 · 绕回主线】' : `【独立终局 · ${b.endingType}】`}`);
    lines.push('');
    lines.push('### 📖【支线文学剧情正文】');
    lines.push(b.narrativeText);
    lines.push('');
    lines.push('### 🎬【去向承接或命运结算】');

    if (b.resolutionType === 'REJOIN') {
      lines.push(`👉 **【殊途同归 · 绕回主线】**：${b.rejoinConsequence || '付出相应代价'}，**无缝承接进入主线【${b.targetClipId || '下一幕'}】**！`);
    } else {
      lines.push(`🎬 **【终局达成】**：达成【${b.endingType} · ${b.endingTitle}】`);
      if (b.verdict) {
        lines.push(`- **命运判词**：“${b.verdict}”`);
      }
      lines.push(`- 🔄 **【时光倒流】**：点击返回【${b.rewindTargetClipId || b.sourceClipId}】，重新抉择！`);
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}
