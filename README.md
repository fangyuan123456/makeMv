# makeMv: AI 互动影视与影游导演系统 (全栈 TypeScript)

基于 **TypeScript + Node.js + Next.js** 构建的互动影视游戏 (FMV) 生成引擎与 AI 导演中枢。

本项目基于工业级多智能体流水线与人机协作（Human-in-the-Loop）架构，支持分支剧情决策树、角色一致性视觉质检、异常提示词自愈，客户端与服务端完全解耦。

---

## 📂 仓库架构说明

```
makeMv/
├── client/                     # 💻 前端客户端 (Next.js 16 + React 19 + TailwindCSS)
│   ├── app/                    # 页面路由与主界面 (工作台、会话管理、成片播放)
│   ├── components/             # 交互组件 (阶段控制器、分支编辑器、视频播放器等)
│   ├── config/                 # 客户端状态与 API 路由配置
│   ├── package.json
│   └── next.config.ts          # 自动反向代理 API 至服务端 (http://127.0.0.1:8000)
│
├── server/                     # ⚙️ 后端服务端 (Node.js 22 + TypeScript + Hono API + CLI)
│   ├── src/
│   │   ├── types/              # Zod 强类型契约 (工作流、FMV剧本分支、分镜头)
│   │   ├── config/             # 配置管理 (多端环境兼容、FFmpeg 自动寻径)
│   │   ├── media/ffmpeg.ts     # FFmpeg 视频剪辑拼接服务
│   │   ├── providers/          # 统一模型驱动层 (LLM / 图像 / 视频驱动与 Mock)
│   │   ├── agents/             # 6 大导演阶段智能体 (编剧/美术/分镜/参考/视频/剪辑)
│   │   ├── prompts/            # VideoClaw 专业提示词模板库
│   │   ├── orchestrator/       # 核心状态机与人机介入 (Session & Orchestrator)
│   │   ├── server/             # RESTful API 服务 (Hono, 端口 8000)
│   │   ├── cli.ts              # CLI 演示工具入口
│   │   └── index.ts            # 后端服务启动入口
│   ├── data/                   # 📁 影视工程输出物与会话持久化目录 (已配置 .gitkeep)
│   │   ├── sessions/           # 导演状态机持久化会话 JSON
│   │   └── projects/           # 剧本、分镜图、生成视频片段与 final/ 成片
│   ├── .env                    # 服务端配置文件 (API Keys & FFmpeg 路径)
│   ├── package.json
│   └── tsconfig.json
│
├── package.json                # 🏠 根目录 Monorepo 统一调度配置
└── FMVGames.code-workspace     # VS Code 多工作区配置
```

---

## 🚀 快速启动指南

### 1. 服务端配置 (Server)

复制或编辑 `server/.env`，可配置各大商业大模型 API Key，也可开启 `MOCK_MODE=true` 进行零成本离线演示：

```env
PORT=8000
HOST=127.0.0.1
MOCK_MODE=true

# FFmpeg 路径 (系统全局或指定绝对路径)
FFMPEG_PATH=E:\tools\ffmpeg\bin\ffmpeg.exe

# 大模型配置 (兼容 Qwen / DeepSeek / Ark / OpenAI)
LLM_PROVIDER=openai
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=your_key_here
LLM_MODEL=qwen-plus
```

### 2. 根目录一键命令

在项目根目录 `FMVGames/` 下直接运行：

| 命令 | 说明 |
| :--- | :--- |
| `npm run dev:server` | 启动后端 API 服务器（监听 `http://127.0.0.1:8000`） |
| `npm run dev:client` | 启动前端 Web 客户端（监听 `http://localhost:3000`） |
| `npm run cli` | 运行 CLI 交互式导演生成测试（支持离线 dry-run） |
| `npm run build:server` | 编译后端 TypeScript 代码到 `server/dist/` |
| `npm run build:client` | 构建前端生产版本 |

---

## 🎬 核心特性

1. **前后端清晰解耦**：客户端通过 Next.js API 代理统一桥接至服务端的 8000 端口，开箱即用。
2. **支持 FMV 互动剧情**：原生支持剧情分支决策点（Choices），自动生成分叉视频片段与 `timeline.json` 决策图谱。
3. **六阶段可介入流程**：
   - Stage 1: `ScriptWriterAgent`（剧本策划、场景与分支设计）
   - Stage 2: `CharacterDesignerAgent`（角色外观、服装设定卡与场景概念）
   - Stage 3: `StoryboardAgent`（分镜头景别、运镜轨迹与中英文提示词规划）
   - Stage 4: `ReferenceGeneratorAgent`（分镜首帧关键参考图生成）
   - Stage 5: `VideoDirectorAgent`（文生视频 / 图生视频动态渲染）
   - Stage 6: `VideoEditorAgent`（FFmpeg 自动拼接缝合与互动元数据生成）
4. **内置 Mock / Dry-Run 安全模式**：在无 API 余额时使用本地 SVG 与 FFmpeg 调色测试片无缝闭环全流程。
