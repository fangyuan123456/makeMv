# makeMv Client - AI 导演交互座舱与影游播放器

> makeMv 前端应用：基于 **Vite 6**、**React 18** 与 **Tailwind CSS 4** 打造的创作者交互座舱（ConfirmUI）与互动影游运行时播放器。

---

## 🎨 核心功能与模块划分

### 1. 流式打字机对话视窗 (`src/components/Chat/` & `src/hooks/useMastraChat.ts`)
- **纯天然自然语言交互**：创作者自由表达剧作灵感或微调指令；
- **思考流实时拦截分离**：配合服务端打字机流式输出，实时解析并隔离 `<think>...</think>` 思考流与 `<action_proposal>...</action_proposal>` 提案块，确保正文对话的高信噪比与专业感；
- **打字机动态回显**：大模型生成与工序产物实时打字机渲染，支持 Markdown 视听格式化展示。

### 2. 人在回路确认卡片 (`src/components/ProposalCard/`)
- 当大模型提议工序推进、定妆照绘制、关键帧首样或视频渲染时，自动以交互卡片呈现；
- **参数预览与微调**：卡片直观展开正负向纯中文提示词、采样参数与受影响资产，创作者可直接在卡片内手修字段；
- **一键批准与驳回**：点击“批准生成”调用后端 `/api/proposals/:actionId/approve` 恢复工作流；点击“驳回”或输入补充修改意见进行定向自愈。

### 3. 互动影游双缓冲播放器 (`src/components/Player/`)
- **互动抉择点分支倒计时**：解析母带清单中镜头的 `decisionWindow`，在精确时间戳弹出互动抉择选项；
- **待机呼吸循环短视频**：在玩家思考抉择期间，自动平滑无缝循环播放 3~5 秒呼吸切片（`idleLoopUrl`），杜绝画面卡死或黑屏；
- **无缝镜头转场**：玩家做出选择后，通过双缓冲技术瞬间无缝预加载并切入对应分支剧情，保障沉浸式影视观感。

---

## 📁 前端源码结构

```
client/
├── src/
│   ├── main.tsx                # 应用启动入口
│   ├── App.tsx                 # 导演工作台根组件 (双模切分：导演台 / 互动播放)
│   ├── components/             # 交互组件库
│   │   ├── Chat/               # 对话视窗、输入栏与流式渲染
│   │   ├── ProposalCard/       # 行动提案交互卡片与微调表单
│   │   ├── Canvas/             # 工序资产预览全景画布 (故事圣经/定妆照/分镜/视频)
│   │   └── Player/             # 互动影游母带播放器与分支控制器
│   ├── hooks/                  # 自定义 Hook
│   │   ├── useMastraChat.ts    # SSE 流式会话管理与协议解析
│   │   └── useProject.ts       # 工程资产状态与工序阶段订阅
│   ├── lib/                    # 基础网络与客户端工具
│   │   └── mastra.ts           # HTTP API 请求封装
│   └── types/                  # 视图层契约与前端组件类型定义
├── index.html
├── package.json
└── vite.config.ts
```

---

## 🚀 启动与调试

```bash
# 安装依赖
npm install

# 启动 Vite 研发服务器 (默认运行于 http://localhost:5173)
npm run dev

# 生产环境打包构建
npm run build
```
