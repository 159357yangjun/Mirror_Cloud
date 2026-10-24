# WORKLOG

## 2026-10-03（本会话，压缩前快照）

**事实**：图标换装落仓（z6 深海青水晶云，`70cd60e`+`69e44bf`）；更新器 fmt/check/test 三关经 run#199–#231 收敛后全绿（`90198ed`）；审计十项中已修 A（PWB URL 语义，本轮 `a464cbb`）、权限收紧、Gitee 脱敏；B（措辞分级）同笔落地。CI 三条失败自证通道常驻（fmt 补丁分片 base64 / check 首错 / test 首错）。

**判断**：格式战役的根因链最终全部有主——批量替换粘连签名（我的错，测试模块漏读 diff）、`impl Fn` vs `FnMut`、`without_url()` 吃所有权、两处 >99 format! 塔形。前六轮猜测无证据，作废记录在 CHANGELOG §22/§23。

**已撤回的结论（勿当欠账复活）**：①"宽度判据整体作废"过头——join 后 ≤99 必并行的规则与全部反例相容，只是不是唯一规则；②"run#29 的 8m41s 证明红不在 fmt"未经日志证实，维持 unknown；③ fail() 借用包装（E0507 后改 owned + redact()）。

**下三条**：1) 推送 a464cbb 后核 CI 终态；2) 开工 C（G1 PendingUpdate），形状照 RELEASE_GATE §G1，新断言与违规同笔；3) D（Local API auth-before-body）带 timeout+semaphore 一起做。

**别碰清单**：v1.4.6 tag（污染，不移动不复用）；远端 tag 现停 `262a70d` 属失败候选；identifier `dev.multicloud.publisher`（改了用户数据"看起来没了"）；`updater.rs` 现有排版（已过三关）；发布/打包/push main 需用户点名。

## 2026-10-04（G2 PREPARED 快照，非 PASS）

**本轮 API/git 一手读数**：dev HEAD=`6116e3d`、package.json `1.4.7`、工作树 clean；CI #247 push/dev/6116e3d/success；Release Bundle(workflow 361967452) `total_count=29` 且最近 5 条全为 `event=push branch=v1.4.6 conclusion=failure` ⇒ **dispatch run 0 条**；`release.yml:4` 有 `workflow_dispatch:`；`/tags` 顶端 `v1.4.6`（无 v1.4.7）；`/releases/tags/v1.4.7` = Not Found。

**口径修正（已双方确认）**：312 = 仓库全部 Actions runs；29 = Release Bundle 单条 workflow 的 runs。**G2 PREPARED ≠ G2 PASS**。

**顺带更正的过期登记**：TASKS 里 E 曾写"未开工"，实测已完成（Rust 三条建库路径 commands.rs:807/883/974 + plugin-runtime http_endpoint，门禁 `USERFLOW_CHECKS total=284 failed=0`）。E/F/G/H 的状态以 TASKS 现值为准。

**G2 → PASS 的唯一缺口**：一次已登录人工 `workflow_dispatch(dev)`。三通道代做均失败且有证人：Edge 连接器可导航但 `evaluate_script` 返回 `{}`、点击后 `list_pages` 只剩 about:blank；Computer Use 中止于 `browser_url_policy / insufficient_url_confidence`；Qoder 内置浏览器未登录（快照头部 `Sign in`、无 Run workflow 控件）。

**本笔不改任何东西**：`6116e3d` 保持为 RC 候选源码——不动 src、不动 release.yml、不建 tag、不复用 v1.4.6。点成功后须重读最新事实（不沿用本日读数），再按十二项证据 + 四个 artifact 文件名 + publish-release SKIPPED + tag/Release 无副作用一次核完。

## 2026-10-24（远端分支与进度复核；main 本地验证）

