# 开发流程与文件职责

更新：2026-10-27。以[AGENTS.md](../AGENTS.md)为协作约束；本文保留当前工作流，不复制阶段路线和历史测试数量。

## 记录与审批

功能、修复或重构开始前，在workspace/specs/active/YYYY-MM-DD-topic.md维护一份轻量spec，写范围、行为、必要实现和验收摘要。用户审核并明确同意后才开发，范围变化回填同一份。具体测试只引用tests/，不新增并行任务表或开发日志。

实现后记录实际检查和未覆盖边界；仍待用户验收的保持active，真正完成后转completed，被替代的旧方案转archive。提交代码或整理文档不等于用户验收。

文档各司其职：README负责启动和导航；docs/design描述当前行为/架构；本文描述工作方式；docs/submission描述交付限制；tests/README维护自动覆盖与最新结果；tests/manual/current记录人工待办，regression保存唯一完整用例，basic-demo说明测试材料。

## 文件职责

| 目录或入口 | 责任 |
|---|---|
| src/client/App.vue | 入口、图库、审阅/历史页面组合与模式下编辑可见性 |
| src/client/ImageStage.vue | 图像/标记渲染、工具模式、缩放/平移、测量与底部状态 |
| src/client/components/ | 排序、上传反馈、核对弹窗等独立界面组件；保留兼容组件 |
| src/client/http/ | HTTP、DTO验证与SSE客户端适配 |
| src/client/state/use-workbench.ts | 页面/身份/图库/历史/同步/队列等衔接 |
| src/client/state/ | 工作副本、持久化、核对、身份、上传队列和Toast |
| src/client/review*.ts、stage-resize.ts、tab-session.ts等 | 坐标、标记会话、测量调度、预览及标签页缓存逻辑 |
| src/server/app.ts、server.ts | Express装配、启动就绪、静态页面与停服 |
| src/server/http/ | 路由、上传中间件、输入/错误适配、SSE连接 |
| src/server/persistence/ | SQLite仓库、操作人、原图与整图删除 |
| src/server/config.ts、storage.ts、logger.ts | 配置、迁移/目录就绪及日志 |
| src/shared/ | schema、DTO与共享类型，不引入Node专属依赖 |
| migrations/ | 001–005正式SQL，历史校验和不改写 |
| scripts/ | dev/client/start/clean-build/copy-migrations正式运行脚本 |
| tests/unit/ | 纯逻辑、队列和无DOM状态回归 |
| tests/integration/ | Supertest、SQLite、真实HTTP/子进程回归 |
| tests/support/ | 隔离资源、演示生成、非法请求及生产HTTP辅助代码 |
| tests/manual/ | current/regression/basic-demo三份当前手册 |
| tests/.tmp/ | 忽略的隔离数据库、样本和临时产物；只清理已确认本项目归属的目标 |
| workspace/ | 忽略的本地spec与推进索引，不存测试数据 |
| dist/ | 构建输出，不提交 |

保留有兼容责任的源码/自动测试，不因文件名来自旧阶段就删除。Vite根是src/client；源码HTTP客户端放http/，不能放会被/api代理截获的路径。前后端共享模块不能间接导入SQLite或文件系统。

## 验证与数据

变更后运行lint、typecheck、npm test和build；保存/存储/启动变更同时运行非法标记与生产HTTP检查，命令及覆盖见[测试入口](../tests/README.md)。build先清理本项目dist再复制迁移，避免旧编译文件残留。

自动测试只能写tests/.tmp的独立目录，必须关闭数据库/子进程并清理自己的数据。默认端口回归需3002/5174空闲，冲突时明确受阻，不停止其他应用或把现有ready冒充新进程启动成功。其他测试可显式隔离端口，生产检查需要最终构建。

页面交互、视觉、原生文件选择器、焦点和显示器缩放由用户按[手动回归](../tests/manual/regression.md)验证；不使用Playwright或其他浏览器自动化。数学/无DOM状态/HTTP通过不代表页面通过。记录真实缺陷、步骤和requestId，审批后再修复范围外问题。

默认用户DATA_DIR、既有人工数据、其他项目及全局缓存不能作为自动测试目标。演示只用既有demo:prepare/reset并遵守归属/活动数据保护，见[演示说明](../tests/manual/basic-demo.md)。删除目标先核对绝对路径与非联接；自动审批拒绝时保留并报告，不换方式绕过。

## Git

开始前核对Git根、分支、完整脏工作区及暂存区，保留用户改动。默认采用main加短期分支/PR；新分支使用codex/前缀。用户明确要求当前分支提交时可按授权本地提交，不自动推送、合并或发版，不终止用户应用。

提交前检查全部差异、文档链接、测试结果及待验收标记；使用Conventional Commits。源码、正式测试和当前文档提交；workspace、dist、node_modules、日志及tests/.tmp不提交。兼容回归与未通过项不能为得到绿色结果而删改或跳过。

完成标准是实现、文档和测试一致，实际执行适用检查，未验证项明确可操作；自动通过与用户验收分别记录。
