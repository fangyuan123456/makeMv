推进 makeMv 互动影游 AI 导演系统【第一站：底层基石迁移与标准化】的全局收尾与法证审计，完成正式封箱，并紧接着推进【第二站：故事世界观圣经 StoryBible 的 Mastra Tool 化与流式对接】的代码迁移与功能落地。

Working directory: e:\fangyuan\gitWorkSpace\makeMv
Integrity mode: development

## Requirements

### R1. 第一站 Milestone 3 全局收官与法证审计封箱
完成底层基石迁移（ProjectStore SSOT 与 MediaDownloader 视听底层）的全局编译与测试验收，执行架构法典合规审计，产出第一站正式封箱报告。

### R2. 第二站 StoryBible 工具化与流式对接迁移
将 backup/ 历史代码中的故事世界观圣经（StoryBible）工序能力迁移至现代 Mastra + Vercel AI SDK 架构，封装为标准的 Mastra Tool，实现与对话中枢的流式交互与数据流转。

### R3. 严格遵循架构法典与工程契约
全链路遵循项目核心开发与架构法典：单一事实来源 (SSOT)、零历史别名冗余、纯中文提示词体系、刚性 Fail-Fast 阻断，杜绝在下游进行防御性兼容与假收敛。

## Acceptance Criteria

### 第一站编译与测试验收
- [ ] 在 server 目录下执行 TypeScript 编译（`npm run build`），全局 0 错误、0 警告。
- [ ] 运行全量单元测试套件，所有测试用例 100% 通过（PASS），无任何失败或未捕获异常。

### 法典审计与第一站封箱
- [ ] 审查已迁移底层基石模块，确认无任何题材硬编码、无历史别名胶水代码，完成第一站正式封箱报告。

### 第二站 StoryBible 交付
- [ ] 完成 StoryBible 的 Mastra Tool 化封装与流式对接迁移，提供清晰的数据契约与状态读写。
- [ ] 针对 StoryBible 编写对应的单元测试套件，测试用例全部通过（PASS）且 TypeScript 编译 0 错误 0 警告。
