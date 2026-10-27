# 测试入口

更新：2026-10-27。保留全部26份正式自动测试，按当前职责维护，不按旧阶段删除兼容回归。页面交互/视觉由用户手动执行，不使用Playwright或其他浏览器自动化。下方为账号认证、UI成员注册与任意密码实现后的本地实际结果；GitHub 运行状态以 [Actions](https://github.com/ming-lah/image-review-annotator/actions) 为准。

## 命令与最新结果

仓库根目录使用Node 24.x：

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run repro:invalid-annotation
npm run test:production
```

| 本轮实际执行 | 结果与边界 |
|---|---|
| lint | 通过，零警告 |
| typecheck | 通过，Vue与服务端strict检查 |
| npm test | 26文件233项全部通过，包含3002/5174默认端口启动与代理用例；A1本轮已解除 |
| build | 通过，136模块；构建不是页面验收 |
| repro:invalid-annotation | 通过，真实隔离进程空说明/越界均400，稳定错误码/requestId且无标记写入 |
| test:production | 最终构建后通过，真实生产HTTP页面/资源、空密码成员注册/登录、原会话保持/成员删除拒绝、账号登录/图库、当前点/全部保存、SSE、大小/版本/回执、原图、删除/防复活和重启 |
| account CLI | 本轮生产编译CLI help确认任意密码含空密码提示；加盐哈希与空/短/长密码由API测试覆盖。上轮独立tests/.tmp交互初始化/list及最后管理员保护为历史证据 |
| 手动页面 | 未执行；账号与权限G39–G44及成员注册G45–G47为待办，不能用API/无DOM结果代替 |
| 收尾临时目录 | 上轮验证日志/CLI库及失败回归遗留目录的清理曾被自动审批拒绝，原样保留且本轮未重试；本轮常规自动测试自行关闭/清理独立资源，未额外创建日志或手动库 |
| demo:reset | 本轮未重置既有演示包；隔离basic-demo集成测试通过；此前 16 样本/5 条正式标记的真实 API 校验及重启/原图字节一致，见演示说明 |

本轮全量运行时默认端口可用，3002/5174启动与代理用例真实通过；未停止用户应用、改默认端口或跳过断言。上轮因端口占用受阻是历史结果，由本轮实际通过解除A1。不要把现有服务ready当作测试新启动成功。

`test:production`需要先build；`npm test`不需要。默认端口用例固定3002/5174，其余进程测试使用独立端口。每项自动测试只创建tests/.tmp独立目录，关闭SQLite/子进程并清理自身资源，不使用默认用户DATA_DIR，不修改真实迁移制造失败。

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

## 手动测试与后续集合

- [current.md](manual/current.md)：待完成M1–M5/M7–M12、延期M6、已解除A1和独立待审缺陷；建议执行顺序也在该文件。
- [regression.md](manual/regression.md)：唯一G1–G47操作步骤、预期与测试原因；按改动触发，无需每次重跑全部。
- [basic-demo.md](manual/basic-demo.md)：16样本、固定场景、启动/重置与数据隔离，不重复维护另一套用例。

```text
tests/
  README.md          自动覆盖、最新结果、导航
  vitest.config.ts   自动测试配置
  unit/              14份单元/无DOM状态测试
  integration/       12份API/SQLite/进程测试
  support/           正式测试与演示辅助代码
  manual/            current.md / regression.md / basic-demo.md
  .tmp/              忽略的隔离数据、样本及临时产物
```

## 已发生的局部证据

前段会话曾按当时明确允许的例外使用隔离Edge headless 156、DPR=1，在3302/5474和项目tests/.tmp数据上验证。现在遵守AGENTS.md，不继续浏览器自动化，也没有项目依赖/配置/长期浏览器套件。两份日期报告的有效摘要合并如下，不将局部证据改写为用户验收：

- 前轮短视口图库、核对关闭焦点和未知保存提示已修；当时开发/生产分别覆盖10种布局、10种焦点路径及3类未知请求恢复。
- 当前画布开发页测量横/竖/32×24小图在1280×700、860×650、375×667、375×400共12组合：适应中心各轴误差≤0.5 CSS px，小图未放大；短窄舞台修正后137px，控件内部滚动可达。桌面顶栏54px，保存信息在底栏。
- 默认鼠标点击/键盘不新增、只读标记；平移与10%/400%轮缩边界、指针锚点漂移<1 CSS px，失焦/取消/切模式结束手势。打点键盘新增、单点保存另一空草稿保留，保存后工具不复位；未知保存刷新后鼠标仍可确认原范围，未重复建版。
- 保存按钮测得透明背景、绿色文字；成功上传无常驻清单，短Toast消失，混合错误按需详情，未知上传可恢复。未留存完整收尾上传断言，不将11张/原UUID等所有页面子项记通过。
- 上述不能证明最终生产页面、完整Tab/hover/四边坐标、真实显示缩放/动态清晰度或全部M/G通过。既有UI总体确认仍为历史证据；M1–M10不据此批量关闭。
- BC-BV-004窄屏列表缩略图越列遮挡标题仍待审核，见current.md；没有在本次整理中擅自修复。

## 资源与清理

先前演示basic-demo按当时授权重建；manual-p2/manual-p4/manual-workbench等人工数据保留。前段pw-20261027、bvfix-20261027、canvas-20261027浏览器和测试服务已关闭；先前针对这三个旧目录的清理被自动审批以blocked by policy拒绝，命令未执行，目录保留，没有换方式绕过。本轮未重新尝试清理。只清理核实绝对路径/非联接/归属且已停止的单个目标，禁止清理整个tests/.tmp或全局浏览器数据。
