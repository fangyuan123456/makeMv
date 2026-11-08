/**
 * agents/pipeline/workflows/steps/critic-review/prompt.ts
 * 独立影视审查官与剧本医生智能体专用纯中文提示词体系 (Reviewer Prompt SSOT)
 */

export const CRITIC_REVIEWER_SYSTEM_PROMPT = `你是一位享誉业界的资深电影节终审评委、好莱坞剧本医生（Script Doctor）与严苛的互动影游独立制片监制。
你的天职不是说好听的客套话或盲目迎合，而是站在最高影视工业与叙事哲学标准上【挑刺、找逻辑硬伤、防假选择、杜绝角色物种与动机塌陷】。

【四大核心审查维度】：
1. 剧情逻辑因果律 (LOGIC)：是否存在机械降神（Deus ex machina）、前后吃设定、巧合过度、或者关键反转缺乏前置伏笔？
2. 角色可信度与弧光 (CHARACTER)：角色是否扁平脸谱化？角色行为是否违背了人物小传中的核心动机与欲望？是否存在强行为了推剧情而“降智”？
3. 互动分支有效性 (INTERACTIVE)：选项是否为欺骗玩家的“假选择”（即无论怎么选，后续剧情走向与戏剧代价毫无差异）？各分支是否形成实质性道德两难抉择？
4. 视听落地可行性 (VISUAL)：场景与分镜提示词是否符合当前 AI 影视模型（如生图/生视频）的实际生成边界？是否存在过于抽象、超现实、违背物理逻辑而必然导致画面崩坏的不可控描述？角色外貌描述是否与设定发生物种/人设漂移？

【门禁放行规则 (Gatekeeper)】：
- PASS (🟢准许放行)：综合评分 >= 80，且无任何 CRITICAL 致命硬伤，准许进入下一工序；
- WARN (🟡建议优化)：综合评分 60~79，存在中等戏剧瑕疵，提示创作者注意但允许选择性推进；
- FAIL (🔴刚性阻断)：综合评分 < 60，或存在致命逻辑断裂、角色严重降智、或者严重的假选择，必须刚性阻断并要求整改。`.trim();

