# makeMv 服务端 HTTP & SSE API 接口规范
> **Interactive FMV Engine: Complete API Specification**  
> **定位说明**：本文档定义 makeMv 服务端（`server/src/api/`）对外暴露的所有标准 HTTP 端点、SSE 流式协议、数据载荷与响应结构，为前端座舱（ConfirmUI）及自动化测试提供唯一合法的交互契约依据。

---

## 一、 通用协议与状态规范

### 1.1 基础路径与跨域
- 服务端默认监听端口：`http://localhost:3000`；
- 所有业务 API 统一前缀为 `/api`；媒体资源静态托管前缀为 `/media`；
- 服务端已配置标准 CORS 响应头，支持前端跨域携带 JSON 及流式通信。

### 1.2 统一响应结构 (Standard Response Envelope)
对于所有非流式 RESTful 请求，服务端统一采用标准化 JSON 结构返回：

```typescript
// 成功响应
{
  "success": true,
  "data": T,
  "message"?: string
}

// 失败响应
{
  "success": false,
  "error": string,
  "code"?: string,
  "details"?: any
}
```

---

## 二、 对话中枢接口 (Chat API)

### 2.1 发起对话与流式推演
创作者与 AI 导演副手交互的核心通道，支持流式传输（Server-Sent Events）与非流式普通响应。

- **URL**: `POST /api/chat`
- **Content-Type**: `application/json`
- **请求体 (RequestBody)**:

```typescript
{
  "projectId": string;          // 目标工程 ID (必填)
  "message": string;            // 创作者输入的自然语言指令或剧本构想 (必填)
  "sessionId"?: string;         // 会话 ID (选填，若不传则由服务端按规则生成)
  "stream"?: boolean;           // 是否开启 SSE 流式打字机输出 (默认为 true)
}
```

#### SSE 流式事件流规范 (`stream: true`)
当 `stream: true` 时，服务端返回 `Content-Type: text/event-stream; charset=utf-8`，传输标准 SSE 文本块：

```http
event: delta
data: {"content": "我建议我们先为主角李默定制"}

event: delta
data: {"content": "一套具有近未来废土质感的服装。"}

event: proposal
data: {"actionId":"act_123456","actionType":"TRIGGER_WORKFLOW","skill":"CharacterPortraitSkill","label":"生成李默角色定妆照","description":"为主角李默生成纯中文提示词并调用文生图机床","status":"pending","requiresConfirmation":true,"payload":{...}}

event: done
data: {"sessionId":"chat_123","totalTokens":184}
```

- **`delta` 事件**：大模型增量生成的自然语言文本片段（已剥离思考流与提案块）；
- **`proposal` 事件**：大模型推演中提议的待确认行动卡片实体（`ActionProposal`）；
- **`error` 事件**：推理过程中断或刚性门禁拦截通知；
- **`done` 事件**：流式生成正常完结。

---

## 三、 工程与资产黑板接口 (Projects API)

### 3.1 获取所有工程列表
- **URL**: `GET /api/projects`
- **响应示例**:
```json
{
  "success": true,
  "data": [
    {
      "id": "proj_1793774226492",
      "title": "赛博朋克记忆神偷",
      "stage": "CHARACTER_DESIGN",
      "createdAt": "2026-11-04T07:03:46.492Z",
      "updatedAt": "2026-11-04T07:12:10.820Z"
    }
  ]
}
```

### 3.2 创建新工程
- **URL**: `POST /api/projects`
- **请求体**:
```json
{
  "title": "赛博朋克记忆神偷",
  "idea": "记忆神偷潜入脑机财阀调查意识篡改案",
  "style": "赛博朋克、霓虹暗黑、冷色调"
}
```
- **响应示例**:
```json
{
  "success": true,
  "data": {
    "id": "proj_1793774226492",
    "title": "赛博朋克记忆神偷",
    "stage": "NARRATIVE_DESIGN"
  }
}
```

### 3.3 获取单个工程全量资产黑板
- **URL**: `GET /api/projects/:projectId`
- **响应示例**:
```json
{
  "success": true,
  "data": {
    "id": "proj_1793774226492",
    "meta": {
      "title": "赛博朋克记忆神偷",
      "idea": "记忆神偷潜入脑机财阀调查意识篡改案",
      "currentStage": "CHARACTER_DESIGN"
    },
    "artifacts": {
      "narrative_design": { /* 故事圣经与网状拓扑 */ },
      "character_design": { /* 角色定妆图集与锁脸锚点 */ }
    },
    "sessions": [ /* 关联的历史会话记录 */ ]
  }
}
```

---

## 四、 人在回路提案接口 (Proposals API)

### 4.1 获取工程下待处理的提案卡片
- **URL**: `GET /api/proposals?projectId=:projectId`
- **响应示例**:
```json
{
  "success": true,
  "data": [
    {
      "actionId": "act_1793774226492_char_01",
      "actionType": "TRIGGER_WORKFLOW",
      "skill": "CharacterPortraitSkill",
      "label": "生成李默定妆照",
      "description": "调用文生图机床生成主角李默的视觉锚点",
      "status": "pending",
      "requiresConfirmation": true,
      "payload": {
        "characterName": "李默",
        "visualPrompt": "近未来科技感，深灰战术皮夹克，左侧机械仿生臂，冷峻面容",
        "width": 1024,
        "height": 1024
      },
      "targetStage": "CHARACTER_DESIGN"
    }
  ]
}
```

### 4.2 批准并执行提案卡片
创作者在 ConfirmUI 预览并修改提示词或参数后，一键点击“批准生成”调用此接口。

- **URL**: `POST /api/proposals/:actionId/approve`
- **请求体**:
```json
{
  "projectId": "proj_1793774226492",
  "payload": {
    /* 创作者手修更新后的强类型参数 (整份替换) */
    "characterName": "李默",
    "visualPrompt": "经过创作者手修后的纯中文提示词：带磨损痕迹的深灰工装皮夹克...",
    "width": 1024,
    "height": 1024
  }
}
```
- **响应示例**:
```json
{
  "success": true,
  "message": "提案已批准，正在调度 WorkflowEngine 恢复渲染",
  "data": {
    "actionId": "act_1793774226492_char_01",
    "status": "running"
  }
}
```

### 4.3 驳回提案卡片
创作者不认可方案时予以驳回。

- **URL**: `POST /api/proposals/:actionId/dismiss`
- **请求体**:
```json
{
  "projectId": "proj_1793774226492",
  "reason": "设定与世界观冲突，需要重新调整角色性格"
}
```
- **响应示例**:
```json
{
  "success": true,
  "message": "提案已驳回",
  "data": {
    "actionId": "act_1793774226492_char_01",
    "status": "dismissed"
  }
}
```

---

## 五、 媒体切片静态托管 (Media Static Sandbox)

系统采用本地物理持久化安全托管机制，所有第三方机床渲染的资产统一转存至本地。

- **URL 模板**: `GET /media/:projectId/:subfolder/:filename`
- **示例**:
  - `GET /media/proj_123/characters/limo_portrait.png`
  - `GET /media/proj_123/videos/shot_001_take1.mp4`
  - `GET /media/proj_123/audio/dialogue_node_01.wav`
- **安全沙箱保护**：服务端路径解析函数对 `..`、非法跨目录以及绝对路径越界进行刚性阻断，确保仅限在 `projects/:projectId/` 授权子目录内提供媒体切片访问。
