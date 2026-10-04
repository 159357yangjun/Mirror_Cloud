# STATE

> **本文件不再手写事实。** 版本、HEAD、tag、仓库名等由 `scripts/project_state.py` 从
> git / Cargo / package.json / GitHub API 读取，产物是 `.ai/STATE.generated.json`。
> 复算：`python scripts/project_state.py --verify`（漂了就 rc=1）。
> 这里只留**判断与叙述** —— 机器读不出来的那部分。

## 当前局面（叙述）

- 产品：镜云 / Mirror Cloud，本地优先的多云图片发布客户端；无自建后端，云端只用用户自己配的存储目标。
- 发布链卡在 G2：代码与门禁全绿，缺一次带认证的 `workflow_dispatch`。上一会话穷尽五个通道均不可代做，证人见 `docs/HANDOFF_TEST_SUBMISSION.md` §7。
- v1.4.6 是污染 tag：不移动、不复用。G3 真机升级 E2E 未跑过 ⇒ 在此之前不得建 v1.4.7 tag。
- 用户在用的是 `D:\Mirror Cloud`（v1.4.5 资产包），等他换装新包。
- 默认分支 `main` 已与 `dev` 分叉（main 领先 1 个单 commit、落后 383），发布链一律走 dev；Actions 的 workflow 可见性取决于默认分支上有没有 `.github/workflows/`。

## 结构性风险（在档未修）

| 项 | 事实 | 缓解 |
| --- | --- | --- |
| 迁移只有 up | 13 up / 0 down | 动 schema 前备份 `%APPDATA%\dev.multicloud.publisher\publisher.sqlite3` |
| identifier 冻结 | `dev.multicloud.publisher` | 改了用户数据"看起来没了" |
| remote URL 仍指旧名 | origin 靠 GitHub 重定向工作 | 改名会断；README 已改指 Mirror_Cloud |
| P2-1 remote index 截断 | `storage-github` 的 `list()` 无分页、无 complete 标志 | 挂账；未构造 >1000 文件真实验证 |
