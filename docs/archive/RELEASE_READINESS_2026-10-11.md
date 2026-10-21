> [!IMPORTANT]
> **历史归档（2026-10-11 快照），不是当前 main 发布状态或执行指令。** 以下文档来自旧分支 `docs/ux34-release-readiness-20261011`，仅用于保留当时的构建、安装、SQLite/Windows 凭据升级与离线回滚验收证据。
> 当前开发已规定**只使用 main**；历史文档中关于“独立版本准备分支”、待合并 PR、旧 SHA 和发布门禁状态的描述仅对当时成立，不得据此创建分支、启动发布或真实 R2 测试。
> **当前发布决策仍需按 `docs/RELEASE_GATE_UPDATER.md` 和当前 main 的 CI / 原生 / 受保护云端门禁重新裁定。** 该归档不会将 #34 的历史成功算作当前 main 已通过 G3。
>
> 来源：[历史分支原文](https://github.com/159357yangjun/Mirror_Cloud/blob/docs/ux34-release-readiness-20261011/docs/RELEASE_READINESS_2026-10-11.md) · 原始 Blob SHA：`8208f8f13b12ec201dd900071962c406229de0b2`。

---

# 镜云发布前验收与阻塞清单（2026-10-11）

> **状态：候选代码冻结 / NOT READY FOR PUBLIC RELEASE。** 本文只记录验证证据和发布门槛；不是授权合并、改版本、运行真实云端写入或发布。时间敏感结果以对应 GitHub Actions 的最终结论为准。

## 1. 候选来源与集成策略

- 正式 GitHub Release: [v1.4.9](https://github.com/159357yangjun/Mirror_Cloud/releases/tag/v1.4.9)（2026-10-08）。
- 冻结产品源码：`e6c2e0e4e78d6677bbcd3bc98c6aba2ceb7e25df`（[#34](https://github.com/159357yangjun/Mirror_Cloud/pull/34) / 整体 [Draft #35](https://github.com/159357yangjun/Mirror_Cloud/pull/35)）。
- `dev` 冻结观察值：`e634ced12a9531ffde63e751dbf24b03d875252e`；比较结果 **ahead 226 / behind 0**。实际集成前重新读取远端 `dev`，有漂移则重新比较和测试。
- 原始依赖：[#31](https://github.com/159357yangjun/Mirror_Cloud/pull/31) → [#32](https://github.com/159357yangjun/Mirror_Cloud/pull/32) → [#33](https://github.com/159357yangjun/Mirror_Cloud/pull/33) → [#34](https://github.com/159357yangjun/Mirror_Cloud/pull/34)；这四个 PR 和 #35 均为 Draft，未合并。**最终只选择一种集成路线**：逐层合并原 PR，或审查后将等价整体候选一次性合并；不混合两种路径导致重复合并记录。不得使用 force push 覆盖协作历史。
- 本文件必须与上述固定源码保持隔离；文档 PR 不代表新的产品构建。

## 2. 已验证的自动化证据

| 验证面 | 不可变证据 | 当前结论 | 证明范围与例外 |
| --- | --- | --- | --- |
| 全栈候选 CI | [#35 Push #38132296623](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/38132296623)、[PR #38132334954](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/38132334954) | Success | Rust check/test、桌面前端和 docs build、契约；不等于真实云操作 |
| Windows Edge 交互 | [#38114495288](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/38114495288) | Success | 浏览器 Tab、Shift+Tab、Esc 等行为；不等于原生平台事件全覆盖 |
| #34 原生 Windows + NSIS/MSI | [#38132107841](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/38132107841) | Success | 固定源码 `e6c2e0e4...`；原生窗口 2 次启动、SQLite 进程重启保留、安装卸载均通过 |
| #34 构建身份 | [#38123998014](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/38123998014) | Success | 默认构建没有候选标识；显式设置完整 SHA 后前端显示短 SHA，语义版本仍为 1.4.9 |
| 官方 1.4.9 → #33 候选升级 | [#38123515352](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/38123515352) | Success | 临时 Windows 用户配置中的 SQLite 设置、离线存储记录、`credential_ref` 和本机 API Windows 凭据字节保留；不是任何真实云 Token 兼容性的证明 |
| 官方 1.4.9 → #34 候选升级 | [#38140613195](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/38140613195) | **Success** | 使用实际 #34 固定安装包，核验同版本 NSIS 覆盖安装、新旧原生启动、数据库设置、WinCred 本机 API Token 未变；`UPGRADE_UX34_COMPAT_GATE ... failed=0` |
| 官方版冷备份 → #34 升级 → 恢复官方版及 SQLite | [#38141333402](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/38141333402) | **Success** | 独立 CI-only Windows Runner；SQLite backup API 冷备份、旧版 EXE 哈希复原、旧数据库恢复、3 次原生窗口启动、设置/存储/WinCred 保留，`ROLLBACK_UX34_GATE ... failed=0`；并非产品内置回滚功能 |

### #34 原生产物独立核验

- [原生构建工作流](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/38132107841)：Artifacts `mirror-cloud-ux34-native-candidate-installers`；验证时 ZIP CRC 完整，`SHA256SUMS.txt` 的 3 个条目与实际字节一致。
- `mirror-cloud-ux34-candidate-e6c2e0e4e78d-windows-x64-setup.exe`：SHA256 `e483fc6e29faaa1517b0159eed5e7f690b8882fd0bb5ebea864e93fd4db9ccc9`
- `mirror-cloud-ux34-candidate-e6c2e0e4e78d-windows-x64.msi`：SHA256 `9432957237bbcd76747d6bf7f953e0003e34ca81be86a5ef102de58c49d79fe7`
- `mirror-cloud-ux34-candidate-e6c2e0e4e78d-source.zip`：SHA256 `6302c0bf9525ed836223d0f13bf837c660b5710e0d2aea4ba32af80ed2b7290d`

**注意：这些是 CI 候选文件，内部仍是 `1.4.9`，不可当作新正式版，也不应直接覆盖日常工作环境。**

## 3. 阻塞项：从高到低

### G1 — 真实私有 R2 的生产接口 E2E（**阻塞**）

- [Issue #7](https://github.com/159357yangjun/Mirror_Cloud/issues/7) 尚在 Open；受保护的主分支工作流注册 [PR #9](https://github.com/159357yangjun/Mirror_Cloud/pull/9) 尚在 Open。候选树中的 `.github/workflows/r2-private-live-e2e.yml` 故意使用 `if: ${{ false }}` 禁止从不可信 feature ref 读取密钥或执行写入。
- **不得在本次验收中解除该开关、调用真实账户或把凭据写进 PR/日志。** 须由仓库所有者配置独立 disposable private R2 bucket、Cloudflare Environment `r2-private-e2e` 强制人工审批与分支限制，并审查可运行工作流的固定测试 SHA，才考虑启用。
- [R2 私有对象 E2E 规范](../R2_PRIVATE_LIVE_E2E.md) 所需证据：管理 API 查证公共域禁用 → 临时对象 upload/stat/readback → 匿名 GET 应拒绝 → 生产 presigned URL 可授权读取 → 过期后拒绝 → 对象清理验证。另行检查 Worker/proxy/caching 公共路径。
- 不能用“普通 CI 全绿”或静态 mock/模拟 E2E 替代以上证据。其它 Provider（GitHub、Gitee、OSS、COS、WebDAV）的真实权限/删除/失败恢复也需要隔离测试账号与逐项验收。

### G2 — 正式语义版本与升级矩阵（**阻塞**）

- 当前发布源/候选包均为 `1.4.9`。界面增加候选 SHA 只是**构建身份**，不能替代包管理器、更新比较和 tag 所需的**新语义版本**。
- 由仓库维护者先批准下一正式版本号（例如 `1.4.10` 仅为讨论选项，并未批准），然后在**独立版本准备分支**统一修改：
  1. 根目录 `Cargo.toml` 的 workspace.package.version，及 `Cargo.lock` 中所有 workspace member 版本；
  2. `apps/desktop/package.json`、`apps/desktop/package-lock.json` 顶层与 root package 的版本；
  3. `apps/desktop/src-tauri/tauri.conf.json` 的 `version`；
  4. 按仓库约束更新记录、运行 `python scripts/check_release_version.py` 和完整 CI。
- 用**重新生成的新版本安装包**重做 Windows 原生启动、NSIS/MSI 安装卸载、旧正式版 → 新版数据/系统凭据兼容性、升级后的手动更新提示。新 Release/tag 必须与版本对齐，不复用 `v1.4.9`。

### G3 — 用户数据、真实行为及回滚（**阻塞**）

**新增自动化证据：** [隔离离线回滚演练 #38141333402](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/38141333402) 已成功完成从官方版 SQLite 备份、覆盖到 #34、恢复原版 EXE、离线 SQLite 恢复，再启动官方程序；核对原始数据表、模拟用户设置/存储和 Windows 本机 API Token。此项将“没有回滚实验证据”更新为“已证明一组模拟数据的离线回滚流程”，**但实际产品仍无一键备份/自动回滚能力**。

**重要功能边界：** `portable_backup.rs` 内导出的便携存储清单明确**不是 SQLite/凭据备份**，也没有提供旧应用/数据库自动回滚。任何真实用户降级前，必须获得独立可还原的完整数据目录/系统凭据处理方案，断开进程并验证恢复；不要把迁移清单误当作完整备份。


- 已通过的自动化只覆盖**新建临时 Windows 配置 + 部分符合真实数据结构的测试项**，不是多年来积累的全部用户库。
- 用脱敏、可销毁的隔离配置测试：老版本 SQLite migration、配置/存储引用/秘钥保护、失败时的未完成任务、备份与恢复、单实例行为、同版本/跨版本升级界面、NSIS/MSI 家族内和跨家族路径（需分别审查）。
- 留有真实用户数据时先做 SQLite 数据目录、配置及系统凭据的**安全备份方案和恢复验证**；不直接上传真实数据库/密钥到 GitHub Actions。
- 在独立 Windows 用户配置上完成最终**手动 GUI 验收**：弹窗焦点、任务进行时误关闭、发布失败与部分成功、更新提示与检查结果措辞，以及双击安装后的实际运行。

## 4. 发布决策检查表

- [x] 冻结整栈 #34 SHA、可追溯 PR #35 入口
- [x] #35 整栈 Push/PR CI 全绿
- [x] #34 原生 Windows、安装卸载与候选文件 SHA256 通过
- [x] #33 的官方版 → 候选版数据库设置与本机凭据保留
- [x] #34 同版本候选真实 NSIS 覆盖升级复测：[#38140613195](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/38140613195)，`baseline=1 replaced=1 native=2 sqlite=1 settings=1 storage=1 keyring=1 failed=0`
- [ ] 受保护 R2 真实 E2E + 私有访问、清理、到期验证完成并人工批准
- [ ] 各 Provider 真实权限/上传/删除/恢复风险按产品承诺验收或明确标为不可用
- [ ] 正式版本号经维护者确认并全仓同步，新包重建并验证升级
- [x] 代表性 SQLite 离线备份、程序回退、数据库恢复的独立 CI 演练通过（仅合成测试资料）
- [ ] 真实用户数据目录及凭据的完整备份、恢复、故障注入和最终人工 Windows GUI 验收通过
- [ ] 维护者决定 **只使用一种** #31～#35 集成路线，重新比较 `dev`、完成评审
- [ ] 获得明确发布授权后，才合并、创建匹配的 tag/Release 并复查下载 SHA256 与客户端更新感知

**目前的决策：HOLD / NO MERGE / NO RELEASE。** 文档与候选 CI 的创建均不构成正式发布授权。
