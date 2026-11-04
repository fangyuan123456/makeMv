# Project: makeMv 互动影游 AI 导演系统（全景架构与演进总纲）

> [!NOTE] 历史里程碑归档说明 (Milestone Archive)
> 本文档记录了 makeMv 早期 M1 ~ M4 阶段的基础设施迁移快照（ProjectStore 移植、MediaDownloader 改造、StoryBible Tool 化）。
> 当前系统已全面演进至 Mastra 1.81.0 官方微内核、WorkflowEngine 通用调度状态机、7 大工序与全流程 ConfirmUI 前后端联调阶段。
> 最新的系统架构设计、数据契约及 API 规范，请以根目录 [README.md](../../README.md)、[docs/fmv-architecture-blueprint.md](../../docs/fmv-architecture-blueprint.md) 及 [docs/api-specification.md](../../docs/api-specification.md) 为单一事实来源（SSOT）。

## Architecture
- **状态黑板与单一事实来源 (SSOT)**：
  - `server/src/project-store/`：基于物理磁盘的工程黑板，提供工序产物 (Artifacts)、多会话白板 (Scratchpad)、消息持久化、有界 LRU 缓存、Windows 原子防锁落盘与历史版本快照归档。
  - 全局单例门面：`ProjectStore.getInstance()`，消灭跨模块传参。
- **多媒体底层工程**：
  - `server/src/media/`：大模型临时 URL 本地永久化 (`MediaDownloader`)，生成 `/media/:projectId/:subfolder/:filename` 标准化本地路径；FFmpeg 原生切片、压缩与视听合规 (`FFmpegService`)；视听渲染中枢 (`VisualMediaRenderer`) 与提供商适配 (`DashScopeMediaProvider`, `ComfyUIMediaProvider`)。
- **现代 Mastra 微内核与技能微架构 (Chat + Skills)**：
  - `server/src/mastra/`：以 Mastra 微内核 (`@mastra/core`) 为核心，标准 Tool 封装 (`createTool`)，提供强类型入参与出参校验 (Zod SSOT) 及人在回路控制 (`requireApproval: true`)。
  - `server/src/mastra/tools/story-bible/`：故事世界观圣经推演工具（黄金三幕主干 ➔ 互动抉择矩阵 ➔ DAG网状剧情拓扑 ➔ 核心角色档案），Fail-Fast 刚性校验，双向黑板与本地工程同步。
- **统一大模型服务层 (LLM Services)**：
  - `server/src/llm/`：统一大模型接入抽象与多通道注册表 (`LLMRegistry`, `LLMService`, `RealLLMService`, `MockLLMService`)，支持流式对话与结构化生成 (`generateObject`)，提供测试沙箱确定性 Mock 能力。
- **基础支撑层**：
  - `server/src/types/`：领域聚合根契约（解耦外挂技能）。
  - `server/src/chat/session/types.ts`：会话白板与提案契约。
  - `server/src/utils/`：环境与路径配置 (`config.ts`)、Windows 原子写 (`atomicFile.ts`)、错误归一与打点 (`trace.ts`)、并发与数据清洗。

