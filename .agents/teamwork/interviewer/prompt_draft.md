启动一个 Coder 和一个 Reviewer，针对当前项目的 agent 进行审查修复，Reviewer 跑通所有单测前让他们一直循环修改，直到完全通过为止。[OPEN: 团队组织模式 - 小型聚焦团队还是标准团队？]

Working directory: e:\fangyuan\gitWorkSpace\makeMv\server
Integrity mode: [OPEN: 行为限制与完整性模式]

## Requirements

### R1. Agent 审查与修复
针对当前项目的 agent 代码进行系统性审查与问题修复。[OPEN: 审查范围是否仅限 server/src/agents 还是扩展至全流程技能？]

### R2. 审查与测试循环
Reviewer 与 Coder 形成闭环循环，在所有单元测试完全跑通前持续进行迭代修改，直至全部通过。[OPEN: 单元测试来源及运行机制]

## Acceptance Criteria

### 单元测试与代码质量
- [ ] [OPEN: 具体的单测与验收标准]
