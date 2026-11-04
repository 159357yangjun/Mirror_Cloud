# HANDOFF

入口规则见根目录 AGENTS.md。当前仅 main 开发。用户指定本地项目为 D:/image-hosting-platform；已确认其原状态干净，并从 3f5d1e1 快进同步至本批已验证产品源。后续以此目录为主，会话 work/source 保留核验副本；安装应用位置未变。

## 当前：1.4.13候选与实际升级基线

固定交付候选源60f0a34c898cf3ef88c470ff019381ef0fa476e5，适用CI41761819146与七页41761818872成功，CI Rust246/0/1真实R2忽略。基础源091ef4e七项检查及原生安装/SQLite成功作为同产品代码补充证据，不冒称当前源同SHA七项检查。无tag候选41762347677成功，windows-bundle126352697742、publish-release126355858655按手动候选规则跳过；本run Rust246/0/1、NSIS/MSI smoke、签名配对和验件均成功。独立下载六资产、Ed25519与哈希、501源码和三锁核验通过。artifact13290489317，60390907字节，digest4eab9014542e350f299ddb1d389db8f82f1af84eaddb674bb9ddce4d10742012；NSIS16542951字节，SHA256 77adb8aa7ab7720888db8ff7bda1ec366b96a9f23cc59e9b5fd1886867c72a17。文件在会话outputs/candidate-1.4.13-60f0a34c898c，详见candidate-1.4.13-cloud-verification.json。

初次091ef4e/41758695818已成功结束、发布跳过；取消409未实际取消，因旧状态快照其产物不交付、不复用于新SHA。当前记录提交不替代已验候选产品源。用户已授权条件发布，但新候选G3尚未执行，v1.4.13正式tag未创建；不得只凭G0/G2发布。

新版Computer Use已能初始化与操作，旧kernel assets阻塞不再适用。按用户要求核对D盘一级目录、相似应用目录及程序metadata，再实际打开D:/Mirror Cloud/image-hosting-platform-desktop.exe，界面明确1.4.10候选c4d8a540a1f9、发现正式1.4.12。通过真实客户端按钮完成下载，UI显示SHA256通过，文件16480162字节且独立磁盘哈希匹配已核验的正式包。当前停在立即安装；按Computer Use的安装时确认规则已问用户，未收到允许前不启动安装器。用户先前1.4.12反馈保留，但不能据此声称本机当前已安装1.4.12。

本轮18表SQLite只读一致性快照已DPAPI加密并实际恢复校验；未落盘明文或记录行内容。证据在会话outputs/baseline-update-to-1.4.12.json、mirror-cloud-before-1.4.13-backup.json；私钥/系统凭据未导出。候选产物完成后独立核验六资产、签名、完整源码及三个构建锁，再完成新插件/G3；本机未发现Windows Sandbox，不擅自启用系统功能或创建账号。D盘origin旧重定向已改为用户给定的规范Mirror_Cloud地址；状态快照按脚本重新生成，13facts/0problem，UPDATE_REPO匿名API核对跳过。

## 2026-11-03 — 1.4.12 正式发布与签名检查反馈

不可变 v1.4.12 固定产品源 `75d05c838713f2a027f70e038825891f7c01c234`。[正式构建 41667783285](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/41667783285) 的 windows-bundle 与 publish-release 均成功，标签 CI 41667783389 成功。[正式 Release](https://github.com/159357yangjun/Mirror_Cloud/releases/tag/v1.4.12) 已公开、非候选，latest 指向此版本。G5 独立下载六个公开文件，与云端归档、GitHub digest、签名清单及 SHA256SUMS 一致；源码 494 文件和三份锁核对通过。

正式 EXE 为 16480162 字节，SHA256 `997839522f02e0fb0ac105f01396fed9805c00156bb2ced95c07361bd8135e68`，与 G3 候选字节不同。用户在当前 1.4.12 点击检查更新后回复“检查正常，没有签名错误”。这是用户报告的签名检查通过；同版本没有更高更新符合预期。没有将其扩写为正式包真机重装或更高版本完整“检查→下载→安装”已经实操。原始反馈及公开核验见本轮 outputs/G5-user-update-check-1.4.12.json、formal-1.4.12-public-verification.json。后续更高版本继续独立验收下载/安装。

## 当前插件批次

用户确认“完成当前更新闭环后，继续做前三项插件能力”。现已实现本地 Manifest 预览/确认安装、宿主 API/Schema 1 校验与历史官方兼容、受限 Schema 表单。安装使用后端缓存原文对应对象/一次性 UUID/五分钟 TTL/最多四份预览/SQLite insert-if-absent，默认关闭且仅 read_asset。更改不增加迁移或外部依赖版本；只增加测试用 tokio 依赖边。文档见 docs/PLUGIN_ARCHITECTURE.md，例子见 examples/plugins。

产品源 1d3aa9ab2c40b7ac5efc325a4a5ab086343e5843 的 CI 41678849682 成功，Rust 246/0/1真实R2忽略；原生 Windows/SQLite 41678849564 和七页契约 41678849544 成功。完整证据见 WORKLOG。原生 UI 自动化初始化持续报 kernel assets 路径错误，未在用户机操作新插件/数据库。下一候选需独立验收文件选择、预览/确认、授权、表单和重启保留；不复用 v1.4.12 tag 发布这些未发布变更。社区索引与 WASM 未实施。

私钥在系统凭据库，GitHub Secret 已配置；加密 PKCS8 与 DPAPI 数据库备份实际恢复校验通过。异地签名备份未确认，凭据值不得进入日志或源码。早前临时目录清理被自动策略拒绝，未绕过，残留仍在会话 work；后续不重复批量删除。旧历史请查 Git，不沿用旧“等待授权/未发布”状态。