## Code Layout
```
server/src/
├── types/
│   └── index.ts                 # 领域模型核心契约 (无 skills 反向循环依赖)
├── chat/
│   └── session/
│       └── types.ts             # ScratchpadMemory 与 ActionProposal 契约
├── utils/
│   ├── config.ts                # 路径探测与环境配置 SSOT
│   ├── atomicFile.ts            # Windows 平台原子写盘与自愈
│   ├── trace.ts                 # 错误归一化与打点
│   ├── concurrency.ts           # 异步并发控制
│   ├── JsonSanitizer.ts         # 模型文本清洗
│   └── index.ts                 # 统一导出
├── project-store/
│   ├── types.ts                 # 快照类型
│   ├── IProjectStateStore.ts    # 黑板接口契约 (SSOT)
│   ├── ProjectStore.ts          # 单例门面
│   ├── MemoryProjectStateStore.ts # 内存黑板
│   ├── FileProjectStateStore.ts # 生产级磁盘黑板 (已除历史别名)
│   ├── ProposalStore.ts         # 提案管理仓库
│   └── index.ts                 # 统一导出
├── media/
│   ├── MediaDownloader.ts       # 媒体流式持久化下载器 (Fail-Fast 刚性抛错、去盘符、连续点消除、超时联动)
│   ├── ffmpeg.ts                # FFmpeg 视听切片与合规服务
│   ├── VisualMediaRenderer.ts   # 视听渲染总控 (纯中文视听术语、无题材硬编码)
│   ├── providers/
│   │   ├── ImageProvider.ts
│   │   ├── VideoProvider.ts
│   │   ├── DashScopeMediaProvider.ts
│   │   ├── ComfyUIMediaProvider.ts
│   │   └── MediaProviderFactory.ts
│   ├── workflows/
│   └── index.ts
├── llm/                         # 统一大模型集成服务
│   ├── LLMService.ts            # 抽象接口与类型契约
│   ├── MockLLMService.ts        # 离线沙箱与测试桩确定性服务
│   ├── RealLLMService.ts        # 真实 OpenAI/百炼等大模型服务
│   ├── LLMRegistry.ts           # 全局单例注册表 (支持沙箱 reset 与 Mock 注入)
│   └── index.ts
├── mastra/
│   ├── agents/
│   │   ├── director.agent.ts    # AI 导演副手 (挂载 tools)
│   │   └── index.ts
│   ├── tools/
│   │   ├── demo.tool.ts
│   │   ├── story-bible/         # 🌟 第二站核心工序工具
│   │   │   ├── schema.ts        # Zod 强类型契约 (剔除 targetEpisodes 死字段)
│   │   │   ├── prompt.ts        # 纯中文四大推演提示词体系 (无题材硬编码)
│   │   │   ├── story-bible.tool.ts # createTool 标准 Mastra Tool (requireApproval: true)
│   │   │   └── index.ts
│   │   └── index.ts
│   ├── workflows/
│   └── index.ts
└── __tests__/
    ├── project-store/
    ├── utils/
    ├── media/
    └── mastra/
        ├── StoryBibleContract.test.ts   # 正常流契约与黑板落盘断言
        ├── StoryBibleFailFast.test.ts   # 异常流与刚性阻断守卫断言
        └── StoryBibleAdversarial.test.ts # 题材无偏性、历史别名拒收与并发锁对抗
```

