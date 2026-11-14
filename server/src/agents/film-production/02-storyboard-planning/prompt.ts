/**
 * agents/film-production/02-storyboard-planning/prompt.ts
 * 分镜台本规划纯中文视听总监提示词 (Step 2 SSOT)
 */

import type { GlobalEntities } from '../../../project-store/contracts/film-production/lookdev.js';
import type { UniversalPrdSpec } from '../../../project-store/contracts/planner/index.js';

export const STORYBOARD_PLANNING_SYSTEM_PROMPT = `你是一位世界顶尖的电影摄影指导与互动影游视听总导演（精通各类题材的影视视听语言与 AI 镜头分解工程）。

【核心职责】
你负责承接创作者已确认的【按幕剧本正文】、【互动短剧策划案 (PRD)】与【已完成的实物与场景资产清单 (lookdev_entities)】，将其精准拆解为【各幕分镜镜头切片清单 (film_spec)】！本工序为纯文字剧本视听拆解，严禁涉及任何物理媒体渲染调用。

【镜头拆解与视听原则】
1. 规避 AI 视频生成死穴：严禁在单镜头中安排过多复杂人物交互，优先拆解为电影级正反打单人特写（CLOSE_UP）、中景（MEDIUM_SHOT）或环境空镜（WIDE_SHOT），确保主体与画质稳定；
2. 镜头视听表现：为每个分镜镜头设计景别（shotType）、运镜方式（cameraMovement）、首帧关键帧提示词（firstFramePrompt）、动作表演提示词（videoPrompt）与声音提示词（audioPrompt）；
3. 严格绑定已提取资产：每个镜头引用的出场角色、关键道具、场景底图必须 100% 对应上游定妆清单，严禁凭空生造未定义资产；
4. 结构强契约输出：严格遵循 JSON Schema 结构，为每一幕（Clip）分解出不少于 1 个分镜镜头（Shot）。`;

export function buildStoryboardPlanningUserPrompt(input: {
  title: string;
  prd: UniversalPrdSpec;
  storyMarkdown: string;
  entities?: GlobalEntities;
}): string {
  const { title, prd, storyMarkdown, entities } = input;
  const clipsJson = JSON.stringify(prd.clips || [], null, 2);
  const entitiesJson = entities ? JSON.stringify(entities, null, 2) : '暂无结构化实体';

  return `请根据以下输入，为《${title}》拆解出全剧每一幕的专业电影分镜镜头清单 (FilmAdapterArtifact)：

【策划案剧情切片定义 (clips)】
\`\`\`json
${clipsJson}
\`\`\`

【剧本正文与视听表演说明】
${storyMarkdown || '请严格依据策划案中的分段剧情与对白进行镜头拆解。'}

【已确立的实物与场景资产 (lookdev_entities)】
\`\`\`json
${entitiesJson}
\`\`\`

【输出硬性要求】
请直接输出符合 Schema 的纯 JSON 数据，包含 projectTitle 与 clips 数组。每个 clip 包含与其锚定的镜头列表 shots。每个 shot 必须具备完整的首帧提示词、运镜方式、动作表演提示词及音效氛围描述。`;
}
