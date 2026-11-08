/**
 * agents/director/modifier/invariants.ts
 * 修改轨语义不变量校验 (Modifier Invariants)
 *
 * ── 为什么需要 ──
 * 原子提交只能保证「JSON 合法」，保证不了「故事成立」。
 * 真实事故：把主角性别改为女性后，六个角色（含 10 岁儿子、妻子、反派）
 * 的 gender 全被改成「女」，JSON 完全合法、任务状态 succeeded、正文宣称已调整——
 * 一次「完全成功的错误」。
 *
 * 所以这里补的是「语义层」的两类硬约束：
 *   1. 引用存在性：任何按名字引用角色的地方，名字必须真的在 characters 里；
 *   2. 角色自洽：性别与角色定位/称谓不能互相矛盾。
 *
 * ── 分级原则（关键）──
 * 与「修改前基线」比对：
 *   - 基线里没有、修改后冒出来的 ⇒ 本次改出来的 ⇒ 落在改动文件内就 error（阻断）；
 *   - 基线里同样存在的 ⇒ 历史遗留 ⇒ 只记 warning，绝不阻断。
 * 否则一个历史脏项目会让之后每一次修改都被自己的旧数据挡住。
 *
 * 本模块是纯函数：不读盘、不写盘、不调模型，可直接单测。
 */

export type InvariantLevel = 'error' | 'warning';

export interface InvariantIssue {
  level: InvariantLevel;
  /** 机检码，用于日志聚合与单测断言，不面向创作者 */
  code: string;
  /** 面向创作者/模型的中文说明 */
  message: string;
  /** 违规所在的产物键（story-bible / scene-script / storyboard） */
  fileKey?: string;
  /** 违规所在的字段路径，如 characters[2].gender */
  path?: string;
  /** 涉事主体（角色名 / 说话人 / 节点 id），用于与基线做稳定比对 */
  subject?: string;
}

export interface InvariantFile {
  /** 产物键，与 TEXT_FILES 的 key 一致 */
  key: string;
  title: string;
  artifact: any;
}

export interface InvariantOptions {
  /** 本次改动涉及的产物键。新问题落在这些文件里才升级为 error */
  strictKeys?: string[];
  /**
   * 修改前的基线快照。
   * 传入后，基线里同样存在的违规一律降为 warning（历史遗留不阻断）。
   */
  baselineFiles?: InvariantFile[];
}

/** 未定级的原始违规 */
interface RawIssue {
  code: string;
  message: string;
  fileKey: string;
  path?: string;
  subject?: string;
}

/** 非角色的说话人：旁白/系统音不属于 characters，必须放行 */
const NON_CHARACTER_SPEAKERS = new Set([
  '旁白',
  '画外音',
  '画外',
  '系统',
  '系统音',
  'Narrator',
  'VO',
  'V.O.',
  'OS',
  'O.S.',
]);

