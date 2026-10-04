# 发布前人工验收：冷启动与空闲内存（P3）

## 这份清单解决什么

`docs/REFERENCE_COMPARISON_PICGO_PICLIST_PICUPLOADER.md` 里"打包面收益"这条卖点，目前只有一个不需要安装就能拿到的数字：
NSIS `image-hosting-platform-v1.4.5-windows-x64-setup.exe` = **8,205,472 B**，对照 PicList dmg 141.7 MB ≈ **17×**。
另外两个数（冷启动耗时、空闲内存）必须让应用**开着**才能量，而本机当前没装它——
2026-10-01 三处独立取证一致：进程表按 CommandLine 匹配 `image|hosting|piclist|tauri` 为 0 条、
卸载注册表 HKCU/HKLM/WOW6432Node 对 `image-hosting` 0 匹配、四个常见安装目录全 absent。
CI 侧的 `scripts/smoke_windows_installers.ps1` 装完即卸（[2/4]、[4/4] 步），无头 runner 上也没有人在那个时刻读数，
所以云端跑不出这两个数。**这份清单是给"一台装着它的真机器 + 一次人工读数"用的。**

## 前置：安装（你手动做，我不代做）

从 Release `v1.4.5`（`release_id=401526603`）下载并双击安装：

- `image-hosting-platform-v1.4.5-windows-x64-setup.exe` — sha256 `b54c4a92…f2502000`
- 或 `image-hosting-platform-v1.4.5-windows-x64.msi` — sha256 `4485c4d6…daeef2a1`

装完后程序名是 **"Mirror Cloud"**，二进制 `image-hosting-platform-desktop.exe`，
数据目录 `%APPDATA%\dev.multicloud.publisher`。

## 测量一：冷启动

定义：**双击图标 → 主窗口第一次出现可交互内容**（不是进程创建，也不是窗口框架出现）。

采法（选一个，两个都留档更好）：
1. 秒表法：双击同时开始计时，看到资源列表/首页渲染出来停止。**n=5 次，报中位数和最大值**，别报单次。
2. 任务管理器法：详情列勾选「启动时间」，读到的是进程创建→UI 响应，比秒表客观一档。

注意：第 1 次通常是冷缓存（磁盘页未预热），第 2 次起是热启动。**两者分开记，不要混成一个数。**

## 测量二：空闲内存

定义：**打开后不做任何操作、静置 60 秒**时的占用。

采法：
- 任务管理器 → 详细信息 → 找到所有 `image-hosting-platform-desktop.exe` 行，
  「内存(活动专用工作集)」逐行相加。**Tauri 是多进程的（主进程 + WebView2 子进程），只加主进程会少算一半以上。**
- 如果有 msedgewebview2.exe 子进程属于本应用，一并计入；不确定归属就整行截图留档。
- 同样 n=5，静置后再测一次"上传一张图之后"的峰值，作为第二个数。

## 数值回来后怎么进门禁

这两个数一旦有真值，就进 `scripts/verify_shape.mjs` 基线台账当棘轮（只准变好不准变坏），
并在 CHANGELOG 登记时带上分母与采样条件（第几次启动、静置多久、是否含 WebView2 子进程）。
**没有真值之前不要预填任何数字，也不要写成"待测"以外的推测值。**

## 不在本清单范围内

- 安装冒烟本身已由 CI 覆盖（`smoke_windows_installers.ps1` 四步 + 失败上传日志 artifact）。
- 本清单不要求装第二台机器、不要求常驻安装；测完可以留着，也可以走 `uninstall.exe /S` 卸掉。
