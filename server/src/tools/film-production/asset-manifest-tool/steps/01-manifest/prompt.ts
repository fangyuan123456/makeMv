/**
 * tools/film-production/asset-manifest-tool/steps/01-manifest/prompt.ts
 * 全剧资产清单发现提示词 (Asset Manifest Prompt SSOT)
 */

export function buildAssetManifestPrompt(params: {
  title?: string;
  storyMarkdown: string;
  prd?: any;
}): string {
  const { title, storyMarkdown, prd } = params;

  return `你是一名享誉好莱坞的资深电影制片统筹与选角总监（Film Production Coordinator & Script Breakdown Supervisor）。
请依据影视工业标准剧本分解规范（Hollywood Script Breakdown Pipeline），通读剧本与策划案，提炼全剧的高信噪比核心资产清单：

【故事标题】：${title || '未命名影视项目'}

【策划案/世界观大纲】：
\`\`\`json
${JSON.stringify(prd || {}, null, 2)}
\`\`\`

【剧本正文】：
\`\`\`markdown
${storyMarkdown || '请结合项目剧情提取出场资产'}
\`\`\`

【影视工业三大资产分类与收敛刚性公理（SSOT · 100% 通用无偏）】：
1. 🎭【角色公理 (Speaking Cast & Agency · 严格控制 3~5 位)】：
   - 必须以剧本中真正有对白发言、独立台词交互或主导核心戏剧冲突的能动主体为准；
   - 具象化灵异实体、人形傀儡、非人化身或关键智能造物，只要具备独立戏剧交互能动性，100% 统一定性为角色（严禁被误定为道具或场景陈设）；
   - 100% 绝对严禁提取泛用无名路人、背景群演或单次功能性过客；
   - 数量指标：全剧核心主角 1~2 位，重要配角 2~3 位，总数严格控制在 3~5 位。

2. 🏛️【宏观母场景聚类公理 (Master Location Clustering · 严格控制 2~3 个)】：
   - 必须以全剧戏剧冲突发生的【宏观三维物理建筑/地理实体（Master Set）】为最小定妆单元；
   - ⚠️【绝对刚性禁令 · 严禁碎片化机位场景】：100% 绝对严禁将同一栋建筑或物理区域的不同房间、偏房、角落、门廊或特定分镜机位视点拆分为多个独立场景！
   - 上述属于同一母体建筑的各个具体发生角落，必须全部聚类为一个唯一的宏观母场景（如：主宅院、主街区），并在其 subScenes 数组中完整登记包含的子机位/偏房列表；
   - 数量指标：整部短剧的核心宏观主场景严格控制在 2~3 个，从源头杜绝场景碎片化！

3. 🗝️【道具触碰铁律公理 (Actor Touches It · 严格控制 1~3 件)】：
   - 必须严格遵循影视工业唯一道具法则：【Actor touches it】——仅限演员在戏中亲手握持、抓取、翻阅、交付或承载核心解谜与因果逆转的关键信物（Hero Props，如关键遗物、解谜信件、专属信物）；
   - ⚠️【绝对刚性禁令 · 严禁提取生活环境陈设】：凡是摆在背景、挂在墙上、放在桌案上但演员从未拿起来操作的生活陈设与家具（如香炉、烛台、挂画、茶杯、桌椅），100% 属于场景固定硬装，绝对严禁作为独立道具提取！
   - 数量指标：全剧关键信物道具严格控制在 1~3 件。

4. 📌【PRD 锚点优先对齐】：
   - 优先继承工序 1（Planner）在策划案 PRD 中已经确立的角色与核心空间名称，保持全剧术语 100% 一致，严禁随意更名。

请输出严格符合 AssetManifestOutputSchema 的 JSON。`;
}
