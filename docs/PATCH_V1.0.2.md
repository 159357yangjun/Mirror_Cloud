# v1.0.2 — Windows 启动体验修复

## 问题

Windows 启动正式版时除了主界面外还会出现一个黑色控制台窗口。原因是桌面入口 `main.rs` 没有声明 GUI Windows subsystem。

## 修复

`apps/desktop/src-tauri/src/main.rs` 顶部加入：

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
```

效果：

- 正式 release / 安装包：只显示 Multi-cloud Publisher 主窗口。
- `tauri dev` / debug：继续保留控制台，方便查看日志和报错。

## 重新发行

修复只有重新构建发行版后才会生效。GitHub Actions 或本地 `npm run tauri build` 均可。不要继续运行旧的 v1.0.1 exe。
