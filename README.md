# Image Review Annotator

本地优先的图片审阅Web工作台：昵称进入 → 图片库 → 审阅 → 整图保存 → 查看完整版本。支持多图列表、搜索/排序/分页、1–10张逐文件上传、逐点大小、连续显示序号、版本历史、整图确认删除及服务重启恢复。2026-10-26用户已确认此前工作台UI手测通过；P5新增上传/删除及其他待验场景见[当前待验证](tests/manual/current.md)。昵称不是认证，内容共享可见；不提供实时协作或权限。

## 安装与运行

使用 Node.js 24.x 和 npm，依赖版本由 package-lock.json 精确锁定。

```bash
npm ci
npm run dev
```

开发页面为 [127.0.0.1:5174](http://127.0.0.1:5174)，后端为 127.0.0.1:3002，Vite 代理 /api。任一端启动失败会共同退出；Ctrl+C 停止本次实例。修改后端源码后重启开发命令。

生产模式：

```bash
npm run build
npm run start
```

构建先清理本项目受控 dist/，避免旧编译文件残留；生产只需 Node，在 [127.0.0.1:3002](http://127.0.0.1:3002) 同源提供页面、API 与图片。

| 环境变量 | 默认值与边界 |
|---|---|
| HOST | 127.0.0.1；显式设 0.0.0.0 才监听其他网卡，局域网验收留待 P6 |
| PORT | 3002；开发代理跟随，不静默换端口 |
| VITE_PORT | 5174；只影响开发前端，不静默换端口 |
| DATA_DIR | 绝对路径；不设置时使用系统应用数据目录 |

默认 DATA_DIR：Windows 为 `%LOCALAPPDATA%/ImageReviewAnnotator`，macOS 为 `~/Library/Application Support/ImageReviewAnnotator`，Linux 为 `$XDG_DATA_HOME/ImageReviewAnnotator`，后者未设置时使用 `~/.local/share/ImageReviewAnnotator`。SQLite 与图片文件保存在同一目录树中。错误和日志不输出完整本机路径，技术控制台使用英文 ASCII。

人工验收请使用隔离数据，完整准备与清理见 [当前手动集合](tests/manual/current.md)：

```powershell
$env:HOST = '127.0.0.1'
$env:PORT = '3002'
$env:VITE_PORT = '5174'
$env:DATA_DIR = Join-Path (Get-Location) 'tests/.tmp/manual-workbench/data'
npm run dev
```

未进入时只显示username表单；图库上传成功即保存原图并创建初始记录。批量逐项报告成败，未知结果暂停并可用原文件确认；单张成功打开工作台，多张结束留图库。工作台的标记新增/修改/待删除在顶部一次手动保存，每次有效保存形成V1/V2等完整可查看版本，按时间与操作人显示；图片存续期间全部历史保留，原图不按版本复制。确认“删除图片”会删除本图、全部标记、版本和草稿，无法撤销；原文件清理失败时记录告警并等待受控孤儿扫描。上传队列不承诺刷新续传。同标签页尝试恢复未保存工作副本，缓存失败不影响后端成功；普通新开不承诺恢复草稿。切换username会回入口，不复用不同username的操作人ID。

演示数据已提供：首次运行 `npm run demo:prepare`，随后按 [演示启动与手动步骤](tests/manual/basic-demo.md) 设置专用 DATA_DIR，打开固定图片链接。包含16个合成/错误样本和5条已保存标记；现有包不会被覆盖，需放弃包内改动时先停止自己的演示实例再显式 `npm run demo:reset`。

## 验证

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run repro:invalid-annotation
npm run test:production
```

最后两项使用隔离测试数据并自动清理，生产 HTTP 检查需要先 build。自动结果和覆盖边界见 [tests/README.md](tests/README.md)；页面、焦点和视觉由用户按手动集合验收，不使用浏览器自动化。默认端口回归要求 3002/5174 空闲，不能终止其他应用替测试腾端口。

## 文档与目录

- [文档索引](docs/README.md)、[设计基线](docs/design.md)、[V1 方案与路线图](docs/v1-plan.md)
- [开发流程与代码职责](docs/development.md)、[交付及实际验证记录](docs/submission.md)、[协作约束](AGENTS.md)
- [测试入口](tests/README.md)、[当前未完成验收](tests/manual/current.md)、[后续手动回归](tests/manual/regression.md)、[样本说明](tests/manual/basic-demo.md)

```text
src/client/    Vue 页面、components/、http/、state/ 与图片视图逻辑
src/server/    app/server、http/、persistence/、配置与日志
src/shared/    共享 schema、DTO 与类型，不依赖 Node
migrations/    正式 SQL 迁移；历史迁移不改写
scripts/       正式开发、构建与启动脚本
tests/         单元/API/SQLite/进程测试、手动步骤与隔离临时数据
docs/          产品、设计、流程与交付资料
workspace/     本地 spec 与推进索引，Git 忽略
dist/          构建产物，Git 忽略
```
