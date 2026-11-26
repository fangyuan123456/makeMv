/**
 * skills/skill-loader.ts
 * 项目内置影视视听技能资产装载器 (Project-Scoped Cinematic Skill Loader SSOT)
 * 
 * 负责从项目内置的 skills/ 目录动态解析和加载标准 SKILL.md 技能，
 * 解耦硬编码提示词常量，为业务 Agent 和领域工具提供开箱即用的专业领域技能按需切片注入。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CinematicSkill {
  name: string;
  description: string;
  content: string;
  filePath: string;
}

const skillCache = new Map<string, CinematicSkill>();

/**
 * 获取 skills 物理存放目录（同时兼容 ts 开发模式、dist 构建模式与 .agents 根目录）
 */
function resolveSkillsRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);

  // 1. 同级目录优先（如 server/src/skills 或 server/dist/skills）
  if (fs.existsSync(path.join(currentDir, 'cinematic-storyboarding', 'SKILL.md'))) {
    return currentDir;
  }

  // 2. 相对源码路径查找
  const candidates = [
    path.resolve(currentDir, '..', 'skills'),
    path.resolve(currentDir, '..', '..', 'src', 'skills'),
    path.resolve(currentDir, '..', '..', '.agents', 'skills'),
    path.resolve(process.cwd(), 'server', 'src', 'skills'),
    path.resolve(process.cwd(), '.agents', 'skills'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'cinematic-storyboarding', 'SKILL.md'))) {
      return candidate;
    }
  }

  return currentDir;
}

/**
 * 解析 SKILL.md 文件的 YAML Frontmatter 与 Markdown 正文
 */
function parseSkillFile(filePath: string): CinematicSkill {
  const rawText = fs.readFileSync(filePath, 'utf-8');
  let name = path.basename(path.dirname(filePath));
  let description = '';
  let content = rawText;

  // 极简高效解析 YAML Frontmatter: --- ... ---
  const match = rawText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (match) {
    const frontmatter = match[1];
    content = match[2].trim();

    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    if (nameMatch) name = nameMatch[1].trim();

    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
    if (descMatch) description = descMatch[1].trim();
  }

  return {
    name,
    description,
    content,
    filePath,
  };
}

/**
 * 按技能名称加载指定技能（内存级极速缓存）
 */
export function getSkill(skillName: string): CinematicSkill | undefined {
  if (skillCache.has(skillName)) {
    return skillCache.get(skillName);
  }

  const root = resolveSkillsRoot();
  const skillFile = path.join(root, skillName, 'SKILL.md');

  if (!fs.existsSync(skillFile)) {
    console.warn(`[SkillLoader] 技能未找到: "${skillName}" (搜索路径: ${skillFile})`);
    return undefined;
  }

  try {
    const skill = parseSkillFile(skillFile);
    skillCache.set(skillName, skill);
    return skill;
  } catch (err: any) {
    console.error(`[SkillLoader] 解析技能 [${skillName}] 失败:`, err);
    return undefined;
  }
}

/**
 * 从 Skill 内容中精准切片提取指定章节
 */
export function extractSkillSections(content: string, startPattern: RegExp, endPattern?: RegExp): string {
  const lines = content.split(/\r?\n/);
  let startIndex = -1;
  let endIndex = lines.length;

  for (let i = 0; i < lines.length; i++) {
    if (startIndex === -1 && startPattern.test(lines[i])) {
      startIndex = i;
      continue;
    }
    if (startIndex !== -1 && endPattern && endPattern.test(lines[i])) {
      endIndex = i;
      break;
    }
  }

  if (startIndex === -1) return '';
  return lines.slice(startIndex, endIndex).join('\n').trim();
}

/**
 * 提取技能的提示词正文（附带标准领域标识包裹）
 */
export function getSkillPrompt(skillName: string): string {
  const skill = getSkill(skillName);
  if (!skill) return '';
  return `【内置专业技能指引 · ${skill.name}】\n${skill.description ? `> 说明：${skill.description}\n\n` : ''}${skill.content}`;
}

/**
 * 获取系统当前已就绪的全部内置技能清单
 */
export function getAllSkills(): CinematicSkill[] {
  const root = resolveSkillsRoot();
  if (!fs.existsSync(root)) return [];

  const dirs = fs.readdirSync(root, { withFileTypes: true });
  const list: CinematicSkill[] = [];

  for (const d of dirs) {
    if (d.isDirectory()) {
      const s = getSkill(d.name);
      if (s) list.push(s);
    }
  }

  return list;
}

/**
 * 获取指定 Agent 拥有的技能元数据清单（Mastra 官方渐进式披露规范：仅暴露 name + description）
 * 对话层 Agent 轻装上阵：只做能力概要索引与权限防火墙认知，不背负大部头正文
 */
export function getAgentSkillsOverview(
  agentType: 'storyboard' | 'planner' | 'lookdev'
): string {
  const skillNamesByAgent: Record<string, string[]> = {
    storyboard: [
      'cinematic-storyboarding',
      'camera-movement',
      'cinematic-lighting-and-color',
      'blocking-and-acting-direction',
      'cinematic-sound-design',
    ],
    planner: ['ai-interactive-screenplay'],
    lookdev: ['cinematic-lighting-and-color', 'blocking-and-acting-direction'],
  };

  const targetSkills = skillNamesByAgent[agentType] || [];
  if (targetSkills.length === 0) return '';

  const lines = targetSkills.map((name) => {
    const s = getSkill(name);
    if (!s) return `- \`${name}\``;
    return `- **\`${s.name}\`**: ${s.description}`;
  });

  return `【导演智能体专属专业技能库索引 (Mastra Agent Skills)】：
${lines.join('\n')}`;
}

