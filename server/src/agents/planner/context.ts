import { ProjectStore } from '../../project-store/ProjectStore.js';
import { resolveProjectStorySource } from '../../project-store/story-source.js';

export type PlannerPhase = 'STEP_1_PENDING' | 'STAGE_1_COMPLETED';

function buildScreenplaySummary(screenplay?: string | null): string {
  if (!screenplay || screenplay.trim().length <= 100) return '尚未生成剧本正文';
  const trimmed = screenplay.trim();
  const head = trimmed.slice(0, 700).trim();
  const tail = trimmed.length > 1000 ? `\n...\n${trimmed.slice(-260).trim()}` : '';
  return `已产出剧本正文（共约 ${trimmed.length} 字）。内容摘录：\n"""\n${head}${tail}\n"""`;
}

function buildTopologySummary(storySource: any): string {
  if (!storySource || !(storySource.clips?.length > 0)) {
    return '';
  }
  const clips: any[] = storySource.clips || [];
  const interactions: any[] = storySource.interactions || [];
  const endings: any[] = storySource.endings || [];

  const lines: string[] = [];
  const titlePart = storySource.title || storySource.gameTitle ? `《${storySource.title || storySource.gameTitle}》` : '';
  const genrePart = storySource.genre ? `（${storySource.genre}）` : '';
  lines.push(
    `已收敛结构化分幕与因果拓扑${titlePart}${genrePart}：共 ${clips.length} 个分幕片段、${interactions.length} 个互动节点、${endings.length} 个结局。`
  );

  if (clips.length > 0) {
    const clipList = clips
      .slice(0, 12)
      .map((c: any) => `${c.id}(${c.title || c.id})`)
      .join('、');
    lines.push(`- 分幕片段：${clipList}${clips.length > 12 ? ` 等 ${clips.length} 项` : ''}`);
  }

  if (endings.length > 0) {
    const endingList = endings
      .slice(0, 6)
      .map((e: any) => `[${e.endingType || 'BE'}] ${e.title || e.id}`)
      .join('；');
    lines.push(`- 分支结局：${endingList}`);
  }

  return lines.join('\n');
}

export function evaluatePlannerPhase(projectId: string): {
  phase: PlannerPhase;
  hasScreenplay: boolean;
  screenplaySummary: string;
  topologySummary: string;
} {
  const store = ProjectStore.getInstance();
  const screenplay = store.getArtifact<string>(projectId, 'screenplay');
  const storySource = resolveProjectStorySource(projectId);
  const hasScreenplay = Boolean((screenplay && screenplay.trim().length > 100) || (storySource?.clips?.length > 0));

  const phase: PlannerPhase = hasScreenplay ? 'STAGE_1_COMPLETED' : 'STEP_1_PENDING';

  return {
    phase,
    hasScreenplay,
    screenplaySummary: buildScreenplaySummary(screenplay || storySource?.scriptMarkdown),
    topologySummary: buildTopologySummary(storySource),
  };
}
