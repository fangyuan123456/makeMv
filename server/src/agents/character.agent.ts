import path from 'path';
import fs from 'fs';
import { BaseAgent, AgentContext, AgentResult } from './base.agent.js';
import { WorkflowStage } from '../types/workflow.js';
import { ScriptArtifact } from '../types/script.js';
import { CharacterDesignArtifact, CharacterDesign } from '../types/storyboard.js';
import { llmProvider, ChatMessage } from '../providers/llm.provider.js';
import { imageProvider } from '../providers/image.provider.js';
import { config } from '../config/index.js';
import { characterEvaluator } from './character.evaluator.js';

export class CharacterDesignerAgent extends BaseAgent<CharacterDesignArtifact> {
  readonly stage = WorkflowStage.CHARACTER_DESIGN;

  async execute(context: AgentContext): Promise<AgentResult<CharacterDesignArtifact>> {
    const { session, projectDir, userFeedback } = context;
    const scriptArtifact = session.stageArtifacts[WorkflowStage.SCRIPT_GENERATION] as ScriptArtifact;

    if (!scriptArtifact) {
      throw new Error('Script artifact missing. Please run SCRIPT_GENERATION stage first.');
    }

    const systemPrompt = `
你是顶级概念设计师与电影视觉总监。根据剧本中出现的角色与实体（无论是人类、巨兽神兽、动物生灵、机甲载具、还是奇幻异形），输出最契合该题材特质的核心角色概念设定卡。

【角色视觉设定准则】：
1. 角色实体第一性原理建模：
   - 【人类主体】：细致刻画年龄、族裔、五官轮廓、发型、肤色光影及符合其身份与时代的服装材质与色彩。
   - 【非人类主体（巨兽、生物、动物、机甲、神魔等）】：精准刻画其体量规模、表皮质感（鳞甲/毛皮/合金/岩石/羽翼）、头部骨骼与面部神态、充能或武器挂载、压迫感与环境交互质感。
2. imagePrompt 独立生成（极其关键）：
   - 请为每个角色直接输出一段最纯正、高信息密度的英文生图 Prompt（imagePrompt），必须包含主体细节、构图、光影及专业级风格标签。
   - 比如人物肖像：'cinematic 85mm portrait of a tired detective, natural skin texture, moody chiaroscuro lighting, photorealistic, 8k'
   - 比如怪兽生物：'epic cinematic concept art of a colossal prehistoric monster, glowing atomic spines, obsidian scales, volumetric fog, unreal engine 5, masterpiece, 8k'
3. 严格输出纯 JSON 格式。

格式规范：
{
  "characters": [
    {
      "id": "char_1",
      "name": "角色名",
      "age": "年龄或存在时代",
      "role": "身份或定位",
      "personality": "性格或行为特质",
      "appearancePrompt": "英文外观质感描写",
      "clothingPrompt": "英文服饰、装甲或专属体表特征描写",
      "imagePrompt": "专用于AI图像生成的完整英文生图Prompt"
    }
  ]
}
`.trim();

    const isNonCharacter = (name: string) =>
      /^(旁白|解说|解说员|画外音|narration|narrator|v\.?o\.?|o\.?s\.?|voiceover|voice\s*over|system\s*voice)$/i.test(name.trim());

    const validCharacterNames = (scriptArtifact.characterNames || []).filter(name => !isNonCharacter(name));

    let feedbackInstruction = '';
    let parsedFeedback: any = null;
    let isTargetedRegeneration = false;
    if (userFeedback) {
      if (typeof userFeedback === 'string') {
        try {
          parsedFeedback = JSON.parse(userFeedback);
          feedbackInstruction = parsedFeedback?.instruction || parsedFeedback?.feedback || userFeedback;
        } catch {
          feedbackInstruction = userFeedback;
        }
      } else if (typeof userFeedback === 'object' && userFeedback !== null) {
        parsedFeedback = userFeedback;
        feedbackInstruction = (userFeedback as any).instruction || (userFeedback as any).feedback || JSON.stringify(userFeedback);
      }

      if (Array.isArray(parsedFeedback?.regenerate_characters)) {
        isTargetedRegeneration = true;
      }
    }

    const userPrompt = `
【故事标题】：${scriptArtifact.title}
【整体风格】：${scriptArtifact.style}
【故事梗概】：${scriptArtifact.bible?.logline || scriptArtifact.logline || ''}
【核心看点】：${(scriptArtifact.bible?.sellingPoints || scriptArtifact.sellingPoints || []).join('；')}
【出场角色名单】：${validCharacterNames.join(', ')}
${scriptArtifact.scriptText ? `【剧本文本内容】：\n${scriptArtifact.scriptText.slice(0, 2000)}\n` : ''}
${feedbackInstruction ? `【修改要求】：${feedbackInstruction}` : ''}
请结合故事大纲与戏剧冲突，为剧本中出场的所有角色自动推演出最专业、最具辨识度的外貌体表特征、性格与行为模式，并生成最契合该题材的高信息密度生图 Prompt JSON。注意：仅为有具体外形实体的真实角色生成美术概念，不要为旁白或无实体的背景音效生成角色条目。
`.trim();

    // Check if an artifact already exists from a previous run
    const existingArtifact = session.stageArtifacts[WorkflowStage.CHARACTER_DESIGN] as CharacterDesignArtifact | undefined;

    const regenCharIds: string[] = isTargetedRegeneration ? (parsedFeedback?.regenerate_characters || []) : [];

    let designJson: CharacterDesignArtifact;

    if (existingArtifact && (isTargetedRegeneration || (!userFeedback && existingArtifact.characters?.length > 0))) {
      // Reuse existing characters definitions
      designJson = existingArtifact;
    } else {
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      designJson = await llmProvider.chatJSON<{
        characters: CharacterDesign[];
      }>(messages);

      const normalizeName = (name: string) =>
        (name || '').replace(/\s*[\(（][^\)）]+[\)）]\s*/g, '').trim().toLowerCase();

      const isSameCharacter = (a: string, b: string) => {
        const normA = normalizeName(a);
        const normB = normalizeName(b);
        if (!normA || !normB) return false;
        return normA === normB || normA.includes(normB) || normB.includes(normA);
      };

      // Filter out any accidental voiceover / narration character entries
      designJson.characters = (designJson.characters || []).filter(char => !isNonCharacter(char.name || ''));

      // Clean character names from bilingual parenthesis e.g. "炎骸 (Yanhai)" -> "炎骸"
      for (const char of designJson.characters) {
        const cleanName = (char.name || '').replace(/\s*[\(（][^\)）]+[\)）]\s*/g, '').trim();
        if (cleanName) {
          char.name = cleanName;
        }
      }