**事实**：按用户“拉取远端最新代码，本地测试提交”和“检查项目进度，检查远端分支情况”的要求，先执行 `git fetch origin`，再创建跟踪远端的本地 `main` 并执行 `git pull --ff-only origin main`，结果 Already up to date。被测源码基线为 `5c79c42a04bfde72020329679bbb5dd4f961dbbd`。原本地 `dev` 保留在 `d3e39b4c2bd6004f1e49c130e465fb67e348ce24`；`git rev-list --left-right --count origin/dev...dev` 为 0/159，未将这批历史工作覆盖、重置或合并到 main。

远端采集使用 `git ls-remote origin refs/heads/main refs/heads/dev`，以及 GitHub REST `branches?per_page=100`、`pulls?state=open&per_page=100`：main 为上述被测 SHA，dev 为 `e634ced12a9531ffde63e751dbf24b03d875252e`；共 53 个分支、32 个开放 PR，其中 31 个 Draft。PR #40/#41/#42/#43 均已合并到 main（分别为 R2 向导、UI-00 审计、UI-01 合同、基础候选整合），PR #9 仍是开放 Draft。存量分支大量使用串联 PR，且 main 曾 Squash 合并；提交 ahead 或非祖先关系不等于成果缺失，不能据此删除或整批重合并。经典 branch-protection API 返回 403，不能以本连接器结果判断保护规则已解除。

本地实际通过：validate（21 个 up 迁移、17 张表，仅内存库）、commands（97/97/97）、user-flow（639/0）、docs contract（16 项）、Action pins（45 个引用）、R2 live-workflow 静态门（10 项，未运行云端）、release version（1.4.9，13 个 workspace 成员）、Tauri dependency family、`cargo fmt --all -- --check`、桌面 `npm run build`、TaskUI 9 个单测及 `project.taskui.json --strict`（errors=0 warnings=0）、R2 离线诊断（9/0）、shape（81/0）。`node scripts/test_r2_wizard_browser.mjs` 使用本机 Edge、真实向导组件和明确拒绝远端写入的内存 IPC 替身，在 1366×768 DPR=1 与 640×480 DPR=1.5 两个场景通过 60 项检查，cloud_writes=0；此 DPR 测试不等于 Windows 原生系统 DPI 验收。前端构建仍有大于 500 kB chunk 及无效动态导入警告。主题文档核对失败：`node scripts/theme_face_inventory.mjs --verify` 报 mismatch=11（未修改文档或放宽门）。

远端同源码 SHA 的 [CI 39604556442](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/39604556442) 为 success，jobs 的 Rust format/check/tests、Desktop build、Docs build 均为 success；同 SHA 的 [TaskUI strict 39604556641](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/39604556641) 亦 success。另有历史主线 Windows 原生/SQLite 验收 [39603276174](https://github.com/159357yangjun/Mirror_Cloud/actions/runs/39603276174)，其 SHA 为 `72e9c2df4e6f8e0cbcc6c8c281430589b94cf77a`，不能冒充本次最新源码的原生复跑。

**判断**：前次针对本地 dev 的 83 命令/885 静态断言/22 迁移及 ShareLinkPanel 未挂载等结论，只属于该历史开发线，不能套用到 main。当前 main 已有 R2/S3 临时签名分享调用及私有预览，UI-00/UI-01 为已合入的审计和设计合同，不代表 UI-02—UI-10 或正式发行验收完成。真实 R2 E2E 仍未验证，live workflow 的 `if: ${{ false }}` 保留。主题基线与早期 .ai/ 台账仍漂移，应与源码和实际 CI 交叉核实。

**动作与边界**：本批仅追加本工作日志并按用户要求做本地 Git 提交，产品源码、迁移、版本及工作流均未修改；本日志提交没有远端 CI 结果，引用的 PASS 只对应上文被测源码 SHA。本机仍缺 MSVC C++ linker，本次未重跑本地 Rust 编译/测试；文档依赖未安装，未跑本地文档构建。未运行完整 verify:all、真实云端上传、用户旧库升级、安装器或人工 G3；未推送、合并 PR、删除分支、移动 tag 或发布。本次临时 Vite 服务在测试结束后关闭。下一步先对账存量 PR 的独立成果与 main 文件树，再按 main-only 规则推进 UI-02；主题基线修订需保留真实差异，不以重签掩盖失败。
