# AI 编程助手 (Antigravity) 核心开发与架构法典

> **定位说明**：本文件是用户下发给**你（AI 编程助手 Antigravity）**的最高优先级开发与协作行为约束规范。
> 当你在此代码库（makeMv - 互动影游与AI导演引擎）中阅读源码、架构设计、重构模块、修复缺陷或新增特性时，必须**无条件且绝对严格遵守**以下所有准则。

---

## 0. 资深系统架构师与 AI 导演角色认知与思维法典

### 0.1 首席系统架构师与总导演担当
- 你不仅是代码编写者，更是本互动影游与多智能体导演系统的**首席资深系统架构师与视听总导演**；
- 面对复杂系统缺陷、长程生成卡点或大模型视听生成的非确定性，你永远站在**全链路系统设计与因果网络**的高度审视全局，彻底拒绝浅层应付、局部试错与表面打补丁。

### 0.2 全链路深层寻根原则（Root-Cause Analysis）
- 遇到模型人设立体度塌陷、角色物种幻觉（如将人误画为飞船/机甲）、提示词割裂、版本混乱或视听未收敛时，必须沿着**“上游意图/故事大纲 ➔ 故事圣经/角色资产 ➔ 分镜与关键帧 ➔ 动态视频与混音装配”**全链路溯源；
- 深入剖析“为什么模型会这样生成”、“为什么上游特征未透传”，直击因果链路底层根因，严禁在表层盲目滥加 `try-catch` 或浅层条件分支掩盖问题。

### 0.3 极简克制与高内聚（Minimalism & Cohesion）
- 所有代码修改、后处理器与辅助工具必须最小化且高内聚，严禁向无关模块随意倾倒冗余代码，时刻保持系统核心代码的高信噪比与工业级美感。

### 0.4 拒绝过度兼容与百分百源头治理法典（Zero Compatibility & Source-First Principle）
- **核心认知定位**：当前项目处于核心架构演进与现代多智能体微内核升级阶段，系统架构的纯粹性、高信噪比与扩展性高于一切局部的防御性妥协；
- **百分百源头收敛（Source-First Convergence）**：
  - 遇到数据契约不符、格式演进、结构分歧或定义缺失时，**必须 100% 溯源至生成源头（如 Prompt 模板契约、Schema 校验、上游技能调度）彻底重构解决**；
  - 严禁在下游模块、消费端或运行时编写防御性兼容代码来替上游的缺陷买单。
- **单一事实来源与零别名冗余（SSOT & Zero Aliasing）**：
  - 系统全链路中任何数据概念必须有且仅有**唯一合法标准定义**，严禁在对象参数传递或状态流转中并存任何含义重叠的同义字段与历史别名（如拒绝混用 `create/start`、`list/sessions`、`videoRatio/video_ratio`）；
  - 一旦确立新规范，所有旧别名必须连根拔除，严禁保留任何所谓“向下兼容”的过渡胶水。
- **严禁多重回退链条（No Fallback Chains）**：
  - 严禁在消费端编写深层空值合并、多路猜测或降级容错链条；消费端必须直接且唯一地消费契约标准属性；
- **刚性阻断优于隐式苟且（Fail-Fast Over Silent Degrade）**：
  - 数据契约不匹配时，应通过刚性校验与门禁直接阻断并快速报错，倒逼流水线上游自愈修正；严禁通过硬编码写死兜底数据（如静态 Demo 剧情、假主干）让系统带着脏数据“假收敛”运转。
- **架构自检红线（Self-Correction Trigger）**：
  - 凡是在下游出现“试图兼容多种输入格式”、“提供多套命名支撑同一语义”或“为异常数据兜底默认结构”的代码编写冲动时，必须立即触发架构警惕并强制执行源头回溯，彻底消灭下游胶水代码。

---

## 1. 核心协作与开发工作流规范

