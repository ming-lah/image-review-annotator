# 开发与 Git 流程

状态：P0–P1 已实现；后续阶段规划
日期：2026-10-25

## 开发前：先写轻量 spec

### 文档分工

- docs/design.md：长期设计基线。
- docs/v1-plan.md：产品与技术细化草案、整体路线图，新增规则需对齐。
- workspace/specs/active/：单个可实施、可验收的开发变更；已完成的 P0–P1 工程骨架归入 completed/。
- 根 README 与 docs/README.md：入口与分类；workspace/README.md：本地推进索引。
- AGENTS.md：目录与协作约束；tests/：唯一测试入口、测试代码、配置和手动集合。

每次开发只维护一份可独立阅读的 spec，写清当前交付、行为、必要方案和验收摘要。具体测试代码与手动步骤统一放在 tests/ 并由 spec 引用，不在多份文档复制测试集合；整体规划不复制进 spec。

每个独立功能、修复或重构，coding 前必须创建：

```text
workspace/specs/active/YYYY-MM-DD-short-name.md
```

spec 只写：

```text
交付：这次完成后用户或运行者能做什么；明确尚不能做什么
行为：说明用户怎么操作，以及正常、失败时会发生什么
实现：只写支撑行为的必要契约、数据变化和边界
验收：用检查项列出可复现步骤和通过标准，开发后就地回填结果
```

最小模板：

```md
# <名称>

状态：待对齐
日期：YYYY-MM-DD

## 本次实现什么

写清本次做什么、暂不做什么。

## 具体行为

说明正常操作和失败时的预期结果。

## 怎么实现

只写必要的接口、数据和实现约束。

## 测试与验收

- [ ] 可复现步骤与通过标准

开发后在本文件回填改动、测试结果、失败与剩余项。
```

先写清 spec，再 coding；范围变化就在原文更新。以读懂和能验收为准，不强制需求编号、多张对照表或额外审批文档。

## 开发中

1. 按当前 spec 实现最小改动。
2. 记录实现入口、数据变化、失败原因和已知限制。
3. 先运行针对性测试，再运行阶段级检查。
4. 发现失败时保留复现步骤和修复结果。
5. 不把未运行的命令写成通过。

完成并验收后，将 spec 从 `workspace/specs/active/` 移到 `workspace/specs/completed/`；被替代的移到 `workspace/specs/archive/` 并注明替代关系。

## 实施顺序

整体阶段表保留在 docs/v1-plan.md；P0–P1 已实现并验证，后续阶段另开 spec。下面为阶段摘要：

1. P0：初始化仓库、工程规则、跨平台数据目录和基础目录。
2. P1：Vue、Express、SQLite、health/ready、开发和生产启动。
3. P2：单图片、点击标记、说明输入的前端闭环。
4. P3：归一化坐标、缩放、滚动、多标记、编辑和删除。
5. P4：图片文件存储、SQLite 元数据、保存和重启恢复。
6. P5：多图片列表、上传、切换和删除。
7. P6：先本机验证并发，再做可信局域网；WAL、编号事务和 version 保护的前移建议见 V1 方案草案，在涉及的阶段 spec 对齐后执行。
8. P7：测试、日志、失败复现、文档和交付。
9. V2：另开 spec，增加基础 WebSocket 更新通知；自动保存另开 spec，先解决草稿、重试、幂等和断网恢复。

每个阶段都必须建立或更新回归测试集，避免后续阶段破坏前面已通过的行为。

## 最低开发标准

- TypeScript 严格模式。
- 前后端共享类型和输入 schema。
- 数据库通过迁移和数据访问层访问。
- 文件路径限制在跨平台 `DATA_DIR` 内，不能接受客户端绝对路径。
- 上传校验大小、扩展名、MIME 和图片尺寸。
- API 错误使用稳定错误码和 request ID。
- 日志不记录图片二进制、密码和完整本机路径。
- 关键功能有单元或集成测试，页面与核心用户流程提供可复现手动步骤、预期和原因；不使用 Playwright 或其他浏览器自动化。
- 测试代码、配置、集合统一在 tests/；自动测试临时数据在 tests/.tmp/，结束后关闭资源并自动清理。workspace/ 只保存 spec 与记录。

## 可观测性和失败证据

结构化日志至少包含：

```text
timestamp level requestId method path status durationMs
imageId annotationId actorId errorCode
```

提供：

```text
GET /api/health   # 进程存活
GET /api/ready    # SQLite 和数据目录可用
```

必须提供：

```bash
npm run repro:invalid-annotation
```

脚本提交空说明或越界坐标，预期返回 HTTP 400 和稳定错误码。更完整的异常 cases 在 P4/P7 对应 spec 中补齐，实际输出写入 spec 和 `SUBMISSION.md`。

## Git 约束

远程仓库：`https://github.com/ming-lah/image-review-annotator.git`
默认分支：`main`，保持可运行。每个分支只服务一个独立目标：

```text
feature/p1-server-health
feature/p2-basic-marker
feature/p4-persistence
feature/p6-concurrency
fix/coordinate-after-scroll
docs/update-design-baseline
```

提交使用 Conventional Commits：

```text
feat: add annotation create endpoint
fix: preserve marker position after scroll
test: cover optimistic update conflict
docs: record local network boundary
```

合并或交付前运行：

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

里程碑通过后再打标签：

```text
v0.1.0-design
v0.2.0-skeleton
v0.3.0-basic-annotation
v0.4.0-persistence
v1.0.0-submission
```

`workspace/`、运行时数据、日志、构建产物、测试报告和 `node_modules/` 不提交。

## Definition of Done

- 对应 spec 已完成并移动到 `completed/`。
- 需求、代码、测试和文档一致。
- 自动化检查实际执行；需要用户手动验证的部分提供 tests/manual/ 中的步骤、预期和原因，未收到反馈前标记待验证，不冒充通过。
- 失败路径有明确行为和复现证据。
- 日志或错误信息可支持排查。
- `SUBMISSION.md` 没有把未验证能力写成已完成。
