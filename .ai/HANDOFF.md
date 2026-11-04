# HANDOFF

入口规则见根目录 AGENTS.md。当前仅 main 开发。用户指定本地项目为 D:/image-hosting-platform；已确认其原状态干净，并从 3f5d1e1 快进同步至本批已验证产品源。后续以此目录为主，会话 work/source 保留核验副本；安装应用位置未变。

## 当前：1.4.13候选与实际升级基线

用户已授权执行版本/候选/验收及条件正式发布。基础源091ef4e3633daa6d82a50146c06d43489afb9d1e同源七项push检查成功，CI41756938053/job126335144324为Rust246/0/1真实R2忽略；原生41756938033通过安装/卸载和SQLite保留。初次无tag候选41758695818已成功结束，publish-release跳过；取消请求返回409（run已结束），未实际取消。因附带旧STATE.generated快照，其产物保留但不作为交付候选。当前提交刷新快照、更新实际UI证据并给发布构建接入与既有CI/原生相同锁键的缓存；产品运行代码不变。须待本提交适用CI通过后重新冻结候选源并构建，不能复用原候选身份或二进制。v1.4.13正式tag未创建。

新版Computer Use已能初始化与操作，旧kernel assets阻塞不再适用。按用户要求核对D盘一级目录、相似应用目录及程序metadata，再实际打开D:/Mirror Cloud/image-hosting-platform-desktop.exe，界面明确1.4.10候选c4d8a540a1f9、发现正式1.4.12。通过真实客户端按钮完成下载，UI显示SHA256通过，文件16480162字节且独立磁盘哈希匹配已核验的正式包。当前停在立即安装；按Computer Use的安装时确认规则已问用户，未收到允许前不启动安装器。用户先前1.4.12反馈保留，但不能据此声称本机当前已安装1.4.12。

本轮18表SQLite只读一致性快照已DPAPI加密并实际恢复校验；未落盘明文或记录行内容。证据在会话outputs/baseline-update-to-1.4.12.json、mirror-cloud-before-1.4.13-backup.json；私钥/系统凭据未导出。候选产物完成后独立核验六资产、签名、完整源码及三个构建锁，再完成新插件/G3；本机未发现Windows Sandbox，不擅自启用系统功能或创建账号。D盘origin旧重定向已改为用户给定的规范Mirror_Cloud地址；状态快照按脚本重新生成，13facts/0problem，UPDATE_REPO匿名API核对跳过。

## 2026-11-03 — 1.4.12 正式发布与签名检查反馈

不可变 v1.4.12 固定产品源 `75d05c838713f2a027f70e038825891f7c01c234`。[正式构建 41667783285](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/41667783285) 的 windows-bundle 与 publish-release 均成功，标签 CI 41667783389 成功。[正式 Release](https://github.com/159357yangjun/Mirror_Cloud/releases/tag/v1.4.12) 已公开、非候选，latest 指向此版本。G5 独立下载六个公开文件，与云端归档、GitHub digest、签名清单及 SHA256SUMS 一致；源码 494 文件和三份锁核对通过。

正式 EXE 为 16480162 字节，SHA256 `997839522f02e0fb0ac105f01396fed9805c00156bb2ced95c07361bd8135e68`，与 G3 候选字节不同。用户在当前 1.4.12 点击检查更新后回复“检查正常，没有签名错误”。这是用户报告的签名检查通过；同版本没有更高更新符合预期。没有将其扩写为正式包真机重装或更高版本完整“检查→下载→安装”已经实操。原始反馈及公开核验见本轮 outputs/G5-user-update-check-1.4.12.json、formal-1.4.12-public-verification.json。后续更高版本继续独立验收下载/安装。

## 当前插件批次

用户确认“完成当前更新闭环后，继续做前三项插件能力”。现已实现本地 Manifest 预览/确认安装、宿主 API/Schema 1 校验与历史官方兼容、受限 Schema 表单。安装使用后端缓存原文对应对象/一次性 UUID/五分钟 TTL/最多四份预览/SQLite insert-if-absent，默认关闭且仅 read_asset。更改不增加迁移或外部依赖版本；只增加测试用 tokio 依赖边。文档见 docs/PLUGIN_ARCHITECTURE.md，例子见 examples/plugins。

产品源 1d3aa9ab2c40b7ac5efc325a4a5ab086343e5843 的 CI 41678849682 成功，Rust 246/0/1真实R2忽略；原生 Windows/SQLite 41678849564 和七页契约 41678849544 成功。完整证据见 WORKLOG。原生 UI 自动化初始化持续报 kernel assets 路径错误，未在用户机操作新插件/数据库。下一候选需独立验收文件选择、预览/确认、授权、表单和重启保留；不复用 v1.4.12 tag 发布这些未发布变更。社区索引与 WASM 未实施。

私钥在系统凭据库，GitHub Secret 已配置；加密 PKCS8 与 DPAPI 数据库备份实际恢复校验通过。异地签名备份未确认，凭据值不得进入日志或源码。早前临时目录清理被自动策略拒绝，未绕过，残留仍在会话 work；后续不重复批量删除。旧历史请查 Git，不沿用旧“等待授权/未发布”状态。
