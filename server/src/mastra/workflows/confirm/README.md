# 施工图：互动影游 Agent 全链路（v2 —— 含音频工序与交互契约）

> 参照格式：`server/src/media/workflows/comfyui_t2i.json / comfyui_i2v.json`——ComfyUI API 格式的声明式节点图，加载即可执行。
> 本文档定义：**需要产出哪几份这种 JSON**、每份实现什么工作流、confirmUI 在哪里介入。
> v2 变更：新增 ⑦ 音频工序（旧版默片硬伤）；② 增加全片风格锚点；③④ schema 补交互字段；③ 取消可跳过。

---

## 0. 整体线框（最终口径，8 道工序）

8 道影游工序 × 三泳道分工（Agent / ConfirmUI / 媒体工作流）：

| 工序 | Agent 层 | ConfirmUI 卡 | 媒体工作流 |
|---|---|---|---|
| ① 叙事圣经 | 对话产出三幕+结局分支+角色名单 | 圣经定稿卡（纯文本） | 无 |
| ② 角色设计 | 角色 visualPrompt | 定妆卡：编辑提示词/**锁定风格锚点**/传参考图 | **5 份全挂这里**（t2i/三视图/图生图/动作/细节修改，单入口扇出） |
| ③ 场景剧本 | 按节点扩写+**产出抉择点文案 choiceText[]** | 剧本卡（**不可跳过**） | 无 |
| ④ 分镜 | 镜头表+运动提示词+**镜头标注 isInteractive/nodeRef** | 分镜表卡（nodeId 悬空红标禁通过） | 无 |
| ⑤ 关键帧 | 分镜视觉提示词（带 styleRef） | 样片卡：先 1 张校验（定调已在②完成） | 场景图复用 char_t2i → keyframe_i2v 样片 |
| ⑥ 视频切片 | agent 不参与 | 样片通过→批量卡 | keyframe_i2v 批量（部分失败只补失败） |
| ⑦ **音频配音**（新增） | 按镜头台词产出 TTS 文本+情感标记 | **试听卡：先 1 句定音色** | dialogue_tts.json（样片→批量） |
| ⑧ 影游装配 | agent 不参与 | 终审卡：覆盖率+试玩 | 装配 manifest（代码节点：视频+音轨混流） |

底部横向一层：**产物资产库（assets.json）**——所有工作流产出的图/视频/音频按 `{角色id或镜头id}_{类型}_{序号}` 登记（url / 来源工作流 / 参考了哪张图 / seed / 音色id），URL 注回 agent 上下文。

默认口径（可调）：**每个有产出的工序都停一次确认**；确认策略统一为"样片先行"——图 1 张、视频 1 镜、音频 1 句。

### 各工序内部 step 拆分（继承自 server_backup_v1 的领域分解，已验证，直接照搬）

v1 的 `src/pipelines/*` 已把每道工序拆成带独立 prompt + Zod schema 的串行 step（输出是下一个 step 的输入）。v2 的 workflow step 按这个粒度实现，**不要把一道工序压成一个巨型 step**：