function text(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 从自由文本读性别意图。
 * 产物里的性别常写成「男」「男性」「女」「Female」等，这里只做包含式判定；
 * 读不出来一律返回 undefined（不校验），避免误伤「未知」「其他」这类合法值。
 */
function readGender(raw: any): '男' | '女' | undefined {
  const value = text(raw);
  if (!value) return undefined;
  if (value.includes('男') || /^m(ale)?$/i.test(value)) return '男';
  if (value.includes('女') || /^f(emale)?$/i.test(value)) return '女';
  return undefined;
}

/** 角色定位里声称的性别（男主角 / 女一号 / 男配 …） */
function roleClaimsGender(role: string): '男' | '女' | undefined {
  const male = /男(主|一|配|性|人)/.test(role);
  const female = /女(主|一|配|性|人)/.test(role);
  if (male && !female) return '男';
  if (female && !male) return '女';
  return undefined;
}

/** 称呼里隐含的性别（妻子、儿子、父亲 …） */
function titleImpliesGender(name: string): '男' | '女' | undefined {
  const female = /妻子|夫人|女友|未婚妻|母亲|妈妈|女儿|姐妹|寡妇|儿媳|婆婆|岳母/.test(name);
  const male = /丈夫|先生|男友|未婚夫|父亲|爸爸|儿子|兄弟|鳏夫|女婿|公公|岳父/.test(name);
  if (female && !male) return '女';
  if (male && !female) return '男';
  return undefined;
}

/** 采集违规（不含定级） */
function collectIssues(files: InvariantFile[]): RawIssue[] {
  const issues: RawIssue[] = [];
  const push = (
    fileKey: string,
    code: string,
    message: string,
    path?: string,
    subject?: string
  ): void => {
    issues.push({ fileKey, code, message, path, subject });
  };

  const bible = files.find((f) => f.key === 'story-bible')?.artifact;
  if (!bible) return issues; // 没有故事圣经，角色类不变量无从校验

  const characters: any[] = Array.isArray(bible.characters) ? bible.characters : [];
  const characterNames = new Set(
    characters.map((c) => text(c?.name)).filter((n) => n.length > 0)
  );

  // ── R1：故事圣经内部的名字引用必须存在 ──
  const indexNames: any[] = Array.isArray(bible.characterNames) ? bible.characterNames : [];
  indexNames.forEach((raw, i) => {
    const name = text(raw);
    if (name && !characterNames.has(name)) {
      push(
        'story-bible',
        'dangling-character-ref',
        `角色索引 characterNames[${i}] 指向不存在的角色「${name}」`,
        `characterNames[${i}]`,
        name
      );
    }
  });

  const nodes: any[] = Array.isArray(bible.storyGraph?.nodes) ? bible.storyGraph.nodes : [];
  nodes.forEach((node, ni) => {
    const refs: any[] = Array.isArray(node?.characterNames) ? node.characterNames : [];
    refs.forEach((raw, ci) => {
      const name = text(raw);
      if (name && !characterNames.has(name)) {
        push(
          'story-bible',
          'dangling-character-ref',
          `剧情节点「${text(node?.title) || text(node?.id) || ni}」引用了不存在的角色「${name}」`,
          `storyGraph.nodes[${ni}].characterNames[${ci}]`,
          name
        );
      }
    });
  });

  // ── R2：角色自身的性别与定位/称谓自洽 ──
  characters.forEach((c, i) => {
    const name = text(c?.name);
    const gender = readGender(c?.gender);
    if (!name || !gender) return;

    const role = text(c?.role);
    const claimed = roleClaimsGender(role);
    if (claimed && claimed !== gender) {
      push(
        'story-bible',
        'role-gender-conflict',
        `角色「${name}」性别为${gender}，但角色定位仍是「${role}」——定位与性别自相矛盾，需同步改写`,
        `characters[${i}].role`,
        name
      );
    }

    const implied = titleImpliesGender(name);
    if (implied && implied !== gender) {
      push(
        'story-bible',
        'title-gender-conflict',
        `角色「${name}」从称谓看是${implied}，但性别为${gender}——若非有意设定，请确认是否应删除或改名`,
        `characters[${i}].gender`,
        name
      );
    }
  });

  // ── R3：剧本说话人必须存在于角色表 ──
  const script = files.find((f) => f.key === 'scene-script')?.artifact;
  const scenes: any[] = Array.isArray(script?.scenes) ? script.scenes : [];
  scenes.forEach((scene, si) => {
    const dialogues: any[] = Array.isArray(scene?.dialogues) ? scene.dialogues : [];
    dialogues.forEach((d, di) => {
      const speaker = text(d?.speaker);
      if (!speaker) return;
      if (NON_CHARACTER_SPEAKERS.has(speaker)) return;
      if (characterNames.has(speaker)) return;
      push(
        'scene-script',
        'dangling-speaker',
        `第 ${si + 1} 场「${text(scene?.sceneTitle) || ''}」的台词说话人「${speaker}」不在角色表里`,
        `scenes[${si}].dialogues[${di}].speaker`,
        speaker
      );
    });
  });

  // ── R4：分镜出镜角色必须存在于角色表 ──
  const board = files.find((f) => f.key === 'storyboard')?.artifact;
  const shots: any[] = Array.isArray(board?.shots) ? board.shots : [];
  shots.forEach((shot, i) => {
    const refs: any[] = Array.isArray(shot?.characterNames) ? shot.characterNames : [];
    refs.forEach((raw) => {
      const name = text(raw);
      if (name && !characterNames.has(name)) {
        push(
          'storyboard',
          'dangling-character-ref',
          `镜头「${text(shot?.shotId) || i + 1}」引用了不存在的角色「${name}」`,
          `shots[${i}].characterNames`,
          name
        );
      }
    });
  });

  // ── R5：场次与镜头挂靠的剧情节点必须存在 ──
  const nodeIds = new Set(nodes.map((n) => text(n?.id)).filter(Boolean));
  if (nodeIds.size > 0) {
    scenes.forEach((scene, i) => {
      const nodeId = text(scene?.nodeId);
      if (nodeId && !nodeIds.has(nodeId)) {
        push(
          'scene-script',
          'dangling-node-ref',
          `第 ${i + 1} 场挂靠的剧情节点「${nodeId}」已不存在`,
          `scenes[${i}].nodeId`,
          nodeId
        );
      }
    });
    shots.forEach((shot, i) => {
      const nodeId = text(shot?.nodeId);
      if (nodeId && !nodeIds.has(nodeId)) {
        push(
          'storyboard',
          'dangling-node-ref',
          `镜头「${text(shot?.shotId) || i + 1}」挂靠的剧情节点「${nodeId}」已不存在`,
          `shots[${i}].nodeId`,
          nodeId
        );
      }
    });
  }

  return issues;
}

/** 与基线做稳定比对的键：同一码 + 同一主体视为同一条问题 */
function issueKey(issue: { code: string; subject?: string }): string {
  return `${issue.code}|${issue.subject || ''}`;
}

/**
 * 校验一组产物（跨文件视图）的语义不变量，并与基线比对定级。
 *
 * @param files 修改后的全量文本产物快照
 * @param options strictKeys = 本次产生补丁的文件；baselineFiles = 修改前快照
 */
export function checkArtifactInvariants(
  files: InvariantFile[],
  options: InvariantOptions = {}
): InvariantIssue[] {
  const after = collectIssues(files);
  if (after.length === 0) return [];

  const strict = new Set(options.strictKeys || []);
  const baselineKeys = new Set(
    options.baselineFiles ? collectIssues(options.baselineFiles).map(issueKey) : []
  );

  return after.map((issue) => ({
    ...issue,
    level: baselineKeys.has(issueKey(issue))
      ? 'warning'
      : strict.has(issue.fileKey)
        ? 'error'
        : 'warning',
  }));
}

/** 只取阻断项，供 apply 阶段做落盘/回滚决策 */
export function blockingIssues(issues: InvariantIssue[]): InvariantIssue[] {
  return issues.filter((i) => i.level === 'error');
}

/** 拼一句可直接展示给创作者/模型的中文摘要 */
export function summarizeIssues(issues: InvariantIssue[], limit = 5): string {
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length === 0) return '';
  const head = errors.slice(0, limit).map((i) => `- ${i.message}`);
  const rest = errors.length > limit ? `\n- …另有 ${errors.length - limit} 处同类问题` : '';
  return `本次修改会导致 ${errors.length} 处设定自相矛盾：\n${head.join('\n')}${rest}`;
}
