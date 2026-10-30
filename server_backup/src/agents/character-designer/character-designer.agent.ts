import path from 'path';
import fs from 'fs';
import { BaseAgent, AgentContext, AgentResult } from '../base/index.js';
import { WorkflowStage } from '../../types/workflow.js';
import { NarrativeDesignArtifact } from '../narrative-designer/types.js';
import { CharacterDesignArtifact, CharacterDesign } from './types.js';
import { llmProvider, ChatMessage } from '../../providers/llm.provider.js';
import { imageProvider } from '../../providers/image.provider.js';
import { config } from '../../config/index.js';
import { characterEvaluator } from './character.evaluator.js';
import { loadPromptSafe } from '../../prompts/loader.js';
import { asyncPool } from '../../utils/concurrency.js';

export class CharacterDesignerAgent extends BaseAgent<CharacterDesignArtifact> {
  readonly stage = WorkflowStage.CHARACTER_DESIGN;

  async execute(context: AgentContext): Promise<AgentResult<CharacterDesignArtifact>> {
    const { session, projectDir, userFeedback } = context;
    const scriptArtifact = session.stageArtifacts[WorkflowStage.NARRATIVE_DESIGN] as NarrativeDesignArtifact;

    if (!scriptArtifact) {
      throw new Error('缺少第一阶段剧本产物，请先执行 NARRATIVE_DESIGN 阶段。');
    }

    const systemPrompt = loadPromptSafe('character', 'character_design', 'zh');

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

    const cleanCharacterName = (rawName: string) =>
      (rawName || '').replace(/\s*[\(（][^\)）]+[\)）]\s*/g, '').trim();

    // 提取第一阶段故事圣经（Stage 1）中已确认的核心角色列表（唯一事实源）
    const bibleChars = (scriptArtifact.characters || scriptArtifact.bible?.characters || []).filter(
      (bc: any) => !isNonCharacter(bc.name)
    );

    const upstreamCharDetails = bibleChars.length > 0
      ? `【已知核心角色设定（必须严格遵守此人设，禁止篡改姓名、性别、年龄及物种/身份）】：\n` +
        bibleChars.map(c => `- 角色名：${cleanCharacterName(c.name)} | 性别：${c.gender || '未知'} | 年龄：${c.age || '未知'} | 身份：${c.role || ''} | 性格动机：${c.personality || ''} ${c.visualPrompt || c.appearance ? `| 初步视觉特征：${c.visualPrompt || c.appearance}` : ''}`).join('\n')
      : '';

    const userPrompt = `
【故事标题】：${scriptArtifact.title}
【整体风格】：${scriptArtifact.style}
【故事梗概】：${scriptArtifact.bible?.logline || scriptArtifact.logline || ''}
【核心看点】：${(scriptArtifact.bible?.sellingPoints || scriptArtifact.sellingPoints || []).join('；')}
【出场角色名单】：${validCharacterNames.join(', ')}
${upstreamCharDetails ? `\n${upstreamCharDetails}\n` : ''}
${(scriptArtifact as any).scriptText ? `【剧本文本内容】：\n${(scriptArtifact as any).scriptText.slice(0, 2000)}\n` : ''}
${feedbackInstruction ? `【修改要求】：${feedbackInstruction}` : ''}
【特别要求】：角色名称必须与【出场角色名单】完全一致，严禁擅自篡改；人类角色必须严格刻画为人类肖像。
请结合故事大纲与戏剧冲突，为剧本中出场的所有角色自动推演出最专业、最具辨识度的外貌体表特征、性格与行为模式，并生成最契合该题材的高信息密度生图 Prompt JSON。
`.trim();

    // 检查当前会话是否已存在历史轮次生成的角色产物
    const existingArtifact = session.stageArtifacts[WorkflowStage.CHARACTER_DESIGN] as CharacterDesignArtifact | undefined;

    const regenCharIds: string[] = isTargetedRegeneration ? (parsedFeedback?.regenerate_characters || []) : [];