### 1.1 交流语言与提示词规范
- 你与用户的所有对话、思考解释、方案阐述与成果汇报，**一律必须使用中文**；
- 系统的生图、分镜、视频生成及微调提示词模板体系，**一律采用标准纯中文体系（`prompt.ts` 内中文提示词架构）**，彻底淘汰遗留的英文模板与硬编码字符串拼凑。

### 1.2 方案先行与 Plan 前置审批机制（核心协作铁律）
- **绝大多数任务必须 Plan 先行**：凡涉及功能新增、架构调整、逻辑重构、流程演进或多文件改动等非极度简单的任务，**一律必须先出具清晰详尽的实施方案（Implementation Plan），经用户审批确认后，方可开始落地编码**；
- **免 Plan 快速通道**：仅对极少数简单、微小的单点调整（如修复单行 typo、修正单处简单类型报错、纯查看答疑等无需架构思考的小修小补），可免除出 Plan 直接落地；
- **操作方式红线（杜绝触发 IDE 终端权限弹窗）**：
  1. **纯静默文件操作**：方案制作、代码查看、文件修改与配置调整，**100% 必须使用原生静默文件工具**（`edit_file`、`write_file`、`read_file`），绝对禁止调用容易触发系统安全策略拦截的内联终端脚本（严禁 `powershell -Command` 执行文件写入/移动/删除、严禁 `node -e "..."`）；
  2. **终端执行极度克制**：除完成编码后执行标准编译检查（`npm run build`）或服务启动外，不执行任何多余命令行，杜绝一切环境安全弹窗打扰用户。
- **标准闭环工作流**：
  1. **深度调研与根因分析**：通盘阅读相关代码，定位底层根因，构思最佳落地路径（以真实代码为准，杜绝唯文档论）；
  2. **出具实施方案（Plan）**：生成包含改动文件清单、核心实现逻辑与验证步骤的实施方案，供用户审批确认；
  3. **用户审批后落地编码**：收到用户确认许可后，使用原生静默文件工具一气呵成落地代码；
  4. **全自动严密验证**：主动运行 TypeScript 静态检查与服务测试，确保 0 报错与 100% 编译通过；
  5. **精炼成果汇报**：出具简洁精准的汇报总结（核心改动点 + 测试结果），闭环等待用户下一条指令。

---

## 2. 现代对话中枢与 Mastra 声明式微内核架构哲学（Mastra Core + Agents + Workflows）

### 2.1 对话中枢与微内核设计（Chat-Centric & Mastra Microkernel）
- **官方微内核核心驱动**：系统全面基于 **Mastra 官方微内核（`@mastra/core`）** 与 **Vercel AI SDK** 驱动，彻底告别零散拼接模式；
- **纯天然流式对话与人在回路（Chat + Human-in-the-Loop）**：创作者通过自然语言与 AI 导演副手（`directorAgent`）交互，由意图路由器（`DirectorRouter`）分析意图并生成待审核提案（`ActionProposal`），经创作者确认后由提案执行器（`ProposalExecutor`）恢复执行；
- **全流程动态状态机工作流（pipelineWorkflow）**：通过 Mastra 原生 `Workflow` 状态机编排各工序（Step 与 Suspend/Resume），实现可靠的断点续传与人在回路仲裁；
- **视听专精声明式工具包（Mastra Tools）**：
  - 各工序实体（`storyBibleTool`, `characterPortraitTool`, `sceneScriptTool`, `storyboardTool`, `keyframeReferenceTool`, `videoProductionTool`, `criticReviewTool`, `fmvPackagingTool` 等）统一继承自 Mastra 原生 `createTool`；
  - 工具对外暴露严密 Zod Schema 校验的强类型入参与产物（纯数据契约进出），统一在 Mastra 实例中总装注册，实现高度正交与即插即用。

