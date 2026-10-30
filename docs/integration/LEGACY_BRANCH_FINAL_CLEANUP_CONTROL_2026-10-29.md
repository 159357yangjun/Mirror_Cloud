# Mirror Cloud — 旧远程分支总整理及最终清理控制表

> **只读分支审计快照：2026-10-29（America/Los_Angeles；GitHub 工作流可能记录 2026-10-30 UTC）**。本文件仅整理，不删除任何分支、不关闭任何 PR、不合并历史 PR、不授权批量删除。主分支与 PR 在用户最后清理之前可能继续变化，所有清理条件都必须在执行当天重新检查。

## 1. 本轮核对的事实（时点快照）

- 仓库：[`159357yangjun/Mirror_Cloud`](https://github.com/159357yangjun/Mirror_Cloud)。
- main SHA：`06d1d60f5a2a01faae68392fc67e5a0160c84fa0`；受保护：`false`（当前为 false，**需在最终清理前恢复禁止强推/删除 main 等保护**；完整 Branch Protection API 返回 403 时不能推断其他细节）。
- 远程分支：53 条，其中非 main：52 条；开放 PR：32 条（含 31 Draft）。
- PR 关联的**不同非 main 分支**：33 条（包括作为 PR base 和 head 的分支），无开放 PR 引用：19 条。
- 分类 A 已合并 UI/集成候选：5；B 无开放 PR 的历史测试分支：14；C 关联开放 PR：33。
- GitHub Actions 当前 SHA 的完整结论必须单独读取；任何仍在运行的 CI 不写 PASS。本文生成不替代 CI 与用户验收。

## 2. 对照方法与限制

- 已在本轮针对 52 条分支运行递归 Git 文件树 Blob SHA 对照，参照最新可访问的 main 树：旧分支各自都有与 main 内容不同的同路径文件；**没有一条能仅凭整棵树完全相同就直接证明等价**。共识别出 **9 条在 main 没有同一路径的历史文件**，均为独立工作流、测试脚本、旧发布验收文档；没有发现仅存在旧分支的生产功能文件路径。
- 旧实现与 main 的同名文件可能存在真实行为差异。上述结果只是路径和 Blob 级扫描，不能替代逐项安全语义审计、Rust/SQLite、真实 Windows、安装/升级及私有云权限验收。因 Squash 历史造成 ahead/behind 很大，禁止整条历史分支直接覆盖 main。
- 保留原分支 HEAD、PR 评论及 review 历史，供用户最终统一删除前二次检查；文档清理不代表分支删除许可。

## 3. 9 条仅存在旧分支的历史路径：成果去向

| 旧分支独有路径 | 原目的 | 当前保存/替代结果与缺口 |
| --- | --- | --- |
| `.github/scripts/test_candidate_upgrade.ps1` + `.github/workflows/ux-upgrade-compat.yml` | 旧 #34 升级/回滚运行代码 | `docs/archive/legacy_ci/ux34_candidate_upgrade_and_rollback.ps1` 仅防误执行归档，当前仍无已授权的完整升级保真 G3 |
| `.github/scripts/ux_keyboard_smoke.mjs` + `.github/workflows/ux-browser-smoke.yml` | 旧 Edge 键盘测具 | `scripts/ux_keyboard_smoke.mjs` + `taskui-ui-windows-acceptance.yml` 已改造，DPR/键盘测具不等于系统原生 DPI |
| `.github/workflows/ux-candidate-identity-smoke.yml` | 候选构建身份检查 | `main-candidate-identity.yml` 已移植，并在历史 CI 验证；正式发布仍独立门禁 |
| `docs/RELEASE_READINESS_2026-10-11.md` | 历史 #34 发布结论与证据 | `docs/archive/RELEASE_READINESS_2026-10-11.md` 已归档，不能当作当前发布许可 |
| `.github/workflows/full-ux-00-baseline.yml` | 七页面浏览器基线 | 当前 `taskui-ui-windows-acceptance.yml` + TaskUI 合同存在替代检查，仍需逐项核对覆盖 |
| `.github/workflows/taskui-dpi-check.yml` | 浏览器 DPI 模拟 | 主线 Edge CDP DPR 1.25/1.5 测试已接入；不是 Windows 原生 DPI |
| `.github/workflows/taskui-pr39-browser-acceptance.yml` | 历史冻结 PR #39 验收 | 当前 main UI 工作流及归档证据取代固定旧 SHA |

另外，旧分支 `.github/scripts/native_tauri_acceptance.ps1` 路径已在 main 有移植版本；当前仍需要检查真实环境窗口/数据库验收的版本与证据。

## 4. 52 条旧分支原始 HEAD 与 PR 引用 — 全量台账

### A · 已合并 UI/集成：5 条（第一批清理候选）

| 分支 | 完整原 SHA | 现有开放 PR 引用 | 状态 |
| --- | --- | --- | --- |
| `integration/mirror-cloud-taskui-postfreeze-20261018` | `15f81067224245ba78bee849b29ddfdc2482d29a` | — | MERGED-CANDIDATE |
| `ui/full-ux-00-audit` | `c10c4a3fc7dc643c48c91bc06f09acfbe822e14c` | — | MERGED-CANDIDATE |
| `ui/full-ux-01-system` | `3f7cd6aaf8c149481bd12dca80ac4f957adb5730` | — | MERGED-CANDIDATE |
| `ui/taskui-publish-first-pass-20261018` | `6ee670e6975ac06babeb60f841c5b95073eae341` | — | MERGED-CANDIDATE |
| `ui/taskui-r2-guided-diagnostics-20261018` | `5da886812bab5d7d3bc300bd34056d314332b1ba` | — | MERGED-CANDIDATE |

**A 类处置**：仅当最终清理当天再次确认对应历史 PR 已合并、旧分支 HEAD 未更新、main 内容已保留、同 SHA 必需 CI 成功且无新的 PR 依赖，才可以删除。此前既有的 #39/#40/#41/#42/#43 合并记录可作为依据，但仍必须复查。

### B · 无开放 PR 的历史 CI/QA：14 条（成果归档候选，不直接删除）

| 分支 | 完整原 SHA | 现有开放 PR 引用 | 状态 |
| --- | --- | --- | --- |
| `ci/mvp-installer-smoke-20261010` | `958153002a073487a401c72921eb4fb57184845d` | — | ARCHIVED-CANDIDATE |
| `ci/release-v1.4.10-native-draft-20261011` | `66ececdaa699f229229ce3e9d8c7b7fefedb6908` | — | ARCHIVED-CANDIDATE |
| `ci/update-feedback-installer-smoke-20261010` | `c9009174b8ab280f24b8c265ca4f8af1a1b0a5f9` | — | ARCHIVED-CANDIDATE |
| `ci/ux34-native-smoke-20261011` | `ee6e2ebc96aea9a8af580734f94b373115599afe` | — | ARCHIVED-CANDIDATE |
| `ci/ux34-offline-rollback-20261011` | `19e923034556c2879c367041aa51b076fd69f6fa` | — | ARCHIVED-CANDIDATE |
| `ci/ux34-upgrade-compat-20261011` | `9d3182436b0f478255976233fc17973f5028d692` | — | ARCHIVED-CANDIDATE |
| `ci/ux-browser-smoke-20261011` | `17743992695b11a03759f0d1a42ed48f5a282a6a` | — | ARCHIVED-CANDIDATE |
| `ci/ux-candidate-identity-smoke-20261011` | `50f733e2d4d69232cd27005111170561e0ed6b11` | — | ARCHIVED-CANDIDATE |
| `ci/ux-candidate-identity-v2-20261011` | `0868cbd70a41d47eea9ee00e149a0573ddabaac7` | — | ARCHIVED-CANDIDATE |
| `ci/ux-native-smoke-20261011` | `1fd384924403840ee8141baeddfc1e3119b21d0f` | — | ARCHIVED-CANDIDATE |
| `ci/ux-upgrade-compat-20261011` | `fb2d357cf3026278b24cf021c7d7d8b81d935889` | — | ARCHIVED-CANDIDATE |
| `qa/full-ux-00-baseline-20261019` | `a72e6665aa3e00fd19d6b8498c48cc230e1d3e76` | — | ARCHIVED-CANDIDATE |
| `qa/taskui-dpi-125-150-20261018` | `65ef9b388d77635abca011a4b5c62b9cfd6bdd87` | — | ARCHIVED-CANDIDATE |
| `qa/taskui-pr39-windows-browser-20261018` | `3faa9a0e0b4833a55ff03fdf22b3f939c6e6a08d` | — | ARCHIVED-CANDIDATE |

**B 类处置**：逐条复核上面的 9 个独立路径是否已保全/替代、CI/Release Artifact 和历史脚本是否具有未来可复用价值。候选版安装器、旧分支专用 workflow 不得直接并入 main 触发，历史升级/回滚归档还不是当前可运行替代测试。

### C · 被开放 PR 引用：33 条（保留至 PR 收口）

| 分支 | 完整原 SHA | 现有开放 PR 引用 | 状态 |
| --- | --- | --- | --- |
| `chore/r2-live-e2e-default-activation` | `94ebfe161ef2b9adb51fa0c28f1d6c4ae0f1d9c2` | [#9](https://github.com/159357yangjun/Mirror_Cloud/pull/9) (head) | HOLD-R2 |
| `dependabot/github_actions/dev/workflow-actions-c673fd7efc` | `e486200d35278bf9fa4d23fb6f3ad9dfa1fa0233` | [#38](https://github.com/159357yangjun/Mirror_Cloud/pull/38) (head) | REVIEW-DEPS |
| `dev` | `e634ced12a9531ffde63e751dbf24b03d875252e` | [#6](https://github.com/159357yangjun/Mirror_Cloud/pull/6) (base); [#31](https://github.com/159357yangjun/Mirror_Cloud/pull/31) (base); [#35](https://github.com/159357yangjun/Mirror_Cloud/pull/35) (base); [#38](https://github.com/159357yangjun/Mirror_Cloud/pull/38) (base) | PR-DEPENDENCY |
| `docs/ux34-release-readiness-20261011` | `0fa477affbe75e15e6a2c8a46c61ee9210b6684d` | [#36](https://github.com/159357yangjun/Mirror_Cloud/pull/36) (head) | PR-DEPENDENCY |
| `feature/first-upload-journey-v1` | `1271a4c70c38b0f01765b5604215bbc9617d3d66` | [#29](https://github.com/159357yangjun/Mirror_Cloud/pull/29) (head); [#30](https://github.com/159357yangjun/Mirror_Cloud/pull/30) (base) | PR-DEPENDENCY |
| `feature/gallery-private-preview-v1` | `272415ec36b55df98926603fc469c908a554cd62` | [#11](https://github.com/159357yangjun/Mirror_Cloud/pull/11) (head); [#12](https://github.com/159357yangjun/Mirror_Cloud/pull/12) (base) | PR-DEPENDENCY |
| `feature/portable-assets-activation-gate-v1` | `90b90ebe6f430f93f1f3411a1404c9f5c6e6412c` | [#23](https://github.com/159357yangjun/Mirror_Cloud/pull/23) (head); [#24](https://github.com/159357yangjun/Mirror_Cloud/pull/24) (base) | PR-DEPENDENCY |
| `feature/portable-assets-batch-review-v1` | `98b946adb4ccc0f4f97cce118e0c8675b67a7f2c` | [#24](https://github.com/159357yangjun/Mirror_Cloud/pull/24) (head); [#25](https://github.com/159357yangjun/Mirror_Cloud/pull/25) (base); [#26](https://github.com/159357yangjun/Mirror_Cloud/pull/26) (base) | PR-DEPENDENCY |
| `feature/portable-assets-item-review-v1` | `7de1ac16ba1e96fabc787f5f933f0480b862d4f2` | [#22](https://github.com/159357yangjun/Mirror_Cloud/pull/22) (head); [#23](https://github.com/159357yangjun/Mirror_Cloud/pull/23) (base) | PR-DEPENDENCY |
| `feature/portable-assets-preview-v1` | `cfb80a0ba7e4a4b7f8061ac6eb014bfb614b9a9c` | [#20](https://github.com/159357yangjun/Mirror_Cloud/pull/20) (head); [#21](https://github.com/159357yangjun/Mirror_Cloud/pull/21) (base) | PR-DEPENDENCY |
| `feature/portable-assets-staging-v1` | `533c6e8abdfe79a1643bf854e01b45ed95c6edd3` | [#21](https://github.com/159357yangjun/Mirror_Cloud/pull/21) (head); [#22](https://github.com/159357yangjun/Mirror_Cloud/pull/22) (base) | PR-DEPENDENCY |
| `feature/portable-reconnect-id-mapping-v2` | `442d91bfea74c2995a3294572136c5cbcd8ecea3` | [#17](https://github.com/159357yangjun/Mirror_Cloud/pull/17) (head); [#18](https://github.com/159357yangjun/Mirror_Cloud/pull/18) (base) | PR-DEPENDENCY |
| `feature/portable-references-group-restore-v1` | `285e2535564d7d11d1d79c80050ac86ab913d4dc` | [#18](https://github.com/159357yangjun/Mirror_Cloud/pull/18) (head); [#19](https://github.com/159357yangjun/Mirror_Cloud/pull/19) (base) | PR-DEPENDENCY |
| `feature/portable-storage-manifest-v1` | `213dc18bc5eecc4f11cda09c8d582c2f9eb4a5e9` | [#13](https://github.com/159357yangjun/Mirror_Cloud/pull/13) (head); [#14](https://github.com/159357yangjun/Mirror_Cloud/pull/14) (base) | PR-DEPENDENCY |
| `feature/portable-storage-reconnect-v1` | `86c82ad592d511ffb23157823d530f892b0f0ce8` | [#14](https://github.com/159357yangjun/Mirror_Cloud/pull/14) (head); [#15](https://github.com/159357yangjun/Mirror_Cloud/pull/15) (base) | PR-DEPENDENCY |
| `feature/portable-workflow-restore-v2` | `27c33ae380c6b2dc8a6134abe662266670472c4d` | [#19](https://github.com/159357yangjun/Mirror_Cloud/pull/19) (head); [#20](https://github.com/159357yangjun/Mirror_Cloud/pull/20) (base) | PR-DEPENDENCY |
| `feature/private-asset-preview-v1` | `82a41bd7face619c1936dd491bec6b775e99967c` | [#10](https://github.com/159357yangjun/Mirror_Cloud/pull/10) (head); [#11](https://github.com/159357yangjun/Mirror_Cloud/pull/11) (base) | PR-DEPENDENCY |
| `feature/private-share-link-v1` | `53e9b33ae4060407a989c067e4fac2e7dfc1c57a` | [#6](https://github.com/159357yangjun/Mirror_Cloud/pull/6) (head); [#8](https://github.com/159357yangjun/Mirror_Cloud/pull/8) (base) | PR-DEPENDENCY |
| `feature/r2-private-publish-v1` | `4cf2dd51199962dac90e2ef6821dd37a11506757` | [#8](https://github.com/159357yangjun/Mirror_Cloud/pull/8) (head); [#10](https://github.com/159357yangjun/Mirror_Cloud/pull/10) (base) | PR-DEPENDENCY |
| `feature/s3-private-publish-v1` | `3388cbd7a614be859222d2ba3cbb30b620dcee04` | [#12](https://github.com/159357yangjun/Mirror_Cloud/pull/12) (head); [#13](https://github.com/159357yangjun/Mirror_Cloud/pull/13) (base) | PR-DEPENDENCY |
| `feature/upload-retry-safety-v1` | `c171c09f3445315522706c2980a4fcb13118a9c3` | [#26](https://github.com/159357yangjun/Mirror_Cloud/pull/26) (head) | PR-DEPENDENCY |
| `fix/portable-reconnect-atomic-insert-v1` | `4cf5cea64e03c99c185fd8f1818bc9f3a7e8838a` | [#16](https://github.com/159357yangjun/Mirror_Cloud/pull/16) (head); [#17](https://github.com/159357yangjun/Mirror_Cloud/pull/17) (base) | PR-DEPENDENCY |
| `fix/portable-reconnect-submit-guard-v1` | `2406c3d5cf14624a2ba977879988d259852210b0` | [#15](https://github.com/159357yangjun/Mirror_Cloud/pull/15) (head); [#16](https://github.com/159357yangjun/Mirror_Cloud/pull/16) (base) | PR-DEPENDENCY |
| `fix/update-check-feedback-v1` | `5d72662cb8a6c810e96522befe1ebe00537b3c04` | [#32](https://github.com/159357yangjun/Mirror_Cloud/pull/32) (head); [#33](https://github.com/159357yangjun/Mirror_Cloud/pull/33) (base) | PR-DEPENDENCY |
| `fix/upload-atomic-task-batch-v1` | `5ab256a7260dd316dec56a5bd3c0197693ce41f9` | [#28](https://github.com/159357yangjun/Mirror_Cloud/pull/28) (head); [#29](https://github.com/159357yangjun/Mirror_Cloud/pull/29) (base) | PR-DEPENDENCY |
| `fix/upload-dialog-batch-feedback-v1` | `b6568acea19c96a4bddf0fe8338dfcee295a4abf` | [#30](https://github.com/159357yangjun/Mirror_Cloud/pull/30) (head) | PR-DEPENDENCY |
| `fix/upload-failed-only-republish` | `b894143bb921431c41483d89a994f8a9ff136779` | [#25](https://github.com/159357yangjun/Mirror_Cloud/pull/25) (head); [#27](https://github.com/159357yangjun/Mirror_Cloud/pull/27) (base) | PR-DEPENDENCY |
| `fix/upload-retry-interaction-guard-v1` | `4be5e088794d7816049edb120bd40f13df624e20` | [#27](https://github.com/159357yangjun/Mirror_Cloud/pull/27) (head); [#28](https://github.com/159357yangjun/Mirror_Cloud/pull/28) (base) | PR-DEPENDENCY |
| `integration/mirror-cloud-ux34-frozen-20261011` | `e6c2e0e4e78d6677bbcd3bc98c6aba2ceb7e25df` | [#35](https://github.com/159357yangjun/Mirror_Cloud/pull/35) (head); [#36](https://github.com/159357yangjun/Mirror_Cloud/pull/36) (base); [#37](https://github.com/159357yangjun/Mirror_Cloud/pull/37) (base) | PR-DEPENDENCY |
| `integration/mvp-candidate-20261010` | `b6568acea19c96a4bddf0fe8338dfcee295a4abf` | [#31](https://github.com/159357yangjun/Mirror_Cloud/pull/31) (head); [#32](https://github.com/159357yangjun/Mirror_Cloud/pull/32) (base) | PR-DEPENDENCY |
| `release/prepare-v1.4.10-20261011` | `33f1930bb4486826d819d51d5a9abbbae7d71a47` | [#37](https://github.com/159357yangjun/Mirror_Cloud/pull/37) (head) | HOLD-RELEASE |
| `ux/candidate-build-identity-20261011` | `e6c2e0e4e78d6677bbcd3bc98c6aba2ceb7e25df` | [#34](https://github.com/159357yangjun/Mirror_Cloud/pull/34) (head) | PR-DEPENDENCY |
| `ux/clear-copy-and-interaction-20261011` | `0f7ac930860c46c3553f76d83429aae842fa35a9` | [#33](https://github.com/159357yangjun/Mirror_Cloud/pull/33) (head); [#34](https://github.com/159357yangjun/Mirror_Cloud/pull/34) (base) | PR-DEPENDENCY |

**C 类处置**：任何分支即使是旧版本代码，只要仍被 PR 作为 head 或 base 使用，就不要先删。先审核增量行为并决定“已被 main 替代 / 需要单独移植 / 明确放弃”，再按从下游到上游的顺序关闭或合并相关 PR，最后才满足删除准入。

## 5. 开放 PR 全量表（32 条，显示依赖链）

| PR | head | base | 状态 |
| --- | --- | --- | --- |
| [#38](https://github.com/159357yangjun/Mirror_Cloud/pull/38) | `dependabot/github_actions/dev/workflow-actions-c673fd7efc` | `dev` | Open |
| [#37](https://github.com/159357yangjun/Mirror_Cloud/pull/37) | `release/prepare-v1.4.10-20261011` | `integration/mirror-cloud-ux34-frozen-20261011` | Draft |
| [#36](https://github.com/159357yangjun/Mirror_Cloud/pull/36) | `docs/ux34-release-readiness-20261011` | `integration/mirror-cloud-ux34-frozen-20261011` | Draft |
| [#35](https://github.com/159357yangjun/Mirror_Cloud/pull/35) | `integration/mirror-cloud-ux34-frozen-20261011` | `dev` | Draft |
| [#34](https://github.com/159357yangjun/Mirror_Cloud/pull/34) | `ux/candidate-build-identity-20261011` | `ux/clear-copy-and-interaction-20261011` | Draft |
| [#33](https://github.com/159357yangjun/Mirror_Cloud/pull/33) | `ux/clear-copy-and-interaction-20261011` | `fix/update-check-feedback-v1` | Draft |
| [#32](https://github.com/159357yangjun/Mirror_Cloud/pull/32) | `fix/update-check-feedback-v1` | `integration/mvp-candidate-20261010` | Draft |
| [#31](https://github.com/159357yangjun/Mirror_Cloud/pull/31) | `integration/mvp-candidate-20261010` | `dev` | Draft |
| [#30](https://github.com/159357yangjun/Mirror_Cloud/pull/30) | `fix/upload-dialog-batch-feedback-v1` | `feature/first-upload-journey-v1` | Draft |
| [#29](https://github.com/159357yangjun/Mirror_Cloud/pull/29) | `feature/first-upload-journey-v1` | `fix/upload-atomic-task-batch-v1` | Draft |
| [#28](https://github.com/159357yangjun/Mirror_Cloud/pull/28) | `fix/upload-atomic-task-batch-v1` | `fix/upload-retry-interaction-guard-v1` | Draft |
| [#27](https://github.com/159357yangjun/Mirror_Cloud/pull/27) | `fix/upload-retry-interaction-guard-v1` | `fix/upload-failed-only-republish` | Draft |
| [#26](https://github.com/159357yangjun/Mirror_Cloud/pull/26) | `feature/upload-retry-safety-v1` | `feature/portable-assets-batch-review-v1` | Draft |
| [#25](https://github.com/159357yangjun/Mirror_Cloud/pull/25) | `fix/upload-failed-only-republish` | `feature/portable-assets-batch-review-v1` | Draft |
| [#24](https://github.com/159357yangjun/Mirror_Cloud/pull/24) | `feature/portable-assets-batch-review-v1` | `feature/portable-assets-activation-gate-v1` | Draft |
| [#23](https://github.com/159357yangjun/Mirror_Cloud/pull/23) | `feature/portable-assets-activation-gate-v1` | `feature/portable-assets-item-review-v1` | Draft |
| [#22](https://github.com/159357yangjun/Mirror_Cloud/pull/22) | `feature/portable-assets-item-review-v1` | `feature/portable-assets-staging-v1` | Draft |
| [#21](https://github.com/159357yangjun/Mirror_Cloud/pull/21) | `feature/portable-assets-staging-v1` | `feature/portable-assets-preview-v1` | Draft |
| [#20](https://github.com/159357yangjun/Mirror_Cloud/pull/20) | `feature/portable-assets-preview-v1` | `feature/portable-workflow-restore-v2` | Draft |
| [#19](https://github.com/159357yangjun/Mirror_Cloud/pull/19) | `feature/portable-workflow-restore-v2` | `feature/portable-references-group-restore-v1` | Draft |
| [#18](https://github.com/159357yangjun/Mirror_Cloud/pull/18) | `feature/portable-references-group-restore-v1` | `feature/portable-reconnect-id-mapping-v2` | Draft |
| [#17](https://github.com/159357yangjun/Mirror_Cloud/pull/17) | `feature/portable-reconnect-id-mapping-v2` | `fix/portable-reconnect-atomic-insert-v1` | Draft |
| [#16](https://github.com/159357yangjun/Mirror_Cloud/pull/16) | `fix/portable-reconnect-atomic-insert-v1` | `fix/portable-reconnect-submit-guard-v1` | Draft |
| [#15](https://github.com/159357yangjun/Mirror_Cloud/pull/15) | `fix/portable-reconnect-submit-guard-v1` | `feature/portable-storage-reconnect-v1` | Draft |
| [#14](https://github.com/159357yangjun/Mirror_Cloud/pull/14) | `feature/portable-storage-reconnect-v1` | `feature/portable-storage-manifest-v1` | Draft |
| [#13](https://github.com/159357yangjun/Mirror_Cloud/pull/13) | `feature/portable-storage-manifest-v1` | `feature/s3-private-publish-v1` | Draft |
| [#12](https://github.com/159357yangjun/Mirror_Cloud/pull/12) | `feature/s3-private-publish-v1` | `feature/gallery-private-preview-v1` | Draft |
| [#11](https://github.com/159357yangjun/Mirror_Cloud/pull/11) | `feature/gallery-private-preview-v1` | `feature/private-asset-preview-v1` | Draft |
| [#10](https://github.com/159357yangjun/Mirror_Cloud/pull/10) | `feature/private-asset-preview-v1` | `feature/r2-private-publish-v1` | Draft |
| [#9](https://github.com/159357yangjun/Mirror_Cloud/pull/9) | `chore/r2-live-e2e-default-activation` | `main` | Draft |
| [#8](https://github.com/159357yangjun/Mirror_Cloud/pull/8) | `feature/r2-private-publish-v1` | `feature/private-share-link-v1` | Draft |
| [#6](https://github.com/159357yangjun/Mirror_Cloud/pull/6) | `feature/private-share-link-v1` | `dev` | Draft |

### PR 收口顺序（不自动执行关闭/合并）

1. 审核最下游 PR 的具体补丁与风险，先处理其子 PR，防止 parent 先消失后 diff 失去有意义的比较基线。可先按 **#38、#37、#36、#35、#34→#33→#32→#31、#30→#29→#28→#27 / #26→#25→#24→…→#6** 分组处理；不是闭眼按编号关闭，分叉须查 PR base。
2. **PR #9**（受保护 R2 live E2E）保持特殊 HOLD：`main` 的 `.github/workflows/r2-private-live-e2e.yml` 仍设置 `if: ${{ false }}`；`docs/archive/legacy_ci/PR9_R2_LIVE_ACTIVATION_DRAFT.yml` 只保留源码，不授权启动真实 R2 写入。必须单独决定是持续保留审批，还是明确放弃后关闭。
3. **PR #37**（v1.4.10 发布准备）保持特殊 HOLD：已归档源代码不代表版本号已获批、升级/回滚 G3 通过或创建正式 Release 的资格。
4. **PR #38**（Dependabot Actions 更新）：需对照当前 main 的 pinned action SHA 和安全门禁确认是否已经采纳或无需更改，再决定关闭或更新。
5. PR #36 的旧发布证据已有主线归档，但确认评审已收口后才能关闭；其他旧功能链应对照 main 的真实行为验证，尤其恢复原子性、重复提交、私有访问、已成功任务的不可重复发布。

## 6. 用户最终统一删除时的准入门禁

- [ ] 将这份快照与删除当天的 `git ls-remote --heads origin` / GitHub branches API 对比，确认每条分支的 SHA 未变化，新增分支另审。
- [ ] 完成 32 条开放 PR 的功能语义、review 与依赖处理；相关 PR 已明确合并、关闭并留存理由，**不能假装关闭即合并**。
- [ ] 有价值的测试、源代码及必要文档在 main 有明确对应文件或被有依据地放弃；不盲合旧分支导致版本倒退。
- [ ] 只以删除当天最新 main SHA 对应的必需 CI 成功作为主线准入；Windows 原生、DPI、私有 R2 live、升级回滚等分属不同门禁，缺失据实 HOLD。
- [ ] 恢复 main 禁止 Force Push 和禁止删除的保护，不强制 PR 的决定应与当前 main-only 流程协调；如保护 API 403，维护者在网页核验并留证。
- [ ] 用户明确启动最终删除阶段后，逐个核对远端 SHA 与开放 PR head/base，记录删除结果与失败原因。不得把此文档当作批量删除授权。
- [ ] 删除后确认远端只存在 `main`，保留 PR、Commit、CI、Release 与清理台账；本地 `git fetch --prune` 仅刷新本地远端跟踪引用，不自动代表 GitHub 删除完成。

## 7. 最终删除当天可用的只读核验命令

```powershell
git fetch origin --prune
git ls-remote --heads origin
gh pr list --state open --limit 100
git ls-remote --heads origin main
```

建议逐条比对原 SHA 后再执行真实删除。**本次整理不附带任何立即执行的批量删除指令。**

## 8. 本轮交付记录

- **实际分支删除：0；PR 关闭：0；Release/Tag：0；云端真实写入：0。**
- 文件仅为审计与操作准入台账，不改变产品代码，不替换 `.ai/STATE.generated.json` 中的机器采集快照，也不改变长期 `AGENTS.md`。
- 本文列出的 SHA 和 PR 关系是采集时点，不代表清理时点。后续新的 main 开发不影响原分支记录，但会让行级差异判断过时，务必重新比对。
