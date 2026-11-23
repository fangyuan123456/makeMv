import { ProjectStore } from '../../project-store/ProjectStore.js';
import { computeProjectStaleMap } from '../../project-store/freshness.js';

export type PlannerPhase = 'STEP_1_PENDING' | 'STEP_2_PENDING' | 'STAGE_1_COMPLETED';

function buildScreenplaySummary(screenplay?: string | null): string {
  if (!screenplay || screenplay.trim().length <= 100) return '尚未生成剧本正文';
  const trimmed = screenplay.trim();
  const head = trimmed.slice(0, 700).trim();
  const tail = trimmed.length > 1000 ? `\n...\n${trimmed.slice(-260).trim()}` : '';
  return `已产出剧本正文（共约 ${trimmed.length} 字）。内容摘录：\n"""\n${head}${tail}\n"""`;
}

function buildPrdSummary(prd: any): string {
  if (!prd || !(prd.clips?.length > 0 || prd.scenes?.length > 0)) {
    return '尚未拆解 PRD 拓扑';
  }
  const clips: any[] = prd.clips || prd.scenes || [];
  const interactions: any[] = prd.interactions || [];
  const endings: any[] = prd.endings || [];

  const lines: string[] = [];
  const titlePart = prd.gameTitle ? `《${prd.gameTitle}》` : '';
  const genrePart = prd.genre ? `（${prd.genre}）` : '';
  lines.push(
    `已收敛 Universal PRD 拓扑策划案${titlePart}${genrePart}：共 ${clips.length} 个分幕/分支片段、${interactions.length} 个关键抉择点、${endings.length} 个结局。`
  );

  if (clips.length > 0) {
    const clipList = clips
      .slice(0, 12)
      .map((c: any) => `${c.id}(${c.title || c.name || c.id})`)
      .join('、');
    lines.push(`- 分幕片段：${clipList}${clips.length > 12 ? ` 等 ${clips.length} 项` : ''}`);
  }

  if (interactions.length > 0) {
    const choiceList = interactions
      .slice(0, 6)
      .map((inter: any) => {
        const opts = (inter.outcomes || [])
          .map((o: any) => `${o.key}:${String(o.label || '').slice(0, 28)}`)
          .join(' / ');
        return `${inter.id}[${opts}]`;
      })
      .join('；');
    lines.push(`- 关键抉择：${choiceList}`);
  }

  if (endings.length > 0) {
    const endingList = endings
      .slice(0, 6)
      .map((e: any) => `[${e.endingType || (e.isVictory ? 'HE' : 'BE')}] ${e.title || e.id}：${String(e.summary || '').slice(0, 60)}`)
      .join('；');
    lines.push(`- 分支结局：${endingList}`);
  }

  return lines.join('\n');
}

export function evaluatePlannerPhase(projectId: string): {
  phase: PlannerPhase;
  hasScreenplay: boolean;
  hasPrd: boolean;
  screenplaySummary: string;
  prdSummary: string;
} {
  const store = ProjectStore.getInstance();
  const screenplay = store.getArtifact<string>(projectId, 'screenplay');
  const prd = store.getArtifact<any>(projectId, 'prd');
  const hasScreenplay = Boolean(screenplay && screenplay.trim().length > 100);
  const hasPrd = Boolean(prd && (prd.clips?.length > 0 || prd.scenes?.length > 0));
  const staleMap = computeProjectStaleMap(projectId);

  let phase: PlannerPhase = 'STEP_1_PENDING';
  if (hasScreenplay && (!hasPrd || Boolean(staleMap.prd))) phase = 'STEP_2_PENDING';
  else if (hasScreenplay && hasPrd) phase = 'STAGE_1_COMPLETED';

  return {
    phase,
    hasScreenplay,
    hasPrd,
    screenplaySummary: buildScreenplaySummary(screenplay),
    prdSummary: buildPrdSummary(prd),
  };
}
