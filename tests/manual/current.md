# 当前手动验收与未完成项

更新：2026-10-27。用户此前确认的原R1–R12工作台修正仍为历史通过记录，不扩展为本轮新增能力通过。窗口/图片稳定性及当前点保存新增M9待用户验证；未补造浏览器版本、逐项时间或异常注入记录。

## 尚未完成

M1–M5从旧集合提取，尚无专项通过记录；M6局域网已按用户本轮决定延期，不作为V1完成门槛。P5新增M7、P6新增M8均待用户手测；旧UI确认不扩展为新增能力通过。账号权限、实时共同输入与编辑软锁不列为待测能力。

| ID / 状态 | 操作步骤 | 预期结果 | 测试原因 |
|---|---|---|---|
| M1 待确认：真实文件与解码边界 | 用[样本说明](basic-demo.md)中的 PNG/JPEG/WebP、竖图/小图/长名称逐个上传；再试损坏、伪装、动画、EXIF异常、超限文件，最后上传合法文件 | 合法图正确显示；异常有明确中文原因，后端错误带requestId；失败不出现成功卡片，可恢复上传。记录实际准备的样本，未准备不记通过 | API已覆盖格式规则，尚缺真实选择器/浏览器解码的专项确认 |
| M2 待确认：昵称与深链接 | 保存图片链接和历史链接，在独立浏览器窗口打开，输入测试昵称；切换为另一昵称保存一次，再查看旧版；测试不存在的图片/版本链接 | 未进入先显示昵称入口；有效链接打开对应图/完整只读版本；旧作者快照不变；无效链接有可恢复错误，不能误开另一图片 | 本轮UI通过不等于身份恢复、链接失效与历史作者边界均已验证 |
| M3 待确认：缓存受限与新会话 | 在专用测试站点带未保存输入刷新；普通新窗口只输入链接打开；若浏览器支持，只限制该测试站点存储并重新进入/编辑，再恢复许可 | 同标签页尽力恢复草稿且详情默认收起；独立新会话只读取正式状态；缓存不可用时明确提示，不伪报保存、不丢当前内存输入；恢复许可后后续编辑可继续缓存 | 不沿用已移除的IndexedDB图片恢复/“重试缓存”按钮预期；真实浏览器存储异常尚无专项证据 |
| M4 待确认：生产页面与目录持久化 | 记下测试图片/版本链接；仅停自己的dev实例，在同终端保留相同DATA_DIR，build/start并打开3002；重新输入昵称，查看、编辑保存、看历史，重启自己的服务再打开链接 | 无Vite也能使用，正式原图/大小/版本跨重启保留；5174与3002的浏览器身份和草稿分开；后端正式数据一致 | 生产HTTP已通过，尚缺生产页面真人操作的明确确认 |
| M5 待确认：演示重置保护（仅演示包） | 使用basic-demo专用目录运行时另终端执行demo:reset；记录拒绝结果；仅停自己的演示实例，明确放弃该包修改后再reset | 活动数据不被覆盖；停止后重置回固定样本，其他手动目录不变；页面显示编号1…5，新点#6 | 旧D12未收到独立反馈；生成器/保护有自动证据，人工数据生命周期仍需确认 |
| M6 延期：可信局域网 | 本次无需执行；未来另行确定可信网络/监听/第二设备验证方案 | 不记通过，不阻塞本轮V1；默认仍为127.0.0.1 | 用户已收窄V1到本机多人协作与并发，不能用本机结果代替LAN证据 |
| M7 待确认：P5图片管理 | 按[回归集合G16–G20](regression.md#p5-新增回归本轮待用户执行)执行批量上传、未知重试、整图删除取消/确认、冲突、分页及键盘窄屏；同时回归G1/G9/G10 | 符合对应条目预期；仅删除专用测试图片，记录未执行分项 | 本轮新功能尚未获用户页面验收，不由旧UI确认或自动化替代 |
| M8 待确认：P6多人协作 | 按[回归集合G21–G27](regression.md#p6-新增回归本轮待用户执行)，本机两个独立浏览器以不同昵称，在同一来源与同一服务验证新增/同点冲突/删除/通知/断线/再次更新及键盘窄屏 | 独立修改核对后保留，同点选择后另点保存；未知请求先确认；通知不覆盖草稿，已删不复活；连接恢复读取最新 | API/进程/无DOM状态测试不证明真实EventSource、焦点、弹窗、缓存及视图体验；所有分项仍待用户执行 |
| M9 待确认：窗口与当前点保存 | 按[回归集合G28–G32](regression.md#2026-10-27-窗口与当前点保存本轮待用户执行)观察非全屏动态稳定性、局部滚动、居中、图库和窄屏面板；用两个独立浏览器核对当前点与其他草稿的保存范围，再验证取消/删除/未知请求 | 图片静止后不周期抖动/时清时糊，列表不撑长整页；保存/取消语义清楚，仅当前点正式保存，其他草稿保留，顶部仍保存全部；真实焦点/布局可达 | 本轮5项用户反馈的专门复验，静态截图、纯几何及无DOM状态测试不能证明动态显示问题已消失 |

另有 **A1 自动化未完成项**：2026-10-27全量191项中190通过，默认3002/5174代理测试因已有3002监听报 `DEFAULT_PORT_IN_USE`，不能记为全量通过。待本人协调释放这两个端口后执行 `npm test`，不能以手测确认替代；不停止其他应用腾端口。本轮未重启现有服务，使用开发页面时刷新到本次前端；P5/P6后端若尚未更新，应由本人重启自己的实例加载005/删除/SSE接口。生产模式需使用本次build产物。

物理断电/磁盘耗尽、Windows ACL实机拒写、macOS/Linux完整运行暂为未验证限制，见[交付说明](../../docs/submission.md)，不强制加入本轮UI验收。

## 准备与运行

只使用本项目 `tests/.tmp/` 的数据。复用已有 `manual-workbench/data` 可继续核对之前保存的版本；需从空白开始时可用同级新的专用目录，记录实际路径。不要连接默认用户DATA_DIR，不因旧文档说“已启动”就认为当前进程属于测试实例。

```powershell
Set-Location D:\Projects\image-review-annotator
$env:HOST = '127.0.0.1'
$env:PORT = '3002'
$env:VITE_PORT = '5174'
$env:DATA_DIR = Join-Path (Get-Location) 'tests/.tmp/manual-workbench/data'
npm run dev
```

开发入口为 http://127.0.0.1:5174/。仅在自己的实例已停止、端口可用时启动。生产用同一DATA_DIR执行 `npm run build`、`npm run start`，打开 http://127.0.0.1:3002/。后端修改需要重启本项目实例；本轮未检查当前后端版本，不再沿用上一轮“旧后端未重启”的现场判断。

样本、演示目录/固定链接与重置说明统一见 [basic-demo.md](basic-demo.md)。手动截图/报告只放对应 `tests/.tmp/` 子目录。

## 结束、清理与反馈

恢复Online和测试站点存储许可，归还移动过的测试文件，只停止自己启动的实例。人工数据默认保留供回归，本轮整理不会删除既有数据库、图片或缓存。

确需清理manual-workbench时，先确认实例已停止，再执行下列检查与删除；其他测试目录需另行核对，不替换为整个tests/.tmp。技术错误使用英文，不修改终端全局配置。

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
# Confirm this project's stopped manual-workbench instance and the displayed path before deletion.
Remove-Item -LiteralPath $taskTarget -Recurse -Force
```

反馈格式：`M编号 / 通过-失败-未执行 / 浏览器与系统 / 现象 / requestId（若有）`。用户反馈后在本文件更新该项状态，再同步相关spec/交付说明。已通过的本轮UI不因列入长期回归而退回“未完成”。