| 工序 | 内部 step（串行） | 关键 schema 字段（v1 已定义） |
|---|---|---|
| ① 叙事圣经 | `story-spine`（故事脊柱）→ `pivot-points`（抉择点）→ `story-graph`（剧情图）→ `character-profiles`（角色小传） | spine: logline/goldenSpine(三幕+悬念断点)；pivot: macroPivotPoints[].choices[].text + microPivotPoints[]（互动机制）；graph: nodes[].id/choices[].targetNodeId/isEnding/endingType；characters: appearance/personality/motivation/arc |
| ② 角色设计 | `visual-spec`（视觉规格）→ `portrait-render`（定妆渲染）→ `quality-eval`（质检） | visualPrompt 锚点 + v2 新增 styleRef；quality-eval 对应门禁 |
| ③ 场景剧本 | `scene-structuring`（分场）→ `screenplay-expansion`（扩写） | 场次列表 + 每场抉择点；v2 新增 choiceText 归属 |
| ④ 分镜 | `shot-composition`（镜头切分）→ `continuity-audit`（连续性审计） | shotId/nodeRef + v2 新增 isInteractive；continuity-audit 对应门禁 |
| ⑤ 关键帧 | `prompt-enhancement`（提示词增强）→ `image-batch-render`（批量渲染） | 样片先行插在两 step 之间（suspend 点） |
| ⑥ 视频切片 | `motion-prompt-enhancement`（运动提示词增强）→ `video-batch-render`（批量渲染） | 同上，样片先行 |
| ⑦ 音频（v2 新增） | `dialogue-tts`（按镜头台词配音） | voiceId/情感/shotId 对应关系；样片先行 |
| ⑧ 影游装配 | `manifest-packaging`（打包）→ `master-assembly`（母带混流） | v2：视频+音轨混流、双 100% 校验 |

> 说明：v1 的 `pivot-points` 和 `story-graph` 里已经有 `choices[].text` / `targetNodeId` —— v2 提的 choiceText 交互契约在 v1 数据模型里已存在一半，缺的是"抉择出现在哪个镜头/时间点"（④ 的 isInteractive + 时序），这是唯一要新增的字段。

### 三个 v2 修正的落点

1. **风格锚点（②锁定，全程引用）**：定妆卡上用户上传一张风格参考图（或一段风格描述）→ 存为 `styleRef` → 之后所有生成（定妆/三视图/动作/⑤场景图/⑥视频）都携带。⑤样片确认从"定调"降级为"校验"，风格返工不烧已产出的钱。
2. **交互契约（③④的 schema 字段）**：③每个抉择点输出 `choiceText[]`（按钮最终文案）；④镜头表输出 `isInteractive: boolean` + `nodeRef`。⑧装配自动收集生成 manifest 的 choice 节点——上游不出这些字段，装配直接抛错。
3. **音频（⑦，新增工序）**：每镜头台词 TTS。**样片先行**：先出 1 句确认音色/语速/情感，通过后批量。TTS 按字数计费，确认卡必须显示预估总价。

## 1. 职责边界（先划清，防止再做错）

| 层 | 负责 | 不负责 |
|---|---|---|
| **Agent** | 剧本、故事结构、角色设定、**抉择点文案**、TTS 台词文本的生成与对话；产出各类提示词 | 不直接出图/出视频/出音频，不碰媒体管线 |
| **ConfirmUI** | 接收 agent 推来的提示词/参数，渲染成确认卡：编辑、上传参考图/风格图、调参、看预估成本；确认后触发工作流；结果展示+重画/细节修改入口 | 不生成内容、不做决策 |
| **工作流 JSON** | 纯媒体管线：文生图、三视图、图生图、动作、细节修改、图生视频、TTS。确定性执行 | 不理解剧情，不做任何内容判断 |

**数据流**：

```
agent 产出提示词/台词文本（或用户上传参考图/风格图）
      ↓
confirmUI 确认卡（编辑/传图/试听/确认）
      ↓ 确认
对应工作流 JSON 加载执行（变量注入 {{...}}）
      ↓
产物 URL 回 confirmUI 预览卡
      ↓ 不满意
重画（原参数+修改）或 细节修改（走 char_detail_fix）
```

## 2. 需要的 7 份 JSON 文件

所有文件放 `server/src/media/workflows/`（与现有 comfyui_*.json 同目录）。基础管线节点直接复用现有两份 JSON 里验证过的配置；**`{{...}}` 是 confirmUI 注入的变量**，其余为固定管线参数。

### 2.1 `char_t2i.json` —— 文生图·角色定妆