export function pruneAssetForAudit(stage: string, rawAsset: any): any {
  if (!rawAsset || typeof rawAsset !== 'object') return rawAsset;

  switch (stage) {
    case 'narrative_design': {
      const chars = Array.isArray(rawAsset.characters) ? rawAsset.characters : [];
      return {
        title: rawAsset.title,
        logline: rawAsset.logline,
        theme: rawAsset.theme,
        style: rawAsset.style,
        goldenSpine: rawAsset.goldenSpine?.map((g: any) => ({
          act: g.act,
          name: g.name,
          summary: g.summary,
          cliffhanger: g.cliffhanger,
        })),
        pivotPoints: rawAsset.pivotPoints?.macroPivotPoints?.map((p: any) => ({
          act: p.act,
          decisionMoment: p.decisionMoment,
          choices: p.choices?.map((c: any) => ({
            text: c.text,
            dramaticImpact: c.dramaticImpact,
          })),
        })),
        endingsCount: rawAsset.storyGraph?.endingsCount,
        characters: chars.map((c: any) => ({
          name: c.name,
          role: c.role,
          motivation: c.motivation,
          personality: c.personality,
          appearance: c.appearance,
        })),
      };
    }
    case 'character_design': {
      const list = Array.isArray(rawAsset.characters) ? rawAsset.characters : [];
      // 角色事实已在 narrative_design 条目中完整呈现，这里只审视觉落地质量，避免重复喂同一份事实
      return {
        totalCharacters: rawAsset.totalCharacters || list.length,
        style: rawAsset.style,
        characters: list.map((c: any) => ({
          name: c.name,
          visualPrompt: c.visualPrompt,
          isRendered: Boolean(c.imageUrl),
        })),
      };
    }
    case 'scene_script': {
      const scenes = Array.isArray(rawAsset.scenes) ? rawAsset.scenes : [];
      return {
        totalScenes: rawAsset.totalScenes || scenes.length,
        scenesOverview: scenes.slice(0, 15).map((sc: any) => ({
          nodeId: sc.nodeId,
          act: sc.act,
          sceneTitle: sc.sceneTitle,
          location: sc.location,
          timeOfDay: sc.timeOfDay,
          actionSummary: sc.actionSummary,
          dialoguesSummary: sc.dialogues?.map((d: any) => `${d.speaker}: ${d.line}`).slice(0, 4),
          interactionMoment: sc.interactionMoment,
        })),
      };
    }
    case 'storyboard': {
      const shots = Array.isArray(rawAsset.shots) ? rawAsset.shots : [];
      return {
        totalShots: rawAsset.totalShots || shots.length,
        estimatedTotalDurationSec: rawAsset.estimatedTotalDurationSec,
        shots: shots.slice(0, 25).map((s: any) => ({
          shotId: s.shotId,
          nodeId: s.nodeId,
          shotNumber: s.shotNumber,
          shotScale: s.shotScale,
          cameraMovement: s.cameraMovement,
          durationSec: s.durationSec,
          visualComposition: s.visualComposition,
          audioAtmosphere: s.audioAtmosphere,
        })),
      };
    }
    case 'keyframe_reference': {
      const keyframes = Array.isArray(rawAsset.keyframes) ? rawAsset.keyframes : [];
      return {
        totalKeyframes: rawAsset.totalKeyframes || keyframes.length,
        samples: keyframes.slice(0, 20).map((k: any) => ({
          shotId: k.shotId,
          shotNumber: k.shotNumber,
          visualPrompt: k.visualPrompt,
          isRendered: Boolean(k.imageUrl),
        })),
      };
    }
    case 'video_production': {
      const clips = Array.isArray(rawAsset.clips) ? rawAsset.clips : [];
      return {
        totalClips: rawAsset.totalClips || clips.length,
        samples: clips.slice(0, 20).map((c: any) => ({
          clipId: c.clipId,
          shotId: c.shotId,
          durationSec: c.durationSec,
          prompt: c.prompt,
          isRendered: Boolean(c.videoUrl),
        })),
      };
    }
    case 'fmv_packaging': {
      const manifest = rawAsset.fmvManifest || rawAsset;
      const nodes = manifest?.nodes ? Object.keys(manifest.nodes) : [];
      return {
        gameTitle: manifest?.gameTitle,
        totalNodes: manifest?.totalNodes || nodes.length,
        totalDurationSec: manifest?.totalDurationSec,
        startNodeId: manifest?.startNodeId,
      };
    }
    default:
      return rawAsset;
  }
}

export function buildPanoramicAuditPrompt(
  projectName: string,
  targetStage: string,
  panoramicAssets: Record<string, any>,
  userConstraints?: string[],
  userFeedback?: string
): string {
  const prunedAssets: Record<string, any> = {};
  for (const [stage, asset] of Object.entries(panoramicAssets)) {
    if (asset) {
      prunedAssets[stage] = pruneAssetForAudit(stage, asset);
    }
  }

  let prompt = `【审计项目】：《${projectName}》\n`;
  prompt += `【当前聚焦审查工序】：${targetStage}\n\n`;

  if (userConstraints && userConstraints.length > 0) {
    prompt += `【创作者底线红线与禁忌】：\n${userConstraints.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n`;
  }

  if (userFeedback) {
    prompt += `【创作者特别指出的疑虑与重点审视方向】：\n${userFeedback}\n\n`;
  }

  prompt += `【全链路核心资产全景快照（已剥离冗余，保留核心戏剧与视听因果）】：\n`;
  prompt += `\`\`\`json\n${JSON.stringify(prunedAssets, null, 2)}\n\`\`\`\n\n`;

  prompt += `请遵循【四大核心审查维度】对上述全景资产进行极其严谨的交叉穿透审讯，推演因果链，找出破绽与假选择，并严格按照 JSON Schema 格式输出审计报告与门禁裁决。`;

  return prompt;
}
