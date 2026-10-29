import { BaseAgent, AgentContext, AgentResult } from './base.agent.js';
import { WorkflowStage } from '../types/workflow.js';
import { ScriptArtifact } from '../types/script.js';
import { CharacterDesignArtifact, StoryboardArtifact, StoryboardShot } from '../types/storyboard.js';
import { llmProvider, ChatMessage } from '../providers/llm.provider.js';
import { loadPrompt, formatPrompt } from '../prompts/loader.js';

export class StoryboardAgent extends BaseAgent<StoryboardArtifact> {
  readonly stage = WorkflowStage.STORYBOARD;

  async execute(context: AgentContext): Promise<AgentResult<StoryboardArtifact>> {
    const { session, userFeedback } = context;
    const scriptArtifact = session.stageArtifacts[WorkflowStage.SCRIPT_GENERATION] as ScriptArtifact;
    const charArtifact = session.stageArtifacts[WorkflowStage.CHARACTER_DESIGN] as CharacterDesignArtifact;

    if (!scriptArtifact) {
      throw new Error('Script artifact missing. Please run SCRIPT_GENERATION stage first.');
    }

    const systemPrompt = `
你是顶级影视分镜导演与视听语言专家。请根据剧本全剧内容与角色设定库，提炼并规划最能体现该剧核心戏剧冲突与视觉奇观的分镜头列表（Storyboard Shots）。

【通用影视分镜四大工业法则（严禁题材特异性硬编码，完全基于第一性原理）】：
1. 【场次连续性（Scene Sequence Continuity）】：
   - 所规划的 5 个镜头必须构成【同一场核心戏剧事件中环环相扣的连续镜头组】，严禁各个镜头在毫无关联的时空与背景间随意跳跃！
   - 镜头组必须遵循经典的影视叙事递进链（起·承·转·合·余）：
     - S001（空间与环境建立 Establish）：确立该场戏的具体物理环境、光源基调与初始情境；
     - S002（主体入画/动势铺开 Presence）：核心主角在该空间现身入画，与环境建立尺度与动势联系；
     - S003（核心动作推进 Action）：主体的关键行动、对抗爆发或核心动机交互；
     - S004（高潮细节特写 Climax Detail）：主体的关键面部神态、致命瞬间或核心动作的极高视觉冲击力特写；
     - S005（动作余波与悬念 Outcome）：动作释放后的环境冲击、结果定格或下一步戏剧悬念。

2. 【核心主角绝对视线中心（Protagonist Dominance）】：
   - 无论何种题材（都市情感中的男女主、悬疑刑侦中的侦探嫌犯、科幻机甲中的机师机体、或奇幻怪兽中的核心巨兽），镜头必须以第一主角为绝对视线中心！
   - 严禁将宝贵的镜头分配给无关龙套或缺乏叙事动力的空镜。每个镜头必须在 charactersInShot 中准确填入出场的核心角色名字。

3. 【时空光影影调统一（Lighting & Palette Anchor）】：
   - 这 5 个镜头的 imagePrompt 必须严格共享同一空间位置、同一时间段与同一主光源方向，确保整组镜头的明暗光比、色温梯度与胶片光学签名完全统一，形成强烈的电影感。

4. 【角色外观设定严格继承（Visual Prompt Inheritance）】：
   - 镜头的 imagePrompt 必须深度融合【角色设定库】中该角色的具体外貌与服饰设定，确保同一角色在整组镜头中五官形体与服饰材质高度统一，绝不走样变脸。
   - 每个镜头的时长在 3 到 5 秒之间，景别（shotType）、机位角度（cameraAngle）与运镜方式（cameraMovement）明确规范。
   - 输出纯 JSON。

格式规范：
{
  "episodeNumber": 1,
  "shots": [
    {
      "shotId": "S001",
      "unitId": "U01",
      "sceneId": "E01_S01",
      "shotType": "全景",
      "duration": 4,
      "cameraAngle": "低角度仰拍",
      "cameraMovement": "镜头缓慢向前推移",
      "charactersInShot": ["核心角色名"],
      "visualContent": "画面核心主体、动作流向与光影视效",
      "dialogueOrAction": "关键动作描写或对白台词",
      "imagePrompt": "Cinematic shot of [Character], detailed appearance from character design, dramatic lighting, 8k",
      "videoPrompt": "Dynamic camera motion with [Character] performing action smoothly"
    }
  ]
}
`.trim();

    // Compile comprehensive scenes summary across episodes so LLM sees the climax & key character scenes
    const allScenes = (scriptArtifact.episodes || []).flatMap(ep => 
      (ep.scenes || []).map(sc => ({
        episodeNumber: ep.episodeNumber,
        sceneId: sc.sceneId,
        title: sc.title,
        location: sc.location,
        characters: sc.characters,
        actions: sc.items?.filter((it: any) => it.type === 'action').map((it: any) => it.action?.description).join('; '),
      }))
    );

    const charListForPrompt = (charArtifact?.characters && charArtifact.characters.length > 0)
      ? charArtifact.characters
      : (scriptArtifact.characters || scriptArtifact.bible?.characters || []).map((c) => ({
          name: c.name,
          role: c.role,
          appearancePrompt: c.appearance || '',
          clothingPrompt: '',
          imagePrompt: (c as any).imagePrompt || '',
        }));

    const userPrompt = `
【故事标题】：${scriptArtifact.title}
【用户核心创意】：${session.meta.idea}
${scriptArtifact.scriptText ? `【完整长剧本文本】：\n${scriptArtifact.scriptText}\n` : ''}
【角色设定库（包含外观英文Prompt）】：
${JSON.stringify(charListForPrompt.map(c => ({
  name: c.name,
  role: c.role,
  appearancePrompt: c.appearancePrompt,
  clothingPrompt: c.clothingPrompt,
  imagePrompt: c.imagePrompt,
})), null, 2)}
【剧本场景全景库】：
${JSON.stringify(allScenes, null, 2)}
${userFeedback ? `【修改要求】：${userFeedback}` : ''}
请为短片规划 5 个最精彩、最震撼的影视分镜头列表（必须以核心主角为绝对中心，严禁主角缺席，imagePrompt 必须继承角色外观设定）。
`.trim();

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const rawJson = await llmProvider.chatJSON<{
      episodeNumber: number;
      shots: StoryboardShot[];
    }>(messages);

    // Industrial Continuity Audit Pass (staging_continuity_zh.txt)
    try {
      const continuityTemplate = loadPrompt('storyboard', 'staging_continuity', 'zh');
      const continuityPrompt = formatPrompt(continuityTemplate, {
        episode_number: rawJson.episodeNumber || 1,
        episode_title: scriptArtifact.title || '全剧',
        retry_feedback: '',
        segments: JSON.stringify(
          (rawJson.shots || []).map((s, idx) => ({
            shot_number: idx + 1,
            shotId: s.shotId,
            cameraAngle: s.cameraAngle,
            cameraMovement: s.cameraMovement,
            charactersInShot: s.charactersInShot,
            visualContent: s.visualContent,
          })),
          null,
          2
        ),
      });

      const continuityRes = await llmProvider.chatJSON<{
        issues?: string[];
        patches?: Array<{ shot_number: number; content: string }>;
      }>([
        { role: 'system', content: continuityPrompt },
        { role: 'user', content: '请执行分镜空间与站位连续性检查，输出修复补丁或空数组。' },
      ]);

      if (continuityRes?.patches && continuityRes.patches.length > 0) {
        console.log(`[StoryboardAgent] Applied ${continuityRes.patches.length} continuity fixes:`, continuityRes.issues);
        for (const patch of continuityRes.patches) {
          const target = rawJson.shots[patch.shot_number - 1];
          if (target && patch.content) {
            target.visualContent = patch.content;
          }
        }
      }
    } catch (continuityErr) {
      console.warn('[StoryboardAgent] Continuity pass skipped:', continuityErr);
    }

    let totalDuration = 0;
    const shots = rawJson.shots.map((shot, idx) => {
      const dur = shot.duration || 4;
      totalDuration += dur;
      return {
        ...shot,
        shotId: shot.shotId || `S00${idx + 1}`,
        unitId: shot.unitId || `U0${idx + 1}`,
        duration: dur,
      };
    });

    const epNumber = rawJson.episodeNumber || 1;
    const epTitle = scriptArtifact.episodes?.[0]?.title || `第 ${epNumber} 集`;
    const sceneMap: Record<string, any> = {};
    const segList: any[] = [];

    shots.forEach((s, idx) => {
      const segKey = s.sceneId || s.unitId || 'seg_1';
      if (!sceneMap[segKey]) {
        let loc = '场景区域';
        let chars = s.charactersInShot || [];
        for (const ep of (scriptArtifact.episodes || [])) {
          const sc = (ep.scenes || []).find((scene: any) => scene.sceneId === segKey);
          if (sc) {
            loc = sc.location || sc.title || loc;
            if (sc.characters?.length) chars = sc.characters;
            break;
          }
        }
        sceneMap[segKey] = {
          segment_id: segKey,
          segment_number: segList.length + 1,
          episode_number: epNumber,
          location: loc,
          characters: chars,
          total_duration: 0,
          shots: [],
        };
        segList.push(sceneMap[segKey]);
      }

      sceneMap[segKey].total_duration += s.duration;
      sceneMap[segKey].shots.push({
        shot_number: idx + 1,
        shot_type: s.shotType,
        duration: s.duration,
        content: `${s.visualContent} (${s.dialogueOrAction}) [${s.cameraAngle} · ${s.cameraMovement}]`,
      });
    });

    const artifact: StoryboardArtifact = {
      episodeNumber: epNumber,
      shots,
      totalDuration,
      episodes: [
        {
          episode_number: epNumber,
          episode_title: epTitle,
          segments: segList,
        },
      ],
    };

    return {
      stage: this.stage,
      artifact,
      requiresIntervention: true,
      stopPointTitle: '影视分镜方案确认',
      stopPointDescription: `已成功规划 ${artifact.shots.length} 个分镜（预计成片总时长约 ${artifact.totalDuration} 秒）。包含景别、运镜轨迹与中英文提示词。请确认分镜方案以开始生成参考图。`,
    };
  }
}
