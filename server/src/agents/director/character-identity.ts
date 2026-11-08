/**
 * agents/director/character-identity.ts
 * 角色稳定身份 (Character Identity SSOT)
 *
 * ── 为什么需要 ──
 * 角色名一直是跨产物的外键：故事圣经 characters[] ↔ 定妆 character_design.characters[]
 * ↔ 分镜 characterNames。它同时也是展示名。两个职责压在同一个字符串上，后果是：
 *   1. 改名即断链——故事圣经里的名字改了，定妆条目还停在旧名，事实查不到，
 *      下游再引用就落到「无事实」的降级路径；
 *   2. 同名即串味——两个角色同名（「影子」「影子」）或被包含（「影子」/「影子人」）时，
 *      按名字匹配只能取第一个，事实会张冠李戴，而且没有任何报错。
 *
 * ── 做法 ──
 * 给角色一个与显示名解耦的 characterId：
 *   - 在产物写入层统一补齐（生成 / 微调 / 就地修补 / 导入都走同一个口子，不会漏）；
 *   - 读取期先按 id 关联，id 缺失再回落 name（老项目零迁移也能跑）；
 *   - 改名只改 name，id 不动，关联天然不断。
 *
 * 这里只做「身份」，不做「事实」——事实仍然只在故事圣经里（见 character-facts.ts）。
 */

import { randomUUID } from 'crypto';

export const CHARACTER_ID_KEY = 'characterId';

/** 新角色身份：与名字无关，改名不影响 */
export function newCharacterId(): string {
  return `char_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

function hasId(value: any): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 故事圣经补 id（幂等）。已存在的一律不动，避免每次写盘都换身份。
 * @returns 本次新增的数量
 */
export function ensureBibleCharacterIds(bible: any): number {
  const list = Array.isArray(bible?.characters) ? bible.characters : [];
  let added = 0;
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    if (hasId(item[CHARACTER_ID_KEY])) continue;
    item[CHARACTER_ID_KEY] = newCharacterId();
    added++;
  }
  return added;
}

/**
 * 定妆条目继承故事圣经的角色身份（幂等）。
 *
 * 以下三种情况分开处理，别用一条「按名字改写 id」糊过去：
 *   - 条目已有 id 且圣经里存在同 id → 保留（常规路径，也是改名后仍能对上键的原因）；
 *   - 条目 id 在圣经里已不存在（圣经整份重生成过）→ 按名字认领圣经的新 id；
 *   - 条目没有 id → 按名字认领；认领不到就留空，读取期回落按名字匹配。
 *
 * @returns 本次补写/刷新的数量
 */
export function syncPortraitCharacterIds(bible: any, portrait: any): number {
  const items = Array.isArray(portrait?.characters) ? portrait.characters : [];
  const bibleChars = Array.isArray(bible?.characters) ? bible.characters : [];
  if (items.length === 0 || bibleChars.length === 0) return 0;

  const idsInBible = new Set(
    bibleChars.map((c: any) => c?.[CHARACTER_ID_KEY]).filter((id: any) => hasId(id))
  );

  let touched = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const currentId = item[CHARACTER_ID_KEY];
    if (hasId(currentId) && idsInBible.has(currentId)) continue;

    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) continue;
    const matched = bibleChars.find((c: any) => String(c?.name || '').trim() === name);
    if (!matched || !hasId(matched[CHARACTER_ID_KEY])) continue;

    item[CHARACTER_ID_KEY] = matched[CHARACTER_ID_KEY];
    touched++;
  }
  return touched;
}

/**
 * 产物写入前的统一身份补齐。
 *
 * 放在存储层而不是各个生成器里，是因为写产物的入口太散（生成轨 / 微调轨 /
 * repairArtifact / 存量导入），只有收在一处才不会出现「某条路径漏补 id，
 * 于是那条路径改完名字就断链」。
 *
 * @param stageArtifacts 项目当前的全部产物（写入前的快照）
 * @param stage          本次要写的阶段键
 * @param artifact       本次要写入的产物（原地补齐）
 */
export function applyCharacterIdentity(
  stageArtifacts: Record<string, any> | undefined,
  stage: string,
  artifact: any
): void {
  if (!artifact || typeof artifact !== 'object') return;
  if (stage === 'narrative_design') {
    ensureBibleCharacterIds(artifact);
    return;
  }
  if (stage === 'character_design') {
    const bible = stageArtifacts?.['narrative_design'];
    syncPortraitCharacterIds(bible, artifact);
  }
}
