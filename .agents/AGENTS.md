# makeMv 开发协作约定

本文件面向修改 makeMv 仓库的 AI 编程助手，不是产品内导演 Agent 的系统提示词。遵循宿主指令和用户当前要求；本文件不声明高于它们的优先级。

架构核对日期：2026-11-22。以下以当前工作区实现为依据；修改前仍应核对源码、工具注册和契约，不能为符合旧文档而回退现有实现。

## 1. 开发工作方式

- 使用中文交流，说明具体问题、修改结果和验证情况，避免夸大保证。
- 先定位问题及其直接依赖，再做最小完整修改。涉及数据丢失、资产失效或生成偏差时沿生产、存储、消费链路排查，不因“源头治理”扩大为无关重构。
- 用户明确要求的常规修复、文档同步和可逆改动直接完成。复杂任务先简要说明计划；关键需求不明、破坏性操作或超出授权范围时才请求确认，不按修改文件数量设置审批。
- 修改前检查工作区已有改动；基于当前内容编辑，保留无关修改及暂存状态。不自动提交、重置或清理用户文件。
- 使用环境实际提供的工具。允许只读搜索、Git 状态与差异检查、类型检查、测试和构建，不依赖特定 IDE 的工具名称，也不承诺工具一定不触发宿主审批。
- 提示词正文以中文为主；保留 API 字段、工具标识、代码符号及必要技术术语，不为“纯中文”破坏协议。

## 2. 当前架构与源码入口

### 2.1 前后端与导演运行时

- 前端使用 React 18、Vite、TypeScript，工作台位于 `client/src/components/studio/`。对话入口包括 `client/src/lib/DirectorConversation.ts` 和 `client/src/hooks/useDirectorChatFlow.ts`；HTTP 封装位于 `client/src/lib/api.ts`。
- 服务端入口为 `server/src/index.ts`，HTTP 路由和服务位于 `server/src/api/`。
- `server/src/agents/registry.ts` 的 `AgentFactory` 创建 `PlannerAgent`、`LookdevAgent`、`StoryboardAgent` 或 `GenericAgent`。
- `server/src/agents/runtime/runner.ts` 的 `AgentRunner` 基于 Mastra Agent 与 AI SDK 管理流式对话、上下文和意图。当前 `server/src/mastra.ts` 只导出空配置的 Mastra 容器，不能将业务调度归因于该文件。
- 领域目录中的 `prompt.ts`、`context.ts`、`capabilities.ts` 分别提供角色规范、状态上下文和可用工具。公共意图规则在 `runtime/intent-policy.ts`；意图工具、解析和修复在 `intent-tool.ts`、`intent-resolver.ts`、`intent-repair.ts`。
- `runtime/stream-merger.ts` 合并自然语言流和工具回复；`viewport-observer.ts` 与 `server/src/llm/vision-perception.ts` 处理视口及图片上下文。排查提示词时同时检查动态装配内容。
- 会话由 `runtime/session-store.ts` 的 `AgentSessionStore` 按项目和会话管理；批准逻辑在 `runtime/approval-service.ts`。不要将所有会话存储职责归给 `ProjectStore`。
- SDK 消息适配在 `server/src/mastra-compat/streamAgent.ts`。按实际协议处理消息，不对所有内部记录强制套用简单的 user/assistant 交替规则。

### 2.2 任务执行与资产存储

