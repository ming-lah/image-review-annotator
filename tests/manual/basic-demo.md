# 手动样本与演示数据

本文件只说明测试材料与生命周期，不再维护D1–D12阶段用例。当前待验收见 [current.md](current.md)，后续回归见 [regression.md](regression.md)。

最近初始化：2026-10-27，按用户授权执行已有demo:reset，恢复16个样本、固定原图和5条正式标记；API样本校验、原图字节及重启一致性通过。basic-demo以外的人工数据保留；该结果不代替M5活动实例拒绝重置的人工验收。

## 准备与启动

仓库根目录使用Node 24.x。首次运行 `npm run demo:prepare`；已有非空包会报DEMO_ALREADY_EXISTS，保留数据，不要为启动重复生成。样本位于tests/.tmp/basic-demo/fixtures，manifest.json记录实际哈希、尺寸与预期错误；data保存演示原图/数据库，OPEN-DEMO.txt提供入口。

```powershell
Set-Location D:\Projects\image-review-annotator
npm run demo:prepare
$env:HOST = '127.0.0.1'
$env:PORT = '3002'
$env:VITE_PORT = '5174'
$env:DATA_DIR = (Resolve-Path 'tests/.tmp/basic-demo/data').Path
# 新生成的包已包含隔离演示账号；为人工使用重新设置自己的密码
npm run account -- reset t20000000-0000-4000-8000-000000000001
npm run dev
```

新包登录账号 t20000000-0000-4000-8000-000000000001 对应演示甲；演示乙为尾号002。账号由演示生成器显式建立，先用 reset 设置人工密码；仅能用于 tests/.tmp 演示目录。旧版无账号的包先停止自己的实例、备份后运行 account init demo-admin "演示管理员"，不要为获得账号重置已有演示成果。已有包跳过prepare命令。端口被占用时不停止其他应用；只停止自己的实例，显式覆盖端口时同步页面地址和代理。不要把演示数据混进默认用户DATA_DIR。

[演示图入口](http://127.0.0.1:5174/?imageId=10000000-0000-4000-8000-000000000001)，生产入口为同样imageId的3002地址。先使用账号和密码登录，再进入图片。包的5条正式标记在当前UI连续显示#1…#5，新点显示#6；manifest中内部number仍可能为1/3/4/5/6、nextNumber为7，这些用于存储排序，不是用户可见序号。标记version是乐观锁，图片V1/V2是独立保存版本，具体历史以当前生成结果为准。

## 样本

| 文件 | 内容与服务端预期 | 原因 |
|---|---|---|
| grid-landscape.png / .jpg / .webp | 2000×1500静态网格，可上传 | 三格式与坐标目标 |
| grid-portrait.png / tiny.png / 长名称.png | 竖图、小图、长文件名，可上传 | 适应、滚动与溢出 |
| empty.png / broken.png | 空文件、损坏图；400 IMAGE_INVALID | 解码与可恢复失败 |
| unsupported.txt / jpeg-disguised-as-png.png | 不支持格式、字节/声明不一致；415 IMAGE_TYPE_UNSUPPORTED | 浏览器预检不替代服务端校验 |
| oversized.png | 20MiB+1；413 IMAGE_TOO_LARGE；内容不是合法图 | 只验证文件大小，不当作合法大图 |
| too-wide.png / too-many-pixels.png | 12001×1、8000×5001；400 IMAGE_INVALID | 边长/总像素上限 |
| animated.png / animated.webp | 两帧；415 IMAGE_ANIMATION_UNSUPPORTED | 动画拒绝 |
| orientation-6.jpg | EXIF方向6；415 IMAGE_ORIENTATION_UNSUPPORTED | 非正常方向拒绝 |

样本默认16个，实际文件名以manifest为准。首次prepare可加 `-- --boundaries`，增加12000×1、8000×5000两张合法边界图；已有包若需重建，先停止自己的实例，再明确执行 `npm run demo:reset -- --boundaries`。精确20MiB合法图片由自动集成测试覆盖，不塞入默认样本。

## 重置与清理

`npm run demo:reset`会放弃该演示包的人工修改，只有明确需要恢复固定场景且自己的实例已停止时才执行。活动数据库/WAL/SHM会触发保守拒绝，不直接删这些文件绕过保护。生命周期人工检查为current.md的M5；生成器及归属/越界/活动数据保护由integration/basic-demo.test.ts维护。

包默认保留。确需删除时核对根目录、绝对目标tests/.tmp/basic-demo、归属标识及无联接，确认对应实例已停；只删除该包，不递归删除整个tests/.tmp，也不清理manual-workbench或全局浏览器数据。一般手动数据清理示例见current.md。