      // Merge with Bible characters to preserve user's written profiles and reference images
      const bibleChars = scriptArtifact.characters || scriptArtifact.bible?.characters || [];
      if (bibleChars.length > 0) {
        for (const bChar of bibleChars) {
          if (isNonCharacter(bChar.name)) continue;
          let matched = designJson.characters.find(c => isSameCharacter(c.name, bChar.name));
          if (!matched) {
            matched = {
              id: `char_${designJson.characters.length + 1}`,
              name: bChar.name,
              role: bChar.role || '主要角色',
              personality: bChar.personality || '',
              appearancePrompt: bChar.appearance || '',
              clothingPrompt: '',
              imagePrompt: `cinematic concept art of ${bChar.name}, ${bChar.role}, ${bChar.appearance || ''}, ${scriptArtifact.style}, 8k, masterpiece`,
            };
            designJson.characters.push(matched);
          } else {
            // Keep canonical name from Bible
            matched.name = bChar.name;
            if (bChar.appearance && !matched.appearancePrompt) {
              matched.appearancePrompt = bChar.appearance;
            }
            if (bChar.personality && !matched.personality) {
              matched.personality = bChar.personality;
            }
            if ((bChar as any).imagePrompt && !matched.imagePrompt) {
              matched.imagePrompt = (bChar as any).imagePrompt;
            }
          }
          if (bChar.referenceImageUrl && !matched.referenceImageUrl) {
            matched.referenceImageUrl = bChar.referenceImageUrl;
          }
          if (bChar.imageUrl && !matched.imageUrl) {
            matched.imageUrl = bChar.imageUrl;
            matched.selected = bChar.selected || bChar.imageUrl;
            matched.versions = bChar.versions || [bChar.imageUrl];
          }
          if ((bChar as any).evaluation && !matched.evaluation) {
            matched.evaluation = (bChar as any).evaluation;
          }
          if ((bChar as any).rewrite_result && !matched.rewrite_result) {
            matched.rewrite_result = (bChar as any).rewrite_result;
          }
        }
      }

