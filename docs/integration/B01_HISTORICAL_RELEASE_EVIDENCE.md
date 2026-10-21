# B01 · 历史发布验收证据整合报告

> 状态：本批仅为历史文档归档及审计台账；生产代码、云端真实验收、软件发布、版本号均未修改。本文件记录的是整合范围，不替代提交后同 SHA CI 复核。

## 1. 基线与来源

- 入库前 `main` HEAD：`24d0297149383f157223fec0de11ad214b69de82`。
- 历史来源分支：`docs/ux34-release-readiness-20261011`，旧版验收文件原始 Blob SHA：`8208f8f13b12ec201dd900071962c406229de0b2`。
- 基于仓库 `AGENTS.md` main-only、逐 Commit 报告、CI 不可跳过的要求审查。
- 关联审计：[Issue #45](https://github.com/159357yangjun/Mirror_Cloud/issues/45)；受保护 R2 激活仍以 [PR #9](https://github.com/159357yangjun/Mirror_Cloud/pull/9) 的单独审批门禁为准。

## 2. 修改清单（本批只有以下两个新增文件）

| 文件路径 | 类型 | 原因 |
| --- | --- | --- |
| `docs/archive/RELEASE_READINESS_2026-10-11.md` | 新增 | 留存旧候选 #34 原生 Windows、官方 v1.4.9 升级与 SQLite/WinCred 回滚演练的一手链接和历史阻塞项 |
| `docs/integration/B01_HISTORICAL_RELEASE_EVIDENCE.md` | 新增 | 记录来源、修改范围、风险、验证要求和剩余问题 |

## 3. 内容适配和安全边界

- 旧文件以**历史快照**保存，正文除原相对文档链接改为归档目录下正确的 `../R2_PRIVATE_LIVE_E2E.md` 外保持原文。
- 在归档首部增加历史日期和**不构成当前发布许可**的提示。
- 旧文档中“独立版本准备分支”、开放 PR 及测试结论都是当时的证据，不覆盖现在的 main-only 规则，也不意味着 #34 通过了当前 main 的原生/升级验收。
- 未编辑 Rust/TypeScript、DDL/migration、workflow、密钥、版本号或 Release/tag；不触发 R2 真实写入。

## 4. 证据与验证界限

历史证据（仅适用于当时的冻结候选）：

- [Windows 原生与安装器：Run 38132107841](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/38132107841)
- [v1.4.9 升级：Run 38140613195](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/38140613195)
- [离线备份/升级/回滚：Run 38141333402](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/38141333402)

本次提交后的 CI 必须以 GitHub 上**实际生成的本批 Commit SHA**为准复核；CI pending 或未执行时不得写 PASS。通过 `git log -1 --format=%H -- docs/archive/RELEASE_READINESS_2026-10-11.md` 可定位本批主分支提交。必要时查看完整 diff 和 checks。

## 5. 仍须执行

- B02：从旧 UI/QA 分支抽取焦点、键盘及 DPR 负例，基于当前 harness 合并到 main；不得用历史模拟 DPI 代替原生 Windows DPI G3。
- B03：提炼 Windows 原生窗口/SQLite 重启验收，与当前 main 原生测试去重。
- B04：R2 离线安全检查接入 main；真实 R2 受保护的写入及私有访问验收不得在普通 CI 内启用。
- B05：去除旧 #34 安装包 SHA/Run 绑定后再审查升级回滚脚本。
- 仍有历史开放 PR/分支待逐一处理，不在本批删除。

**最终结论：** B01 仅能判定为“历史证据已归档”；不得据此判断正式发布 READY。提交成功和同 SHA CI 结论须另行核对。
