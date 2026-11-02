# makeMv: 互动影游与 AI 导演制片系统

基于 **TypeScript + Node.js (Hono) + Next.js** 构建的互动影游 (FMV) 生成引擎与 AI 导演中枢。

系统摒弃死板的硬编码流水线，采用**以对话中枢 (DirectorAgent) 为交互门面、动态技能微内核 (SkillRegistry) 为执行支撑、独立审查官 (CriticReviewerAgent & GateGuard) 为质量门禁、异步持久化任务引擎 (TaskEngine) 为长任务保障**的现代 Agentic 架构。

---

## 🏛️ 核心架构与目录组织

```
server/src/
├── api/                        # HTTP 接口与控制器层 (Hono RESTful & SSE)
│   ├── controllers/            # ProjectController, ChatController, ReviewerController, SkillController
│   └── server.ts               # 服务入口与路由挂载
├── agents/                     # 核心双核智能体
│   ├── director/               # AI 导演副手 (DirectorAgent, ContextAssembler, ProposalResolver)
│   └── reviewer/               # 独立审查官与剧本医生 (CriticReviewerAgent, GateGuard)
├── skills/                     # 声明式制片工序技能微内核 (统一继承 BaseSkill)
│   ├── story-bible/            # Stage 1: 故事世界观圣经推演
│   ├── character-portrait/     # Stage 2: 核心角色视觉定妆照生成
│   ├── scene-script/           # Stage 3: 分场多分支互动剧本扩写
│   ├── storyboard/             # Stage 4: 视听导演分镜头表切分
│   ├── keyframe-reference/     # Stage 5: 分镜头首帧高清参考图批量渲染
│   ├── video-production/       # Stage 6: 动态视听切片渲染 (ComfyUI / DashScope)
│   ├── critic-review/          # 刚性影视质检与独立打分
│   └── fmv-packaging/          # Stage 7: 影游母带与分支拓扑装配
├── tasks/                      # 异步长耗时工序任务执行引擎 (TaskEngine SSOT，物理落盘与防断联)
├── chat/                       # 对话与双轨记忆中枢
│   ├── memory/                 # ChatMemoryManager (滑动窗口 + 备忘录白板)
│   └── session/                # 会话与消息实体
├── project-store/              # 状态黑板与独立提案持久化 (ProjectStore, ProposalStore, FileProjectStateStore)
├── llm/                        # 统一大模型集成服务 (LLMRegistry, RealLLMService)
├── media/                      # 视听媒体生成与本地持久化 (VisualMediaRenderer, MediaDownloader)
└── types/                      # 全局业务强类型契约与 StageArtifactMap
```

---

## 🎬 核心系统机制

1. **AI 导演副手与人在回路 (Director Co-pilot & HITL)**：
   创作者通过自然语言与导演副手共同推敲戏剧立意、黄金四幕与人物动机。在阶段推敲成熟时，大模型自主输出携带明确执行参数的行动提案卡片（`ActionProposal`），由创作者决定是否授权推进。
2. **独立影视审查官与统一门禁守卫 (Critic Reviewer & GateGuard)**：
   独立评委与剧本医生对全链路资产进行因果穿透审计（四大维度量化打分）。出具 `FAIL` 时由 `GateGuard` 统一阻断跨阶段带病推进，同时支持创作者针对挑刺进行多轮对辩并持久化对辩日志。
3. **异步持久化任务引擎 (TaskEngine)**：
   彻底消除“HTTP 长连接扛长耗时视频渲染”的脆弱短板。视频渲染等长任务由 `TaskEngine` 在服务端独立异步调度并于磁盘持久化状态，支持断线重连、页面刷新恢复与多端轮询。
4. **独立提案实体模型 (ProposalStore)**：
   行动提案作为项目一等实体独立落盘管理，消灭在历史消息流中倒序遍历查找回标的反模式，支持精确生命周期回标与阶段门禁解除。
5. **本地持久化永久可用**：
   第三方多媒体生成链接自动由 `MediaDownloader` 抓取并转化为 `/media/:projectId/...` 本地物理文件，确保历史工程与视听资产离线永久可用。

---

## 🚀 快速启动指南

### 1. 服务端配置 (`server/.env`)

```env
PORT=8000
HOST=127.0.0.1

# 大模型配置 (兼容 Qwen / DeepSeek / Ark / OpenAI)
LLM_PROVIDER=openai
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=your_dashscope_api_key
LLM_MODEL=qwen-plus
```

### 2. 启动与编译命令

```powershell
# 1. 编译验证
npm --prefix server run build
npm --prefix client run build

# 2. 本地开发启动
npm run dev:server    # 启动后端 API 服务 (http://127.0.0.1:8000)
npm run dev:client    # 启动前端 Next.js 工作台 (http://localhost:3000)
```