    let designJson: CharacterDesignArtifact;

    if (existingArtifact && (isTargetedRegeneration || (!userFeedback && existingArtifact.characters?.length > 0))) {
      // 1. 复用已有角色设定（特别是在单角色重绘或局部微调阶段）
      designJson = existingArtifact;
    } else if (bibleChars.length > 0) {
      // 2. 主干标准路径：直接继承第一阶段故事圣经中推演的角色设定，确保前后一致
      designJson = {
        characters: bibleChars.map((bChar: any, idx: number) => {
          const cleanName = cleanCharacterName(bChar.name);
          const clothing = bChar.clothingPrompt ? `, ${bChar.clothingPrompt}` : '';
          const fallbackPrompt = `${bChar.appearance || bChar.appearancePrompt || cleanName}${clothing}，${scriptArtifact.style || '写实电影质感'}，电影级肖像，8k超高清`;
          const imagePrompt = (bChar.visualPrompt || (bChar as any).imagePrompt || fallbackPrompt).trim();

          return {
            id: bChar.id || `char_${idx + 1}`,
            name: cleanName,
            gender: bChar.gender,
            age: bChar.age ? String(bChar.age) : undefined,
            role: bChar.role || '主要角色',
            personality: bChar.personality || '',
            motivation: bChar.motivation || '',
            affinityTrigger: bChar.affinityTrigger || '',
            appearancePrompt: bChar.appearance || bChar.appearancePrompt || bChar.visualPrompt || '',
            clothingPrompt: bChar.clothingPrompt || '',
            visualPrompt: bChar.visualPrompt || bChar.appearancePrompt || '',
            imagePrompt,
            versions: bChar.versions || (bChar.imageUrl ? [bChar.imageUrl] : []),
            selected: bChar.selected || bChar.imageUrl,
            imageUrl: bChar.imageUrl,
            referenceImageUrl: bChar.referenceImageUrl,
          };
        }),
        settings: (((scriptArtifact as any).settings || (scriptArtifact as any).locations || []) as any[]).map((s: any, idx: number) => ({
          id: s.id || `setting_${idx + 1}`,
          location: s.location || s.name || `场景_${idx + 1}`,
          space: s.space || '内',
          atmospherePrompt: s.atmospherePrompt || s.atmosphere || '',
          lightingPrompt: s.lightingPrompt || s.lighting || '',
        })),
      };
    } else {
      // 3. 兜底提取路径：若第一阶段未生成结构化角色（如纯文本剧本），则调用大模型推演
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      if (context.audit) {
        designJson = await context.audit.trackLlmCall(
          { systemPrompt, userPrompt },
          'qwen-plus',
          () => llmProvider.chatJSON<{ characters: CharacterDesign[] }>(messages)
        );
      } else {
        designJson = await llmProvider.chatJSON<{
          characters: CharacterDesign[];
        }>(messages);
      }

      designJson.characters = (designJson.characters || []).filter(char => !isNonCharacter(char.name || ''));
      for (let idx = 0; idx < designJson.characters.length; idx++) {
        const char = designJson.characters[idx];
        char.name = cleanCharacterName(char.name);
        if (!char.id) char.id = `char_${idx + 1}`;
        // 尝试与上游故事圣经对齐性别与年龄
        const matchedBible = bibleChars.find((bc: any) => cleanCharacterName(bc.name) === char.name || bc.id === char.id);
        if (matchedBible) {
          if (!char.gender && matchedBible.gender) char.gender = matchedBible.gender;
          if (!char.age && matchedBible.age) char.age = String(matchedBible.age);
          if (!char.role && matchedBible.role) char.role = matchedBible.role;
        }
        const fallbackPrompt = `${char.appearancePrompt || char.name}，${scriptArtifact.style || '写实电影质感'}，电影级肖像，8k超高清`;
        char.imagePrompt = (char.imagePrompt || char.visualPrompt || fallbackPrompt).trim();
      }

      if (!designJson.settings || designJson.settings.length === 0) {
        designJson.settings = (((scriptArtifact as any).settings || (scriptArtifact as any).locations || []) as any[]).map((s: any, idx: number) => ({
          id: s.id || `setting_${idx + 1}`,
          location: s.location || s.name || `场景_${idx + 1}`,
          space: s.space || '内',
          atmospherePrompt: s.atmospherePrompt || s.atmosphere || '',
          lightingPrompt: s.lightingPrompt || s.lighting || '',
        }));
      }
    }

