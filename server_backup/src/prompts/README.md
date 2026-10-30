# makeMv 工业级影视与互动影游 Prompts 提示词分类规范

本文档详尽梳理系统内所有 LLM 与图像/视频生成模型的提示词体系（Prompt Templates）。
所有模板均统一归纳在 `server/src/prompts/templates/` 目录下，解耦硬编码，支持插值渲染、多语言回退及自愈挽回。

---

## 目录结构与 9 大类别总览

```
server/src/prompts/templates/
├── bible/              # 1. [大纲企划与故事圣经] - 全剧宏观架构、主体第一性原理对齐、看点提炼及多集规划
├── script/             # 2. [单集剧本与分场视听] - 单集深化分场视听剧本、黄金钩子、结尾断章与格式自愈
├── character/          # 3. [角色设计与实体概念] - 概念设计视觉卡、高信息密度英文生图 Prompt 与质量评估
├── storyboard/         # 4. [分镜头设计与视听调度] - 环环相扣连续镜头组规划、主角视线支配与连续性工业审计
├── reference/          # 5. [首帧与视觉参考] - 镜头首帧参考图生成与一致性锁死
├── video/              # 6. [视频生成与动力学镜头] - 视频前后缀增强词库、胶片质感与动力学运镜控制
├── genres/             # 7. [影视类型与戏剧范式库] - 叙事弧线 (narrative_arc) 与一票否决边界 (negative_rules)
├── style/              # 8. [视觉渲染与艺术风格库] - 电影写实、赛博朋克、日漫、水墨等预设描述符
└── doctor/             # 9. [错误自愈与诊断医生] - 生成拦截、敏感词替换、超长提示词自愈重写
```

---

## 详细分类说明

### 1. 全剧企划与故事圣经 (`bible/`)
* **定位**：影视工业第一阶段。将用户原始灵感通过 LLM 意图路由至最契合的影视范式，并架构起不可推翻的世界观与故事圣经。
| 模板名称 | 对应文件 | 核心职责与规范 | 关键入参变量 |
| :--- | :--- | :--- | :--- |
| `generate_bible` | `generate_bible_zh.txt` | 架构全剧标题、题材标签、总梗概 (Logline)、核心商业看点、主角清单及分集规划 | `{genre_name}`, `{genre_id}`, `{narrative_arc}`, `{negative_rules}`, `{episodes}` |
| `revise_bible` | `revise_bible_zh.txt` | AI Copilot 响应创作者自由指令，定向修订大纲企划，保持核心设定稳定 | 同上 |
| `route_genre` | `route_genre_zh.txt` | 影视类型智能意图路由器，从 `genres/` 库中动态判定匹配类型 | `{catalog}` |

### 2. 单集剧本与分场视听 (`script/`)
* **定位**：影视工业第二阶段。将大纲下钻深化为视听语言强烈的可拍摄长文本分场剧本。
| 模板名称 | 对应文件 | 核心职责与规范 | 关键入参变量 |
| :--- | :--- | :--- | :--- |
| `expand_episode` | `expand_episode_zh.txt` | 单集剧本详写，执行【黄金3秒开篇抓眼钩子】与【结尾掐脖子断章】 | `{genre_name}`, `{episode_number}`, `{episode_title}`, `{narrative_arc}` |
| `smart_continue_script` | `smart_continue_script_zh.txt` | 剧本断点智能续写，无缝顺接剧情与角色动作 | `{context}`, `{previous_scene}` |
| `repair_episode_count` | `repair_episode_count_zh.txt` | 修复剧本集数缺失、行数越界或格式格式自愈修正 | `{current_script}`, `{target_episodes}` |
| `eval_dialogue` | `eval_dialogue_zh.txt` | 评估台词密度、冲突压迫感与角色人设对齐度 | `{script}` |
| `eval_plot` | `eval_plot_zh.txt` | 评估剧情节奏、转折推进与逻辑自洽性 | `{script}` |

### 3. 角色设计与实体概念 (`character/`)
* **定位**：概念艺术与角色外观锁死。杜绝随机人脸，为后续分镜与视频奠定唯一视觉基准。
| 模板名称 | 对应文件 | 核心职责与规范 | 关键入参变量 |
| :--- | :--- | :--- | :--- |
| `character_design` | `character_design_zh.txt` | 输出角色实体视觉卡（人类、怪兽神魔、机甲载具），直接提炼独立 `imagePrompt` | 无（由系统输入解析） |
| `character_image_prompt` | `character_image_prompt_en.txt` | 提炼 30-45 词纯正英文顶级生图 Prompt，聚焦构图、材质、光影与体量 | `{name}`, `{role}`, `{appearance}` |
| `character` | `character_zh.txt` | 纯白背景四视角（正面肖像、正面全身、侧面全身、背面全身）角色一致性基线图 | `{style}`, `{name}`, `{desc}` |
| `eval_character` | `eval_character_zh.txt` | 视觉与质量评估（LLM/Vision-as-a-Judge），输出多维度分数与达标状态 | `{character_info}` |
| `eval_select_best` | `eval_select_best_zh.txt` | 在多版本生成图中打分推选最佳版本 | `{candidates}` |

