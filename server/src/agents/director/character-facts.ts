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

/** 按角色名查单一角色事实（大小写不敏感，兼容「张明」与「张 明」等轻微差异） */
export function findCharacterFacts(
  project: ProjectLike | undefined | null,
  name: string | undefined
): CharacterFacts | undefined {
  if (!name) return undefined;
  const facts = readCharacterFacts(project);
  const key = normalize(name);
  return (
    facts.find((f) => normalize(f.name) === key) ||
    facts.find((f) => normalize(f.name).includes(key) || key.includes(normalize(f.name)))
  );
}

/**
 * 把视觉条目与事实源按 name 合并，返回只读视图。
 * 视觉字段（visualPrompt/imageUrl/history 等）永远以条目自身为准，事实字段永远以故事圣经为准。
 */
export function withCharacterFacts<T extends { name: string }>(
  project: ProjectLike | undefined | null,
  sheet: T
): T & Partial<CharacterFacts> & { factsFrom?: string } {
  const facts = findCharacterFacts(project, sheet.name);
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
