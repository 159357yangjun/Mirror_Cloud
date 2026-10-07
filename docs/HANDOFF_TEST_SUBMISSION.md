# 提测说明 · Mirror Cloud（镜云）v1.4.7

> 交付对象：接手本项目的 AI / 工程师。
> 本文档由当前会话在 `dev` tip `157d0e7` 上实测生成，所有数字均可用文中命令复算。

---

## 一、当前状态（一句话）

代码已完成并全量本地验证通过；**唯一未完成的是"发布链"**——v1.4.7 尚无 tag、无 Release、无安装包，且真机升级 E2E（G3）从未跑过一次。

| 项 | 值 | 复算方式 |
| --- | --- | --- |
| 版本 | 1.4.7（三处一致） | `python scripts/check_release_version.py` |
| 分支 | `dev` = 本地 = `157d0e7` | `git rev-list --count HEAD..origin/dev` → 0 |
| 工作树 | clean | `git status --porcelain \| wc -l` → 0 |
| CI | #249 success（`2d40af6`）；`157d0e7` 未单独验 | Actions API |
| v1.4.7 tag / Release / 安装包 | **均不存在** | `git ls-remote --tags`；releases/latest → v1.4.5 |
| 已发布最新版 | v1.4.5（4 资产，公开可下） | GitHub Releases |

---

## 二、项目结构

```
Cargo workspace = 13 members
  apps/desktop/src-tauri        Tauri 2.11 桌面壳 + 全部 IPC commands
  crates/domain                 领域模型
  crates/application            发布编排（含 select_public_url）
  crates/task-engine            任务队列
  crates/persistence-sqlite     SQLite + 13 个迁移（migrations/0001..0013）
  crates/credential-store       系统凭证库
  crates/storage-core           存储抽象
  crates/storage-github         GitHub Contents API
  crates/storage-gitee          Gitee API（access_token 走 query ⇒ 必须脱敏）
  crates/storage-opendal        S3 / OSS / COS / WebDAV
  crates/image-processing       变体生成
  crates/workflow-engine        处理链
  crates/plugin-runtime         插件沙箱 + 端点政策
apps/desktop                    Vue 3 + TS + Vite 前端
website/                        Astro 7.3.5 + Starlight 0.42.4 文档站
scripts/                        门禁与验证工具（见第四节）
docs/                           设计文档 + 基线图片
```

依赖锁定三份：`Cargo.lock`、`apps/desktop/package-lock.json`、`website/package-lock.json`（构建后会被 diff 校验不得变动）。

---

## 三、开发条件（环境硬要求）

### 必需
| 工具 | 版本 | 用途 |
| --- | --- | --- |
| Rust | **1.98.1**（`rust-toolchain.toml` 钉死，含 rustfmt） | 编译与格式门 |
| Node | `.node-version` 指定；需 ≥22（部分脚本用全局 WebSocket） | 前端与门禁脚本 |
| Python | **≥3.11**（`validate.py` 用 `tomllib`） | 静态门禁 |
| Tauri CLI | 2.11.x（JS 2.11.1 / CLI 2.11.4；lock family tauri=2.11.5） | 打包 |

### 本机现状与由此产生的纪律（重要）
- **没有 cargo**。⇒ `cargo fmt --check` / `check --workspace --locked` / `test --workspace --locked` **只能在 CI 上验**。历史上因此连猜六轮 rustfmt 列宽失败，最终靠给 CI 加"自证通道"解决。**改 Rust 后不要声称"本地已验"。**
- **Python 陷阱**：PATH 第一个 `python` 是 WindowsApps 执行别名，`spawnSync('python')` 会 ENOENT。须枚举 `where.exe python` 结果、剔别名、要求 ≥3.11。
- **MSYS/Git Bash 陷阱**：反斜杠路径被吞；`taskkill /F` 要写 `//F //PID`；GitHub API 响应直接管进 `python -c` 会在随机偏移炸 JSONDecodeError ⇒ 先 `-o $TEMP/x.json` 再 heredoc 解析。
- **CRLF**：`core.autocrlf=true`，工作树 CRLF / blob LF。吃 LF 的源码扫描断言会在 smudge 后误红。
- **代理**：访问 GitHub 需 `-c http.proxy=http://127.0.0.1:7897`；直连会 000/ERR_CONNECTION_CLOSED。

