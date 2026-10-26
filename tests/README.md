# 测试入口

测试代码、配置、覆盖说明和手动用例统一放在本目录。不使用 Playwright 或其他浏览器自动化；页面验证由用户手动完成。

```text
tests/
  README.md              测试命令、覆盖范围与当前结果
  vitest.config.ts       自动测试配置
  unit/                  配置与纯逻辑测试
  integration/           API、SQLite、启动与进程测试
  support/               测试辅助代码及自动清理
  manual/                手动测试步骤、预期与原因
  .tmp/                  临时数据，Git 忽略；自动测试结束自动清理
```

## 自动检查

在仓库根目录使用 Node 24.x：

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run repro:invalid-annotation
npm run test:production
```

`npm test` 不要求先 build，不打开浏览器；除默认端口验证需使用固定 3002/5174，其余进程测试使用动态空闲端口，并采用独立测试目录。测试结束关闭本次子进程和存储，删除本次生成的数据目录。默认端口被现有应用占用时记录受阻，不结束该应用。

`repro:invalid-annotation` 在隔离真实子进程中提交空说明和越界坐标，检查 400、稳定错误码、requestId 和无标记写入；异常非零退出。`test:production` 在 build 后检查真实生产 Node 的首页/静态资源、图片、保存和重启恢复。这两项自动关进程并清理本次 tests/.tmp/ 目录；生产 HTTP 通过不等于真实页面验收通过。

| 测试文件 | 覆盖内容 |
|---|---|
| unit/config.test.ts | 默认监听配置、非法端口、DATA_DIR、HOST、三种系统路径规则 |
| unit/review.test.ts | 实际图片边界坐标、说明长度、图片类型/大小/尺寸预检 |
| unit/local-preview.test.ts | 图片替换取消/失败保留完整会话、成功才重置、异步竞态与 URL 释放；注入解码器，不代替真实浏览器解码 |
| unit/review-session.test.ts | 多标记、稳定身份及临时标签、展开/收起保留内存内容、编辑副本、草稿切换分支、确认删除与冻结状态 |
| unit/review-view.test.ts | 适应与手动缩放边界、视口中心锚点、局部定位、滚动钳制与小图居中 |
| unit/tab-session.test.ts | 刷新快照与图片关联、新会话不恢复、同步元数据、配额/图片写入失败重试、缓存竞态、非法快照与清除；注入 adapter 不替代浏览器存储验收 |
| unit/persistence.test.ts | 上传不顺带保存标记、逐条保存、未知结果载荷冻结与 UUID 重用、已知失败保留输入、重复点击、409 显式换基线、更新/删除响应丢失、昵称身份；BC-P4-002：临时标记提交但响应丢失，刷新合并后同ID唯一、其他草稿保留、原请求可确认 |
| unit/review-api-client.test.ts | 结构化错误及 requestId、损坏/无效响应归为结果未知、图片缺失错误、20 秒超时取消 |
| integration/api.test.ts | health、ready、503、JSON 404、requestId、内部信息隔离、目录故障恢复 |
| integration/storage.test.ts | 真实 SQLite 读写、WAL/外键/超时、迁移回滚/校验、重启保留数据 |
| integration/process.test.ts | 非法配置、无效数据目录、损坏迁移、端口冲突、停启、缺少构建、父进程断开 IPC 后退出并释放监听 |
| integration/dev.test.ts | 默认端口启动前占用探测、3002/5174 和代理、完整本地开发 JS 模块图、正常/IPC 断开时共同退出、任一端口冲突后清理 |
| integration/review-api.test.ts | 真实图片验证、字节/哈希、限额、动画/方向、并发上传去重、CRUD/编号、重复创建防复活、版本冲突、忙锁和失败格式 |
| integration/image-storage.test.ts | 图片/SQLite 补偿、清理失败告警、老孤儿清理、引用/新文件保留、目录联接与越界保护、业务目录失效 |
| integration/persistence-process.test.ts | 真实 API 子进程保存、编辑、删除后重启，验证图片、记录、计数、去重记录和日志隔离 |
| integration/basic-demo.test.ts | 合成样本经真实HTTP逐项校验、固定场景与重启、哈希一致；准备不覆盖、活动数据拒绝重置、归属/路径/联接/并行操作保护、重置后固定场景、ASCII CLI失败 |
| unit/workbench.test.ts | 整体工作副本校验、逐点大小/取消/缓存、旧冻结载荷恢复；无浏览器Vue状态覆盖连续序号、完整版本与按需比较、摘要同步/刷新失败分离、搜索请求代次、Toast假时钟及既有入口/离开保护 |
| integration/workbench.test.ts | 稳定userId、完整版本/diff、逐点大小与旧API保留大小、固定版本号/准确图库摘要、非法size及历史写入失败回滚、旧003快照/请求回执升级；保留原子保存/去重/分页/超20次/重启与旧P4升级回归 |

tab-session.test.ts 同时覆盖 P3 旧快照成功升级后才移除旧入口、正式图片只缓存元数据、待确认载荷恢复及不同 imageId 拒绝。storage.test.ts 同时覆盖保留 001 原始校验值的旧库升级。

support/dev-module-graph.ts 从真实 Vite 的 /main.ts 出发，用 TypeScript AST 读取静态及字面量动态 import/export，逐个 HTTP 检查项目本地模块 200 与 JavaScript MIME；覆盖 .vue 编译模块、client/http/ 和共享 schema。它不执行 JS、不访问 DOM，不验证第三方优化依赖、CSS/图片或页面交互，不能写成浏览器验收。默认端口被现有服务占用时，在启动测试子进程前报 DEFAULT_PORT_IN_USE，不把现有服务的 ready 当作测试启动成功。

## 手动测试

- [当前验收与未完成项](manual/current.md)：本轮R1–R12已获用户总体通过确认；只保留未获专项确认的M1–M6及端口自动回归A1。
- [后续开发手动回归](manual/regression.md)：G1–G15按改动选择执行，包含步骤、预期、原因；不是现在重新要求全部执行。
- [样本与演示数据](manual/basic-demo.md)：唯一材料/固定入口/重置说明，不重复维护用例。

旧P0–P4、W、U、R、D阶段手册已合并；逐条保存、上传前临时模式、全局点大小、不重排编号、继承界面、静态原型占位控件不再作为现产品预期。正式自动测试保留，包括旧API/旧缓存/迁移兼容覆盖；没有因为手册过期而删除必要回归。

## 最新结果与证据边界

2026-10-26：用户明确“手动测试通过”，本轮8项UI修正（原R1–R12）记为用户总体验收通过；没有额外补写设备、浏览器、逐条结果或故障注入数据。相应BC-WB-001/002/003按此次反馈关闭，后续回归见G2/G7/G9等。旧阶段未获确认且仍适用的场景转入M1–M6，不再分阶段重复挂待验收。

最近开发轮自动证据：lint零警告、typecheck、build、生产HTTP与重启/原图字节/逐点大小/版本号/去重检查、非法标记400及requestId检查通过。全量18文件137项中136通过，1项默认3002/5174代理测试因已有3002占用报DEFAULT_PORT_IN_USE。该项仍为A1未完成，不被用户手测确认覆盖。本轮未复跑全量、未启动/停止现有服务，端口仍有监听；不沿用旧PID或“当前后端仍旧”的现场判断。

本轮仅合并手册、同步状态与引用，保留自动测试/辅助代码及现有人工作业数据。未使用浏览器自动化、未commit/push。历史阶段自动数量不再堆在测试入口；相关过程记录仍在本地workspace/specs/及交付说明。产品验收和自动检查分开记录，最新待办以current.md为准。

本轮整理检查：lint零警告、typecheck、演示生成器5项定向集成测试通过，22份Markdown的本地文件链接检查通过；仅改说明文字，未重跑build/全量137项，也未重跑页面验收。定向测试子进程与独立临时目录已自动清理。

### P5 准备及本地提交前复核（2026-10-26）

本次重新执行 lint（零警告）、typecheck、build，均通过；全量 `npm test` 为18文件137项：136通过、1失败。失败为默认3002/5174代理用例，启动前发现已有3002监听并报 `DEFAULT_PORT_IN_USE`，A1继续保留；没有结束占用应用或跳过断言。`npm run repro:invalid-annotation` 与 `npm run test:production` 均通过，后者覆盖生产HTTP资源、昵称入口、图库、整图保存、点大小、版本、去重及重启。仅使用独立测试目录与本次子进程，结束后由辅助代码清理。

本次未执行页面手动验收；此前用户对UI的总体确认与M1–M6的未完成状态保持分开。源码已具备单文件上传、多图图库/搜索/排序/分页/切换和版本历史；多文件选择上传及整张图片删除尚未实现。昵称/userId、事务、旧版本拒绝和固定请求重试为后续协作提供基础，不代表账号认证、实时协作或P6已验收。
