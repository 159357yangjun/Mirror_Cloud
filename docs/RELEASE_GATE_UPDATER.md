# 更新功能发布门禁（G0–G5）

状态：**已批准规范**（2026-10-02，用户与外部审计会话共同定稿）。
适用：Mirror Cloud 应用内自更新功能的任何构建、发布与对外表述。
看护锚点见文末检查清单。

## 状态机

```text
G0  dev CI 全绿
 ↓
G1  P0-4 信任边界修复（Rust 自持 PendingUpdate，见验收标准）
 ↓
G2  无 tag 的 RC 构建（workflow_dispatch；exactly-one NSIS + checksum + installer smoke）
 ↓
G3  P0-5 真机升级 E2E（v1.4.5 → 新版，按保真矩阵逐行验证）
 ↓
G4  创建一次不可变正式 tag（此后不得移动、不得 force）
 ↓
G5  GitHub Release 成功
 ↓
才允许把「应用内安全自更新」写进 README / 官网卖点
```

## G1 验收标准（P0-4 信任边界）

```text
download_update()
    ↓
Rust 创建 PendingUpdate { version, canonical_path, expected_sha256, bytes }
    ↓
返回 opaque id 给前端
    ↓
install_update(id)
    ↓
Rust 自己取 PendingUpdate
    ↓
canonicalize
    ↓
确认仍位于受控 mirror-updates 目录
    ↓
重新读取文件、重新计算 SHA256
    ↓
与 Rust 保存的 expected hash 比较
    ↓
通过才 spawn installer
```

**明令禁止的安全模型**：前端传 `{ installerPath, verified: true, sha… }`、
Rust 照单执行。前端只能表达用户意图（"安装刚才那个已验证的更新"），
不能提供安全证明。

## G3 保真矩阵（P0-5）

| 项目 | v1.4.5 升级前 | 升级后 |
|---|---:|---:|
| 应用版本 | 1.4.5 | 新版 |
| SQLite | 有数据 | 保留 |
| Storage 配置 | 有 | 保留 |
| Token / Credential | 有 | 保留 |
| 默认上传目标 | 已设置 | 保留 |
| Typora bridge | 可用 | 保留 |
| Theme / Wallpaper | 已设置 | 保留 |
| Asset index | 有数据 | 保留 |
| 插件配置 | 有 | 保留 |
| 上传一张新图 | — | 成功 |

版本号变化只是第一行；"装得上卸得掉"的安装器 smoke 不构成本条通过。

## Tag 纪律

**RC 不使用正式版本 tag。** 禁止
`v1.4.6 → build → 失败 → 移 tag → 再 build`
的循环（v1.4.6 曾犯五次，全部记录在 CHANGELOG §21）。
正确流程：workflow_dispatch → RC artifact → E2E → 全绿 → 创建 tag 一次。
tag 从出生起即不可变发布点。

## 竞品表述准绳

PicGo / PicList **已有**版本检查与更新提醒（PicList 官方文档"更新助手"；
PicGo 同，且其开发分支 electron-builder 明写 "temporarily disable auto update"
——即完整闭环被考虑过、作者主动不做，原因：跨平台矩阵、macOS 签名门槛、
GitHub 在国内不是可靠更新源）。

Mirror Cloud 的潜在差异点是 **Windows 单一发行面上的完整
"检查 → 下载 → 校验 → 安装"闭环**。该差异只有在 G1/G3/G5 全部完成后
才能作为产品卖点。在此之前本功能一律描述为：

```text
应用内更新功能：开发 / 验证中
```

禁止的表述：更安全 / 更先进 / 领先 PicGo / 领先 PicList。
固定判断约束：**不因竞品没做完整自动更新，而推导镜云更先进。**

## 看护

- 本文件的锚点标题（`G1 验收标准`、`G3 保真矩阵`、`Tag 纪律`、`竞品表述准绳`）
  由 `check_user_flow.py` 以 count==1 断言核对；改结构须同步改门。
- G0 达成证据 = Actions 页 dev 分支最新 run 结论 success 的 API 读数（截图或 JSON 落档）。
- 每关通过时在 CHANGELOG 记一笔（关卡号 + 证据指针），不许静默跳关。
