# 当前手动验收与未完成项

更新：2026-10-26。用户已明确确认本轮工作台手动测试通过，原 R1–R12 对应的 UI 修正记为用户总体验收通过；未补造浏览器版本、逐项时间或异常注入记录。已通过项转入 [后续回归集合](regression.md)，无需现在重复执行。

## 尚未完成

以下从旧集合提取，尚无单独通过记录，不把本轮 UI 确认扩展为这些场景已通过。只测试当前已有功能；批量上传、图片删除、账号权限、实时协作不列为待测能力。

| ID / 状态 | 操作步骤 | 预期结果 | 测试原因 |
|---|---|---|---|
| M1 待确认：真实文件与解码边界 | 用[样本说明](basic-demo.md)中的 PNG/JPEG/WebP、竖图/小图/长名称逐个上传；再试损坏、伪装、动画、EXIF异常、超限文件，最后上传合法文件 | 合法图正确显示；异常有明确中文原因，后端错误带requestId；失败不出现成功卡片，可恢复上传。记录实际准备的样本，未准备不记通过 | API已覆盖格式规则，尚缺真实选择器/浏览器解码的专项确认 |
| M2 待确认：昵称与深链接 | 保存图片链接和历史链接，在独立浏览器窗口打开，输入测试昵称；切换为另一昵称保存一次，再查看旧版；测试不存在的图片/版本链接 | 未进入先显示昵称入口；有效链接打开对应图/完整只读版本；旧作者快照不变；无效链接有可恢复错误，不能误开另一图片 | 本轮UI通过不等于身份恢复、链接失效与历史作者边界均已验证 |
| M3 待确认：缓存受限与新会话 | 在专用测试站点带未保存输入刷新；普通新窗口只输入链接打开；若浏览器支持，只限制该测试站点存储并重新进入/编辑，再恢复许可 | 同标签页尽力恢复草稿且详情默认收起；独立新会话只读取正式状态；缓存不可用时明确提示，不伪报保存、不丢当前内存输入；恢复许可后后续编辑可继续缓存 | 不沿用已移除的IndexedDB图片恢复/“重试缓存”按钮预期；真实浏览器存储异常尚无专项证据 |
| M4 待确认：生产页面与目录持久化 | 记下测试图片/版本链接；仅停自己的dev实例，在同终端保留相同DATA_DIR，build/start并打开3002；重新输入昵称，查看、编辑保存、看历史，重启自己的服务再打开链接 | 无Vite也能使用，正式原图/大小/版本跨重启保留；5174与3002的浏览器身份和草稿分开；后端正式数据一致 | 生产HTTP已通过，尚缺生产页面真人操作的明确确认 |
| M5 待确认：演示重置保护（仅演示包） | 使用basic-demo专用目录运行时另终端执行demo:reset；记录拒绝结果；仅停自己的演示实例，明确放弃该包修改后再reset | 活动数据不被覆盖；停止后重置回固定样本，其他手动目录不变；页面显示编号1…5，新点#6 | 旧D12未收到独立反馈；生成器/保护有自动证据，人工数据生命周期仍需确认 |
| M6 待P6安排：可信局域网 | 先完成本机闭环；仅在可信网络显式HOST=0.0.0.0启动测试目录，第二台设备打开服务器局域网IP:3002，查看/保存，第一台手动刷新 | 两端看到同一正式状态；不承诺实时推送/自动合并；默认127.0.0.1不作为局域网通过证据 | 需要第二台设备与实际网络，不由本机API或本轮UI验收代替 |

另有 **A1 自动化未完成项**：上次全量137项中136通过，默认3002/5174代理测试因端口占用受阻。待本人协调释放这两个端口后执行 `npm test`，不能以手测确认替代；不停止其他应用腾端口。本轮仅整理文档，未复跑该检查，端口当前仍有监听。

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
