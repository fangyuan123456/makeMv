/**
 * skills/mastra-skills.ts
 * 遵循 Mastra 官方标准设计规范实现的 Agent 级原生技能系统 (Mastra Native Skills SSOT)
 *
 * 严格对标 Mastra 官方 @mastra/core/skills 与 Agent Skills Specification：
 * 1. createSkill(input): 官方标准技能工厂，构建不可变的领域技能实体；
 * 2. formatSkillActivation(skill): 官方标准技能激活格式化器；
 * 3. createSkillTools(skills): 官方标准的 Tool-First 技能工具生成器，向 Agent 挂载原生的:
 *    - `skill`: 传入 { name } 激活并获取技能规范正文；
 *    - `skill_search`: 传入 { query, skillNames } 检索或列出可用技能；
 *    - `skill_read`: 传入 { skillName, path, startLine, endLine } 精准按行切片读取技能参考；
 * 4. 坚决杜绝在 Agent instructions 中手搓拼接长篇几万字字符串，全面拥抱渐进式披露与按需 Tool Call。
 */

import { z } from 'zod';
import { createTool } from '../mastra-compat/createTool.js';
import { getSkill, getAllSkills, type CinematicSkill } from './skill-loader.js';

export interface InlineSkillInput {
  /** 技能唯一标识符 (小写字母/数字/中划线) */
  name: string;
  /** 技能功能概要与调用时机说明 */
  description: string;
  /** 技能 Markdown 指引正文 (SKILL.md 核心规约) */
  instructions: string;
  license?: string;
  compatibility?: unknown;
  'user-invocable'?: boolean;
  metadata?: Record<string, unknown>;
  references?: Record<string, string>;
}

export interface Skill {
  name: string;
  description: string;
  instructions: string;
  license?: string;
  'user-invocable'?: boolean;
  metadata?: Record<string, unknown>;
  references?: Record<string, string>;
}

/**
 * Mastra 官方 createSkill() 原生工厂
 */
export function createSkill(input: InlineSkillInput): Skill {
  if (!input.name || typeof input.name !== 'string') {
    throw new Error('[MastraSkill] Skill name 必须为非空字符串');
  }
  if (!input.instructions || typeof input.instructions !== 'string') {
    throw new Error(`[MastraSkill] Skill [${input.name}] instructions 必须为非空字符串`);
  }

  return {
    name: input.name.trim(),
    description: (input.description || '').trim(),
    instructions: input.instructions.trim(),
    license: input.license,
    'user-invocable': input['user-invocable'] ?? true,
    metadata: input.metadata || {},
    references: input.references || {},
  };
}

/**
 * Mastra 官方 formatSkillActivation()
 * 格式化激活内容：标准正文 + 附属参考索引
 */
export function formatSkillActivation(skill: Skill): string {
  const parts: string[] = [
    `# Skill: ${skill.name}`,
    skill.description ? `> ${skill.description}` : '',
    '',
    '## Instructions',
    skill.instructions,
  ];

  if (skill.references && Object.keys(skill.references).length > 0) {
    parts.push('', '## Available References');
    for (const [refName, refContent] of Object.entries(skill.references)) {
      parts.push(`- **${refName}**: ${refContent.slice(0, 120)}...`);
    }
  }

  return parts.filter(Boolean).join('\n');
}

/**
 * 自动从项目内置技能库加载并实例化所有 Mastra 原生 Skill
 */
export function loadBuiltinMastraSkills(): Map<string, Skill> {
  const loaded = getAllSkills();
  const map = new Map<string, Skill>();

  for (const item of loaded) {
    const s = createSkill({
      name: item.name,
      description: item.description,
      instructions: item.content,
      metadata: { filePath: item.filePath },
    });
    map.set(s.name, s);
  }

  return map;
}

