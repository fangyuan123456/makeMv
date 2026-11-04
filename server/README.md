# makeMv Server - 微内核影视生成引擎

> makeMv 后端服务：基于 **Mastra 官方微内核**、**WorkflowEngine 通用调度状态机** 与 **视听多模态机床** 搭建的互动影游生产微内核。

---

## 🏛️ 核心架构体系

### 1. Mastra 官方微内核驱动 (`src/mastra.ts`)
- 全面拥抱 `@mastra/core` 官方生态，不采用零散拼接逻辑；
- 在 `mastra.ts` 中完成全局工具容器（`storyBibleTool`, `characterPortraitTool`, `sceneScriptTool`, `storyboardTool`, `keyframeReferenceTool`, `videoProductionTool`, `criticReviewTool`, `fmvPackagingTool` 等）与总导演智能体（`directorAgent`）的总装注册；
- 模型层统一由 `src/llm/LLMRegistry.ts` 提供支持，输出规范版本 v2 的标准 `OpenAICompatibleConfig` 模型，天然支持流式对话与打字机输出。

### 2. 通用工作流调度引擎 (`src/workflow-engine/`)
- 独立于具体业务的流程调度中枢，支持长程任务编排与状态流转；
- **AOP 确认切面（Confirmation Interceptor）**：支持在任意工序步骤前后执行条件拦截，生成待确认的 `ActionProposal` 挂起任务；
- **人在回路（Human-in-the-Loop）**：通过 `/api/proposals/:actionId/approve` 携带创作者微调后的参数无缝恢复（Resume）任务推进；
- **微观子工作流解耦**：
  - `characterPortraitSubWorkflow`：角色定妆照生成与锁脸特征绑定；
  - `keyframeReferenceSubWorkflow`：分镜首帧高清画面渲染与空间连续性对齐；
  - `videoProductionSubWorkflow`：运镜运动矢量注入与 I2V 动态切片渲染。

### 3. 全局统一状态黑板 (`src/project-store/`)
- **单一事实来源（SSOT）**：统一使用 `ProjectStore.getInstance()` 存取工程状态，根除跨层级深层传参引发的属性丢失；
- **本地化安全持久化**：
  - Windows 环境原子写盘防锁（`atomicFile.ts`）；
  - `FileProjectStateStore` 负责工程全资产（`Artifacts`）、阶段进度、会话白板及历史快照归档；
  - `MediaDownloader` 将 DashScope 等第三方临时签名 URL 刚性转存为本地永久规范文件（`/media/:projectId/...`），保障工程资产离线持久可用。

### 4. 纯中文影视提示词与横向质检防御
- 生图、生视频与微调提示词模板体系 100% 采用纯中文影视专业术语（景别、运镜轨迹、光影、动势）；
- 严禁业务与题材硬编码，系统对任何题材（悬疑、科幻、治愈、历史）完全通用无偏；
- `CriticReviewSkill` 作为贯穿全阶段的横向审查官，出具多维质检评分并阻断不达标提案带病推进。

---

## 📁 服务端源码结构

```
server/
├── src/
│   ├── index.ts                # 服务启动入口与优雅停机
│   ├── mastra.ts               # Mastra 官方微内核容器总装出口
│   ├── api/                    # HTTP 路由分发
│   │   ├── app.ts              # 请求网关与分发中间件
│   │   ├── helpers.ts          # 统一响应与 CORS 工具
│   │   ├── media.ts            # 本地静态媒体切片安全沙箱托管
│   │   └── routes/             # 业务路由 (/chat, /projects, /proposals)
│   ├── workflow-engine/        # 通用工作流调度引擎 (Run, Resume, AOP 拦截)
│   ├── agents/director/        # AI 导演智能体与全景上下文装配
│   │   ├── director.agent.ts
│   │   ├── context-assembler.ts
│   │   ├── tools/              # 导演专属调度工具 (propose-stage-action)
│   │   └── workflows/          # 影视主流程 pipeline.workflow.ts
│   ├── tools/                  # 8 大工序原子工具族 (每目录包含 schema/prompt/tool)
│   │   ├── story-bible/
│   │   ├── character-portrait/
│   │   ├── scene-script/
│   │   ├── storyboard/
│   │   ├── keyframe-reference/
│   │   ├── video-production/
│   │   ├── critic-review/
│   │   └── fmv-packaging/
│   ├── media/                  # 视听下载持久化、FFmpeg 切片与提供商适配
│   ├── llm/                    # 统一大模型注册表与测试桩
│   ├── project-store/          # 全局状态黑板层 (ProjectStore, ProposalStore)
│   ├── types/                  # 全局强类型业务契约
│   └── utils/                  # 原子工具 (JsonSanitizer, atomicFile, trace)
└── tests/                      # 独立物理隔离的自动化测试套件
```

---

## 🛠️ 研发与测试规范

### 1. 静态编译验收
服务端严格执行 0 错误、0 告警交付标准：
```bash
npm run build
```

### 2. 自动化测试
```bash
npm run test
```
测试矩阵包含正常契约流断言、Fail-Fast 刚性拦截断言以及题材无偏与别名拒收对抗测试。
