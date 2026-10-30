import fs from 'fs';
import path from 'path';
import { BaseAgent, AgentContext, AgentResult } from '../base/index.js';
import { WorkflowStage } from '../../types/workflow.js';
import { SceneScriptArtifact } from '../scene-script/types.js';
import { StoryboardArtifact, StoryboardShot } from './types.js';
import { CharacterDesignArtifact } from '../character-designer/types.js';
import { llmProvider, ChatMessage } from '../../providers/llm.provider.js';
import { loadPrompt, formatPrompt, loadPromptSafe } from '../../prompts/loader.js';

export class StoryboardAgent extends BaseAgent<StoryboardArtifact> {
  readonly stage = WorkflowStage.STORYBOARD;

  async execute(context: AgentContext): Promise<AgentResult<StoryboardArtifact>> {
    const { session, userFeedback, projectDir } = context;
    const scriptArtifact = (session.stageArtifacts[WorkflowStage.SCENE_SCRIPT] || session.stageArtifacts[WorkflowStage.NARRATIVE_DESIGN]) as SceneScriptArtifact;
    const charArtifact = session.stageArtifacts[WorkflowStage.CHARACTER_DESIGN] as CharacterDesignArtifact;

    if (!scriptArtifact) {
      throw new Error('Script artifact missing. Please run NARRATIVE_DESIGN or SCENE_SCRIPT stage first.');
    }

    const systemPrompt = loadPromptSafe('storyboard', 'storyboard_design', 'zh');
    const narrativeArtifact = session.stageArtifacts[WorkflowStage.NARRATIVE_DESIGN] as any;

    // 汇总分场全景库（优先从黄金主干幕次/互动图谱节点，或历史剧本中获取）
    let allScenes = (scriptArtifact?.episodes || []).flatMap(ep => 
      (ep.scenes || []).map(sc => ({
        sceneId: sc.sceneId,
        title: sc.title,
        location: sc.location,
        characters: sc.characters,
        actions: sc.items?.filter((it: any) => it.type === 'action').map((it: any) => it.action?.description).join('; '),
      }))
    );

    if (allScenes.length === 0 && narrativeArtifact) {
      if (narrativeArtifact.goldenSpine && narrativeArtifact.goldenSpine.length > 0) {
        allScenes = narrativeArtifact.goldenSpine.map((act: any) => ({
          sceneId: `act_${act.act}`,
          title: `${act.name}（第${act.act}幕）`,
          location: '故事核心场景',
          characters: [],
          actions: `${act.dramaticFunction}；核心冲突：${act.coreConflict}；高潮悬念：${act.cliffhanger}`,
        }));
      } else if (narrativeArtifact.storyGraph?.nodes) {
        allScenes = narrativeArtifact.storyGraph.nodes.map((node: any) => ({
          sceneId: node.id,
          title: node.title,
          location: node.location,
          characters: node.characters || [],
          actions: node.summary,
        }));
      }
    }
    const charListForPrompt = (charArtifact?.characters && charArtifact.characters.length > 0)
      ? charArtifact.characters
      : (narrativeArtifact?.characters || narrativeArtifact?.bible?.characters || []).map((c: any) => ({
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
【角色设定库（包含外观与生图提示词）】：
${JSON.stringify(charListForPrompt.map((c: any) => ({
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

    // 执行工业级连续性质检审核流程 (staging_continuity_zh.txt)
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
      const baseShotId = shot.shotId || `S00${idx + 1}`;
      const prefix = shot.sceneId || shot.unitId || '';
      // 确保镜头 ID 按场次/节点唯一作用域命名，防止分支节点间文件名冲突
      const uniqueShotId = (prefix && !baseShotId.startsWith(prefix)) ? `${prefix}_${baseShotId}` : baseShotId;

      return {
        ...shot,
        shotId: uniqueShotId,
        unitId: shot.unitId || prefix || `U0${idx + 1}`,
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

    // 将可读的分镜表 Markdown 与 JSON 导出至项目目录
    try {
      const sbDir = path.join(projectDir, 'storyboards');
      fs.mkdirSync(sbDir, { recursive: true });

      let md = `# ${session.title || '视听导演分镜表 (Storyboard)'}\n\n`;
      md += `**总预估时长**: ${totalDuration} 秒 | **镜头总数**: ${shots.length} 个\n\n`;
      md += `| 镜头编号 | 归属单元/节点 | 景别 | 运镜与角度 | 时长 | 画面视觉构图 | 声音/对白 |\n`;
      md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;

      for (const s of shots) {
        const visual = (s.visualContent || '').replace(/\|/g, '/').trim();
        const dialogue = (s.dialogueOrAction || '').replace(/\|/g, '/').trim();
        md += `| \`${s.shotId}\` | ${s.unitId || s.sceneId || '-'} | ${s.shotType || '-'} | ${s.cameraMovement || '-'} (${s.cameraAngle || '-'}) | ${s.duration}s | ${visual} | ${dialogue} |\n`;
      }

      fs.writeFileSync(path.join(sbDir, 'shots_table.md'), md, 'utf-8');
      fs.writeFileSync(path.join(sbDir, 'shots.json'), JSON.stringify(artifact, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[StoryboardAgent] Failed to write shots_table.md:', err);
    }

    return {
      stage: this.stage,
      artifact,
      requiresIntervention: true,
      stopPointTitle: '影视分镜方案确认',
      stopPointDescription: `已成功规划 ${artifact.shots.length} 个分镜（预计成片总时长约 ${artifact.totalDuration} 秒）。包含景别、运镜轨迹与中英文提示词。请确认分镜方案以开始生成参考图。`,
    };
  }
}
