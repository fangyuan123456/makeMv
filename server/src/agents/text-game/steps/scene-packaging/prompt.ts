/**
 * agents/text-game/steps/scene-packaging/prompt.ts
 * 分幕自包含切片打包工序提示词体系 (Scene Packaging Prompt SSOT)
 */

import type { ScenePackagingInput } from './schema.js';
import { parseStorySections } from './step.js';

export function buildScenePackagingSystemPrompt(): string {
  return `你是一名资深影视导演兼互动叙事总监 (Director & Narrative Architect)。
你的唯一使命是：严格依据 Step 4 交付的【分幕剧本正文 (storyScenes)】、【通用策划案接线 (PRD)】与【全剧定妆设定集 (entities)】，将全剧每一幕精细打包为【物理独立的分幕自包含 SingleSceneJson 资产数组】。

【核心架构哲学与设计铁律】
1. 【1:1 严格对齐 PRD 节点 ID (Zero Renaming)】：
   - 每个 SingleSceneJson 的 sceneId 必须 1:1 严格沿用 PRD clips[].id（如 "S1", "S1.1", "S2"），严禁私自改名为 scene_01 或 branch_01；
   - targetVideoClipName 必须 1:1 对齐对应视频文件名（如 "S1.mp4", "S1.1.mp4"）；
   - 当前阶段使用“单张完整尾帧场景图 + 逐句对白”替代成品视频，同时沉淀高质量生图与 I2V 视频提示词。
2. 【尾帧定点生图铁律（Freeze-Frame End Anchor，防止图文与交互脱节）】：
   - 互动影游的所有幕尾交互（interactions）和分支抉择均在该幕播完（onEnded）的**尾帧**触发！
   - 因此，每幕的 visualAnchor **严禁画开场首帧或抽象背景**，必须精准定格在**本段正文结尾急刹车的最后一帧画面**（endFrameMoment），确保尾帧中在场的所有角色、站位神态、手持或桌面上的关键道具与随后弹出的互动提示 100% 严丝合缝！
3. 【单幅完整融合生图与角色道具齐备律（严禁多图拼装）】：
   - 每一幕必须输出 entityIds 数组：严格列出本幕**尾帧画面**中真实出场且必须入画的所有角色 ID 与所有道具 ID（角色在前，道具在后），值必须 100% 取自传入的 entities 字典，严禁自造 ID；确无角色与道具出场的纯空镜填 []；
   - visualAnchor.promptZh 与 promptEn 必须在同一连贯的电影单幅构图空间内，清晰写出 entityIds 中**每一位角色**的位置姿态神情与**每一件道具**的具体摆放/手持状态，并严格沿用全剧统一画风（entities.artStyle）；严禁出现拼贴、分格、画中画或设定图描述。
4. 【尊重原作题材的视听与运镜拆解】：
   - visualAnchor 包含 endFrameMoment (尾帧定格描述)、cameraAngle (运镜机位)、lighting (光影氛围)、promptZh (尾帧中文生图词) 与 promptEn (尾帧英文生图词)；光影色彩与视觉风格必须 100% 契合原作题材定位与 entities.artStyle，严禁擅自强加赛博朋克或黑色电影滤镜；
   - screenplay.videoActionDescription：精准撰写 1~2 句供图生视频 (I2V) 模型执行的动态镜头运镜与角色动作描述；
   - screenplay.dialogues：将本幕对白拆解为逐句列表 (speaker, line, emotion)，供字幕打字机与未来 TTS 语音合成消费。
5. 【自驱动指针与状态机对齐】：
   - choices[].nextSceneJson 与 rewindTargetScene 必须填写精准节点 JSON 文件名（如 "S2.json", "S1.1.json", "S1.json"）；
   - 保持所有选项与回溯指针闭环，严禁编造不存在的节点名。`;
}

export function buildScenePackagingUserPrompt(input: ScenePackagingInput): string {
  const storyMap = parseStorySections(input.storyMarkdown);
  const interactionMap = new Map(input.prd.interactions.map((i) => [i.id, i]));
  const storyScenesJson = JSON.stringify(
    input.prd.clips.map((c) => {
      const sec = storyMap.get(c.id);
      const linkedSteps = input.prd.wiring
        .filter((w) => w.from === c.id && interactionMap.has(w.to))
        .map((w) => interactionMap.get(w.to)!);
      return {
        sceneId: c.id,
        title: sec?.title || c.title,
        targetVideoClipName: c.video || `${c.id}.mp4`,
        narrativeText: sec?.narrativeText || c.title,
        onEndedInteractions: linkedSteps.map((s) => ({ id: s.id, kind: s.kind, prompt: s.prompt })),
      };
    }),
    null,
    2
  );

  const entitiesJson = JSON.stringify(input.entities, null, 2);
  const prdWiringJson = JSON.stringify(
    {
      initialState: input.prd.initialState,
      interactions: input.prd.interactions,
      endings: input.prd.endings,
      wiring: input.prd.wiring,
    },
    null,
    2
  );

  return `请根据以下 Step 4 策划案与分幕剧本正文，将全剧所有切片打包为物理自包含的 SingleSceneJson 数组：

【短剧作品】：《${input.title}》
【题材定位】：${input.prd.genre}
【全剧统一画风】：${input.entities.artStyle}
【玩家身份】：${input.prd.playerIdentity}
【PRD 接线与交互/状态参考】：
${prdWiringJson}

---

【全剧分幕剧本清单 (按 prd.clips 1:1 对齐 story.md 正文，注意每个片段结尾急刹车处对应的尾帧画面)】：
${storyScenesJson}

---

【全剧角色与道具定妆字典 (entities)】：
${entitiesJson}

---

【打包规约与尾帧映射】：
1. 严格沿用 PRD clips 的节点 ID：主线与支线 sceneId 必须原封不动使用 clips[].id（如 "S1", "S1.1", "S2"），targetVideoClipName 为 "S1.mp4", "S1.1.mp4"...
2. choices[].nextSceneJson 必须精确填写目标节点 JSON 真实文件名（如 "S2.json" 或 "S1.1.json"）；
3. 若某节点最终直连失败或分支结局（endingType 为 BE / NE 且具备 rewindTargetClipId），设置 isEnding: true 与 endingType，并在 rewindTargetScene 填写回溯目标文件名（如 "S1.json"）；
4. 若某支线在 wiring 中直接连向下游主线片段，choices[] 需包含指向目标主线节点的文件名（如 "S4.json"）；
5. 保证所有指针闭环，严禁出现死链接！
6. 每一幕必须输出：
   - entityIds：严格列出本幕**尾帧画面**真实在场且需要入画的所有角色与道具 ID（角色在前、道具在后，取值严格来自上方 entities 的 characterId / itemId）；
   - visualAnchor.endFrameMoment：明确描述本幕正文结尾急刹车（及对应 onEnded 交互前夕）的尾帧定格画面；
   - visualAnchor.promptZh / promptEn：专门生成本幕**尾帧单张完整场景图**的提示词，必须把 entityIds 中每个角色的外貌姿态与每个道具的位置状态全部融合进同一空间透视中，并沿用全剧统一画风。

请输出规范的 JSON 结构，包含 scenes: SingleSceneJson[] 与 summary: string。`;
}