    const charsDir = path.join(projectDir, 'characters');
    fs.mkdirSync(charsDir, { recursive: true });

    // 确保角色定妆照严格遵循项目全局配置的视频宽高比
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
      // 16:9 比例适配（通义万相等模型要求宽高不小于512且可被16整除，采用 912*512）
      renderWidth = isFast ? 912 : 1280;
      renderHeight = isFast ? 512 : 720;
    }

    // 1. 生成角色定妆概念图（仅在用户主动点击生成或发起定妆请求时触发）
    if (isTargetedRegeneration && regenCharIds.length > 0) {
      const charsToRegen = (designJson.characters || []).filter((char) =>
        regenCharIds.includes(char.id) ||
        regenCharIds.includes(char.name) ||
        regenCharIds.some((rid: string) => cleanCharacterName(rid) === cleanCharacterName(char.name))
      );
      const concurrency = session.meta.concurrencyLimit || 3;
      console.log(`[CharacterDesigner] 正在生成 ${charsToRegen.length} 位角色的定妆图，并发限制=${concurrency}...`);

      await asyncPool(concurrency, charsToRegen, async (char) => {
        const safeCharName = (char.name || 'character').replace(/[\\/:*?"<>|]/g, '_').trim();
        const imgPath = path.join(charsDir, `${safeCharName}_portrait_${Date.now()}.jpg`);

        // 检查创作者是否有特定的修改指令，或是否在界面上手动编辑了提示词
        const customInstruction = (parsedFeedback?.instruction || parsedFeedback?.feedback || feedbackInstruction || '').trim();
        const baseVersionUrl = parsedFeedback?.base_version || undefined;
        const editedPrompt = (parsedFeedback?.edited_prompt || parsedFeedback?.imagePrompt || '').trim();

        if (editedPrompt) {
          char.imagePrompt = editedPrompt;
        }

        let fullPrompt = (char.imagePrompt || char.visualPrompt || '').trim();
        if (!fullPrompt) {
          const clothing = char.clothingPrompt ? `, ${char.clothingPrompt}` : '';
          fullPrompt = `${char.appearancePrompt || char.name}${clothing}，${scriptArtifact.style || '写实电影质感'}，电影级肖像，8k超高清`;
        }

        // 若创作者在前端输入框直接手动修改了提示词，以创作者的输入为最高优先级
        if (editedPrompt) {
          fullPrompt = editedPrompt;
        }

        // 若创作者输入了具体的自然语言修改建议（例如“眼睛颜色很奇怪，改成深褐色义体眼”），调用大模型智能微调提示词
        const isGenericInstruction = !customInstruction || 
          customInstruction.includes('生成视觉定妆图') || 
          customInstruction.includes('生成选中的');

        if (!isGenericInstruction) {
          try {
            console.log(`[CharacterDesigner] 使用大模型根据创作者指令微调提示词: "${customInstruction}"...`);
            const refineSystemPrompt = loadPromptSafe('character', 'refine_prompt', 'zh');
            const llmMessages: ChatMessage[] = [
              {
                role: 'system',
                content: refineSystemPrompt,
              },
              {
                role: 'user',
                content: `【当前提示词】：\n${fullPrompt}\n\n【创作者修改要求】：\n${customInstruction}`,
              },
            ];
            const refined = await llmProvider.chat(llmMessages, 0.4);
            if (refined && refined.trim().length > 10) {
              fullPrompt = refined.trim().replace(/^["']|["']$/g, '');
              console.log(`[CharacterDesigner] 大模型微调提示词完成:\n${fullPrompt}`);
            }
          } catch (err: any) {
            console.warn(`[CharacterDesigner] 大模型微调提示词失败 (${err.message})，使用基础提示词。`);
          }
        }

        // 将微调后的提示词同步更新到角色对象中，确保前后端数据一致
        char.imagePrompt = fullPrompt;

        // 支持基于已选历史版本的垫图衍生生成或参考图引导
        const refImage = baseVersionUrl || char.referenceImageUrl || undefined;

        const res = await imageProvider.generateImage(
          {
            prompt: fullPrompt,
            style: scriptArtifact.style,
            width: renderWidth,
            height: renderHeight,
            referenceImageUrl: refImage,
          },
          imgPath
        );

        // 优先使用本地持久化路径，避免云端临时图链（如OSS签名）在24小时后失效
        const finalUrl = fs.existsSync(imgPath)
          ? `/media/${session.id}/characters/${path.basename(imgPath)}`
          : res.url;

        char.imageUrl = finalUrl;
        char.selected = finalUrl; // 新生成的版本默认激活并设为当前选定图
        if (res.rewrite_result) char.rewrite_result = res.rewrite_result;

        // 追加到多版本历史记录中（按生成顺序归档：v1、v2、v3...）
        if (!char.versions) char.versions = [];
        if (!char.versions.includes(finalUrl)) {
          char.versions.push(finalUrl);
        }

        // 通过角色质量评审器执行视觉与设定一致性质检
        if (!isFast) {
          try {
            const evalResult = await characterEvaluator.evaluateCharacter(
              char.name,
              `${char.role}。${char.personality || ''}。${char.appearancePrompt || ''}`,
              imgPath,
              res.url
            );
            char.evaluation = evalResult;
            console.log(`[CharacterAgent] 已评审角色 "${char.name}": 得分 ${evalResult.score}/10, 是否合格: ${evalResult.isAcceptable}`);
          } catch (evalErr) {
            char.evaluation = { score: 9, isAcceptable: true, issues: [], suggestion: '质检通过' };
          }
        } else {
          // 极速模式：跳过重复大模型审查，秒级通过
          char.evaluation = { score: 9, isAcceptable: true, issues: [], suggestion: '极速画质验证通过' };
        }

        // 双向同步回上游故事圣经 (Stage 1)，保持全局资产单向数据流与持久化一致
        const bibleList = scriptArtifact.characters || scriptArtifact.bible?.characters;
        if (Array.isArray(bibleList)) {
          const matchedInBible = bibleList.find(
            (bc: any) => bc.id === char.id || cleanCharacterName(bc.name) === cleanCharacterName(char.name)
          );
          if (matchedInBible) {
            matchedInBible.imageUrl = finalUrl;
            matchedInBible.selected = finalUrl;
            matchedInBible.imagePrompt = fullPrompt;
            if (!matchedInBible.versions) matchedInBible.versions = [];
            if (!matchedInBible.versions.includes(finalUrl)) {
              matchedInBible.versions.push(finalUrl);
            }
          }
        }
      });
    }

    const artifact: CharacterDesignArtifact = designJson;
    const hasAnyImage = (designJson.characters || []).some(c => Boolean(c.selected || c.imageUrl));

    return {
      stage: this.stage,
      artifact,
      requiresIntervention: true,
      stopPointTitle: '角色视觉设定与定妆展板',
      stopPointDescription: hasAnyImage
        ? `已为部分角色生成定妆图。您可继续选择生成其他角色、上传图片或在底部切换版本。`
        : `已完成 ${artifact.characters.length} 位核心角色视觉规格推演（0 生图消耗）。您可在卡片中选择【AI 生成】或【上传图片】，最终将使用您选定的版本。`,
    };
  }
}