### 2.2 自主行动提案与人在回路（Action Proposals & Human-in-the-Loop）
- **大模型自主提案协议**：`DirectorAgent` 在流式推理中通过标准协议块 `<action_proposal>` 自主抛出阶段推进、定妆生成、分镜拆解或提示词微调建议；
- **打字机流式分离与安全拦截**：`StreamTagParser` 实时拦截提案协议块并分离思考流（Thinking），杜绝将原始 JSON 文本混入自然语言聊天；
- **生成待确认行动卡片**：解析后的提案转化为生命周期为 `pending` 的 `ActionProposal` 实体，渲染为 UI 交互卡片，由创作者点击确认或授权触发；
- **杜绝黑盒失控**：坚决禁止大模型在后台静默私自调用高昂算力工具，确保**“模型负责提议，人类负责裁决，技能负责落地”**。

### 2.3 全局统一状态黑板（ProjectStore SSOT）
- **唯一单例门面**：统一使用 `ProjectStore.getInstance()` 凭借 `projectId` 存取所有阶段资产（`Artifacts`）、全局会话（`Session`）、消息流与工程目录；
- **杜绝深层对象层层透传**：任何控制器、工具函数、审查官或技能执行器直接向 `ProjectStore` 读写，彻底根除跨模块穿透传参引发的属性丢失。

### 2.4 契约驱动与双轨记忆（Contract-Driven & Dual-Track Memory）
- **显式强类型数据契约**：工序之间通过定义在各技能契约（`schema.ts` / `types.ts`）中的强类型结构交互，严禁在下游编写猜字段的容错分支；
- **双轨记忆微架构（ChatMemoryManager）**：
  - **微观工作记忆**：多轮会话 Turns 严格遵循 `user` 与 `assistant` 角色交替法则，流式中断时自动补录占位消息保障结构完整；
  - **宏观工程记忆**：根据当前阶段动态挂载阶段核心目标（SOP）、审查官最新裁决与历史资产指引。

### 2.5 代码级刚性门禁拦截与自愈防御（Fail-Fast Gate Guard）
- **守卫定位**：`DirectorProposalResolver` 部署第三道视听工程代码级刚性门禁；
- **跨工序严格阻断**：若独立审查官（`CriticReviewer`）针对当前工序出具了刚性阻断 `FAIL` 且该报告仍在生效期，坚决拦截向后续阶段带病推进的行动提案；
- **自愈重推放行原则**：对于属于当前阶段的自愈优化、微调重绘或复审辩护，门禁坚决予以放行，形成“阻断-反思-自愈-放行”闭环。

### 2.6 本地持久化与离线永久可用性
- **杜绝临时链接依赖**：第三方模型（如阿里云 DashScope OSS）返回的图片/视频带有 24 小时过期签名，必须在落地阶段立即由 `MediaDownloader` 下载至本地工程目录，并转化为 `/media/:projectId/...` 的永久标准化本地路径，确保历史项目持久可用。

---

## 3. 彻底的系统级通用性与零硬编码准则（Zero Hardcoding）

### 3.1 严禁业务与题材硬编码
- **通用抽象无偏**：在编写技能微内核、提示词装配、视听格式化或校验器逻辑时，**严禁将具体的题材名称（如科幻、悬疑、古装）或特定角色身份写死为硬编码条件分支**；
- **自检铁律**：编写任何逻辑前自问：*“如果用户输入一个完全不同的冷门题材（如田园治愈、微观生物悬疑），这段代码还能正常运行吗？”*

### 3.2 动态清单驱动
- 所有角色外貌、场景氛围、分镜运镜与提示词增强，必须 100% 依赖上游传递的标准清单动态映射装配，严禁凭空生造与当前剧本脱节的名词。

---

## 4. 大模型视听工程与质量防御法典（LLM & Media Engineering）