### 端口
| 端口 | 用途 |
| --- | --- |
| 1420 | Vite dev server（浏览器类门禁的前置，未起则相关 stage 静默 skip） |
| 36677 | 应用内置 Local HTTP API，只绑 127.0.0.1，Bearer token |

---

## 四、验证体系（本项目最强的一面，务必复用）

### 聚合入口
```bash
# 脚本自己定位仓库根；npm 快捷方式定义在 apps/desktop 里
cd apps/desktop && npm run verify:all        # = node ../../scripts/verify_all.mjs
```
**跑之前必须先起 dev server**，否则 9 个浏览器 stage 会 SKIPPED、6 个变异会假红：
```bash
cd apps/desktop && npm run dev               # 占 :1420，另开终端再跑验证
```
> 本轮踩过这个坑：dev server 未起时首跑是 **12 passed / 1 failed / 9 skipped**，
> 那 6 项变异假红（M17/M18/M21/M22/M24/M29，全是 oracle exit 4）**不是代码缺陷**；
> 补上前置后一次转绿，期间未改一行代码。

### 本轮实测：22 stages 全绿（wall 191.8s）
```
静态：validate / check_contracts(69↔6969) / check_user_flow(297) /
      check_docs_site(16) / check_workflow_action_pins(20) /
      check_release_version / check_tauri_dependency_family
形状：verify_shape(65) / theme_face_inventory(22面) / token_policy(15族) / gate-unit(29)
浏览器：gate(3) ab(1) confirm(19) pages(36) links(4) visual(4)
        settings-guard(11) contrast-tier(1917) theme-surfaces(187)
护栏：red-demo(2) mutations(30) ← M1..M31 摘护栏必须变红
```

### 关键脚本
| 文件 | 作用 |
| --- | --- |
| `scripts/check_user_flow.py` | 297 条源码级契约断言（安全/接线/UI 行为），打印 `USERFLOW_CHECKS total=N failed=M` |
| `scripts/verify_guard_mutations.mjs` | M1–M31 变异测试，验证每道护栏有牙 |
| `scripts/verify_dialog_interactions.mjs` | 浏览器实测；含身份门 L1/L2/L3（防"测到旧 checkout 还报 PASS"） |
| `scripts/fingerprint_rows.mjs --patch/--verify` | 承重脚本的 行数/字节/sha256 台账 |
| `scripts/verify_shape.mjs` | UI 形状基线，配 `verify_shape.baseline.json` |

### 门禁纪律（不可破）
1. **新门与违规同笔**：修一个 bug 必须同时加一条会因回退而红的断言。
2. **断言必须有牙**：加完要做变异判别式——制造对应坏状态，门必须红；恢复后不红。**只数出现次数的断言不算牙**（本轮就推翻过一条：把 `safe_ctx` 换成 `to_string()` 后计数不变、门照样 OK，改成逐调用点谓词才咬住）。
3. **承重脚本改动要重登记指纹**：`node scripts/fingerprint_rows.mjs --patch`，随后 `--verify` 必须 rc=0。
4. **基线签字是刻意动作**，不是自动跟随。

---

## 五、本轮相对 v1.4.5 的实质变更（86 commits / 82 files / +1373 −198）

### 用户可感知
1. **应用内自更新**（v1.4.5 完全没有）：检查 → 下载 → SHA256 校验 → 安装。信任边界见 §5.4。
2. **图标换装**：深海青水晶云（`src-tauri/icons/` 50 个文件）。
3. **产品名**：Multi-cloud Publisher → 镜云 / Mirror Cloud。