      // Final deduplication by normalized name
      const seenNames = new Set<string>();
      designJson.characters = designJson.characters.filter(char => {
        const norm = normalizeName(char.name);
        if (!norm || seenNames.has(norm)) return false;
        seenNames.add(norm);
        return true;
      });
    }

    const charsDir = path.join(projectDir, 'characters');
    fs.mkdirSync(charsDir, { recursive: true });

    // Ensure character portraits strictly adhere to the project's global video aspect ratio
    const ratio = session.meta.videoRatio || '16:9';
    const isFast = config.image.qualityLevel === 'fast';

    let renderWidth = 1280;
    let renderHeight = 720;
    if (ratio === '9:16') {
      renderWidth = isFast ? 512 : 720;
      renderHeight = isFast ? 912 : 1280;
    } else if (ratio === '1:1') {
      renderWidth = isFast ? 512 : 1024;
      renderHeight = isFast ? 512 : 1024;
    } else {
      // 16:9 (Wanx requires both dimensions >= 512; 912*512 is 16:9 divisible by 16)
      renderWidth = isFast ? 912 : 1280;
      renderHeight = isFast ? 512 : 720;
    }

    // 1. Generate concept art for characters (ONLY when explicitly requested by user click/targeted regeneration)
    if (isTargetedRegeneration && regenCharIds.length > 0) {
      for (const char of (designJson.characters || [])) {
        if (!regenCharIds.includes(char.id)) {
          continue;
        }

        const safeCharName = (char.name || 'character').replace(/[\\/:*?"<>|]/g, '_').trim();
        const imgPath = path.join(charsDir, `${safeCharName}_portrait_${Date.now()}.jpg`);

        // Use AI-generated bespoke imagePrompt, with fallback to appearancePrompt + clothingPrompt + style
        const clothing = char.clothingPrompt ? `, ${char.clothingPrompt}` : '';
        const fallbackPrompt = `${char.appearancePrompt}${clothing}, ${scriptArtifact.style}, cinematic masterpiece, professional lighting, 8k`;
        const fullPrompt = char.imagePrompt?.trim() || fallbackPrompt;

        const res = await imageProvider.generateImage(
          {
            prompt: fullPrompt,
            style: scriptArtifact.style,
            width: renderWidth,
            height: renderHeight,
            referenceImageUrl: char.referenceImageUrl,
          },
          imgPath
        );
        char.imageUrl = res.url;
        char.selected = res.url;
        if (res.rewrite_result) char.rewrite_result = res.rewrite_result;
        if (!char.versions) char.versions = [];
        if (!char.versions.includes(res.url)) char.versions.unshift(res.url);

        // Quality audit via CharacterEvaluator (LLM/Vision-as-a-Judge)
        const evalResult = await characterEvaluator.evaluateCharacter(
          char.name,
          `${char.role}。${char.personality || ''}。${char.appearancePrompt || ''}`,
          imgPath,
          res.url
        );
        char.evaluation = evalResult;
        console.log(`[CharacterAgent] Evaluated "${char.name}": score ${evalResult.score}/10, acceptable: ${evalResult.isAcceptable}`);
      }
    }

    const artifact: CharacterDesignArtifact = designJson;

    return {
      stage: this.stage,
      artifact,
      requiresIntervention: true,
      stopPointTitle: '角色概念设计确认',
      stopPointDescription: `已完成 ${artifact.characters.length} 个核心角色概念的美术设定。请查看角色形象并生成/上传定妆图。`,
    };
  }
}
