# ConfirmUI 工作流搭建清单（交接文档）

> 目标：搭一套「workflow suspend → 前端确认卡片 → resume 带回结构化 JSON」的确认体系。
> 用户确认的不是"通过/拒绝"一个信号，而是一份 **schema 合法的 JSON 工件**，下游 agent/workflow 直接消费。
> 技术栈：Mastra workflow `suspend/resume` + Zod schema 单一事实源 + Next.js 前端卡片。

---

## 0. 三条总纪律（验收时逐条检查）

1. **出口即合法**：任何 JSON 离开 confirm UI 前必须过 `schema.parse()`，不合法锁死提交按钮。非法数据不允许进入 workflow resume 或 artifacts。
2. **JSON 是唯一事实源**：agent 指令中明确"以下 JSON 为权威，冲突时以 JSON 为准，禁止改写、只做消费/扩写"。防止模型把用户的修改改回自己的版本。
3. **改 schema 只改一处**：workflow inputSchema、agent 工具入参、前端表单渲染，全部从 `schemas/` 目录的同一份 Zod 定义生成。前端手写第二份字段定义 = 纪律已破。

---

## 1. 前置任务（先做，其他都依赖它）

| # | 任务 | 内容 | 验收 |
|---|---|---|---|
| P1 | 建 `server/src/mastra/schemas/` 目录 | `story-bible.ts`、`scene-script.ts`、`shot-plan.ts`、`asset-batch.ts` 等，每份导出 Zod schema + `z.infer` 类型 | schema 文件存在且被 workflow/工具/前端三方 import |
| P2 | 定义通用 suspend/resume 协议 | 见 §3 | 协议类型落盘并被所有 suspend 点使用 |
| P3 | 前端卡片路由器 | 按 `uiType` 分发渲染组件，未知 uiType 显示原始 JSON + 兜底通过/拒绝 | 任意 uiType 不白屏 |

---

## 2. Confirm 点清单（8 个）

★ = 默认必须停；☆ = 可在设置里跳过。**默认停的只有 5 个**：1、2、5、6、7 + 门禁。

| # | 工序 | confirm 点 | 停不停 | 确认什么 | uiType | 为什么 |
|---|---|---|---|---|---|---|
| 1 | 叙事圣经 | 创意拍板 | ★ | 三幕结构、结局分支（2~4 个）、角色名单 | `story_bible_review` | 一切错误的源头，纯主观审美，机器无法替判 |
| 2 | 角色定妆 | 出图前确认提示词 | ★ | 每个角色的 `visualPrompt` 文本 | `character_prompt_review` | 生图烧钱；锚点文本是全片一致性的基准 |
| 3 | 场景剧本 | 剧本验收 | ☆ | 分场数量、抉择点代价设计 | `scene_script_review` | 文本便宜可后改；但分支逻辑错误传播远 |
| 4 | 分镜 | 镜头方案验收 | ★ | 镜头切分、景别、`nodeId` 映射完整性 | `shot_plan_review` | 主键源头：nodeId 对不上打包全错位 |
| 5 | 关键帧 | 风格基准定调 | ★ | **先出第 1 镜**，验收后批量 | `style_sample_review` | 全片视觉基调由第一张定，批量后发现不对=全烧 |
| 6 | 视频切片 | 样片确认 | ★ | **先渲 1 个镜头**，验收后批量渲 9 个 | `video_sample_review` | 全流程最贵工序，样片确认是成本杠杆最大点 |
| 7 | 影游装配 | 终审交付 | ★ | manifest 试玩预览、节点覆盖率、总时长 | `final_review` | 交付不可逆 |
| 8 | 横向：门禁 FAIL | 审查不通过时 | ★ | 三选一：按意见修改重跑 / 逐条辩护 / 强制通过 | `gate_report` | 双核闭环的裁决出口 |
| 9 | 横向：定点重修 | "重画第 3 镜"类请求 | ★ | 覆盖已验收产物前确认影响范围 | `impact_scope_review` | 明确"只有这一格受影响，其余不动" |

---

## 3. 通用 suspend/resume 协议（所有 confirm 点共用一份类型）

```ts
// schemas/confirm.ts —— 唯一协议定义
export const suspendPayload = z.object({
  uiType: z.enum(['story_bible_review', 'character_prompt_review', 'scene_script_review',
                  'shot_plan_review', 'style_sample_review', 'video_sample_review',
                  'final_review', 'gate_report', 'impact_scope_review']),
  stage: z.string(),              // 当前工序 id
  data: z.unknown(),              // 具体内容，由各工序 schema 约束（uiType → schema 映射见 §2）
  cost: z.object({                // 确认卡必须显示"这次要花多少钱"
    estimated: z.number(),
    currency: z.literal('CNY'),
  }).optional(),
  impactScope: z.array(z.string()).optional(),  // 定点重修时：受影响的镜头/节点 id
  feedbackOptions: z.array(z.string()).optional(), // 快捷反馈，如 "运镜太快" "人物崩了"
});

export const resumePayload = z.object({
  decision: z.enum(['approve', 'revise', 'debate', 'force', 'reject']),
  edits: z.unknown().optional(),   // 用户修改后的完整 JSON（不是 diff，不是留言）
  feedback: z.string().optional(), // 自由文本补充
});
```