/**
 * Mastra 官方 createSkillTools(skills)
 *
 * 创建 Mastra 原生内置的 3 大技能工具：
 * - `skill`: 按名称获取/激活指定技能
 * - `skill_search`: 搜索可用技能
 * - `skill_read`: 精确读取技能正文或切片
 */
export function createSkillTools(skillSources?: Skill[] | Map<string, Skill> | Record<string, Skill>) {
  const getSkillsMap = (): Map<string, Skill> => {
    if (!skillSources) {
      return loadBuiltinMastraSkills();
    }
    if (skillSources instanceof Map) {
      return skillSources;
    }
    if (Array.isArray(skillSources)) {
      const m = new Map<string, Skill>();
      for (const s of skillSources) m.set(s.name, s);
      return m;
    }
    const m = new Map<string, Skill>();
    for (const [k, v] of Object.entries(skillSources)) m.set(k, v);
    return m;
  };

  const skillTool = createTool({
    id: 'skill',
    description:
      'Load and activate a specific domain skill by its name. Returns comprehensive professional guidelines and rules for cinematics, lighting, storyboard coverage, camera motion, acting direction, or interactive narrative.',
    inputSchema: z.object({
      name: z.string().describe('The unique name of the skill to load (e.g. "cinematic-storyboarding", "camera-movement", "cinematic-lighting-and-color", "blocking-and-acting-direction", "cinematic-sound-design")'),
    }),
    execute: async ({ context }: { context: { name: string } }) => {
      const skillsMap = getSkillsMap();
      const target = skillsMap.get(context.name) || skillsMap.get(context.name.toLowerCase());
      if (!target) {
        const available = Array.from(skillsMap.keys()).join(', ');
        return `Skill [${context.name}] not found. Available skills: ${available}`;
      }
      return formatSkillActivation(target);
    },
  });

  const skillSearchTool = createTool({
    id: 'skill_search',
    description:
      'Search or list available professional skills by query or filter. Returns matching skill names and summaries.',
    inputSchema: z.object({
      query: z.string().optional().describe('Search keyword or task requirement (e.g. "lighting", "camera", "acting", "branching")'),
      skillNames: z.array(z.string()).optional().describe('Filter by specific skill names'),
    }),
    execute: async ({ context }: { context: { query?: string; skillNames?: string[] } }) => {
      const skillsMap = getSkillsMap();
      const results: Array<{ name: string; description: string }> = [];

      for (const [name, s] of skillsMap.entries()) {
        if (context.skillNames && !context.skillNames.includes(name)) {
          continue;
        }
        if (context.query) {
          const q = context.query.toLowerCase();
          const match =
            name.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q) ||
            s.instructions.toLowerCase().includes(q);
          if (!match) continue;
        }
        results.push({ name: s.name, description: s.description });
      }

      if (results.length === 0) {
        return 'No matching skills found.';
      }

      return results
        .map((r) => `- **\`${r.name}\`**: ${r.description}`)
        .join('\n');
    },
  });

  const skillReadTool = createTool({
    id: 'skill_read',
    description:
      'Read specific line ranges or sections of a skill instructions to inspect specific rules without loading the full text.',
    inputSchema: z.object({
      skillName: z.string().describe('Name of the skill to read'),
      startLine: z.number().optional().describe('Start line number (1-based, inclusive)'),
      endLine: z.number().optional().describe('End line number (1-based, inclusive)'),
    }),
    execute: async ({ context }: { context: { skillName: string; startLine?: number; endLine?: number } }) => {
      const skillsMap = getSkillsMap();
      const target = skillsMap.get(context.skillName);
      if (!target) {
        return `Skill [${context.skillName}] not found.`;
      }

      const lines = target.instructions.split(/\r?\n/);
      const start = Math.max(1, context.startLine || 1) - 1;
      const end = context.endLine ? Math.min(lines.length, context.endLine) : lines.length;

      return lines.slice(start, end).join('\n');
    },
  });

  return {
    skill: skillTool,
    skill_search: skillSearchTool,
    skill_read: skillReadTool,
  };
}