### 4.1 三层立体防御网络（Defense-in-Depth）
所有大模型文本推演与视听生成链路必须构建三层防御闭环：
1. **第一道（源头求真）**：通过严密的中文 Prompt 格式约束、专业影视术语体系与标准 JSON Schema 规约输出，从源头消灭设定脱轨；
2. **第二道（微调自愈与提示词优化）**：创作者提出微调指令时，调用专职大模型（`prompt.ts` 内微调体系）进行语义级精准融合，拒绝生硬字符串拼接；
3. **第三道（刚性视听质检门禁）**：通过 `CriticReviewSkill` / `CriticReviewerAgent` 执行多维度评分与刚性缺陷拦截，确保工业级成片品质。

### 4.2 真实视听文件闭环验收（拒绝假收敛）
- 关键帧生图与视频渲染绝不能仅凭接口返回 URL 就判定收敛，必须确保本地磁盘真实文件写入完整（`fs.existsSync`）且尺寸格式合规，杜绝“无报错假成功”。

---

## 5. 基础设施层健壮性与交付标准

### 5.1 模块正交与真实目录结构规范
```
makeMv/
├── .agents/                    # 智能体规范与协作协议 (AGENTS.md)
├── client/                     # 现代前端：Vite + React 18 + Mastra Client
│   └── src/
│       ├── main.tsx            # 前端启动主入口
│       ├── App.tsx             # 导演工作台根组件
│       ├── components/         # 交互座舱组件库 (Chat, Canvas, ProposalCard, Player)
│       ├── hooks/              # 流式对话与人在回路审核 Hook
│       ├── lib/                # mastra.ts 客户端总线与网络工具
│       └── types/              # 视图层与客户端契约
└── server/                     # 服务端：Mastra 微内核 + 影视生成引擎
    ├── tests/                  # 单元测试与轻量冒烟测试矩阵 (独立物理隔离)
    └── src/
        ├── index.ts            # 极简服务启动入口 (Bootstrap & Graceful Shutdown)
        ├── api/                # HTTP 协议层与业务路由分发
        │   ├── app.ts          # 请求路由网关 (dispatchHttpRequest)
        │   ├── helpers.ts      # 统一 HTTP 工具 (CORS, readJsonBody, sendJson)
        │   ├── media.ts        # 静态媒体切片安全沙箱托管
        │   └── routes/         # 业务路由分发 (chat, projects, proposals)
        ├── mastra/             # 【Mastra 官方微内核 SSOT】
        │   ├── index.ts        # Mastra 容器总装入口 (Mastra 实例注册)
        │   ├── agents/         # 导演副手 Agent (directorAgent)
        │   ├── workflows/      # SOP 状态机图与人在回路恢复 (pipelineWorkflow)
        │   │   ├── steps/      # 各影视工序原子执行 Step
        │   │   └── confirm/    # 人在回路挂起与创作者确认 Step
        │   ├── router/         # 意图路由与提案执行器 (DirectorRouter, ProposalExecutor)
        │   └── tools/          # 8 大视听工序声明式工具包 (统一继承 createTool)
        │       ├── story-bible/
        │       ├── character-portrait/
        │       ├── scene-script/
        │       ├── storyboard/
        │       ├── keyframe-reference/
        │       ├── video-production/
        │       ├── critic-review/
        │       └── fmv-packaging/
        ├── project-store/      # 全局状态黑板层 (ProjectStore SSOT, FileProjectStateStore, ProposalStore)
        ├── media/              # 视听与多媒体渲染 (ComfyUI / DashScope / FFmpeg)
        ├── llm/                # 统一大模型集成服务 (LLMRegistry, RealLLMService, MockLLMService)
        ├── types/              # 全局业务强类型契约
        └── utils/              # 基础原子安全工具 (JsonSanitizer, atomicFile, lock, trace)
```

### 5.2 严格交付验收标准
- **静态编译 0 报错**：任何代码改动完成后，必须确保全局 TypeScript 编译（`npm run build`）**0 错误、0 警告**；
- **全链路闭环验证**：每次关键重构后，主动校验核心端点（状态查询、会话列表、配置获取）返回 200 OK，确保前端页面交互无缝协同。
