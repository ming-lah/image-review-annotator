# Image Review Annotator

本地图片审阅工具：上传图片、打点写说明、显式保存、查看历史，并与同一服务的同事核对修改。

**先看 [SUBMISSION.md](SUBMISSION.md)**：需求、产品规则、安装配置、设计、实际页面截图、操作步骤、失败复现、验证结果与AI协作，集中在这一份说明中。

## 运行

需要Node.js 24.x，在仓库根目录执行：

```bash
npm ci
npm run dev
```

打开 **http://127.0.0.1:5174**，创建普通账号、登录并上传图片。可直接上传仓库内`docs/assets/submission/sample-poster.png`复现提交说明中的案例。开发后端固定3002、前端5174，端口占用会明确报错。

生产运行：

```bash
npm run build
npm run start
```

打开 **http://127.0.0.1:3002**。默认只监听本机；账号、独立DATA_DIR、演示数据、管理员创建与备份方法见[提交说明的运行章节](SUBMISSION.md#二安装与运行)。只停止自己启动的实例。

## 目录与维护入口

| 位置 | 用途 |
|---|---|
| [SUBMISSION.md](SUBMISSION.md) | 完整交付说明，需求/设计/图文案例/失败证据的主入口 |
| src/client/、src/server/、src/shared/ | Vue前端、Node后端、共享schema与类型 |
| migrations/、scripts/ | 正式SQL迁移与运行/构建脚本 |
| [tests/README.md](tests/README.md) | 自动化命令、覆盖范围与维护导航 |
| [tests/manual/regression.md](tests/manual/regression.md) | 完整G1–G47回归集合、验收记录与隔离数据清理 |
| [tests/manual/basic-demo.md](tests/manual/basic-demo.md) | 固定演示样本与准备/重置规则 |
| [docs/development.md](docs/development.md) | 开发流程与源码职责 |
| docs/assets/submission/ | 提交说明正式截图与样例海报 |
| workspace/、tests/.tmp/、dist/ | Git忽略的本地spec、隔离测试产物、构建输出 |

项目协作约束见[AGENTS.md](AGENTS.md)。完整需求与设计已合并入SUBMISSION，不再保留重复设计文档或独立待验收清单。
