# v1.4.9 发布就绪报告（G3 真机升级保真 · 2026-10-07）

**结论：可发布。** 十行判定中 9 行机器取证 PASS，第 7 行为目视项待用户确认。全部证据文件在 `%TEMP%\g3_v149\`，每条附复算方式。

## 候选与 provenance

| 项 | 值 |
|---|---|
| 候选 A（原定义） | `2b936e5`（bump 1.4.9，CI #335 success） |
| RC 实际构建自 | `0422c0d` = dev tip（A + 两笔 Copilot bot 提交：merge 空壳 main + "Initial release completed"） |
| **树等式（关键证人）** | `2b936e5^{tree}` == `0422c0d^{tree}` == `748e58ce…`；`git diff --stat` 输出 0 行 ⇒ **代码内容字节级相同**，二进制同源 |
| CI 链 | #335(A) / #336·#337·#338(A′及后续) 全 success |

## G3 实验方法（已执行完毕）

```text
装好的 v1.4.8（真实用户态：47 assets / GitHub storage / markdown-card 插件带 G3-v149:: 模板）
→ BEFORE-1 冻结（备份 sha256=e69be3ab…，quick_check ok，五步审计链 BEFORE-0→…→BEFORE_1）
→ RC setup.exe 三方哈希对账（本地重算==SHA256SUMS.txt：ad6727f2…6a6d，8,484,442 B；比较器带捏造负例）
→ source.zip 内三处版本声明核=1.4.9（防降级/防错包）
→ /S 静默覆盖安装 → 零手动重配
→ AFTER harness（g3_after.py）+ CLI 真实上传 + 逐行 diff
```

## 十行判定

| # | 行 | 结果 | 一手证据 |
|---|---|---|---|
| 1 | 应用版本 | ✅ | 注册表 1.4.8 → 1.4.9（regver.ps1 两次读数） |
| 2 | SQLite 数据 | ✅ | 稳定计数逐项等（migrations=19/workflows=1/tasks=40/storages=1）；assets 47→48 的 +1 = 行 10 自己传的图 |
| 3 | Storage 配置 | ✅ | storages 行 name/provider/enabled/credential_ref/config_json 五字段逐字等，且升级后进程可解析、provider 可用 |
| 4 | Token/凭据 | ✅ | 经 CredRead（全程零打印）：repo API 200 + `/user` login=`159357yangjun` 匹配 owner + Local API 凭证可读——token 被**真实使用**而非"文件还在" |
| 5 | 默认上传目标 | ✅ | `publish.default_target` JSON 字节等（仍指同一 storage id） |
| 6 | Typora bridge | ✅ | 升级后二进制 `--typora-upload` rc=0 返回 URL，独立拉取 HTTP 200（sha 前缀 e6fe1775 与文件名一致） |
| 7 | Theme/壁纸 | ⏳ 目视 | 应用已启动在桌面，待用户一眼（唯一机器证不了的行） |
| 8 | Asset index | ✅ | remote_scans=1 / entries=47 升级后可读，路径集合完整 |
| 9 | 插件配置 | ✅ | plugins 行五项（id/enabled/perms/hooks/**template=G3-v149::**）逐字等 **+ after_upload 钩子在新资产上真执行**，输出 `G3-v149::probe_after.png::<url>` |
| 10 | 升级后真实上传 | ✅ | probe_after.png 端到端：远端 200 + 本地 assets/deployments 各 +1 + 插件输出挂到新资产 |

## 已知残留（如实）
- 探针文件 `probe_after.png` 与 manual_trigger 时代的 `probe_upload.*` 留在用户 PicList 仓库 assets/uploads/ 下，可删。
- Docs Site run #9 = failure（非阻断：Pages 源未设，release.yml 会隐藏在线教程链接——既有知情缺口）。
- g3_detail_dryrun.json 是我修 harness 中途的一次运行，正式基线只认 BEFORE_1_FROZEN → g3_detail_after。
