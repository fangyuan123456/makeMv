import fs from 'fs';
import path from 'path';
import { AgentContext } from '../base/index.js';
import {
  CharacterProfile,
  StorySpineOutput,
  PivotPointsOutput,
  InteractiveStoryGraph,
} from './types.js';
import { llmProvider, ChatMessage } from '../../providers/llm.provider.js';
import { loadPromptSafe } from '../../prompts/loader.js';

export class CharacterProfilesService {
  /**
   * 生成交付物第 4 步：完整角色小传与视觉档案 (04_character_profiles.json)。
   * Aligns 100% with server/data/examples/stage_1_narrative_spec/04_character_profiles.json
   */
  async generateProfiles(
    context: AgentContext,
    spine: StorySpineOutput,
    pivot?: PivotPointsOutput,
    graph?: InteractiveStoryGraph,
    userInstruction?: string
  ): Promise<CharacterProfile[]> {
    const systemPrompt = loadPromptSafe('character', 'generate_profiles', 'zh');

    // 汇总互动故事拓扑图中涉及的所有角色名称
    const referencedChars = new Set<string>();
    if (graph && graph.nodes) {
      for (const node of graph.nodes) {
        for (const c of node.characters || []) {
          referencedChars.add(c);
        }
      }
    }

    const userPrompt = `
【1. 故事主干原案 (01_story_spine)】：
- 片名：《${spine.title}》
- 题材：${spine.theme}
- 视觉风格：${spine.style}
- 故事梗概：${spine.logline}

【2. 拓扑图中出场人物参照】：
${Array.from(referencedChars).join(', ') || '主角、盟友、核心反派、神秘引路人'}

${userInstruction ? `【用户调整要求】：\n${userInstruction}\n` : ''}

请立即输出深度设计好的 3 ~ 4 位核心角色完整档案 JSON 数组，必须包含 id, name, role, gender, age, personality, motivation, affinityTrigger 以及高质量 SD/Midjourney 英文视觉提示词 visualPrompt！
`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    let profiles: CharacterProfile[];
    try {
      if (context.audit) {
        profiles = await context.audit.trackLlmCall(
          { systemPrompt, userPrompt },
          'qwen-plus',
          () => llmProvider.chatJSON<CharacterProfile[]>(messages, 0.7)
        );
      } else {
        profiles = await llmProvider.chatJSON<CharacterProfile[]>(messages, 0.7);
      }
    } catch (err) {
      console.warn('[CharacterProfilesService] LLM call or JSON parsing failed, using benchmark fallback:', err);
      profiles = this.getBenchmarkFallback(spine);
    }

    if (!Array.isArray(profiles) || profiles.length === 0) {
      profiles = this.getBenchmarkFallback(spine);
    }

    // 将 04_character_profiles.json 导出至项目叙事目录中
    this.exportJson(context.projectDir, profiles);

    return profiles;
  }

  /**
   * 将角色人物小传数组写入 narrative/04_character_profiles.json
   */
  exportJson(projectDir: string, profiles: CharacterProfile[]): void {
    try {
      const narrativeDir = path.join(projectDir, 'narrative');
      fs.mkdirSync(narrativeDir, { recursive: true });
      fs.writeFileSync(
        path.join(narrativeDir, '04_character_profiles.json'),
        JSON.stringify(profiles, null, 2),
        'utf-8'
      );
    } catch (err) {
      console.warn('[CharacterProfilesService] Failed to export 04_character_profiles.json:', err);
    }
  }

  /**
   * 基于当前故事主干大纲的可靠兜底角色生成。
   */
  private getBenchmarkFallback(spine: StorySpineOutput): CharacterProfile[] {
    return [
      {
        id: 'char_01',
        name: '主角',
        role: `第一视角调查员 / 《${spine.title}》事件核心破局者`,
        gender: '男',
        age: 29,
        personality: '冷静、克制，习惯用严密逻辑解构危机，身处绝境时拥有极强的决断力。',
        motivation: '揭穿深层阴谋，在残酷真相与良知抉择中寻求自身与大众的救赎。',
        affinityTrigger: '倾向于互利合作与理性承诺，反感背叛与欺瞒。',
        visualPrompt: `A 29-year-old determined protagonist, sharp jawline, cinematic film still, detailed attire matching ${spine.style}, realistic lighting, 8k, photorealistic.`,
      },
      {
        id: 'char_02',
        name: '盟友',
        role: '地下情报联络员 / 关键同行者',
        gender: '女',
        age: 31,
        personality: '言辞锐利、警惕心强，对既有体制怀有深刻怀疑，擅长危机接应。',
        motivation: '打破暗网封锁，为无辜牺牲的同伴讨回公道。',
        affinityTrigger: '重视生死与共的契约精神，只有经历生死考验才能真正赢得其信任。',
        visualPrompt: `A 31-year-old agile and vigilant female operative, atmospheric cinematic lighting, dark tailored tactical apparel, intense gaze, 8k, photorealistic.`,
      },
      {
        id: 'char_03',
        name: '核心执政官',
        role: '对立阵营最高长官 / 阴谋执行者',
        gender: '男',
        age: 52,
        personality: '不怒自威、城府极深、奉行冰冷的优胜劣汰哲学。',
        motivation: '维护既定秩序与垄断权力，将任何不稳定因素扼杀于萌芽。',
        affinityTrigger: '只认同绝对的实力与服从，任何挑战权威的行为都会招致无情打击。',
        visualPrompt: `A 52-year-old commanding authoritative figure in formal high-collar attire, cold calculating eyes, dramatic chiaroscuro film lighting, 8k, hyper-realistic.`,
      },
    ];
  }
}

export const characterProfilesService = new CharacterProfilesService();