实现要点：
- 每个 workflow step 在需要确认处调 `suspend(payload)`；resume 时先 `resumePayload.parse()` 再消费。
- `edits` 必须是**整份替换的 JSON**，用户在卡片上改字段 → 前端合并 → parse → 提交。禁止把用户修改当自然语言传给模型去"领会"。

---

## 4. 前端卡片要求（每个 uiType 一个组件）

| uiType | 卡片形态 | 可编辑内容 | 特殊交互 |
|---|---|---|---|
| `story_bible_review` | A/B 骨架对比 + 角色名单表 | 三幕标题/摘要、结局 label/tone、角色增删 | 导出 JSON 按钮 |
| `character_prompt_review` | 文本卡：N 个角色各一栏 | `visualPrompt` 多行编辑 | — |
| `scene_script_review` | 列表卡：场次折叠预览 | 每场摘要、抉择点 | 设置里可关闭此确认 |
| `shot_plan_review` | 表格卡：镜头列表 | 景别/描述；**只读列**：nodeId | nodeId 缺口/悬空引用**红色标出且禁用通过按钮** |
| `style_sample_review` | 单图大图卡 | 重画提示词 | 通过 → 触发批量；重画 → 原参数+修改重调同一工具 |
| `video_sample_review` | 单视频卡 + 播放器 | 重渲提示词 | 快捷反馈 chips（feedbackOptions）一键填入 |
| `final_review` | 试玩嵌入（播放器）+ 覆盖率报告 | 只读 | 节点覆盖率 < 100% 时禁用交付按钮 |
| `gate_report` | FAIL 明细列表，每条可展开 | 逐条辩护文本 / 修改指令 | 三按钮：修改重跑 / 辩护 / 强制通过（强制需二次确认弹窗） |
| `impact_scope_review` | 影响面卡：只显示受影响的格子 | — | 明示"其余镜头不受影响" |

通用要求：
- 所有卡片提交前 `schema.parse()`，失败红字提示并锁按钮。
- 每张卡显示 `cost.estimated`（批量卡显示总价）。
- suspend 状态落库后用户可以**明天再来确认**——卡片要从持久化的 run 状态恢复渲染，不依赖前端内存。

---

## 5. JSON 的三个出口（用户点"确认"后同时/按需触发）

```ts
// ① resume 进 workflow —— 媒体工序的输入
await run.resume({ resumeData: { decision: 'approve', edits: confirmedJson } });

// ② 注入 agent working memory —— 后续对话的事实源
await mastra.getMemory().saveWorkingMemory({
  threadId, resourceid: projectId,
  workingMemory: JSON.stringify(confirmedJson),
});

// ③ 存 artifacts / 导出下载
await fetch(`/api/project/${projectId}/artifact/${stage}`, {
  method: 'PATCH', body: JSON.stringify(confirmedJson),
});
// 导出下载：Blob + a[download]，文件名 `{stage}_{ts}.json`
```

---

## 6. 原子资产工具族（confirm 卡里"重画"按钮的执行方）

四个能力各做一个 `createTool`（用工厂函数收敛公共逻辑），`requireApproval: true`：

| 工具 | 输入 schema 要点 |
|---|---|
| `generate-character` | characterName + visualPrompt（来自定稿的 story-bible JSON） |
| `generate-pose` | characterAssetId（引用已有资产，不重传图）+ posePrompt + poseCount(1~8) |
| `generate-three-view` | characterAssetId |
| `generate-from-reference` | referenceImageUrl（用户上传）+ visualPrompt |

统一 outputSchema：`assetId / imageUrl / width / height / cost / isDegraded / degradedReason`。
纪律：**工具之间不互相调用**，组合只发生在 agent 推理循环或 workflow step 里；缺输入就 throw 让上游补。

---

## 7. 验收标准（拿一条真实链路走通才算完）

端到端场景：新建项目 → 对话给出立意 → 产出故事圣经草稿 → **卡 1** 编辑角色并确认 → JSON 注入记忆 + 落 artifacts → 分镜生成 → **卡 4** nodeId 有意制造一个悬空引用 → 卡片红标、通过按钮禁用 → 修复后通过 → 关键帧**卡 5**：重画一次第 1 镜 → 批量 → 中途 kill 进程重启 → run 从 suspend 点恢复，卡片还在。

逐条检查：
- [ ] 9 个 uiType 各有组件，未知 uiType 不白屏
- [ ] 所有出口 JSON 过 `schema.parse()`，非法提交被锁
- [ ] 门禁 FAIL 时除 gate_report 三选一外**没有任何别的推进路径**（grep 不到第二处 advance 判断）
- [ ] 每张确认卡显示预估成本
- [ ] 进程重启后 suspend 卡片可恢复
- [ ] schema 改动只发生在 `schemas/` 一处，前端表单自动跟随
- [ ] 默认停的确认点 = 5 个，scene_script_review 可在设置关闭

---

## 8. 明确不要做的事

- 不要做拖拽式流程编辑器、不要做通用"表单引擎"——9 个 uiType 手写组件就够
- 不要把大 payload（图片/视频二进制）塞进 suspend/resume——只放 URL 和参数
- 不要让 agent 参与"决定是否需要确认"——确认点是 workflow 里的静态挂起点，不是模型自由发挥
- 不要做确认历史的时间线/审计看板——artifacts 的版本快照已经有了，够用
