# 设计基线

日期：2026-10-25
状态：设计基线；阶段实现进度见开发记录
来源：作业题面、需求讨论和当前工作区的设计注释

2026-10-26当前实现补充：已实现username入口、共享图库、整图保存和完整版本查看，入口为“查看历史”，不暴露继承概念。004新增逐点size（12–48px，默认24）及不可变图片版本号；显示序号按当前/各历史有效集合连续编号，真实ID不变。旧历史缺size按24读取，内部差量重建保留，原图一份/历史全部保留。逐点大小、Toast、缩放滑块、摘要同步和默认收起已获用户总体手测通过；未完成项见tests/manual/current.md，后续回归见tests/manual/regression.md；下文保留初始设计背景。

## 产品形态

P5当前实现补充：图库支持一次选择1–10张、逐文件顺序上传与逐项结果；结果未知时暂停并使用原请求确认。工作台可确认删除整图及全部标记/版本，旧基线拒绝删除。005迁移保留最小已删imageId，防止旧上传请求复活；事务先完成逻辑删除，再清理原图，清理失败告警并等待受控孤儿扫描。版本保留规则以图片未被明确删除为前提。新增页面验收见M7。

这是一个可启动的 Web 应用，不做 Electron 或其他桌面客户端。

```text
浏览器 A ─┐
浏览器 B ─┼── HTTP ── Node.js + Express ── SQLite
浏览器 C ─┘                         └── 本地图片目录
```

开发先从本机开始：默认监听 `127.0.0.1:3002`。本机闭环稳定后，再验证 `HOST=0.0.0.0` 的可信局域网访问。生产模式由 Express 托管前端构建产物和 API，使用同一个来源。

## V1 范围

必须完成：

- 多图片上传、查看、切换和重新打开。
- 图片适应窗口、放大、缩小和滚动。
- 点击图片新增多个标记。
- 标记编号、问题说明、严重程度和操作人信息。
- 标记编辑、删除、列表定位和显式保存。
- 保存、刷新和重启后恢复。
- 缩放、滚动后标记仍位于正确位置。
- 本机访问，随后验证可信局域网访问。
- 请求日志、健康检查、错误提示和失败复现。

暂不做：

- 用户名密码登录、复杂角色、资源级权限。
- V1 的 WebSocket 实时推送和自动合并文本。
- 公网部署、生产 HTTPS 和多租户隔离。
- 桌面安装包。

V2 规划：在 V1 数据和 API 稳定后，增加基础 WebSocket 更新通知，并评估自动保存。自动保存必须先定义草稿、重试、幂等和断网恢复语义，不能简单替换 V1 的显式保存；仍不引入 CRDT、OT、Redis、消息队列、分布式锁或多实例架构。

## 图片和数据存储

SQLite 是唯一数据库，图片原文件不保存为 BLOB。

结构化业务数据、图片索引、标记、操作人记录和版本信息保存到 SQLite；图片由应用保存到本地应用数据目录。

默认数据目录按平台解析：

```text
Windows：%LOCALAPPDATA%/ImageReviewAnnotator
macOS：  ~/Library/Application Support/ImageReviewAnnotator
Linux：  $XDG_DATA_HOME/ImageReviewAnnotator，未设置时 ~/.local/share/ImageReviewAnnotator
```

目录结构：

```text
<DATA_DIR>/
  app.db
  images/<image-id>/original.<ext>
  tmp/uploads/<request-id>.upload
```

数据库保存相对 `storage_key`，不保存跨平台绝对路径。上传流程是“临时文件 → 校验 → 正式文件 → SQLite 事务”；失败时清理文件，并保留孤儿文件扫描能力。备份必须同时覆盖数据库和图片目录。

## 身份和访问边界

V1 第一次打开页面时输入昵称，浏览器生成并保存：

```json
{
  "actorId": "uuid",
  "actorName": "张三"
}
```

标记记录创建者和最后修改者。这是操作人标识，不是安全认证，只适合本机或可信局域网。真实账号、Session、权限和 HTTPS 需要单独的 V1.1 spec。

多个浏览器必须通过同一个 Node.js 服务访问 SQLite，不能通过网络文件共享直接读写数据库文件。

## 并发和禁止项

SQLite 初始化：

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

服务端在事务中分配标记编号，禁止前端使用 `max(number) + 1`。标记更新和删除使用 `version` 乐观锁，版本过期返回 HTTP 409，禁止静默覆盖。

本项目不引入：

- Redis。
- 消息队列。
- 分布式锁。
- 多个后端实例。
- 通过网络共享直接打开 SQLite 文件。

## 数据模型

```text
images
  id, original_name, mime_type, width, height, file_size
  storage_key, sha256, next_annotation_number, created_at, updated_at

annotations
  id, image_id, number, x, y, note, severity
  created_by, created_by_name, updated_by, version, created_at, updated_at
  updated_by_name

annotation_creations（P4 最小创建重复保护）
  id, image_id, fingerprint
```

`x`、`y` 是 0 到 1 的归一化坐标；`(image_id, number)` 唯一；图片删除级联删除标记。第一版不建立账号表，但保留操作人字段。

当前工作台使用整图保存与版本历史；旧逐条API保留兼容。annotation_creations 保存创建摘要，防止标记删除后被创建重试复活；P5已具备图片库与整图删除，deleted_images 保存已删imageId防止旧上传恢复。日志当前输出到控制台，不宣称已有 logs/ 文件落盘。

## 前端坐标方案

图片和 SVG overlay 组成同一个可缩放舞台。点击位置根据图片当前 `getBoundingClientRect()` 换算为归一化坐标，重绘时使用图片内部坐标或百分比，不能持久化窗口坐标。

## API 初版

```text
GET    /api/health
GET    /api/ready
GET    /api/images
POST   /api/images
GET    /api/images/:id
GET    /api/images/:id/content
DELETE /api/images/:id
POST   /api/images/:id/annotations
PATCH  /api/annotations/:id
DELETE /api/annotations/:id
```

错误统一包含稳定错误码和 `requestId`：

```json
{
  "error": {
    "code": "ANNOTATION_COORDINATE_OUT_OF_RANGE",
    "message": "x and y must be between 0 and 1",
    "requestId": "req_123"
  }
}
```

## 关键验收

新用户应能启动项目、输入昵称、上传图片、点击并保存多个标记，完成编辑和删除；放大、滚动后标记位置不漂移；刷新和重启后数据恢复；本机第二个浏览器能读取同一数据；非法请求有明确失败响应。
