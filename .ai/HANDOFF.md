# HANDOFF

给下一个接手会话的入口顺序：

1. `AGENTS.md` — 八条硬规则，先读再动。
2. `.ai/STATE.md` — 当前基线与在飞关卡（数字带复算命令）。
3. `.ai/TASKS.md` — 队列与每项状态；收尾必须三态之一。
4. `.ai/DECISIONS.md` — 已定稿规范与待拍板项；批准≠插队。
5. `.ai/WORKLOG.md` — 最近一轮的事实/判断/撤回结论；已撤回的推断不要复活。
6. `docs/RELEASE_GATE_UPDATER.md` — 更新器 G0–G5 门禁全文。
7. `CHANGELOG.md` §21–§23 — 发布门禁定稿、格式战役全过程、审计十项账目。

取证通道速查：CI 失败 → `actions/runs?per_page=N` 拿 run id → `/jobs` 拿 job id →
`check-runs/{job_id}/annotations`（公开可读，含 fmt 补丁分片 / check 首错 / test 首错）。
git 推送走 `-c http.proxy=http://127.0.0.1:7897`。聚合门运行期间禁碰工作树。