### 安全修复（四条，均有门禁断言）
| # | 内容 | 一手位置 |
| --- | --- | --- |
| A | **PrimaryWithBackups URL 语义**：旧代码兜底是 `find(|o| o.error.is_none())`，不分 role ⇒ **Mirror 可接管对外链接**。现收敛为 `PublisherCore::select_public_url`，兜底显式限 `role == Backup`，两面单测覆盖 | `crates/application/src/lib.rs:72` |
| B | **Gitee token 泄漏**：每个请求把 `access_token` 放 query，reqwest 错误文本含完整 URL ⇒ token 进任务记录/toast/诊断。现 `without_url()` + `redact()`，服务端响应体也洗 | `crates/storage-gitee/src/lib.rs:33-52,182` |
| C | **Local API 加固**：改为先读头→鉴权→才读 body；按路由 body 预算（64KB / 32MB / 0）；header 10s + body 120s timeout；8 连接 owned permit 上限 | `apps/desktop/src-tauri/src/commands/integrations.rs` |
| D | **端点统一政策**：HTTPS 放行；HTTP 仅 localhost/127.0.0.1/[::1]；**局域网与公网 HTTP 一律拒**。Rust 为最终门（三条建库路径各调一次），UI 只是镜像提示 | `crates/plugin-runtime/src/lib.rs:107`；`commands.rs:807,883,974` |

另：GitHub crate 目前走 `bearer_auth` 头注入、token 不进 URL ⇒ 暂不构成泄漏，但已在门禁里留了一条 **KNOWN GAP** 断言，防止将来有人把 token 挪进 query。

---

## 六、发布门禁状态机（本项目自定的硬性顺序）

规范全文见 `docs/RELEASE_GATE_UPDATER.md`。

```
G0 dev CI 全绿                              ✅
G1 P0-4 信任边界（Rust 自持 PendingUpdate）  ✅ run#236 三关全绿
G2 无 tag 的 RC 构建（workflow_dispatch）    ⛔ 等人工触发
G3 真机升级 E2E（v1.4.5 → v1.4.7 十行保真）  ❌ 未开始
G4 创建一次不可变正式 tag v1.4.7             ❌ 禁止在 G3 前
G5 GitHub Release 成功                       ❌
   ↓ 之后才允许对外宣称"应用内完整自更新"
   （"安全自更新"还需独立签名，门槛更高，措辞分级写在 RELEASE_GATE §措辞）
```

### G1 已实现的信任边界形状
`download_update()` 在 Rust 侧登记 `PendingUpdate{version, canonical_path, expected_sha256, bytes}` → 返回 opaque id 给前端 → `install_update(id)` 由 Rust 自己取记录 → canonicalize → 确认仍在受控 mirror-updates 目录 → **重新读盘重算 SHA256** → 通过才 spawn `/S /NS`。前端无法伪造路径或哈希。

### G3 十行保真矩阵（版本号变了 ≠ 通过）
版本 / SQLite 数据 / 存储配置 / token 与凭证 / 默认目标 / Typora 桥 / 主题与壁纸 / 资产索引 / 插件配置 / 一次全新上传成功。

---

## 七、已知问题与待办

### 阻塞中
1. **G2 需要一次带认证的 `workflow_dispatch`**。这台机器无 gh、无授权 PAT、MCP 无 GitHub 工具、匿名 POST dispatch 得 401、Computer Use 对浏览器 URL 策略中止、Browser Connector 那个实例无网络出口。⇒ 只能人在已登录页面点。约 10 分钟出包（历史实测 6.6–10.4 min）。
2. **Actions 曾整段时间不可见**：因默认分支 `main` 上没有 `.github/workflows/`（API 404）。现已恢复可见（6 条 workflow active），但 **Release Bundle run 计数归零**，历史取证需靠新 run 重建。