- `server/src/task-engine/task-registry.ts` 注册任务工具；工具的 `toolName` 和 Schema 是身份与参数依据。
- `task-store.ts` 保存任务状态，`task-dispatcher.ts` 执行调度，`plan-waves.ts` 按工具及目标互斥边界划分波次，`task-failure.ts` 处理失败分类。恢复与重试能力以实现为准，不承诺任意步骤断点续跑。
- `server/src/tools/base/task-tool.ts` 的 `BaseTaskTool` 统一回调、进度、执行上下文和子工具组合。具体工具可使用 Mastra Workflow/Step，并调用文本模型或媒体服务。
- `server/src/workflow-engine/` 当前提供运行上下文与并发辅助，不是旧版统一八工序审批状态机。
- `server/src/project-store/ProjectStore.ts` 管理项目与资产；`task-engine/asset-sync.ts` 同步产物；`project-store/freshness.ts` 管理新鲜度，`shot-frame-versions.ts` 管理镜头帧版本。
- 资产契约在 `server/src/project-store/contracts/`，任务契约在 `task-engine/types.ts`，工具输入输出契约在对应工具目录。修改字段时同步生产、持久化、消费和相关测试。
- 复用现有存储入口，避免重复状态源；纯计算函数可显式传参，不要求所有函数直接读写全局单例。

## 3. 当前制作工序

下表用于导航；运行时能力以各 Agent 的 `capabilities.ts`、工具 Schema 和 `runtime/pipeline.ts` 为准，不在多处提示词重复维护参数协议。

| 领域 | 工序与工具 |
| --- | --- |
| 故事策划 | 全景剧本 `planner.screenplay_writer` → PRD 分幕拓扑 `planner.script_to_prd` |
| 视觉定妆 | 资产清单 `film.asset_manifest` → 单实体规格 `film.entity_spec` → 定妆出图 `film.lookdev`；按需超分 `film.image_upscale` |
| 分幕分镜 | 故事剧本升级工业级视听摄制台本（时空锁与全量分镜单一步到位） `film.shooting_script` → 视听一体化推演 `film.shot_prompt`（首帧与同相动态运镜） → 关键帧 `film.shot_keyframe` → 按需超分 `film.image_upscale` → 视频 `film.shot_video` |
| 游戏总装 | 注册表包含 `game.assembly`，不代表每个导演会话都具备该能力 |

- 分镜会话围绕指定 `clipId` 工作；单实体或单镜修改需保留目标范围，不擅自重做全剧。
- 全景剧本先锁定故事设定、有限事实字典，再设计共同事件骨架与 2–3 个结局方向。事实分为空间承接用 shared 与选择成果用 branch，汇合锚点 Schema 不允许 branch 字段。共同骨架确定后、生成任何动作前，按各幕收益和代价补足分支事实值域或必要维度，保留原始编号与开场状态。默认按幕数组织重要选择；每次两个行动都可以改变多个事实，声明收益、代价、后续回报。dramatic-plan.ts 绑定真实前提，逐步校验后果及可选短承接，核对确实到达下一共同事件，再将二者合成一个待扩写场景。骨架声明各幕独有的 decisionPurpose，后续请求携带已完成选择以避免反复追问；默认三次选择的单路线正文约 1200–1800 字。不同入场世界需要的后果由代码编号为短变体，通过条件选项进入，不能把某条支线当作共同历史。结局方向先作为创作目标，全部行动大纲完成后按真实终态归纳为 2–3 个可兑现方向；代码检查每个终态恰好分配一次，并从真实历史生成互斥接线，不预设任意未来事实条件。causal.ts 保留事实传播与共有入场计算；旧单事实选项及单轴结局策略不再作为默认入口。同一结局方向按真实入场世界生成收束短片，接共用结局字幕，不能为复用一个正文而抹掉差异。扩写接收当前账本、所有实际入路共有的既成动作、当前动作、必要的唯一前场与固定规则，汇合不继承任意支线正文。正文使用 write-node.ts 直接生成文字，内部字段由代码包装；大纲仍结构化生成。v3 Markdown 继续保存条件接线并确定性解析为 PRD；图结构通过不代表全文语义和文学质量通过。
- 领域任务工具在 `server/src/tools/planner/`、`film-production/`、`game-assembly/`；通用图像、视频与超分工具在 `server/src/tools/media/`，媒体提供方与下载逻辑在 `server/src/media/`。
- 工具中的模型推演是有效业务步骤。避免无必要的代理递归、重复推理和不可追踪调用，不禁止工具调用模型。

## 4. 产品内导演的行动边界

本节约束 makeMv 产品行为，不要求编程助手每次编辑代码前创建产品提案。

