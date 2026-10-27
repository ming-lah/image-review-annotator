# Image Review Annotator · V1

本地图片审阅 Web 工作台：昵称进入 → 图片库 → 鼠标浏览或打点编辑 → 保存当前点或全部修改 → 查看完整版本。支持多图上传/删除、草稿恢复、三方核对和 SSE 已保存通知。昵称用于记录操作人，不是认证。

## 运行

使用 Node.js 24.x；依赖版本以 package-lock.json 为准。

```bash
npm ci
npm run dev
```

开发页面 [127.0.0.1:5174](http://127.0.0.1:5174)，API 为 127.0.0.1:3002，Vite 代理 /api。任一端失败会共同退出；Ctrl+C 只停止本次实例。后端源码修改后重启自己的实例。

```bash
npm run build
npm run start
```

生产页面与 API 同源位于 [127.0.0.1:3002](http://127.0.0.1:3002)，无需 Vite。

| 环境变量 | 默认与边界 |
|---|---|
| HOST | 127.0.0.1；显式覆盖才向其他网卡监听 |
| PORT | 3002；开发代理跟随，不自动换端口 |
| VITE_PORT | 5174；开发前端端口 |
| DATA_DIR | 绝对路径；未设置时采用系统应用数据目录，见[设计](docs/design.md#数据与存储) |

人工验证请使用 [隔离运行方法](tests/manual/current.md#准备与运行)，不要将测试写进默认用户数据。演示包用 `npm run demo:prepare` 首次生成；已有包无需重复生成。明确放弃演示修改时，停止自己的演示实例后执行 `npm run demo:reset`，详见[演示说明](tests/manual/basic-demo.md)。

## 验证与文档

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run repro:invalid-annotation
npm run test:production
```

生产 HTTP 检查需要先 build。页面交互和视觉由用户手动验收，不使用浏览器自动化。

- [测试入口与最新结果](tests/README.md)：单元、API、SQLite、进程及生产 HTTP 检查。
- [待完成的手动验收](tests/manual/current.md)、[唯一手动回归集合](tests/manual/regression.md)、[演示与样本](tests/manual/basic-demo.md)。
- [当前设计](docs/design.md)、[开发流程与文件职责](docs/development.md)、[交付范围与限制](docs/submission.md)、[文档索引](docs/README.md)。
- [项目协作约束](AGENTS.md)；本地 spec 与推进索引位于被 Git 忽略的 workspace/。

```text
src/client/    Vue 页面、组件、HTTP 客户端、状态和坐标逻辑
src/server/    Express、路由、配置、存储和迁移执行
src/shared/    共享 schema、DTO 与类型
migrations/    正式 SQL 迁移
scripts/       正式开发、构建和启动脚本
tests/         自动测试、辅助代码、手动集合及 .tmp/ 隔离数据
docs/          当前设计、开发与交付文档
workspace/     本地 spec 与推进索引，Git 忽略
dist/          构建产物，Git 忽略
```
