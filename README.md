# Image Review Annotator

“审图打点”是本地优先的图片审阅 Web 工作台。当前已实现 P0–P1 工程骨架：Vue 状态页、Express API、SQLite 初始化和开发/生产启动。图片标注功能尚未实现。

产品定位：本地优先、可在可信局域网共享的图片审阅 Web 工作台。

## 当前决策

- 前端：Vue 3 + TypeScript + Vite
- 后端：Node.js + TypeScript + Express
- 数据库：本地 SQLite，作为唯一数据库
- 图片文件：由应用管理的本地数据目录，SQLite 保存图片元数据和相对路径
- 访问方式：本机访问，配置后支持可信局域网访问
- 操作人：V1 使用浏览器生成的操作人 ID 和昵称，不做密码账号
- 并发：SQLite WAL、短事务、服务端编号分配、标记版本乐观锁
- 实时协作：V1 不做 WebSocket，V2 规划加入基础实时更新
- 公网部署、HTTPS、真实账号和复杂权限：不属于 V1

## 文档导航

- [文档索引](docs/README.md)：文档分类、状态与阅读顺序
- [设计基线](docs/design.md)：需求、架构、数据、存储、并发和 V2 边界
- [V1 产品与技术方案](docs/v1-plan.md)：待对齐的交互规则、技术细化、接口草案和路线图
- [开发与 Git 流程](docs/development.md)：spec、阶段推进、测试验收和 Git 约束
- [提交说明](docs/submission.md)
- [测试入口与覆盖范围](tests/README.md)、[手动测试集合](tests/manual/p0-p1.md)
- [协作约束](AGENTS.md)

本地开发记录写在被 Git 忽略的 `workspace/` 目录：

```text
workspace/
  README.md
  specs/active/
  specs/completed/
  specs/archive/
```

`workspace/` 只用于本地推进，不上传 GitHub。

## 安装与运行

需要 Node.js 24.x 和 npm。依赖已精确锁定；SQLite 使用 better-sqlite3，Windows Node 24 已验证安装与真实读写。

```bash
npm ci
npm run dev
```

开发页面：[http://127.0.0.1:5173](http://127.0.0.1:5173)，后端默认 127.0.0.1:3000；Vite 代理 `/api`。任一进程启动失败时共同退出，Ctrl+C 关闭两端。修改后端代码后需重启开发命令。

生产模式：

```bash
npm run build
npm run start
```

生产只运行 Node，在 [http://127.0.0.1:3000](http://127.0.0.1:3000) 同源提供页面与 API，不需要 Vite。缺少构建时返回 BUILD_MISSING 并非零退出。

配置（环境变量）：

| 变量 | 默认值与约束 |
|---|---|
| HOST | 127.0.0.1；可显式设为 0.0.0.0，局域网实机验收留待后续阶段 |
| PORT | 3000；1–65535 整数；开发代理跟随该值 |
| VITE_PORT | 5173；仅开发前端使用，端口冲突时失败，不自动换端口 |
| DATA_DIR | 绝对路径；未设置时使用系统应用数据目录 |

Windows 默认数据目录为 `%LOCALAPPDATA%/ImageReviewAnnotator`，macOS 为 `~/Library/Application Support/ImageReviewAnnotator`，Linux 为 `$XDG_DATA_HOME/ImageReviewAnnotator`（未设置时 `~/.local/share/ImageReviewAnnotator`）。不回退到临时库。数据库仅有迁移表，暂无业务表。

若 3000 已被占用，可在 PowerShell 中显式选择其他端口（本次验证机器的 3000 被 Claude Code Manager 占用）：

```powershell
$env:PORT = '3102'
$env:DATA_DIR = Join-Path (Get-Location) 'tests/.tmp/manual-p0-p1'
npm run dev
```

此时前端仍是 5173，后端为 3102；生产 `npm run start` 同样遵守 PORT。环境变量仅对当前终端及子进程生效。

## 验证命令

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

测试代码、配置、覆盖范围和手动集合统一放在 [tests/](tests/README.md)。自动测试数据在 `tests/.tmp/`，测试结束自动清理，不接触默认用户数据。不使用浏览器自动化验证；页面交互与视觉验收按[手动测试集合](tests/manual/p0-p1.md)由用户执行。

`GET /api/health` 返回 `{"status":"ok"}`；`GET /api/ready` 真实检查 SQLite 查询和目录写入/清理。错误为 `{error:{code,message,requestId}}`，带对应 X-Request-Id，未知 API 返回 JSON 404。请求日志隐藏查询参数及未知路径内容。

## 当前状态

2026-10-25：P0–P1 已实现；实现记录保留在本地完成 spec，[测试入口](tests/README.md)统一维护覆盖范围、结果及手动集合。整体阶段计划见 docs/v1-plan.md。尚不支持上传、查看图片、标记、昵称或协作；`repro:invalid-annotation` 留到业务接口阶段实现，当前没有占位成功脚本。Windows 为实机验证范围，macOS/Linux 仅覆盖路径逻辑。提交与推送按用户授权进行。

## 目录职责

```text
src/client/     页面与样式
src/server/     API、配置、存储、日志
src/shared/     共享 schema 与类型
migrations/    正式 SQL 迁移
scripts/       正式开发、构建、启动脚本
tests/         测试代码、配置、手动集合、隔离临时数据
docs/          设计、方案、流程、交付摘要
workspace/     本地 spec 与推进记录（Git 忽略）
dist/          构建产物（Git 忽略）
```