- **触发**：agent 生成角色 `visualPrompt` 后推给 confirmUI。
- **confirmUI 确认什么**：`{{visualPrompt}}` 可编辑（全片角色一致性锚点）；**`{{styleRef}}` 风格参考图/风格描述（v2 新增，全片视觉基调，此后所有生成携带）**；负面词、分辨率、seed 可选；显示预估成本。
- **工作流**：`{{visualPrompt}}` CLIPTextEncode（+ styleRef 参考）→ KSampler → 出 1 张定妆图。
- **输出**：定妆图 URL + seed（重画复现用）。
- **验收**：同 seed+同提示词重跑出同图；改提示词出不同图。

### 2.2 `char_three_view.json` —— 三视图

- **触发**：用户在定妆图预览卡点"出三视图"。
- **confirmUI 确认什么**：基准定妆图选择、视图规格（正/侧/背）。
- **工作流**：LoadImage → 参考图管线 → 三视图图组。
- **输入**：`{{characterImage}}`；**输出**：三视图 URL。
- **验收**：与定妆图特征一致（发型/服装/配色不漂移）。

### 2.3 `char_i2i_reference.json` —— 图生图·参考图生成角色

- **触发**：用户上传参考图（纯参考或与 agent 提示词混合）。
- **confirmUI 确认什么**：`{{referenceImage}}` 上传、`{{visualPrompt}}` 编辑、参考图影响强度。
- **工作流**：LoadImage + CLIPTextEncode → 图生图管线 → 角色形象图。
- **输出**：角色图 URL。产出可直接作为 2.2 输入。
- **验收**：保留参考图核心特征 + 提示词修改。

### 2.4 `char_pose.json` —— 动作生成

- **触发**：定妆/三视图卡上点"生成动作"，或 agent 按剧本动作需求批量推。
- **confirmUI 确认什么**：基准角色图、动作提示词列表 `{{posePrompts[]}}`（逐条编辑/勾选）、总价。
- **工作流**：LoadImage + 多条动作提示词 → 参考图管线 batch → N 张动作图。
- **输出**：动作图 URL 列表（每张对应哪条提示词）。
- **验收**：部分失败不整批作废，失败明细返回、可单条重跑。

### 2.5 `char_detail_fix.json` —— 角色/细节修改（定点重绘）

- **触发**：任意已产出图上点"修改细节"。
- **confirmUI 确认什么**：原图、修改指令 `{{fixPrompt}}`、（可选）涂抹蒙版 `{{maskImage}}`；**明示影响范围：整图重绘还是仅蒙版区域**。
- **工作流**：LoadImage + LoadMask（可选）→ inpainting 管线 → 局部重绘。
- **输出**：新图 URL + 旧图留存（版本对）。
- **验收**：带蒙版时只有蒙版区域变化；无蒙版时整图按指令重绘。

### 2.6 `keyframe_i2v.json` —— 图生视频（已有 comfyui_i2v.json，参数化改造）

- **触发**：分镜关键帧确认后，先 1 镜样片，通过后批量。
- **confirmUI 确认什么**：首帧图、`{{motionPrompt}}`、时长/fps；快捷反馈 chips（运镜太快/人物崩了）。
- **工作流**：LoadImage + 运动提示词 → i2v 管线 → 视频切片。
- **验收**：样片 revise 只重渲样片；approve 后批量，部分失败落明细。

### 2.7 `dialogue_tts.json` —— 台词配音（v2 新增）

- **触发**：⑥视频切片确认后，agent 按镜头产出台词文本+情感标记（平静/紧张/悲怆…），推给 confirmUI。
- **confirmUI 确认什么**：
  - **先试听 1 句**（`{{sampleText}}`）：选音色（`{{voiceId}}`，按角色分配）、语速、情感——**音色是全片听觉锚点，等同②的角色锚点**
  - 通过后批量：逐镜头台词列表 `{{lines[]}}`（每条 = shotId + text + emotion）、按字数预估总价
- **工作流**：TTS 管线（音色+文本+情感参数）→ 音频片段（wav/mp3）。
- **输出**：每镜头音频 URL 列表（对应 shotId），供⑧混流。
- **验收**：同 voiceId+同文本重跑出同音频；部分镜头失败只补失败；台词与镜头一一对应（对不上即抛错，不许静默缺声）。

