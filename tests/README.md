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
```

`npm test` 不要求先 build，不打开浏览器；使用动态空闲端口和独立测试目录。测试结束关闭子进程和存储，删除本次生成的数据目录。

| 测试文件 | 覆盖内容 |
|---|---|
| unit/config.test.ts | 默认监听配置、非法端口、DATA_DIR、HOST、三种系统路径规则 |
| integration/api.test.ts | health、ready、503、JSON 404、requestId、内部信息隔离、目录故障恢复 |
| integration/storage.test.ts | 真实 SQLite 读写、WAL/外键/超时、迁移回滚/校验、重启保留数据 |
| integration/process.test.ts | 非法配置、无效数据目录、损坏迁移、端口冲突、停启、缺少构建 |
| integration/dev.test.ts | 前端资源及代理、前后端共同退出、任一端口冲突后清理 |

## 手动测试

当前阶段：[P0–P1 手动测试集合](manual/p0-p1.md)。每项包含具体步骤、预期结果和测试原因，执行后由用户反馈结果。

## 当前验证记录

2026-10-25：目录整理后及本地提交前复跑 lint（零警告）、typecheck、build 均通过；自动测试 5 个文件、29 项通过。测试结束检查 tests/.tmp/ 无遗留运行目录；旧测试数据库、源码副本、浏览器截图与报告已清理。

此前的浏览器自动化属于历史证据，相关依赖、配置、代码和产物现已移除，不作为当前验证要求。本轮没有运行浏览器自动化。当前手动页面用例等待用户执行。
