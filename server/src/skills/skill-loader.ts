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
 * - script: 互动剧本创作规范；
 * - motion: 面向 H3 Ref2V 段落级多机位时间轴，装载景别与三角覆盖切镜、运镜动机与阻尼、动作力学与 LOD、声画时序；
 * - sound: 完整声音设计规范。
 */
export function getSkillsForStage(
  stage: 'script' | 'motion' | 'sound',
  options?: { isIdleLoop?: boolean }
): string {
  switch (stage) {
    case 'script':
      return getSkillPrompt('ai-interactive-screenplay');

    case 'motion': {
      // 1. 景别、机位覆盖、连续性铁律与切镜触发条件：章节 1~5（支撑 H3 Ref2V 多机位时间轴拆镜）
      const sbSkill = getSkill('cinematic-storyboarding');
      const sbMotionSection = sbSkill
        ? extractSkillSections(sbSkill.content, /^##\s*1\./, /^##\s*6\./)
        : '';

      // 2. 运镜字典、动机法则与阻尼质感：章节 2~5（跳过旧版第 6 节单镜单主轴约束）
      const cmSkill = getSkill('camera-movement');
      const cmMotionSection = cmSkill
        ? extractSkillSections(cmSkill.content, /^##\s*2\./, /^##\s*6\./)
        : '';

      // 3. 动作力学：章节 2（动作力学三步法则与景别动能 LOD）
      const blSkill = getSkill('blocking-and-acting-direction');
      const blMotionSection = blSkill
        ? extractSkillSections(blSkill.content, /^##\s*2\./, /^##\s*3\./)
        : '';

      // 4. 声画剪辑时序：章节 4（配合时间轴内联对白与拟音节奏）
      const sdSkill = getSkill('cinematic-sound-design');
      const sdMotionSection = sdSkill
        ? extractSkillSections(sdSkill.content, /^##\s*4\./)
        : '';

      const parts = [
        sbMotionSection ? `### 景别、三角机位覆盖与切镜连续性规范\n${sbMotionSection}` : '',
        cmMotionSection ? `### 摄影机运镜动机与阻尼控制规范\n${cmMotionSection}` : '',
        blMotionSection ? `### 骨骼动作力学三步法与景别动能分级 (LOD)\n${blMotionSection}` : '',
        sdMotionSection ? `### 声画剪辑时序法则\n${sdMotionSection}` : '',
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