### 4. 影视分镜头与视听调度 (`storyboard/`)
* **定位**：视听语言拆解。遵循起·承·转·合·余递进链，杜绝画面空间乱跳。
| 模板名称 | 对应文件 | 核心职责与规范 | 关键入参变量 |
| :--- | :--- | :--- | :--- |
| `storyboard_design` | `storyboard_design_zh.txt` | 规划 5 个连续镜头组，以第一主角为绝对视线中心，统一时空光影与外貌继承 | 无（上下文全量组装） |
| `staging_continuity` | `staging_continuity_zh.txt` | 工业级分镜连续性审计，检查跳轴、主角缺席、光影断裂并输出补丁修复 | `{episode_number}`, `{episode_title}`, `{segments}` |
| `segment_design` | `segment_design_zh.txt` | 剧本段落向分镜单元细化切分 | `{episode_number}`, `{location}`, `{characters}`, `{items}` |
| `segment_plan` | `segment_plan_zh.txt` | 镜头时序与节奏时长配置 | `{total_duration}` |

### 5. 首帧与视觉参考 (`reference/`)
* **定位**：分镜画面视觉锚点。为图生视频（I2V）或两帧过渡提供高画质起始帧。
| 模板名称 | 对应文件 | 核心职责与规范 | 关键入参变量 |
| :--- | :--- | :--- | :--- |
| `first_frame` | `first_frame_zh.txt` / `en` | 继承分镜与角色外貌特征的首帧生成提示词 | `{shot_info}`, `{character_traits}` |
| `eval_first_frame` | `eval_first_frame_zh.txt` | 首帧画面质量与连续性合规审查 | `{shot}`, `{image}` |

### 6. 视频生成与动力学镜头 (`video/`)
* **定位**：视频模型（Wan 2.1 / Kling / Runway 等）专用提示词优化与运镜控制。
| 模板名称 | 对应文件 | 核心职责与规范 | 关键入参变量 |
| :--- | :--- | :--- | :--- |
| `enhance` | `enhance.txt` | 高质量通用前缀、无畸变后缀以及针对各画风的专属增强关键词库 | `[prefix]`, `[suffix]`, `[style_keywords]` |
| `motion_prompt` | `motion_prompt_zh.txt` | 推、拉、摇、移、俯仰升降及手持呼吸感的专业摄影机运动控制词库 | `[push_in]`, `[pull_out]`, `[orbit]` 等 |

### 7. 影视类型与戏剧范式库 (`genres/`)
* **定位**：类型解耦化系统。每个范式包含 `meta.json`、`narrative_arc.txt` 与 `negative_rules.txt`：
- `general/`：经典通用影视范式
- `interactive_fmv/`：互动影游范式（第一人称 POV、直面视线接触、高频分支选择与好感度羁绊）
- `versus/`：双雄争霸 / 宿命对决范式（双主角绝对视线中心、战损升级）
- `suspense/`：悬疑推理范式（伏线前置、多重误导、抽丝剥茧与逆转）
- `scifi_adventure/`：科幻冒险范式（硬核工业美学与视听奇观）
- `short_drama/`：快节奏微短剧范式（情绪极速反转与黄金断章）

### 8. 视觉渲染与艺术风格库 (`style/`)
* **定位**：生图与生视频的美术基调描述：
`realistic.txt`、`cyberpunk.txt`、`anime.txt`、`chinese-ink.txt`、`3d-disney.txt`、`comic-book.txt`、`oil-painting.txt`、`cartoon.txt`。

### 9. 错误自愈与诊断医生 (`doctor/`)
* **定位**：生成故障自愈防护盾。
| 模板名称 | 对应文件 | 核心职责与规范 | 关键入参变量 |
| :--- | :--- | :--- | :--- |
| `diagnose` | `diagnose_zh.txt` | 诊断失败类型（内容安全违规、超长提示词拦截、格式错误），判断是否自愈挽回 | `{stage}`, `{model}`, `{error}`, `{original_prompt}` |
| `rewrite_prompt` | `rewrite_prompt_zh.txt` | 在保留核心视觉特征的前提下，剔除敏感违规词、压缩冗余词并改写为安全提示词 | 同上 |

---

## 代码中加载与调用规范

系统提供统一模块 `server/src/prompts/loader.ts`：

```ts
import { loadPrompt, formatPrompt, loadPromptSafe, listPromptCategories } from '../prompts/loader.js';

// 1. 加载并格式化模板
const template = loadPrompt('bible', 'generate_bible', 'zh');
const prompt = formatPrompt(template, {
  genre_name: '宿命对决',
  episodes: 3,
});

// 2. 带安全回退的加载
const systemPrompt = loadPromptSafe('character', 'character_design', 'zh', '默认提示词');

// 3. 获取所有分类目录元数据
const categories = listPromptCategories();
```