- 导演通过 `emit_director_intent` 表达 `chat_only`、`propose`、`approve` 等意图；完整动作集合以实际 Schema 和解析器为准，不恢复旧版文本意图标签协议。
- 提案包含可执行参数。批准须对应有效待审提案；疑问、暂停或附带修改条件的回复不能直接视为批准。保留审批失效检查与幂等处理。
- 自然语言批准绑定本轮开始时的提案 ID 与参数快照；方案被替换、修改或已处理时拒绝迟到的批准。自动复盘不得替换用户待审卡片，任务派发不得批量关闭其他方案。
- 自主提案默认限定一个阶段；同阶段可处理多个明确目标。仅当创作者明确要求多个阶段时编排对应组合，不顺带捆绑下游算力任务。
- 修改请求只针对指定阶段和资产；不把旧待审方案或历史对白当成新授权。工序完成后依据实际状态判断是否还有合法行动。
- 执行状态以任务记录和产物为准。提案、批准或收到远程 URL 都不等于完成，不提前宣称出图、落盘或渲染成功。
- 复盘与制作任务分别记录成功或失败；复盘失败不能覆盖已完成的制作事实，也不能用“任务未启动”描述复盘异常。
- 工具能力、参数、目标与执行前提需由代码校验，不能只依赖提示词。新增质量审查需明确实现和测试，不将源码中不存在的审查官或门禁写成已生效能力。

## 5. 数据、提示词与媒体质量

- 优先修复错误数据的生产源头，并在外部输入、持久化读取和执行边界保留必要校验。禁止用虚构剧情、假资产或静默默认值掩盖失败。
- 避免分散的字段猜测和多层回退。兼容旧数据或第三方接口时集中在明确适配层，说明范围并验证；不因“零兼容”删除现有有效适配。
- 避免新增语义重复字段；字段迁移需评估已有项目数据与调用方。工具注册表现有名称映射不能未经评估直接移除。
- 角色、场景、道具与镜头描述来自当前剧本和资产契约；通用引擎不硬编码题材或人物。排查时检查特征、实体 ID、参考图和版本是否完整传递。
- 结构化生成结合 Schema、语义校验与清晰错误信息。微调保留未要求修改的内容；是否调用模型取决于语义需求，不禁止正常模板插值。
- 远程媒体经现有下载链路持久化，使用项目本地媒体路由，不以过期签名 URL 作为永久资产。
- 媒体验收核对存在、可读及必要格式/尺寸；仅有 `fs.existsSync` 不能证明文件完整或画面合格。涉及版本和上游修改时核对新鲜度及下游引用。

## 6. 验证与交付

从仓库根目录运行的现有命令：

| 命令 | 用途 |
| --- | --- |
| `npm run dev:server` | 服务端开发模式 |
| `npm run dev:client` | 前端开发模式 |
| `npm run build:server` | 服务端 TypeScript 构建与运行资源复制 |
| `npm run build:client` | 前端 TypeScript 与 Vite 构建 |
| `npm run build` | 依次构建服务端与前端 |
| `npm test` | 执行服务端 package.json 列出的测试链 |
| `npm --prefix server run test:agent-runtime` | 构建后执行 Agent 运行时测试 |

- 按改动范围运行相关测试与构建。纯文档修改检查内容、路径和差异；运行时、调度或契约修改覆盖相关行为，跨模块重构再扩大验证。
- `npm test` 不代表执行所有 `server/tests/` 文件，也不代表覆盖前端测试；相关独立测试需检查运行方式并单独执行。
- 界面、路由和流式修改补充相应交互或端点验证。真实媒体生成可能消耗外部算力，不因“测试”绕过用户授权。
- 验证失败时区分本次问题、已有问题和环境限制；报告实际检查，不将未运行测试、未检查警告或外部服务状态写成通过。
- 简洁说明修改、原因、验证及限制。架构、工具和脚本变化时同步本文件，避免累积历史名称与未经实现的承诺。