## Feature Inventory
| # | Feature | Description | Milestone | Source | Status |
|---|---------|-------------|-----------|--------|--------|
| 1 | 前置基础工具与环境配置 | 移植 config, atomicFile, trace, concurrency, JsonSanitizer | M1 | Survey | DONE |
| 2 | 前置领域模型契约 (解耦版) | 移植 types/index.ts (切断对 skills 的依赖) 与 chat/session/types.ts | M1 | Survey | DONE |
| 3 | ProjectStore 核心黑板系统 | 移植 IProjectStateStore, ProjectStore, Memory/FileProjectStateStore, ProposalStore | M1 | R1 | DONE |
| 4 | ProjectStore 历史别名清理 | 消除 c.appearancePrompt 与 targetStage 等历史回退，遵循法典 0.4 | M1 | Survey & AGENTS.md | DONE |
| 5 | ProjectStore 单元测试套件 | 移植 FileProjectStateStore.test.ts 与 ProposalStore.test.ts 并验证 PASS | M1 | Survey | DONE |
| 6 | MediaDownloader 本地永久化 | 移植 MediaDownloader，将临时 URL 转为 /media/:projectId/... 本地路径 | M2 | R2 | DONE |
| 7 | MediaDownloader Fail-Fast 改造 | 消除下载失败静默返回原始 URL 的隐式降级，失败时刚性抛出异常 | M2 | Survey & AGENTS.md | DONE |
| 8 | FFmpegService 视听切片与合规 | 移植 ffmpeg.ts，原生封装切片/压缩/时长探测，增加可配置路径 | M2 | R2 | DONE |
| 9 | VisualMediaRenderer 渲染中枢 | 移植 VisualMediaRenderer 与 Provider 契约体系 | M2 | R2 | DONE |
| 10 | MediaDownloader 自动化单测 | 编写 MediaDownloader, FFmpeg, VisualMediaRenderer, Fuzz, Stress 测试并验证 PASS | M2 | Survey | DONE |
| 11 | 全局 TypeScript 编译验收 | `npm run build` 全局 0 错误、0 警告 (exit code 0) | M3 | Acceptance Criteria | DONE |
| 12 | 架构与法典刚性审计 | 确保无假收敛、无硬编码题材、无向下兼容胶水，终极审计 CLEAN | M3 | AGENTS.md | DONE |
| 13 | StoryBible 领域契约与 Schema | 迁移 schema.ts，剔除 targetEpisodes 死字段，纯 Zod 强类型驱动 | M4 | Survey & R2 | IN_PROGRESS |
| 14 | 纯中文提示词体系与无题材偏见 | 迁移 prompt.ts，四大推演提示词 100% 纯中文影视术语，零题材硬编码 | M4 | Survey & AGENTS.md | IN_PROGRESS |
| 15 | LLM 基础设施与测试桩支持 | 迁移/支持 LLMRegistry, LLMService, MockLLMService 供 Mastra 工具及测试确定性调用 | M4 | Survey & R2 | IN_PROGRESS |
| 16 | StoryBible Mastra Tool 化封装 | `createTool` 标准封装，`requireApproval: true`，Fail-Fast 刚性阻断，P1-1 拓扑主键与指针校验 | M4 | R2 | IN_PROGRESS |
| 17 | SSOT 双向落盘与白板反向同步 | 同步状态黑板 `WorkflowStage.NARRATIVE_DESIGN`、更新工程标题、`atomicWriteJsonSync` 物理文件导出、更新 Scratchpad | M4 | R2 & AGENTS.md | IN_PROGRESS |
| 18 | StoryBible 三层完整单测矩阵 | 覆盖正常契约流、Fail-Fast 刚性拦截（拒绝空 idea 假收敛）、冷门题材无偏与别名拒收对抗 | M4 | Acceptance Criteria | IN_PROGRESS |
| 19 | 第二站 TypeScript 编译与单测验收 | 全局 `npm run build` 0 报错 0 告警，全部单测 100% PASS | M4 | Acceptance Criteria | PENDING |
| 20 | 第二站法典合规门禁与法证审计 | 2 Reviewers, 2 Challengers, 1 Auditor 严格门禁检验，终极裁决 CLEAN | M4 | AGENTS.md | PENDING |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | ProjectStore SSOT 移植与标准化 | 基础设施工具、解耦契约、ProjectStore 黑板、别名清理、单测 | None | DONE |
| M2 | MediaDownloader 与视听底层移植 | MediaDownloader、Fail-Fast 重构、FFmpegService、渲染中枢、单测与安全对抗 | M1 | DONE |
| M3 | 全局编译验收与终极完整性审计 | 全局 TypeScript 0 错误编译、测试全绿 (170/170 PASS)、法典胜利审计 (CLEAN) | M1, M2 | DONE |
| M4 | StoryBible Mastra Tool 化与流式对接 | Schema 契约、中文提示词、LLM 基础设施、Mastra Tool 封装、双向落盘、全套单测与门禁审计 | M1, M2, M3 | IN_PROGRESS |

## Interface Contracts
### ProjectStore ↔ StoryBible Tool
- `ProjectStore.getInstance().getProject(projectId: string): Project | undefined`
- `ProjectStore.getInstance().setArtifact(projectId: string, stage: 'narrative_design', artifact: StoryBibleArtifact, meta?: any): void`
- `ProjectStore.getInstance().saveProject(project: Project): void`
- `ProjectStore.getInstance().updateScratchpad(projectId: string, sessionId: string, patch: Partial<ScratchpadMemory>): void`
- `ProjectStore.getInstance().getProjectDir(projectId: string): string`

### StoryBible Tool API
- Tool ID: `'story-bible-generator'`
- `requireApproval`: `true` (人在回路)
- `inputSchema`: `StoryBibleInputSchema` (`projectId`, `idea`, `style?`, `userFeedback?`, `sessionId?`)
- `outputSchema`: `StoryBibleOutputSchema` (`success`, `data?`, `summary?`, `error?`)
- 刚性 Fail-Fast: `idea` 为空且 `project.meta.idea` 为空时，必须立即刚性报错，严禁使用 `'未命名故事构想'` 等假数据。