> 场景/分镜关键帧文生图**不单独开文件**：复用 `char_t2i.json`（`{{visualPrompt}}` 换成分镜提示词，携带 `{{styleRef}}`）。分镜图需角色一致性时用 `char_i2i_reference.json` 传定妆图为参考。

## 3. confirmUI 卡片对照表（前端要做几张卡）

| 卡片 | 对应工作流 | 可编辑 | 特殊交互 |
|---|---|---|---|
| 圣经定稿卡 | 无（纯文本确认） | 角色名单、结局分支 | 定稿后注入 agent 记忆 + 落盘 |
| 角色定妆卡 | char_t2i | visualPrompt、**styleRef（风格锚点）**、seed | 重画、出三视图入口、上传参考图入口 |
| 三视图卡 | char_three_view | 基准图选择 | 生成动作入口 |
| 参考图卡 | char_i2i_reference | 上传图、visualPrompt | 产出可进三视图流程 |
| 动作卡 | char_pose | 逐条动作提示词、勾选 | 总价显示、失败单条重跑 |
| 细节修改卡 | char_detail_fix | 修改指令、蒙版涂抹 | 影响范围明示 |
| 剧本卡 | 无 | choiceText 文案 | **不可跳过**；抉择点悬空红标禁通过 |
| 分镜表卡 | 无 | 镜头参数 | nodeId 悬空红标、`isInteractive` 镜头标 ⚡ |
| 图样片卡 | char_t2i / i2i | 重画参数 | 通过后批量（styleRef 校验点） |
| 视频样片卡 | keyframe_i2v | motionPrompt | 快捷反馈 chips → 通过后批量 |
| **TTS 试听卡（v2 新增）** | dialogue_tts | 音色、语速、情感 | 试听 1 句定音色 → 批量总价确认 → 失败单句重跑 |
| 终审卡 | 无（装配） | — | 覆盖率 100% 禁否则不放行；试玩嵌入；**音频完整率校验** |

## 4. Schema 交互契约（v2 新增，⑧装配的前置条件）

| 工序 | 必须输出的字段 | 装配校验 |
|---|---|---|
| ① 圣经 | `storyGraph.nodes[].id`、`endings[].id` | 全链 nodeId 源头 |
| ③ 剧本 | 每个抉择点 `choiceText[]`、`targetNodeId` | 悬空 targetNodeId 抛错 |
| ④ 分镜 | 每镜头 `shotId`、`nodeRef`、`isInteractive`、`durationSec` | nodeRef 悬空抛错；isInteractive 镜头必须有 nodeRef |
| ⑦ 音频 | 每条 `shotId` + audioUrl | 与④镜头表一一对应，缺一个即抛错 |
| ⑧ 装配 | manifest.choice 节点 = ④ 的 isInteractive 镜头集合；每节点视频+音轨齐备 | **覆盖率 100% + 音频完整率 100% 才允许交付** |

## 5. 总验收链路

agent 生成剧本 + 角色提示词 → 定妆卡改一句提示词 + 锁定风格参考图 → 确认出图 → 出三视图 → 勾选 2/5 条动作生成（只算 2 张钱）→ "围巾改红"走细节修改（蒙版区域）→ 上传自己的参考图走图生图换角色 → 分镜确认（悬空 nodeId 被红标拦住，补齐才放行）→ 关键帧样片（风格已锁，仅校验）→ 批量出图 → 视频样片 1 镜 → 批量渲染（缺 1 落明细只补 1）→ **TTS 试听 1 句定音色 → 按台词批量配音** → 终审：覆盖率 100% + 音频完整率 100% → 试玩通过 → 交付。

全程铁律不变：**agent 没碰过媒体管线；工作流没做过任何内容判断；每次花钱执行前都有一张确认卡。**
