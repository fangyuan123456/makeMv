/**
 * agents/director/modifier/stage-directives.ts
 * 阶段待办指令：产物还没生成时，先把创作者的要求记在「那一步」上
 *
 * ── 为什么需要 ──
 * 改一句台词会把下游的关键帧清退。创作者同一句话里还说了「关键帧光影调暗」——
 * 此时没有关键帧可改，现在重新生成也不对（分镜还没重跑，生成必然缺上游）。
 * 唯一正确的时机是「关键帧下一次被生成的时候」，所以要求必须能挂在那一步上等着。
 *
 * ── 怎么消费 ──
 * 生成轨的执行器（generator/register.ts）在这条工序真正开跑前取一次，
 * 拼进 inputData.feedback——也就是各工序 prompt 已经在用的那段创作者原话。
 * 生成成功后再清掉；失败则原样留着，下次重试仍然带上。
 *
 * 这样「第二个源头」既不会被丢掉，也不会被提前执行：它变成一条挂在目标工序上的
 * 待办，等那一步自然到来。
 */

import { ProjectStore } from '../../../project-store/ProjectStore.js';

export interface StageDirective {
  /** 创作者原话（某个分句） */
  text: string;
  createdAt: string;
  /** 来源：哪一单提出的，便于回溯 */
  source?: string;
}

type DirectiveMap = Record<string, StageDirective[]>;

function readMap(project: any): DirectiveMap {
  const raw = project?.meta?.stageDirectives;
  if (!raw || typeof raw !== 'object') return {};
  const out: DirectiveMap = {};
  for (const [stage, list] of Object.entries(raw as DirectiveMap)) {
    if (Array.isArray(list)) out[stage] = list.filter((d) => d && typeof d.text === 'string' && d.text.trim());
  }
  return out;
}

/** 记一条待办：同一阶段同一句话只留一条（连点两次不该生成两次） */
export function addStageDirective(
  projectId: string,
  stage: string,
  text: string,
  source?: string
): boolean {
  const trimmed = (text || '').trim();
  if (!stage || !trimmed) return false;

  const store = ProjectStore.getInstance();
  const project: any = store.getProject(projectId);
  if (!project) return false;

  const map = readMap(project);
  const list = map[stage] || [];
  if (list.some((d) => d.text.trim() === trimmed)) return false;

  list.push({ text: trimmed, createdAt: new Date().toISOString(), source });
  map[stage] = list;

  project.meta = { ...(project.meta || {}), stageDirectives: map };
  project.updatedAt = new Date().toISOString();
  store.saveProject(project);
  return true;
}

/** 读取该阶段挂着的待办（不清除：生成失败时要留着下次重试） */
export function peekStageDirectives(projectId: string, stage: string): StageDirective[] {
  const project: any = ProjectStore.getInstance().getProject(projectId);
  if (!project || !stage) return [];
  return readMap(project)[stage] || [];
}

/** 生成成功后清除该阶段的待办 */
export function clearStageDirectives(projectId: string, stage: string): void {
  const store = ProjectStore.getInstance();
  const project: any = store.getProject(projectId);
  if (!project || !stage) return;

  const map = readMap(project);
  if (!map[stage]?.length) return;

  delete map[stage];
  project.meta = { ...(project.meta || {}), stageDirectives: map };
  project.updatedAt = new Date().toISOString();
  store.saveProject(project);
}