/**
 * 按制作工序按需精准切片加载技能包 (Stage-Scoped Skill Slicing SSOT)
 * 彻底消除跨阶段越权与信息噪音：
 * - storyboard: 仅装载切片规划、景别轴线、运镜选型、走位防瞬移、三大因果铁律、现场拟音与台词锁定；
 * - keyframe: 仅装载空间视锥六大公理（1.2米裁切/主体转正/地标虚化）、重力解剖着力点与道具三点接触、三点布光；
 * - motion: 仅装载单镜单主轴、电影级阻尼、防对撞冲突、动作力学三步法与景别动能分级 (LOD)。
 */
export function getSkillsForStage(
  stage: 'script' | 'storyboard' | 'keyframe' | 'motion' | 'sound',
  options?: { isIdleLoop?: boolean }
): string {
  switch (stage) {
    case 'script':
      return getSkillPrompt('ai-interactive-screenplay');

    case 'storyboard': {
      // 1. 分镜切解、剪辑连续性与上游防守禁忌：章节 1~7 以及 章节 9（相邻镜头信息增量、开场定场铁律）
      const sbSkill = getSkill('cinematic-storyboarding');
      const sbSection = sbSkill
        ? [
            extractSkillSections(sbSkill.content, /^##\s*1\./, /^##\s*8\./),
            extractSkillSections(sbSkill.content, /^##\s*9\./),
          ]
            .filter(Boolean)
            .join('\n\n')
        : '';

      // 2. 摄影机机位视角与运镜张力选型：章节 1~3（视角几何、轴向运动、运镜动作字典与动机法则）与 章节 7（全幕运镜张力分级）
      const cmSkill = getSkill('camera-movement');
      const cmSection = cmSkill
        ? [
            extractSkillSections(cmSkill.content, /^##\s*1\./, /^##\s*4\./),
            extractSkillSections(cmSkill.content, /^##\s*7\./),
          ]
            .filter(Boolean)
            .join('\n\n')
        : '';

      // 3. 场面调度：章节 1（空间权力几何与走位防瞬移）
      const blSkill = getSkill('blocking-and-acting-direction');
      const blSection = blSkill ? extractSkillSections(blSkill.content, /^##\s*1\./, /^##\s*2\./) : '';

      // 4. 声音设计：章节 1~4（声音层级、现场拟音分级、空间声景底噪与 J-Cut 声画剪辑）
      const sdSkill = getSkill('cinematic-sound-design');
      const sdSection = sdSkill ? extractSkillSections(sdSkill.content, /^##\s*1\./) : '';

      return [
        sbSection ? `### 视听分镜切片与机位几何规范\n${sbSection}` : '',
        cmSection ? `### 摄影机运镜动机与选型规范\n${cmSection}` : '',
        blSection ? `### 空间场面调度与走位防瞬移规范\n${blSection}` : '',
        sdSection ? `### 现场拟音与声景设计规范\n${sdSection}` : '',
      ].filter(Boolean).join('\n\n');
    }

    case 'keyframe': {
      // 1. 空间视锥与构图公理：章节 8（空间视锥六大公理：1.2米物理半径裁切、主体转正、地标虚化）
      const sbSkill = getSkill('cinematic-storyboarding');
      const sbFrustumSection = sbSkill ? extractSkillSections(sbSkill.content, /^##\s*8\./, /^##\s*9\./) : '';

      // 2. 重力解剖与着力点、道具三点接触：章节 3~5
      const blSkill = getSkill('blocking-and-acting-direction');
      const blGravitySection = blSkill ? extractSkillSections(blSkill.content, /^##\s*3\./) : '';

      // 3. 三点布光与高反差明暗：章节 1~4
      const ltSkill = getSkill('cinematic-lighting-and-color');
      const ltSection = ltSkill ? extractSkillSections(ltSkill.content, /^##\s*1\./) : '';

      return [
        sbFrustumSection ? `### 空间视锥与机位构图六大公理 (Frustum & Framing Axioms)\n${sbFrustumSection}` : '',
        blGravitySection ? `### 身体受力、重力解剖着力点与道具三点物理接触规范\n${blGravitySection}` : '',
        ltSection ? `### 电影级布光与色彩高反差塑形规范\n${ltSection}` : '',
      ].filter(Boolean).join('\n\n');
    }

    case 'motion': {
      // 1. 运镜控制：章节 4~6（阻尼曲线、单镜单主轴、防对撞红线）
      const cmSkill = getSkill('camera-movement');
      const cmMotionSection = cmSkill ? extractSkillSections(cmSkill.content, /^##\s*4\./) : '';

      // 2. 动作力学：章节 2（动作力学三步法则与景别动能 LOD）
      const blSkill = getSkill('blocking-and-acting-direction');
      const blMotionSection = blSkill ? extractSkillSections(blSkill.content, /^##\s*2\./, /^##\s*3\./) : '';

      const parts = [
        cmMotionSection ? `### 摄影机运镜动力学与单镜单主轴规范\n${cmMotionSection}` : '',
        blMotionSection ? `### 骨骼动作力学三步法与景别动能分级 (LOD)\n${blMotionSection}` : '',
      ];

      // 仅在明确为待机循环时按需挂载
      if (options?.isIdleLoop) {
        const loopSkill = getSkill('seamless-video-looping');
        if (loopSkill) parts.push(`### 互动分支抉择待机微循环规范\n${loopSkill.content}`);
      }

      return parts.filter(Boolean).join('\n\n');
    }

    case 'sound':
      return getSkillPrompt('cinematic-sound-design');

    default:
      return '';
  }
}
