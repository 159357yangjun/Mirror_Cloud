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
