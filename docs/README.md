# 项目文档

更新：2026-10-26。用户已确认本轮工作台UI手测通过；自动检查与剩余专项验收分开记录。

| 文档 | 用途 |
|---|---|
| [设计基线](design.md) | 技术与存储责任，含历史设计背景 |
| [V1方案](v1-plan.md) | 当前行为、阶段路线与后续边界 |
| [开发流程](development.md) | spec审批、代码职责、Git和验证约束 |
| [交付说明](submission.md) | 当前交付、用户确认、自动证据及未验证限制 |
| [测试入口](../tests/README.md) | 自动覆盖、最新结果和手动集合导航 |
| [当前待验证](../tests/manual/current.md) | M1–M5/M7/M8/M9和自动遗留A1；M6局域网延期 |
| [后续回归](../tests/manual/regression.md) | G1–G32按改动触发；P5/P6及本轮窗口/单点保存新增项待测 |
| [样本说明](../tests/manual/basic-demo.md) | 演示数据、格式边界和重置/隔离规则 |
| [静态原型](prototypes/review-workbench/README.md) | 历史设计参考；不再独立验收、不作当前产品预期 |

本地workspace/被Git忽略：active只保留仍有真实未完成门禁的spec；completed是已完成验收记录；archive是被后续方案替代的阶段记录。用户总体确认不补造成其他旧集合的逐项通过记录。

一次变更只维护一份轻量spec，写清范围、行为、实现和验收摘要；具体步骤只维护在tests/。新功能仍须先审核spec并同意后开发。手册清理不删除旧API、缓存或数据库迁移的正式自动兼容回归。