### 结构性风险（在档，未修）
| 项 | 事实 | 缓解 |
| --- | --- | --- |
| **迁移只有 up 没有 down** | `ls migrations/*.sql` = 13，down = 0 | 每次 schema 变更前手动备份 `%APPDATA%\dev.multicloud.publisher\publisher.sqlite3` |
| **identifier 不可改** | 现为 `dev.multicloud.publisher`；改了用户数据"看起来没了" | 冻结 |
| **P2-1 remote index 截断** | `storage-github` 的 `list()` 无分页参数、无 complete 标志；GitHub contents API 单目录约 1000 项上限 ⇒ 超量静默少显示。**代码层面成立，但未构造 >1000 文件真实仓库验证过** | 挂账 |
| **P2-2 遗留物清理** | ① `WorkflowsPage.tsx` 未被任何路由引用（`PageKey` 无 workflows），但 `['workflows']` query key 在 5 处有效使用；② GitHub 上有若干 `One-time *` / `Build Windows Preview` 等 workflow 定义不在 dev 树上，其最新成功产物是 9-27 的 v1.4.0 preview，易被误当成可用构建通道 | 先做 inventory 再删 |
| **改名遗留** | 更新器常量仍是 `UPDATE_REPO="159357yangjun/image-hosting-platform"`；`astro.config.mjs` 的 site/base 仍指 `/image-hosting-platform/`。现靠 GitHub 永久重定向工作，若再次改名会断 | 待定 |
| **文档站未上线** | Pages API 404（Source 未设为 GitHub Actions）⇒ release bundle 探测不到教程，会 bake 空 URL 并隐藏在线教程链接 | Settings → Pages |

### 明确不做
- 不移动/复用 v1.4.6 tag（已判污染）。
- 不为绕过 dispatch 而修改 `release.yml` 触发器或造临时 tag。
- 不教用户绕过 SmartScreen/Defender；正确做法是核对 `SHA256SUMS.txt`。

---

## 八、给接手 AI 的操作守则（浓缩自本项目协作约定）

1. **证据优先**：每条指控带一手读数；查不到就写"已查，不是缺陷"；定性结论前先问"我有什么一手证据"。CI 红了先读 annotation/编译器原话，无证据不得沿同一假设连续盲改。
2. **"存在" ≠ "会跑"**：符号存在不等于接线；轨道存在不等于轨道里有东西；代码里有两道闸门不等于这次会通过。
3. **完成时态要与同一条消息里的命令输出同框**，否则写成计划。
4. **发现即修**，修到"根因→修复→门禁复跑→基线签字"四步闭环；中间态不回报。
5. **批准 ≠ 插队**：授权改变的是许可，不是顺序。
6. **临时品同轮删净**；禁递归扫描；删除先问；不动用户环境（代理设置/凭据管理器/注册表/PATH）。
7. **未经点名绝不读取系统凭据**（本项目会话中发生过一次，已被喝止并撤回）。
8. 出包 / push main / 建 tag / 改版本号 / DDL 变更 —— 都需要用户显式点名。

---

## 九、快速上手命令

```bash
# 1. 起前端（浏览器类门禁需要；另开终端继续）
cd apps/desktop && npm ci && npm run dev      # :1420

# 2. 全量验证（脚本自定位仓库根，也可在 apps/desktop 下用 npm run verify:all）
node scripts/verify_all.mjs                   # 期望 22 passed / 0 failed / 0 skipped

# 3. 只跑静态门（秒级）
python scripts/check_user_flow.py                # USERFLOW_CHECKS total=297 failed=0
python scripts/validate.py
python scripts/check_contracts.py

# 4. Rust 侧（本机无 cargo，须在 CI 或有工具链的机器上）
cargo fmt --all -- --check
cargo check --workspace --locked
cargo test --workspace --locked

# 5. 发布链下一步（需人工，见 §7）
#    Actions → Release Bundle → Run workflow → branch: dev
```
