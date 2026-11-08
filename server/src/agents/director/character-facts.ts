/**
 * agents/director/character-facts.ts
 * 角色事实唯一来源读取层 (Character Facts SSOT Reader)
 *
 * 铁律：角色的客观事实（身份/性别/年龄/外貌/性格/动机）只存在于【故事圣经】
 * (narrative_design.characters)。定妆产物 (character_design) 只持有视觉派生结果
 * (visualPrompt / imageUrl / history)，禁止复制事实字段。
 *
 * 为什么：同一份事实存在两处，改源头时另一处不会跟随，"改了设定下游没变"这类
 * 悬案就无解；也无法判断哪个才是定义、哪个只是派生。
 *
 * 本模块只做「读取期投影」——需要事实的消费方按 name 现查现用，绝不回写产物。
 */

/** 角色客观事实（来源：故事圣经 characters[]） */
export interface CharacterFacts {
  /** 稳定身份：与显示名解耦，改名不断链（老数据可能没有） */
  characterId?: string;
  name: string;
  role?: string;
  gender?: string;
  age?: number | string;
  appearance?: string;
  personality?: string;
  motivation?: string;
  arc?: string;
}

/** 只读投影标记：提示该字段不是产物自身持有，而是读取期从故事圣经合并 */
export const CHARACTER_FACTS_SOURCE = 'narrative_design.characters';

interface ProjectLike {
  stageArtifacts?: Record<string, any>;
}

/** 取项目内全部角色事实（故事圣经为准，缺失时返回空数组） */
export function readCharacterFacts(project: ProjectLike | undefined | null): CharacterFacts[] {
  const bible = project?.stageArtifacts?.narrative_design;
  const list = Array.isArray(bible?.characters) ? bible.characters : [];
  return list
    .filter((c: any) => c && typeof c.name === 'string' && c.name.length > 0)
    .map((c: any) => ({
      characterId: c.characterId,
      name: c.name,
      role: c.role,
      gender: c.gender,
      age: c.age,
      appearance: c.appearance,
      personality: c.personality,
      motivation: c.motivation,
      arc: c.arc,
    }));
}

/** 角色引用：优先用稳定 id，老数据只有名字 */
export interface CharacterRef {
  characterId?: string;
  name?: string;
}

function normalizeRef(ref: string | CharacterRef | undefined): CharacterRef {
  if (!ref) return {};
  return typeof ref === 'string' ? { name: ref } : ref;
}

/**
 * 按角色查单一角色事实。
 *
 * 关联顺序：稳定 id → 精确同名 → 唯一包含匹配。
 * 最后一步只在「有且仅有一个候选」时才认，绝不取第一个：
 * 两个角色都被同一个片段命中时，猜错比查不到更糟——错的性别年龄会被写进下游。
 */
export function findCharacterFacts(
  project: ProjectLike | undefined | null,
  ref: string | CharacterRef | undefined
): CharacterFacts | undefined {
  const { characterId, name } = normalizeRef(ref);
  if (!characterId && !name) return undefined;

  const facts = readCharacterFacts(project);
  if (characterId) {
    const byId = facts.find((f) => f.characterId === characterId);
    if (byId) return byId;
  }
  if (!name) return undefined;

  const key = normalize(name);
  const exact = facts.filter((f) => normalize(f.name) === key);
  // 同名多份同样无解：同名角色只有 characterId 能区分，按名字取第一个等于随机分配事实
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;

  if (key.length < 2) return undefined;
  const loose = facts.filter((f) => {
    const n = normalize(f.name);
    return n.includes(key) || key.includes(n);
  });
  return loose.length === 1 ? loose[0] : undefined;
}

/**
 * 把视觉条目与事实源按 id（缺失时按 name）合并，返回只读视图。
 * 视觉字段（visualPrompt/imageUrl/history 等）永远以条目自身为准，事实字段永远以故事圣经为准。
 */
export function withCharacterFacts<T extends { name: string; characterId?: string }>(
  project: ProjectLike | undefined | null,
  sheet: T
): T & Partial<CharacterFacts> & { factsFrom?: string } {
  const facts = findCharacterFacts(project, { characterId: sheet.characterId, name: sheet.name });
  if (!facts) return sheet;
  return { ...facts, ...sheet, factsFrom: CHARACTER_FACTS_SOURCE };
}

/**
 * 定妆产物只读投影：为每个条目补齐故事圣经事实。
 * 仅供 API 响应/展示层使用，禁止把返回值写回产物（那正是本次要消灭的冗余）。
 */
export function hydrateCharacterArtifact(
  project: ProjectLike | undefined | null,
  artifact: Record<string, any> | undefined
): Record<string, any> | undefined {
  if (!artifact || !Array.isArray(artifact.characters)) return artifact;
  return {
    ...artifact,
    characters: artifact.characters.map((c: any) =>
      c && typeof c.name === 'string' ? withCharacterFacts(project, c) : c
    ),
    factsFrom: CHARACTER_FACTS_SOURCE,
  };
}

/** 同上，直接取项目内的 character_design 产物 */
export function hydratePortraitArtifact(
  project: ProjectLike | undefined | null
): Record<string, any> | undefined {
  return hydrateCharacterArtifact(project, project?.stageArtifacts?.character_design);
}

function normalize(s: string): string {
  return String(s).replace(/\s+/g, '').toLowerCase();
}
