# HANDOFF

入口规则见根目录 AGENTS.md。当前仅 main 开发，原始用户目录与安装应用保留；本轮编辑副本位于会话 work/source。

## 2026-11-03 — 1.4.12 正式发布与签名检查反馈

不可变 v1.4.12 固定产品源 `75d05c838713f2a027f70e038825891f7c01c234`。[正式构建 41667783285](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/41667783285) 的 windows-bundle 与 publish-release 均成功，标签 CI 41667783389 成功。[正式 Release](https://github.com/159357yangjun/Mirror_Cloud/releases/tag/v1.4.12) 已公开、非候选，latest 指向此版本。G5 独立下载六个公开文件，与云端归档、GitHub digest、签名清单及 SHA256SUMS 一致；源码 494 文件和三份锁核对通过。

正式 EXE 为 16480162 字节，SHA256 `997839522f02e0fb0ac105f01396fed9805c00156bb2ced95c07361bd8135e68`，与 G3 候选字节不同。用户在当前 1.4.12 点击检查更新后回复“检查正常，没有签名错误”。这是用户报告的签名检查通过；同版本没有更高更新符合预期。没有将其扩写为正式包真机重装或更高版本完整“检查→下载→安装”已经实操。原始反馈及公开核验见本轮 outputs/G5-user-update-check-1.4.12.json、formal-1.4.12-public-verification.json。后续更高版本继续独立验收下载/安装。

## 当前插件批次

用户确认“完成当前更新闭环后，继续做前三项插件能力”。现已实现本地 Manifest 预览/确认安装、宿主 API/Schema 1 校验与历史官方兼容、受限 Schema 表单。安装使用后端缓存原文对应对象/一次性 UUID/五分钟 TTL/最多四份预览/SQLite insert-if-absent，默认关闭且仅 read_asset。更改不增加迁移或外部依赖版本；只增加测试用 tokio 依赖边。文档见 docs/PLUGIN_ARCHITECTURE.md，例子见 examples/plugins。

本地 21 组 Node 单元和前端 tsc/Vite 构建通过；云端 Rust fmt/check/tests 尚待本批提交的同 SHA 实际结果。不要拿签名发布源的 236/0/1 替代插件源码。原生 UI 自动化初始化持续报 kernel assets 路径错误，未操作真实插件/数据库。后续完成云端回归、记录源码 SHA 与结果；不复用 v1.4.12 tag 发布这些未发布变更。社区索引与 WASM 未实施。

私钥在系统凭据库，GitHub Secret 已配置；加密 PKCS8 与 DPAPI 数据库备份实际恢复校验通过。异地签名备份未确认，凭据值不得进入日志或源码。早前临时目录清理被自动策略拒绝，未绕过，残留仍在会话 work；后续不重复批量删除。旧历史请查 Git，不沿用旧“等待授权/未发布”状态。
