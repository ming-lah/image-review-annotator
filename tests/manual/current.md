# 当前待完成验收

更新：2026-10-27。实现和自动检查不等于用户页面验收；此前UI总体确认与前段局部浏览器证据保留在[测试入口](../README.md#已发生的局部证据)，不批量关闭下列专项项。具体步骤、预期和原因唯一维护在[回归集合](regression.md)。

2026-10-27用户反馈“当前基本正确，手动测试完成部分”，明确同意先在GitHub合并，后续再批量进行完整回归和测试。本次未提供已完成用例清单，因此记录为用户部分手测确认，不据此逐项关闭M11/M12或其他待办，也不将完整回归记为通过。

## 建议顺序

- [ ] 先做M12：UI成员注册与任意密码，G45–G47。
- [ ] 再做M11：账号登录、固定权限和身份失效，G39–G44。
- [ ] 再做M10：底栏/模式隔离/保存样式/上传提示，G33–G38。
- [ ] 再做M9：动态稳定性、局部滚动和单点范围，G28–G32。
- [ ] 再做M7/M8：图片管理和两个独立浏览器的协作/冲突，G16–G27。
- [ ] 补M1–M5：文件、身份/链接、缓存、生产页面/备份和演示生命周期专项。
- [x] A1：本轮全量233项全部通过，包含3002/5174默认端口启动与代理；未停止其他应用。
- M6局域网/第二设备延期，不阻塞本轮本机V1。

以上按新功能风险排序，相关用例可以一起执行。没有要求重做此前全部已验收UI。

## 验收状态

| ID / 状态 | 对应操作集合 | 预期与原因 |
|---|---|---|
| M12 待完成：成员注册/任意密码 | [G45–G47](regression.md#普通成员注册与任意密码) | 简单/空密码可注册登录；注册不影响旧会话与草稿，不能创建admin；管理员仍后台创建，新增页面未验收 |
| M11 待完成：账号与权限 | [G39–G44](regression.md#账号认证与权限) | 登录/跨浏览器身份、member/admin操作差异、撤销与SSE、跨标签页草稿/未知请求隔离；本轮无页面自动化，不记为通过 |
| M1 待完成：文件/解码 | G13，使用basic-demo全部格式/错误样本，合法失败后恢复上传 | 真实选择器/浏览器解码与错误恢复可用；API校验不能替代 |
| M2 待完成：账号/深链接 | G1/G10，独立浏览器登录账号打开图片/历史链接，退出/切账号，试无效链接 | 正确身份、作者快照和目标资源；同源缓存不串身份 |
| M3 待完成：缓存受限 | G11/G25，同标签页带草稿刷新、新会话链接打开，仅限制测试站点存储后恢复 | 尽力恢复与明确缓存错误，不伪报后端失败；真实存储条件未专项确认 |
| M4 待完成：生产页面/备份 | G13，同测试DATA_DIR从dev切生产/重启；用停服完整目录副本演练恢复 | 生产页面真实可用，原图/版本可恢复；生产HTTP通过不替代 |
| M5 待完成：演示生命周期 | G15，活动演示实例时reset应拒绝，停自己的实例后重置 | 不覆盖活动数据/其他目录；本轮已完成停服reset与重启校验，未代填人工保护结果 |
| M6 延期：LAN | 后续另定第二设备/网络方案，本轮不执行 | 默认127.0.0.1，本机多浏览器不等于LAN |
| M7 待完成：图片管理 | [G16–G20](regression.md#图片管理) | 批量/未知/整图删除/分页/窄屏与键盘闭环；只删除专用测试图 |
| M8 待完成：协作 | [G21–G27](regression.md#协作与请求恢复)，A/B两个独立浏览器访问同一来源 | 独立修改可核对保留，同点显式选择，未知优先确认，再次竞争/删除不覆盖草稿 |
| M9 待完成：窗口/单点 | [G28–G32](regression.md#窗口与当前点保存) | 动态不周期抖动，局部滚动/焦点正确；保存当前点保留其他草稿，独立会话验证正式范围 |
| M10 待完成：工具/状态/上传 | [G33–G38](regression.md#画布工具与上传反馈) | 底栏版本/时间/作者正确；鼠标无编辑入口，打点可编辑；草稿保留、绿字保存、正常上传短提示及异常恢复 |

A1已解除：本轮26文件233项全部通过，包含固定3002/5174默认端口启动和代理；上轮DEFAULT_PORT_IN_USE仅保留为历史，不再列为当前阻塞。自动通过不替代页面手动验收。

## 已知待审核缺陷

| 编号 / 状态 | 现象与已有证据 | 后续范围 |
|---|---|---|
| BC-BV-004 待审核、未修 | 375×400图库列表的100px预览列内，预览元素宽165px，正文从119px起、预览到184px，遮住标题开头；无上传结果也出现 | G20复核列表/网格及长标题，需独立批准后限制预览不越列；本次整理不改产品代码修复它 |

## 准备与运行

只使用本项目tests/.tmp独立数据。manual-workbench/data可续查之前人工版本；需要空白数据时使用同级新目录并记录实际路径，不能连接默认用户DATA_DIR。编辑/保存/删除场景先切“打点”，只读验证使用“鼠标”；A/B需同一来源、独立浏览器身份。

```powershell
Set-Location D:\Projects\image-review-annotator
$env:HOST = '127.0.0.1'
$env:PORT = '3002'
$env:VITE_PORT = '5174'
$env:DATA_DIR = Join-Path (Get-Location) 'tests/.tmp/manual-workbench/data'
# 仅首次：初始化隔离目录账号；已初始化则使用原账号，不重复 init
npm run account -- init admin "测试管理员"
# 测试成员从登录页“创建普通账号”建立；后台 create 仍可用于既有固定夹具
npm run dev
```

初始化在自己的旧实例停止后进行；先备份需要保留的旧人工库。普通成员可从登录页创建；管理员在交互终端创建。密码不设长度/复杂度规则，可为空，不把真实密码写入脚本或反馈。测试角色命令始终沿用上面同一 DATA_DIR；已有账号用 account list 确认。开发入口http://127.0.0.1:5174/。只在自己的实例已停止且端口可用时启动。生产使用相同DATA_DIR执行`npm run build`、`npm run start`，打开http://127.0.0.1:3002/。后端变更需重启自己的实例；不沿用旧PID或旧文档判断运行版本。

固定演示目录/链接、16样本与重置见[basic-demo.md](basic-demo.md)。手动截图和临时输出只放对应tests/.tmp子目录。

## 结束、清理与反馈

恢复Online、测试站点存储许可、浏览器缩放和移动过的测试文件，只停止自己启动的实例。人工数据默认保留；演示reset只处理basic-demo，不清理其他人工目录。

确需清理manual-workbench时，先确认实例已停，再核对项目和目标；其他目录需单独核对，不能改成整个tests/.tmp。技术输出英文ASCII，不修改全局终端配置。

```powershell
Set-Location D:\Projects\image-review-annotator
$taskProject = (Resolve-Path -LiteralPath '.').Path
if ((Get-Content -LiteralPath (Join-Path $taskProject 'package.json') -Raw | ConvertFrom-Json).name -ne 'image-review-annotator') { throw 'Unexpected project' }
$taskExpected = [IO.Path]::GetFullPath((Join-Path $taskProject 'tests/.tmp/manual-workbench'))
$taskTarget = (Resolve-Path -LiteralPath $taskExpected).Path
if ($taskTarget -ne $taskExpected) { throw 'Unexpected cleanup target' }
foreach ($taskPart in @('tests','tests/.tmp','tests/.tmp/manual-workbench')) {
  if ((Get-Item -LiteralPath (Join-Path $taskProject $taskPart) -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Cleanup path is a link' }
}
if (Get-ChildItem -LiteralPath $taskTarget -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Cleanup tree contains a link' }
Get-Item -LiteralPath $taskTarget | Select-Object FullName
# Confirm the stopped instance and displayed absolute path before deletion.
Remove-Item -LiteralPath $taskTarget -Recurse -Force
```

自动审批拒绝删除则保留并报告，不换方式绕过；不删全局浏览器缓存/其他项目。反馈格式：`M/G编号 / 通过-失败-未执行 / 浏览器与视口 / 现象 / requestId（若有）`。收到反馈后在本文件更新状态，再同步本地spec。
