# 测试与维护入口

更新：2026-10-28。正式自动测试共26文件，使用Vitest / Supertest、真实SQLite和受控进程；源码与覆盖在本次文档整理中未改动。

评审需要的图文操作、F1–F3失败复现、精确命令、断言和最终验证结果集中在[SUBMISSION.md](../SUBMISSION.md#五可复现的失败)，这里保留自动化覆盖及后续回归导航，不维护第二份案例说明。

## 运行检查

仓库根目录、Node 24.x，先npm ci，再执行：

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run repro:invalid-annotation
npm run test:production
```

生产HTTP检查需要先build，其余测试不要求构建。全量suite中的默认端口用例需要3002/5174空闲；遇到DEFAULT_PORT_IN_USE应保留已有应用并报告，不能换默认端口、跳过断言或把现有ready当成新进程成功。其余进程场景分配独立端口。

本次实际自动结果统一见[提交说明](../SUBMISSION.md#六验证结果与验收)。2026-10-28用户已明确确认现有全部手动回归与所需验证完成，记录在[回归手册](manual/regression.md#验收记录)。本次另按用户明确授权，使用外部Playwright CLI完成SUBMISSION列出的实际页面示例，未引入项目依赖、长期浏览器套件或CI下载步骤；它与完整人工验收分别记录。

## 数据与资源

自动测试只在tests/.tmp创建独立目录，关闭自己的数据库和子进程后自行清理；不使用默认用户DATA_DIR，不修改正式迁移制造失败。已有演示包和人工数据默认保留，不删除整个tests/.tmp，不清理全局浏览器或其他项目数据。清理命令被审批拒绝时保留并报告，不换方式绕过。

一次性浏览器原始截图、快照与日志先保存在本次tests/.tmp目录；最终选用且经检查的截图是正式交付资源，放docs/assets/submission并由SUBMISSION直接引用。历史临时日志不作为当前回归入口，过期说明由Git历史追溯。

## 单元与无DOM状态覆盖

目录tests/unit/，共14文件。定向运行例如`npm test -- tests/unit/review-view.test.ts tests/unit/upload-queue.test.ts`。

| 文件 | 当前覆盖 |
|---|---|
| config.test.ts | 默认端口/监听、非法配置、绝对DATA_DIR及三平台路径规则 |
| review.test.ts | 图片实际边界坐标、说明限制、格式/大小/尺寸预检 |
| review-view.test.ts | 适应/缩放/滚动钳制、小图居中、DPR对齐、指针锚点和滚轮单位/边界 |
| stage-resize.test.ts | 动画帧合并、隐藏/重复测量过滤及卸载取消 |
| review-session.test.ts | 多标记/稳定ID、展开状态、编辑取消、分支草稿和冻结 |
| local-preview.test.ts | 旧预览入口替换失败保留、解码竞态和URL释放 |
| tab-session.test.ts | 同标签页快照、旧缓存升级、严格协议/跨图隔离、存储受限及未知载荷恢复 |
| persistence.test.ts | 显式保存、创建去重、未知结果固定载荷/身份、409、回执与其他草稿保留 |
| marker-save.test.ts | 只提交目标点、保留其他新增/编辑/待删/空草稿、原范围确认、迟到回执精确历史 |
| review-api-client.test.ts | 结构化错误/requestId、损坏响应、超时/取消和结果未知分类、写请求身份一致性头/无客户端授权字段 |
| review-merge.test.ts | 三方独立修改、整条冲突、双删/修改删除、新ID重建及数量边界 |
| review-events.test.ts | SSE服务端慢读/关闭/连接上限；客户端适配器重连/无效消息/停止后回调、撤销心跳断开与停止重连 |
| upload-queue.test.ts | 1–10/11边界、顺序请求、摘要、已知失败、未知暂停/原ID原文件确认、放弃/身份/卸载、认证暂停/原账号恢复 |
| workbench.test.ts | 无DOM Vue工作台、单点/全部/缓存、409核对、通知/搜索竞态、Toast与上传完成、身份/页面/草稿保护、失效重登/跨标签页身份与按账号缓存隔离、注册表单/空密码/重复失败及原草稿保护 |

这些测试不执行DOM/原生dialog/实际EventSource，几何或状态通过不能证明浏览器渲染、焦点、动态抖动或物理清晰度。

## API、SQLite与进程覆盖

目录tests/integration/，共12文件。定向运行例如`npm test -- tests/integration/workbench.test.ts tests/integration/collaboration.test.ts`。

| 文件 | 当前覆盖 |
|---|---|
| auth.test.ts | 真实密码/跨浏览器身份、完整读写鉴权、member/admin、伪造/跨来源/旧标签页拒绝、撤销/过期/限流、账号CLI/历史绑定及不扫描原图；任意密码成员注册/缺失字段/首人不提权/伪造字段/重复并发/Origin/独立限流/不改会话 |
| api.test.ts | health/ready、未登录401/存储503及错误JSON、requestId及内部错误隔离 |
| storage.test.ts | 真实SQLite/WAL/FK、迁移校验/回滚/旧库升级、停启保留 |
| review-api.test.ts | 真实图片解码/字节/限额、旧逐条CRUD/并发编号/版本锁/创建去重 |
| image-storage.test.ts | 文件/数据库补偿、孤儿扫描、缺文件/目录失效、联接与越界拒绝 |
| workbench.test.ts | 操作人、完整版本/diff、点大小、固定版本号、回执/去重/原子事务及旧003兼容 |
| image-management.test.ts | 整图删除/回执/FK/文件、冲突与补偿、旧ID防复活、重启及目录联接保护 |
| collaboration.test.ts | 真实多客户端同基线竞争、核对/再次写入、未知/删除交错及提交后SSE对账 |
| process.test.ts | 非法配置、无效目录、损坏迁移副本、端口/缺构建、IPC断开及自身进程回收 |
| dev.test.ts | 默认端口预检/代理、完整Vite本地模块图、共同启动/退出及冲突回收 |
| persistence-process.test.ts | 真实API保存/编辑/删除后重启，原图/计数/回执及日志边界 |
| basic-demo.test.ts | 样本API/哈希、固定场景/重启、准备不覆盖、活动数据/归属/越界/联接/并行操作保护 |

tests/support/auth-fixtures.ts 为业务回归显式建立账号和服务端会话；isolated-server.ts 在隔离目录建号并通过真实 HTTP 登录后运行进程场景，生产 createApp 不存在测试免鉴权入口。

tests/support/集中维护隔离目录/进程/流辅助代码、真实Vite模块图、样本生成、演示CLI、非法标记和生产HTTP检查。Vite模块图只验证本地模块HTTP和MIME，不执行JS/DOM，不等于页面验收。

## 手动回归与样本

- [regression.md](manual/regression.md)：验收记录、准备/清理及G1–G47完整步骤、预期与原因。新增变更按影响选回归，已有通过项不自动失效。
- [basic-demo.md](manual/basic-demo.md)：16个固定样本、带标记场景、生成与重置的生命周期规则。

单元/状态/HTTP通过不能直接证明浏览器渲染、焦点或物理显示效果。页面常规验收由用户执行；专项浏览器自动化需明确授权，遵循AGENTS及当前用户指令。
