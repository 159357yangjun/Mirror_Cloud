# Changelog

## Unreleased - 2026-09-29（未发版：不改 version、不打 tag，等你批准）

本轮提交：`a8eb977`、`502b25c`、`3c642af`（均在 `dev`，v1.4.4 之后）。

- **发布产物校验器**（`scripts/verify_release_assets.py`）：前三版用一次性片段核对，其中一次正则没匹配上却报了"已验证"。现在三路对账——本机重算、发布的 `SHA256SUMS.txt`、GitHub API 自带的 `assets[].digest`——并校验 tag 版本出现在每个文件名与归档内 `Cargo.toml` / `package.json` / `tauri.conf.json`，以及 `source.zip` 是否恰等于该 tag 的受版本控制树（无构建产物、无凭据型文件名、169 个文本文件按 6 类高信号模式扫零命中）。
- **删除发布链里没人消费的文档构建**：`release.yml` 的 `docs-bundle` 作业构建 `website/dist` 后上传的 artifact 无任何作业下载，它唯一的额外检查（版本一致性）在 `windows-bundle` 已跑；文档站现由 `docs.yml` 构建并发布、`ci.yml` 每次 push 重建。
- **破坏性操作改用应用内确认框**：原先 10 处 `window.confirm`（删除资源、云端删除/移动/改名、批量删除、卸载插件、敏感权限授权、重置 Local API Token、删除存储与多云组）是浏览器外观的原生框，且在 WebView2 中会挂起绘制直到被关闭。`confirmAction` 失败即关闭：关闭、Escape、点遮罩、被新请求取代一律 resolve(false)，`ConfirmDialog` 未挂载时 promise 永不 resolve，因此闸门坏掉只会挡住操作、不会放行删除。

### 本轮验证命令与实际输出

```text
$ for s in validate check_contracts check_user_flow check_workflow_action_pins \
      check_docs_site check_release_version check_tauri_dependency_family; do python scripts/$s.py; done
validate PASS  check_contracts PASS  check_user_flow PASS  check_workflow_action_pins PASS
check_docs_site PASS  check_release_version PASS  check_tauri_dependency_family PASS

$ python scripts/check_user_flow.py | tail -1
User-flow v1.3.5 task/observability/diagnostics hardening: OK | total checks: 143

$ python scripts/verify_release_assets.py --tag v1.4.4 --dir <下载目录> --api api_assets.json --repo .
Release asset verification OK | total checks: 35
      source archive is exactly the tracked tree of v1.4.4 (archive-only [], tree-only [])
      227 tracked files in the archive
      secret scan over 169 text files found nothing ([])

$ npm run build          # apps/desktop，tsc -b && vite build
✓ built in 1.13s
```

守卫做了变异验证：塞回一个 `window.confirm` → FAIL `destructive gates use the in-app dialog…`；摘掉 `<ConfirmDialog />` → FAIL `the confirm dialog is mounted at the app root`；在 release.yml 用 `npm install` → FAIL 锁消费断言。两条旧断言原本把 `window.confirm` 当作"存在确认步骤"的证据（Gallery 确认删除、插件敏感权限），已改为要求 `confirmAction`，插件那条额外要求"用户拒绝即 return"，因此保证强于改前。删除 `docs-bundle` 使旧的 `npm ci >= 2` 计数断言失效，已替换为直接断言三个工作流都不出现 `npm install` / `cargo generate-lockfile`。

### 本轮仍然没有验证的东西

1. **新确认框的视觉与交互**：焦点初始位置、Escape 与遮罩点击的实际行为、长文案换行、与其他弹层（上传对话框 / 图库预览）的 z-index 关系——只过了 `tsc`、`vite build` 和静态断言，没有运行时观察，也没装过应用。**（已被下一节的实测取代：五项全部量过，其中长文案溢出是真缺陷并已修复。）**
2. **教程基址是否真的进了 v1.4.3 / v1.4.4 的包**：NSIS 压缩使二进制搜索无效，解包或安装超出授权；只有间接证据链（Pages 10:47Z 返回 200 → CI 探测步 11:01:46 → 前端构建步 11:10:26）。
3. **`openExternalUrl` 失败时用户零提示**：三处调用点都是 `onClick={() => void openExternalUrl(...)}`（`HelpCenterDialog.tsx:32`、`StorageSetupDialog.tsx:256`、`SettingsPage.tsx:328`），rejection 被吞；本轮只证明了调用点形态，没构造出 openUrl 真失败的场景。可修，未修。**（已被下一节取代：两种失败场景都构造出来了，并已修。）**
4. **`3c642af` 的 CI 结论**：推送成功（代理一度全断、直连重试成功），但记录本条时 API 不可达，尚未读到该次运行的最终结果。**（已填实：`36592371911` / `36593715132` 均 `desktop-check completed / success`，25 步无一非绿。）**
5. **默认分支 `main` 指向另一项目（`# depot`）**：按指令**未执行任何分支操作**，只交方案。关键事实是 `git merge-base --is-ancestor origin/main HEAD` 成立——main 是 dev 的祖先，因此 `git push origin dev:main` 是**纯快进、零提交丢失、不需要 force push**；推荐它而非"只改默认分支指针"（后者仍把 depot 的 README 留在仓库里）。影响面：Dependabot 已显式 `target-branch: dev` 故不受影响；`release.yml` 只认 `v*` tag 故推 main 不会误发版；`ci.yml` 无分支过滤故以后推 main 会跑 CI；外部已分享的 `blob/main/<老文件>` 链接在文件被改名/删除后会 404。

## Unreleased - 2026-09-29 下午（同一轮的第二批：把"无法证明"改成"已证明"）

本轮提交：`534cc15`、`a561161`（`dev`，接在 `a8eb977`、`502b25c`、`3c642af`、`49f7e0c` 之后）。上一批留下的第 1、3、4 条在本批被实测取代，原文保留在下面并逐条标注状态。

### 测量手段

只起前端：`npx vite --port 1420`（**不碰 Rust、不出包、不装任何东西**）。浏览器侧用本机已装的 Edge `--headless=new` + CDP，输入全部走 `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`（可信事件，React 的 `onMouseDown` 才会真的触发），采样前先 `getAnimations().pause()` 冻结入场动画。实测视口 1406×803。

> 中途踩到三个会让结论失真的坑，都记下来：① 会话内置的浏览器连接器那个窗口是 0×0 / `visibilityState: hidden`，同一个 440px 卡片被量成 186.8px——隐藏窗口的几何值不可用，现已做成硬门禁（见下）；② `styles.css` 有 `scroll-behavior: smooth`，`scrollIntoView()` 之后立刻读 `getBoundingClientRect()` 会拿到滚动前的坐标，第一次跑就"点不到"设置页的按钮；③ 用 bash heredoc 写出 `.mjs` 再 `node` 执行时，`'C:\\Program Files (x86)\\...\\msedge.exe'` 的反斜杠被吃掉，`spawn` 报 `ENOENT`——**路径其实是存在的**（同一轮 `ls` 刚列到）。探针脚本里 Windows 路径一律用正斜杠（`C:/Program Files (x86)/...`），不要在 bash 里拼反斜杠。

### 采样门禁（本节的数全部重取过）

上一版这一节里有一条**作废**的数：连接器那个 Chrome 窗口是 `visibilityState: hidden` + `inner/outer/screen = 0×0`，同一个 `max-w-[440px]` 卡片在那里被量成 **186.796875px**。那是伪影，不是布局。这个坑的第三种形态：**不是动画中间帧，而是窗口隐藏时整个布局基准就跳了**——而且隐藏窗口不一定报 0 宽（见下）。

现在探针里 `assertRealViewport(stage)` 是硬前置：`visibilityState !== 'visible'`、`innerWidth <= 0`、`innerHeight <= 0`、`clientWidth/Height <= 0` 任一命中就抛错退出，不拍图、不记数；它在挂载后调用一次，并在**每一次几何采样前**再调用一次（初始焦点、1440 长文案、420×720、640×480、640×480 撑高、吐司共存、平局命中测试、上传对话框各一次），几何采样函数内部还嵌了一道同样条件的断言。

门禁自身演示过红：

```text
$ node scripts/verify_dialog_interactions.mjs gate        # exit 0
control                | expectedFail=false | passed=true  | visible 1406x803
window minimized       | expectedFail=true  | passed=false | VIEWPORT GATE FAILED: visibilityState=hidden
                         但同一时刻 innerWidth=1406 innerHeight=803 clientWidth=1406 hasFocus=false
window restored        | expectedFail=false | passed=true  | visible 1406x803
sawMinimizedReject: true   broken: []
```

**这条演示比预想的更值钱**：窗口最小化时 `innerWidth/innerHeight` 仍然是 1406×803，只有 `visibilityState` 翻成 hidden——也就是说"innerWidth>0 就安全"是错的，**load-bearing 的那一项是 visibility**。诚实记录没做到的两件事：`Emulation.setVisibilityStateOverride` 在这个 Edge 构建里不存在，`setDeviceMetricsOverride` 对 0×0 静默忽略，所以 `innerWidth=0` 那一支在本机**没能重新造出来**，它只有本轮早些时候连接器那次一手读数（hidden / inner [0,0] / client [0,0] / screen [0,0]）作为依据。

### 修前 / 修后逐条对照（真视口，13:00 重采；旧数据作废清单见本节末）

**`534cc15` 长文案溢出**——同一次运行、同一个视口（1406×803 / `visible`）、同一段注入文本（64 位哈希文件名 + 一条不断行 URL），只把 `overflow-wrap` 从 `break-word` 改回 `normal` 来复现修前状态。这样两边只有被测属性在变，比"跑两次"更干净：

| | `overflow-wrap` | `<p>` client / scroll | overflowX | 卡片右边界 | 文字画到 | 超出卡片 | 卡片高 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 修前 | `normal` | 302 / **512** | **210px** | x=923 | **x=1068** | **+145px** | 284 |
| 修后 | `break-word` | 302 / 302 | **0** | x=923 | x=858（内缩 65px） | **0** | 332 |

用户视角：修前那行哈希文件名**从白色卡片里伸出去、压在暗色模糊背景上**（截图 `ab-before-break-words.png`，肉眼一眼可见）；修后收在卡片内，代价是卡片多两行高（284→332）。

**`a561161` 三处教程入口**——每种基址都重启 dev server（只改环境变量，仓库配置未动）后走真实点击，记录实际文本：

| `VITE_DOCS_BASE_URL` | 三处按钮 | 点开新标签 | 应用内实际提示（原文） |
| --- | --- | --- | --- |
| 未设置 | **三处都不渲染**（`getDocsBaseUrl()` 返回 null） | 0 | 无。配置教程面板仍在，文案是「GitHub 配置教程 / 教程内置在应用里，不依赖文档网站。按顺序完成即可。」+ 5 步 |
| 生产值 `https://159357yangjun.github.io/image-hosting-platform` | 「在线文档」×2、「完整调用教程与状态码」 | 3，标题分别是「5 分钟上手 / 本机 HTTP API / 连接 GitHub \| 图床 · Image Hosting Platform」 | **无吐司**（正常路径不被误报，这条是回归防线） |
| 不可达 `https://definitely-not-a-real-docs-host.invalid/…` | 同上三处照常渲染 | 3，标签标题只有裸域名 `definitely-not-a-real-docs-host.invalid`（= 浏览器自己的错误页） | **无吐司** |
| 畸形 `not a url` | 三处照常渲染（按钮不校验值） | 0 | 三处各一条：**「打开链接失败：TypeError: Failed to construct 'URL': Invalid URL」** |
| 非 http `ftp://docs.example.invalid/base` | 三处照常渲染 | 0 | 三处各一条：**「打开链接失败：Error: 只允许打开 http/https 外部地址」** |

**能不能区分"网络不可达"与"协议被策略拦下"：能，但不对称。** 协议被拦 / URL 畸形 → 不开标签 + 明确吐司；网络不可达 → **开标签且没有任何应用内提示**，与"打开成功"在 UI 上完全同形。这不是我漏修：`window.open` 只告诉你有没有把窗口交出去，页面加载结果属于另一个浏览进程，`noopener` 之下更拿不到句柄。**所以这条修复覆盖的是"我们自己知道失败"的那两类，不覆盖"远端挂了"。** 远端不可达目前唯一的缓解是那句「教程内置在应用里，不依赖文档网站」——5 步内置教程与在线教程是两条独立供给。

**本节作废的旧数据**（来自会话内置连接器那个 `visibilityState: hidden` + `inner/outer/screen = 0×0` 的窗口，只此一条几何值，其余属性读数是有效的）：

- `dlgWidth: 186.796875` —— **作废**，0×0 视口下 `max-w-[440px]` 的伪影；同一次读数里的 `dialogRect: {}`（全 0）一并作废。
- 同一次读数里的 `overlayZ: "95"`、`overlayPosition: "fixed"`、`sectionMaxWidth: "440px"`、`pWhiteSpace: "pre-line"`、`activeElementText: "取消"`、`focusIsCancel: true` 是**属性/文本**读数，不依赖视口，保留；且这些量后来都在门禁下重取过一遍（见上表与 `report-confirm.json`）。
- 本轮报告里**没有任何一个数字**取自 hidden 窗口：`210 / 145 / 302 / 512 / 440 / 332 / 284 / 952 / 95 / 70 / 50 / 80 / 90 / 472` 全部来自门禁放行后的 headless Edge（`visible`，1406×803，或显式 `setDeviceMetricsOverride` 的 420×720 / 640×480）。



### 确认框：五件事的实测值（原第 1 条，从"无法证明"移出；每一项都在真视口下取数）

| 问的 | 实测（视口 1406×803，`visible`） |
| --- | --- |
| 初始焦点 | `document.activeElement.textContent === '取消'`，`focusIsCancel: true`、`focusIsConfirm: false`。追加测了 Enter：焦点在取消上时回车**关闭且不执行**破坏性动作。 |
| Escape | 关闭。关闭后设置页没有出现"操作继续执行"才会产生的错误块，页面错误日志为空 → 说明 resolve(false) 走通、`await` 后面的分支没跑。 |
| 点遮罩 | 在 (8,8) 按下即关闭（`onMouseDown`，不是 `onClick`）；在卡片标题上按下**不**关闭（`stopPropagation` 生效）；右上角 X 关闭。 |
| 长文案 | 卡片宽度恒 440px 不增长。**修复前**：`<p>` 可视宽 302px、`scrollWidth 550` → overflowX **248px**，文字画到遮罩与模糊背景上（视口 1406×803 与 640×480 各一份，均有截图）。**修复后**（标题与正文加 `break-words`）：1440 / 420×720 / 640×480 三种视口下 overflowX 全部 **0**。 |
| z-index | 确认层 computed `z-index: 95`、`position: fixed`；祖先链只有它自己因 `backdrop-filter` 生成层叠上下文，`main` 与 `app-shell-root` 都是 `static`/`z-auto` → 与其他弹层在同一根上下文直接比大小：UploadDialog `50`、StorageBrowser 层 `70`、其预览 `80`、HelpCenter / ThemePanel / 图库预览 `90`、ToastViewport `70`。**真实共存命中测试**（重跑到成功为止）：确认框开着的同时让插件/任务路由各抛 4 条吐司，`elementFromPoint(吐司中心)` 落在确认层内（`isToastOrChild:false, isConfirmOrChild:true`）→ 95 盖住 70。ConfirmDialog 是 `main` 的最后一个子节点（有吐司时 index 2 of 3，无吐司时 1 of 2）。UploadDialog 与确认框无法真共存（它的遮罩吞掉侧栏点击），"平局"改用同 class 的 `fixed inset-0 z-[95]` 合成节点测：**后挂载者命中**（`hitIsSynth:true`、`confirmOrderVsSynth:-1`）→ `GalleryPage.tsx:364` 那个同为 95 的路径对话框输给 `App.tsx:53` 最后挂载的 ConfirmDialog；图库预览 90 < 95 恒在下方。 |

窄视口的两条要分清可达性：**420×720 低于 `tauri.conf.json` 的 `minWidth: 640`**，那里卡片 440 + 左右 16 内边距 = 472 > 420，确认按钮 `confirmFullyVisible: false` 被裁出视口——**产品里到不了这个宽度**，只作为 CSS 契约记录；640×480（真实下限）下同一份长文案 overflowX 0、卡片 440×472、按钮完整可见。



纯浏览器不崩：7 条路由逐个可信点击后 `main h1` 都正确切换、`#root` 未卸载、无 React 崩溃；缺 Tauri 运行时的表现是吐司「数据加载失败：TypeError: Cannot read properties of undefined (reading 'invoke')」。**这条只在非 Tauri 运行时出现，装包用户看不到，因此按 harness 事实记录、不算产品缺陷。**

### 一条命令跑完整条链：`cd apps/desktop && npm run verify:all`

七个入口记不住，实际发生的就是"只跑一个就当全绿"。`scripts/verify_all.mjs` 按固定顺序跑 12 道，每道打自己的计数，任何一道非 0 就整体非 0：

```text
1-7   validate / check_contracts / check_user_flow / check_docs_site /
      check_workflow_action_pins / check_release_version / check_tauri_dependency_family
8     gate-unit      视口门禁判定（纯 predicate，不开浏览器）
9     gate           视口门禁对真最小化窗口
10    ab             确认框溢出的成对读数
11    red-demo       身份门禁拒绝两种冒牌 server
12    mutations      证明上面每一道都会报警（放最后，因为它会临时改受版本控制的文件）
```

退出码：`0` 全过；`2` 有道失败（**每道的所有 FAIL 行在它自己那一段就原样打出来**，不等汇总，避免"最后一道遮住前一道"）；`3` 没有失败但有空跑——`gate`/`ab` 需要 dev server，起不来时报 **SKIPPED 而不是 PASSED**，所以"没起服务"永远刷不出绿色。本机实测：

```text
$ cd apps/desktop && npm run verify:all ; echo $?
verify:all | 12 stages: 12 passed, 0 failed, 0 skipped
0
```

聚合层的红（改指纹表一个字符，`verify_all.mjs` 那行哈希末位 2→3）：

```text
$ cd apps/desktop && npm run verify:all ; echo $?
    FAIL fingerprint row for scripts/verify_all.mjs matches its HEAD blob (table ...dbbc363; blob ...dbbc362)
    FAIL fingerprint row for scripts/verify_all.mjs matches the working copy (table ...dbbc363; on disk ...dbbc362)
FAILED  check_user_flow  USERFLOW_CHECKS total=183 failed=2
FAILED  mutations  count: NOT REPORTED by this stage - treat as a harness gap, not a pass
verify:all | 12 stages: 10 passed, 2 failed, 0 skipped
2
$ cp /tmp/cl.good CHANGELOG.md && npm run verify:all ; echo $?
verify:all | 12 stages: 12 passed, 0 failed, 0 skipped
0
```

`mutations` 那道一起红是**设计**：CHANGELOG 是它的变异目标之一，脏树时它拒绝执行，不静默跳过。哈希这次打满 64 位，因为十二位截断曾让"末位改一个字符"的两边显示成同一个值。

**为什么又改了一次 `apps/desktop/package.json`**：只加 `verify:all` 一个 scripts 键（`node ../../scripts/verify_all.mjs`）。仍然没有新依赖、没动 `version`/`dependencies`/`devDependencies`、没动 lock、没跑 `npm install`。这条与上一条 `verify:dialog` 同理：仓库里没有根 `package.json`，聚合入口挂在已有的桌面清单上。

**聚合器自己踩的两个坑**（都是"看起来在检查，其实检查的是散文"）：① 解释器探测——`spawnSync('python')` 在本机 ENOENT，因为 PATH 第一个 `python` 是 WindowsApps 执行别名，CreateProcess 过不去，而 `where.exe python` 能列出真正的 `D:/anaconda/python.exe`；改成枚举 `where.exe` 结果、剔掉别名、并要求 ≥3.11（`validate.py` 用 `tomllib`，挑到 3.10 会让三道守卫假红）。② "oracle 到底跑没跑"的判据原来是输出里有没有 `total checks:` 这句人话——我把横幅改掉之后它只在成功路径存在，于是 12 道变异里有 11 道被误判成"oracle 沉默"。现在检查器无论成败都先打一行机器可读的 `USERFLOW_CHECKS total=N failed=M`。

### 横幅里的版本标号（你问的第 2 条）

确认过：`v1.3.5` **不是**检查器自己的版本号，也不是应用版本，而是"这一批断言是在应用 v1.3.5 那轮加进来的"分节标号，且从 1.4.0 起再没跟着动过 —— 属于旧残留被当成现状读。改法：分节行统一成 `user-flow section [v1.3.4 lifecycle/application/task hardening] | checks so far: N`（明确是进度），结论文行去掉版本字样，改成 `user-flow checker: OK | total checks: 183`，失败时 `user-flow checker FAILED: 2 of 183 check(s)`。现在同一屏上只剩应用版本一个数字（`Release version consistent: 1.4.4`）。

### 三处调用点与两条踩坑记录

三处 `void` 调用点的确切位置：`HelpCenterDialog.tsx:32`（经 `AppShell.tsx:114` 注入）、`SettingsPage.tsx:328`、`StorageSetupDialog.tsx:256`（后者要先在云端页展开"配置教程"面板才出现）；同一批里另外 6 处是 `GalleryPage.tsx:321/342/388` 与 `StorageBrowserDialog.tsx:149/169/183` 的"浏览器打开"，它们共用同一个包装函数。逐基址的实际提示文本见上面那张表。

- 我第一版顺手加的 `if (!window.open(...)) throw new Error('浏览器拦截了新窗口…')` **是错的**：规范规定带 `noopener` 时 `window.open` 一律返回 `null`，实测三个本来能正常打开的链接全部误报成"被拦截"（那一次的吐司原文：「打开链接失败：Error: 浏览器拦截了新窗口，请允许弹出窗口后重试」，出现在明明已经开好的标签旁边）。已撤掉，并在注释里写明浏览器分支只能报告真正的 rejection。
- 丢弃 promise 这件事本身的红→绿是在同一页面里对照测的（等吐司栈清空后各调一次）：`void openExternalUrl('not a url…')` → `toastsAfterVoidCall: 0`，只留一条 `Uncaught (in promise)` 的页面错误；`openExternalUrlOrReport(同一个值)` → `toastsAfterWrapperCall: 1`，文本就是表里那条 TypeError。
- 诚实边界：`popup 被拦`这一种失败在浏览器分支仍**不可检测**（保留 `noopener` 比一个诊断信号更值钱）；Tauri 分支的 `openUrl` rejection 现在会被报告，但那条分支需要 Rust 运行时，本机没跑。

### 测具已进仓：`scripts/verify_dialog_interactions.mjs`

上面所有数字都出自这个探针。它此前只存在于会话目录（`cdp-dialog-probe.mjs`，34,750 字节 / 12:31），而仓库里已经有 11 个 `scripts/*` 检查器——**修搞出来了，别人重跑不了验证，会话目录一清测具就没了**。现在它、它的入口、以及"认证它的检查器"的指纹都在仓里。

**指纹表（机器核对，见本节末；改完这些文件而没更新这张表，`check_user_flow.py` 直接红）**

| 文件 | 行数 | 字节 | sha256 | 基线通过项数 | 证明它报过警的命令 |
| --- | --- | --- | --- | --- | --- |
| `scripts/verify_all.mjs` | 360 | 26,714 | `720d8d2eebbcaf2578ef50c19a4787f879b3db80a399274c790f40cbeeeb55aa` | 18 stages：七道静态守卫 + 两份台账（`theme_face_inventory`、`verify_shape`）+ 七个测具模式（新增 `contrast-tier`、`theme-surfaces`）+ `red-demo` + 变异套件；`layout` 仍不接入，原因见其注释 | `cd apps/desktop && npm run verify:all`（把表里任一哈希改一个字符，它会以非 0 退出并点名那一行）；`node scripts/verify_all.mjs selftest`（往 stage 表里粘一行重复名字，必须被点名） |
| `scripts/verify_dialog_interactions.mjs` | 3796 | 312,097 | `b0bd0c56581c5dfbc591d6f18a9d3468cdf95ea0ab804b94307a5161e1b2ae36` | `gate-unit` 29/29（viewport 6 + coverage 5 + doc-table 8 + **staleness 10**，后者含植入 470px 位移与"缺盒子必须回 null"）；`ab` `deltaOverflowX: 210`；identity 75 个导出全中；`visual` `VISUAL_GATE total=4 failed=0`；`layout` `checked=21 matched=21 skipped=0`，七道控制全过（含逐轴 CONTROL-F）；`theme-surfaces` 控制能区分跟主题/写死 | `node scripts/verify_dialog_interactions.mjs red-demo`（两次 rc=2）；`node scripts/verify_guard_mutations.mjs M1 M2 M3 M4 M5`；`visual` 对 `ab13df8` 的旧弹窗实测 rc=1 并点名 4 条回归；`node scripts/verify_guard_mutations.mjs M17`；`node scripts/verify_guard_mutations.mjs M18`；`node scripts/verify_guard_mutations.mjs M26 M27`（把逐元素比较循环拔空、把"比不了"当"没动"，两条都必须被 `gate-unit` 点名） |
| `scripts/verify_guard_mutations.mjs` | 371 | 29,915 | `da940809514f6f31607b864a132d43a3b08160088f2639961665dc6eaa7a116d` | 24 个变异（M1–M24），每个都必须被它指定的那台 oracle 抓到；本轮 M18/M19/M21/M22/M23/M24 的逐条读数见下面"本轮末次运行读数"一节 | 它本身就是报警器；表未更新时 `node scripts/verify_guard_mutations.mjs M11` 报 rc=2 |
| `scripts/verify_probes.mjs`（三段页面侧探针，纯字符串导出、零控制流） | 770 | 47,295 | `5c4466e2c831de43b533063e19127d934e0b70747e9eb3459570ce63d827b8b7` | 被 harness 的三个 evaluate 直接消费；本模块自身不含可执行逻辑 |
  它本身不能单独报红（没有断言），所以红演示挂在 harness 上：`node scripts/verify_guard_mutations.mjs M20`
| `scripts/__fixtures__/impostor_dev_server.mjs` | 76 | 3,887 | `e6e9b182585b7ece6b8811d06ab67412d90f6c23a7404633c8a22c91590b6fc1` | 两种模式各自只触发预期的那一层（other-app→L1+L2；stale-source→仅 L3） | `node scripts/verify_dialog_interactions.mjs red-demo` |
| `scripts/check_user_flow.py`（认证上面四个的那份检查器，同址在 `scripts/`） | 923 | 74,732 | `a5df632def8491895d415993464a1515c3566dcb2db90421bc85e6160216df99` | `USERFLOW_CHECKS total=222 failed=0`（落盘后；未提交时它必然报 10 条"HEAD blob 里没有这个文件"，见本节末） | `node scripts/verify_guard_mutations.mjs M6 M7 M8 M9 M10 M11 M12 M13 M14 M15 M16 M19 M20` |
| `scripts/theme_token_census.mjs`（主题 token 普查 + 口径断言：族内声明方式必须一致） | 148 | 8,483 | `4fd961d1cb1fea90d46a879c9db8c1561ddbcded15733bddfaecbcf4b82e2968` | `TOKEN_POLICY_SELFTEST cases=5 failed=0` + `TOKEN_POLICY families=13 breaches=0` | 立口径那一轮它当场咬到 `--accent-solid`（exit 1）；把 `--accent-solid` 从 :root 删掉再 `--verify` 就会重新红 |
| `scripts/__fixtures__/hanging_stage.mjs`（永不结束的假 stage，自己再 spawn 一个孙进程：`timeout-demo` 的靶子） | 20 | 1,155 | `16d702ee2dda998f2e7538d739f82d61656b075194ada2cb87fa014a80cf509a` | 只被 `verify_all.mjs timeout-demo` 生成，没有任何门读它 | `node scripts/verify_all.mjs timeout-demo`（六例，含"不调 taskkill 也不留孤儿"的消融与"正常结束不得报成 timeout"的负对照） |
| `scripts/verify_modes.mjs`（模式名单 + 锚定的 dispatch 正则，纯数据、零控制流；runner 与 shape 台账读同一份） | 36 | 1,449 | `0b250811609418512489e3de9ffb70c1dbe24c7adc2d0b6cfe8da739bc6c2f87` | 每次启动三方核对：声明↔已派发用法块已文档化（15 个模式） | `node scripts/verify_guard_mutations.mjs M24`（把启动拒绝拔掉的变异，必须仍红） |
| `scripts/verify_shape.mjs`（拆分对账台账：模式集合双向差、总行/字节、六族决策点数、以及"拆出去的探针是否仍逐字节等于拆之前"） | 313 | 18,455 | `cf453e6bd75acf90ab59a0780968fc52c4083da36b325de19a69a82524b7aa6c` | `SHAPE_SELFTEST cases=6 failed=0` + `SPLIT_SHAPE OK checked=17 failed=0` | 它自己先跑 6 例植入式夹具（改一个字节、删一个模式、把 extraction 弄瞎），任一抓不到就 exit 2；`--snapshot` 无 `--reason` 直接拒绝 |
| `scripts/verify_shape.baseline.json`（上一行那本台账**签过的基线**：文件清单、总行/字节、六族决策点数、模式集合、extraction 长度与 `--snapshot --reason` 的原文） | 143 | 3,199 | `7102798cfccc8d29ca34fd317f3149683e5e63a155eca4608fa9f650ee548ac6` | `SPLIT_SHAPE OK checked=17 failed=0`（它变了而代码没变 ⇒ 要么有人重签，要么有人偷改） | 它自己不会报红，是 `verify_shape.mjs --verify` 报红；本轮把它纳入指纹表，是因为"改基线"这件事此前只存在于 JSON 被碰过这一种痕迹里 |
| `scripts/theme_face_inventory.mjs`（逐面三档清单的生成器，`docs/VISUAL_BASELINE.md` 4.1 那张表由它核对） | 204 | 12,424 | `8eee9bedb20ce49f30d61f30f23b69b9e92da624c1564709fa9e1208a6c702b9` | `THEME_FACE_VERIFY faces=23 docLines=25 mismatch=0`（`faces=23` = **22 个面 + 1 合计行**，2026-10-01 起该行把拆解一并印出，比对定义未改） | `node scripts/theme_face_inventory.mjs --selftest`（7 例：自己的输出干净、改一个数字恰好报 1 行、截断要报、行号要点对，加 **CRLF 整表必须干净 / 开头一个空行必须干净 / 混合行尾下改一个数字仍报 1 行**；抓不到 exit 2。后三例是 2026-10-01 那次"内容一致却 25 行全报红"的现场，见十六节） |

**这张表现在是断言，不是纪律**：`check_user_flow.py` 解析上面每一行，对每个文件重算 `git show HEAD:<path>` 的行数/字节/sha256 并逐项比对，还断言"表里的行集合 == 磁盘上成员集合"，成员由四条规则导出而不是由名字导出：`scripts/verify_*.mjs`、`scripts/__fixtures__/*.mjs`、`verify_all.mjs` 里被当作 stage 引用的 `scripts/*.mjs`、以及 `scripts/*.baseline.json`（外加 `check_user_flow.py` 自己）。所以：新加一个测具忘了上表 → 红；改了测具忘了更新表 → 红；哈希对不上 → 红，并附一句"该文件另有未提交改动"。上一版这张表就是**手写漂移了一笔提交**（记 965 行 / `9341e4ba…`，实际 1119 行 / `d9572a31…`），而它上面那句"改完必须回来更新"正是被漂移的那句——所以规则本身不解决问题，断言才解决。`.baseline.json` 这一类是本轮补的：`verify_shape.baseline.json` 早就在仓里、早就被 `--snapshot` 重签过十次，而指纹表按名字匹配 `.mjs` 一直没看见它——**门禁自己的输入清单漏了门禁签过的那张纸**。

**哈希比的是 `git show HEAD:<path>` 的 blob，不是工作区**——`core.autocrlf=true` 下工作区是 CRLF、库里是 LF，拿工作区算出的哈希别人复现不出来（实测：文件干净时两者逐字节相等，所以提交前可先用"工作区 CRLF→LF 归一化"预计算，落盘后必须相等）。


### 本批自曝的一次损坏：CHANGELOG 被我自己的脚本改坏过

写上面这张表时，我用 `readFileSync(path,'latin1')` 读、`writeFileSync(path, s)`（默认 utf8）写，把整份 CHANGELOG 的每个中文字符变成两字节 mojibake。文件仍然"能按 UTF-8 解析"，所以任何 parse 检查都是绿的——`readFileSync('CHANGELOG.md','utf8')` 在损坏状态下不报错，这一点我实测过。

- 发现方式：`sed` 打印第 188 行时看到 `æ¬æ¹ä¸¤ç¬`，用 `max code point = 239` 确认整份文件的 CJK 全部退化到 Latin-1 区。
- 修复：`Buffer.from(text,'latin1').toString('utf8')` 反向还原，先断言 `max code point ≤ 255` 且还原后 U+FFFD 计数为 0 才落盘；再与损坏前一笔提交 `0bb8dfe` 逐行 diff，确认差异只有本批新增的 72 行、删除 29 行，没有第二处损伤。
- 补的守卫：`CHANGELOG.md still holds real CJK code points (not double-encoded)`——判据是"存在码点 > U+00FF"，因为真中文必然越界，而双重编码产物全部 ≤255。**演示过红**：把损坏过程原地重放一次 → `FAIL CHANGELOG.md still holds real CJK code points`，同时刻 `readFileSync utf8` 不报错（证明只加 parse 检查不够）；还原后 `rc=0`、`diff -q` 字节一致。
- 教训写进测具规范：**读一个含中文的文件，绝不用 `latin1`；要改行尾就用二进制读写（`readFileSync` 不传编码 → `Buffer` → 替换 → `writeFileSync(buf)`）。**


- **依赖：零第三方包。** 只用 `node:child_process` + `node:fs`，加上 Node 22+ 自带的全局 `fetch` / `WebSocket`。`check_user_flow.py` 会解析它的 import 列表，出现任何非 `node:` 前缀就 FAIL。
- **入口**：`cd apps/desktop && npm run verify:dialog <mode>`（`verify:dialog` 就是 `node ../../scripts/verify_dialog_interactions.mjs`）。模式 `confirm | ab | gate | gate-unit | links | pages | external`，`--help` 打印同一份说明。这条接线也被断言钉住：`the harness is reachable from an npm script entry`。
- **为什么改了 `apps/desktop/package.json`（不是依赖例外登记）**：仓库里**没有根 `package.json`**（`git ls-files package.json` 返回 0 个），所以"接进根 package.json"这个机制不存在；在一个 Rust workspace 根上新建一个没有 lock 的 npm 清单，正好和这个仓库"只从已提交的 lock 安装"的纪律相反，所以入口挂在**已有**的 `apps/desktop/package.json` 上，且**只加了一个 `scripts` 键**——`name` / `private` / `version` / `type` / `dependencies` / `devDependencies` 一字未动，`package-lock.json` 未改，未跑过 `npm install`。仓库里本来就没有"配置例外登记"这类文件，这句话因此写在这里而不是别处。
- **输出位置**：截图与 JSON 默认落 `%TEMP%/image-hosting-probes/<日期>/`——不写进仓库，也不写主目录根；dev server 没起就直接 `rc=4` 并打印该敲的那条命令；浏览器路径自动探测 Edge(x86)→Edge→Chrome，`--edge` 可覆盖。
- **从仓内路径复跑（与会话目录版逐位相同）**：`gate` → `rc=0`、`sawMinimizedReject: true`；`ab` → `210 / 145 / 302 / 512 / 923 / 1068 / 858 / 332 / 284`；`confirm` → 焦点 `取消`、Escape/遮罩/X/Enter 全关、卡片内按下不关、overflowX 在 1440 / 420×720 / 640×480 三种视口均为 0、z 层级 95 > 70 > 50。

### 门禁拦下过什么（不是自述，是被变异逼出来的）

`gate-unit` 把门禁判定抽成纯函数后单独喂读数，**每个拒绝用例只破坏一个条件并指名要回哪一子句**：

```text
$ npm run --silent verify:dialog gate-unit          rc=0
OK   live headless viewport                -> accepted
OK   hidden, sizes healthy                 -> rejected: visibilityState=hidden (needs "visible")
OK   innerWidth 0, everything else healthy  -> rejected: innerWidth=0 (needs > 0)
OK   innerHeight 0, everything else healthy -> rejected: innerHeight=0 (needs > 0)
OK   clientWidth 0, everything else healthy -> rejected: client=0x803
OK   recorded connector reading (hidden + 0x0) -> rejected: 四条全中
Viewport gate unit check: 6/6 correct
```

**这里先出过一次假绿灯，是变异试出来的**：第一版用例把 `innerWidth` 和 `clientWidth` 一起设成 0，于是**删掉 `innerWidth` 那一整条子句后仍然 6/5→5/6 全过**（`client=0x…` 替它把页面上去了）。改成"每例只坏一项 + 必须指名返回"之后，五条变异各自变红：

```text
M1 删 innerWidth 子句   → rc=1  FAIL innerWidth 0, everything else healthy -> accepted      (5/6)
M2 删 visibility 子句   → rc=1  FAIL hidden, sizes healthy -> accepted; FAIL recorded …     (4/6)
M3 删 innerHeight 子句  → rc=1  FAIL innerHeight 0, everything else healthy -> accepted     (5/6)
M4 删 client 子句       → rc=1  FAIL clientWidth 0, everything else healthy -> accepted     (5/6)
M5 判定恒过             → rc=1  FAIL 五条全被 accepted                                      (1/6)
M6 摘掉 npm 入口        → rc=1  FAIL the harness is reachable from an npm script entry
M7 把 CHANGELOG 双重编码 → rc=1  FAIL CHANGELOG.md still holds real CJK code points (not double-encoded)
                          同一刻 readFileSync(...,'utf8') 不报错 —— 只做 parse 检查抓不到这类损坏
M8 摘掉身份门禁函数        → rc=1  FAIL the harness verifies it is measuring this project
M9 失败改成 finish(2) 不抛 → rc=1  FAIL an identity mismatch exits as a harness fault, not a pass or a regression
M10 把 type/interface 加回导出正则 → rc=1  FAIL the export comparison ignores type exports that the TS transform erases
每次改完立即还原并 diff -q 确认字节一致；baseline 与 restored 均 rc=0。
```

真浏览器侧的端到端拦截（`gate` 模式，`Browser.setWindowBounds minimized`）：`visibilityState` 翻成 `hidden` 而 `innerWidth/innerHeight` **仍是 1406×803**，门禁照样抛错退出——所以"尺寸>0 就安全"是错的。`innerWidth=0` 那一支**本机无法在活页面上复现**（`setDeviceMetricsOverride` 忽略 0，最小化窗口保留旧尺寸），它由上面 `gate-unit` 的第 3、6 例覆盖，输入是本轮连接器实际报过的读数。**这是等价物的边界，别当端到端证据。**

守卫计数：`check_user_flow.py` 143 → 150 → 154 → 155 → 156 → **159**（本批 +3 条身份门禁断言）。

### 身份门禁：指纹钉得住"文档与测具同版本"，钉不住"测具跑的是当前代码"

上面那张表只保证测具文件本身没被换过。它**不保证 1420 端口上跑的是这棵树**——旧 commit 的 dev server 还挂着，测出来的就是旧代码，而且照样报 PASS。这台机器有前科：另一套回归脚本硬编码 `5173`，撞上别的项目长期占用，15 页全报"未渲染"仍然 rc=0。所以采样前加三道，全部**从仓库现读、不写死常量**（否则会和被测代码一起漂移）：

- **L1** `document.title` 必须等于磁盘 `apps/desktop/index.html` 里的 `<title>`；
- **L2** dev server 返回的 `/package.json` 必须与工作区**逐字节相同**（Vite 对这个路径是原样透传的）——这一条专抓"同一个应用、另一个 checkout/另一个 commit"；
- **L3** 磁盘 `src/lib/desktop.ts` 里每个**值导出**名都必须出现在 server 返回的模块文本里——这一条专抓"package.json 没变但源码是旧的"。

不匹配就 **`throw` 并由 `main().catch` 退出码 2**：既不算通过也不算回归。退出码表已写进测具头部注释（0 测成 / 1 断言真红或崩 / 2 harness 故障 / 3 找不到浏览器 / 4 dev server 不可达）。

红绿两条实输出（红用 `node:http` 临时起的假 server 顶在 1431/1432 端口，脚本放在仓库外，跑完删）：

```text
$ node scripts/verify_dialog_interactions.mjs ab --app http://127.0.0.1:1431/   # 另一个项目占端口
rc=2  PROJECT IDENTITY GATE FAILED - refusing to measure. Exit 2 means harness fault...
        L2 served /package.json differs from the working tree (different checkout or app)
        L1 document.title is "Some Other App", index.html says "图床 | Image Hosting Platform"

$ node scripts/verify_dialog_interactions.mjs ab --app http://127.0.0.1:1432/   # 同标题同 package.json，源码是旧的
rc=2  PROJECT IDENTITY GATE FAILED - refusing to measure. ...
        L3 served /src/lib/desktop.ts is missing 1 export(s) present on disk: openExternalUrlOrReport

$ node scripts/verify_dialog_interactions.mjs ab                                # 真 dev server
rc=0  IDENTITY   {"title":"图床 | Image Hosting Platform","packageJsonMatches":true,"exportsChecked":75,"exportsMissing":0}
      PROVENANCE {"headCommitUnderTest":"bd9c06b","desktopPackageVersion":"1.4.4", ...}
      "deltaOverflowX": 210
```

L3 那条红是**独立**抓到的：假 server 的标题和 `package.json` 都跟真的一模一样，只有模块少了被验修复的那个导出。

**这两条红之前，门禁自己先错过两次，都记下来：**
1. 第一版把 `export interface` / `export type` 也算进比较，于是对着**正确的** dev server 报 `missing 1 export: RemoteIndexSyncResult`——TS transform 会把类型擦掉，服务端的 JS 里永远不可能有它。改成只比值导出（`function|const|class|enum`）。这条断言现在被 `the export comparison ignores type exports that the TS transform erases` 钉住，把 `type|interface` 加回去就红（M10）。
2. 第一版失败时调 `finish(2)`，而 `finish` 是 `setTimeout(process.exit, 300)`——**控制流继续往下走**，于是同一次运行先打印 `PROJECT IDENTITY GATE FAILED`，紧接着又打印一行 `"packageJsonMatches":true` 的成功 IDENTITY。等于门禁报了故障还顺手伪造通过证据。改成 `throw`（带 `identityFault` 标记 → 退出码 2），M9 把 `throw` 换回 `finish(2)` 就红。

**测具与被测之间的版本链还剩哪环没闭上**：应用里**没有构建期版本标记**，Vite 又是按需读盘，所以 L2/L3 证明的是"server 的根目录 = 当前工作树"，而**不是**"这个 dev server 是在 `bd9c06b` 启动的"。报告里 `headCommitUnderTest` 取自我本地 `git rev-parse --short HEAD`，不是应用自报——想真正闭死这一环，得让应用暴露一个构建期 commit（新配置项，超出本轮范围，记为待批）。




### 这张表第一次真的报警（原始输出，非转述）

要求是"改一个字节、不更新表 → 必须红"。用一行**只加了一个空格**的改动做（行数不变，所以只有哈希能抓到）：

```text
$ python - <<'PY'   # 给 fixture 的注释行末尾加一个空格，表不动
$ git diff --numstat
1       1       scripts/__fixtures__/impostor_dev_server.mjs

$ python scripts/check_user_flow.py ; echo $?
FAIL fingerprint row for scripts/__fixtures__/impostor_dev_server.mjs matches the file (table 76L/3897B/d54d83cb52a1; working copy 76L/3898B/06958e44cb61)
User-flow contract FAILED: 1 of 177 check(s)
1                                     ← 非 0 退出码

$ cp /tmp/fx.orig scripts/__fixtures__/impostor_dev_server.mjs
$ git diff HEAD | wc -l ; 0                       ← 还原是字节级的
$ git diff HEAD --numstat | wc -l ; 0
$ python scripts/check_user_flow.py ; echo $?
User-flow v1.3.5 ... OK | total checks: 177
0
```

同一件事也做成了可重跑：`node scripts/verify_guard_mutations.mjs M11` 就是这一字节，跑完自己还原。

**为了走到这一步，又挖出两个我自己造的坑**（都属于"守卫被自己的测试数据喂绿/喂红"这一类）：

1. **只比 HEAD blob 不够**：第一版指纹断言只比 `git show HEAD:<path>`，于是**未提交**的一字节改动照样绿——而漂移恰恰发生在提交之前。现在分两半各自比：HEAD blob（别人 clone 后能复现的那份）与工作区（把没提交的漂移也抓住），失败消息里点名是哪一半不一致。
2. **依赖扫描被自己的测试数据毒了**：`re.findall(r"from '([^']+)'")` 不认行首，M12 那条变异为了演示"第三方 import 会被判红"，字面量里写了 `import chalk from 'chalk'`——结果**含这张表的文件**被扫出 `chalk`，依赖断言假红。改成只匹配行首 `import … from '…'`。这条与"mutation 表不能放在被同一文件子串断言的测具里"是同一个失效形状，只是这次是扫描器扫到了自己的说明书。

### 测具链现在自带的三条重跑命令

```text
node scripts/verify_dialog_interactions.mjs gate-unit   # 视口门禁 6/6（纯 predicate，不开浏览器）
node scripts/verify_dialog_interactions.mjs red-demo    # 身份门禁 2/2 次 rc=2（真起 headless Edge）
node scripts/verify_guard_mutations.mjs                 # 12/12 变异都被对应 oracle 抓到，跑完树干净
```

本轮实测：`red-demo` → `2/2 alarms reproduced`、两个子进程 `exit=2 (want 2)`；`verify_guard_mutations` → `12/12 alarms reproduced | interpreter: py -3 | tree restored: clean`，退出码 0。



### 本轮故意放弃的选项（写清楚"放弃 X，因为 Y"，别只写做了什么）

1. **放弃把 `mutate` 做成测具自带模式**（一开始就是这么写的）——因为测具的守卫断言是**子串匹配**，而 mutation 表的字面量里就含那些子串：`from: 'async function assertProjectIdentity()'` 让"这个函数必须存在"的断言在函数被改名后**仍然绿**。已实测到：M8/M9/M10 在表内联时 exit 0。改成独立文件 `scripts/verify_guard_mutations.mjs`，并加了两条断言钉住这个不变式（测具里不得出现 mutation 表、runner 不得变异自己）。
2. **放弃"根 package.json 加测试入口"**（你最初给的机制）——`git ls-files package.json` 返回 0，这个仓根本没有根清单；在 Rust workspace 根上新建一个没有 lock 的 npm 清单，与"只从已提交 lock 安装"的既有纪律相反。入口挂在已有的 `apps/desktop/package.json`，只加 `scripts` 一个键。
3. **放弃用 `window.open` 返回值判断弹窗被拦**——规范规定带 `noopener` 时恒返回 `null`，实测三个本来正常打开的链接全部误报"浏览器拦截了新窗口"。宁可漏报，不可把正常路径判红。
4. **放弃给确认框 `<section>` 加 `max-h` + 滚动**——撑到 14 行才可见的那个尺寸，现有 10 个调用点最长文案只有 2 行，构造不出可达路径；为中心化的模态框补滚动会引入新的焦点/滚动陷阱，属为假想需求改动产品行为。只登记数字（952px / 按钮出视口 / 遮罩 `overflowY: visible`）。
5. **放弃把 L2/L3 升级成构建期 commit 标记**——那要动 vite 配置（`define` 注入），是待批项，继续挂着。当前诚实边界：身份门禁证明"server 根目录 = 当前工作树"，**不**证明"server 启动于哪个 commit"。
6. **放弃顺手修 `StorageBrowserDialog.tsx:148/168/182` 三处 `void copyText(...)`**——和已修的 `void openExternalUrl` 同一类，但本轮拿不出它真会失败的证据（headless 下剪贴板写入不失败）。没有红过的证据就不动，避免把"看起来同类"当成"已验证"。
7. **放弃让 `red-demo` 用纯 predicate 代替真浏览器**——那样只证明字符串比较，证明不了真页面 + 真门禁会拒绝。现在每个用例真起一次 headless Edge，代价约 40 秒，买到的是端到端。
8. **放弃 `shell: true` 跑 python oracle**——cmd.exe 把 `python` 解析到一个死掉的 WindowsApps 转发，exit 1 且零输出，看起来"守卫报警了"其实是 oracle 没跑。改成探测真解释器，并要求输出里出现它自己的 `total checks:` 标记才算"跑过"。
9. **放弃"只比 HEAD blob"的指纹语义**（第一版就是这么实现，也是你最初要求的措辞）——它抓不到未提交的一字节漂移，而那正是漂移发生的地方。现在 blob 与工作区两半都比；代价是提交前必然看到一次"表比 blob 新"的红，这是设计而非缺陷，已在上面贴出。
10. **放弃给依赖扫描加豁免名单**（比如"忽略出现在 `id: 'M12'` 行里的 import 字面量"）——豁免名单会跟着下一条变异数据一起再被毒一次，且它自己就是一条"看起来在检查"的假绿。改成把扫描限定在行首 `import`，从语法上而不是从名单上排除字符串字面量。
11. **放弃把 mutation 表挪进 JSON 数据文件**（能同时解掉两个自吞问题）——多一个没有类型、没有断言、谁都能手改的数据面；现在的两条不变式（测具里不得有 mutation 表、runner 不得变异自己）已经把它们挡在结构外，不需要再引入一个可被同样方式污染的文件。
12. **放弃把解释器探测抽成共享模块**——多一个 `scripts/*.mjs` 就要多一行指纹表项、多一条"它自己有没有被断言过"的问题；两处 20 行的探测逻辑重复，换来的是每个文件都能被单独证伪。若第三处再需要，就该抽了。
13. **放弃在聚合器里自动起 dev server**——那是把"我测的是哪个构建"变成聚合器自己的副作用，而且 `npm run dev` 属于起进程，越出本轮边界；宁可 SKIPPED 并退 3。
14. **放弃给 `verify:all` 加超时后继续**——12 道里有 4 道要开真浏览器，最坏几分钟；一道卡死应该被看见成一道失败，而不是被 `Promise.race` 吞成"没跑到"。

### 本轮记录（仓库路径与实状态）


- 仓库路径（绝对）：`D:image-hosting-platform`，分支 `dev`，远端 `origin/dev`。
- **提交前** `git status -sb` 逐字输出（本文件即其中之一，所以它必然在列表里）：

```text
## dev...origin/dev [ahead 3]
 M CHANGELOG.md
 M apps/desktop/package.json
 M scripts/check_user_flow.py
 M scripts/verify_dialog_interactions.mjs
```

  上面是**捕获时刻**的快照。本文件**故意不再写"最终 ahead N"**：那个数字包含"提交本行的这一笔"，所以任何写下它的提交一落地就少一笔——上一版就是这么错的（写了 ahead 5，实际 7）。要状态就跑
  `git -C D:/image-hosting-platform status -sb`，以它为准，不以本文件为准。**本轮指令是不 push**，所以远端仍停在 `fe57911`，本地在其之上另有数笔。
- **"没改 version"要说得可比对**（逐文件核 `git diff v1.4.4..HEAD`）：`Cargo.lock` 与 `apps/desktop/package-lock.json` **不在差异列表里**；`Cargo.toml`、`tauri.conf.json` 的 blob 哈希与 v1.4.4 逐字节相同（`d8e893409a791dbf…` / `0d502d74a3f6bffa…`）；`apps/desktop/package.json` 的 blob 哈希**变了**（`d9cf163d…` → `eff85f02…`），但整个文件的差异只有两行——给 `"tauri": "tauri"` 补逗号、加一行 `"verify:dialog"`——`version` 两端同为 `1.4.4`，`check_release_version.py` 仍报 `Release version consistent: 1.4.4`。所以准确说法是"**version 字段没动，但五个 version 声明文件之一被 scripts 键碰过**"，不是"五个文件零改动"。
- 完整链路实输出（`cd apps/desktop && npx vite --port 1420` 起前端后逐条跑，取真实退出码）：

```text
validate                          rc=0 | ... version alignment: 1.4.4 | GitHub write queue: OK
check_contracts                   rc=0 | frontend invokes: 66 | Rust commands: 66 | registered: 66
check_user_flow                   rc=0 | total checks: 156
check_docs_site                   rc=0 | total checks: 16
check_workflow_action_pins        rc=0 | GitHub Actions pin validation passed for 19 external action reference(s).
check_release_version             rc=0 | Release version consistent: 1.4.4
check_tauri_dependency_family     rc=0 | Locked family: tauri=2.11.5, tauri-runtime=2.11.3, tauri-runtime-wry=2.11.4
npm run verify:dialog gate-unit   rc=0 | Viewport gate unit check: 6/6 correct
npm run verify:dialog gate        rc=0 | "sawMinimizedReject": true
npm run verify:dialog ab          rc=0 | "deltaOverflowX": 210
npm run verify:dialog confirm     rc=0 | 五项采样全部在门禁下取得
```

### 本轮验证命令与实际输出

```text
$ for g in validate check_contracts check_user_flow check_docs_site; do python scripts/$g.py; done
validate           ... version alignment: 1.4.4 | GitHub write queue: OK
check_contracts    Command contracts: OK | frontend invokes: 66 | Rust commands: 66 | registered: 66
check_user_flow    User-flow ... OK | total checks: 150        # 143 → 150，本批 +7
check_docs_site    Docs site contract OK | total checks: 16

$ cd apps/desktop && npx tsc --noEmit -p tsconfig.app.json
（无输出，exit 0）

$ python jobs.py 36592371911 36593715132      # GitHub Actions API
=== run 36592371911 ===   desktop-check | completed | success | steps=25 | non-green=[]
=== run 36593715132 ===   desktop-check | completed | success | steps=25 | non-green=[]

$ python watch_ci.py                          # 本批三个提交推上 dev 之后
attempt 3: run 36599075215 CI status=completed conclusion=success
JOB desktop-check | completed | success | steps=25 | non-green=[]

$ python watch_ci.py                          # 记录提交 86e59a3 之后
attempt 4: run 36599811212 CI status=completed conclusion=success
JOB desktop-check | completed | success | steps=25 | non-green=[]

$ python watch_ci.py                          # 作废 186.8 并重采之后 fe57911
attempt 3: run 36600841593 CI status=completed conclusion=success
JOB desktop-check | completed | success | steps=25 | non-green=[]
```

原第 4 条（`3c642af` / `49f7e0c` 的 CI 结论）到此填实：两条提交各触发一次 CI，运行 `36592371911` 与 `36593715132`，唯一作业 `desktop-check` 均 `completed / success`，25 个步骤无一非绿。

守卫变异验证（每次只改一处，跑完立即还原并复核内容一致）：摘掉 `<p>` 的 `break-words` → FAIL `the confirm dialog detail wraps unbreakable filenames`；把 `SettingsPage.tsx:328` 改回丢弃 promise 的写法 → FAIL `no external-link open is fire-and-forget (['src/pages/SettingsPage.tsx'])`；摘掉包装里的 `.catch(...)` → 同时 FAIL 上面两条。这条守卫自己也红过一次：它把 `desktop.ts` 里描述旧写法的**注释文本**当成了违规调用点，我没有放宽断言，而是改写注释——放宽规则会让下一个真调用点混过去。

### 本批仍然没有验证的东西

1. **基址到底进没进 v1.4.3 / v1.4.4 的包**：按批准不下包、不解包、不安装，这条**允许长期停在无法本地证明**。日后要证的话，方案是在 `release.yml` 现有 `windows-bundle` 作业里加一步 `echo "docs base baked as: ${env:VITE_DOCS_BASE_URL}"`——不新增作业、不新增 artifact、不改 version、不动 `check_docs_site.py` 里"禁止硬编码 `VITE_DOCS_BASE_URL:`"的既有约束（它禁的是硬编码，回显探测结果是另一回事）。**方案先报，未批不动 CI。**
2. **Tauri 分支的 `openUrl` 失败提示**：需要 Rust 运行时，本机无 cargo，只能靠代码路径推断。
3. **14 行级长文案在最小窗口下的可用性**：640×480（`tauri.conf.json` 的 minWidth/minHeight）时，本轮那串 5 行长文案下卡片 440×472、按钮 `confirmFullyVisible: true`；把正文撑到 14 行则卡片高 **952px**、确认按钮 `confirmFullyVisible: false`，且遮罩 `overflowY: visible` 不可滚动 → 用户既看不到也点不到。**当前 10 个调用点里最长的批量删除文案只有 2 行，构造不出这个尺寸，所以判潜在而非现存缺陷，未修。** 真要修是给 `<section>` 加 `max-h` + 滚动。
4. **确认框打开期间吐司被遮住**：95 盖住 70 已实测（`elementFromPoint` 落在确认层内），且遮罩本身是 `background-color: oklab(0.129 … / 0.35)` + `backdrop-filter: blur(8px)`——吐司是画在这层 35% 暗色 + 8px 模糊**之下**的，截图 `10-toast-behind-confirm.png`。"还能不能读清"是感知判断，我没有下结论；能确定的是它不在最上层、点不到（吐司容器 `pointer-events: none`，其上的确认层吃掉命中）。现有 10 个调用点都是"确认关闭之后才发吐司"，所以真实流程里还没构造出"确认框还开着、后台先报错"的场景。
5. **`StorageBrowserDialog.tsx:148 / :168 / :182` 还有 3 处 `void copyText(...)`**（三个"复制"按钮）：**判定 = 与已修的 `void openExternalUrl` 同构，只是这一轮拿不到红**，不是"Tauri 分支走另一条错误通道"。
   - 依据：`desktop.ts:71-78` 的 `copyText` 两条分支都 `await` 一个会 reject 的 promise（Tauri 走 `plugin-clipboard-manager` 的 `writeText`，浏览器走 `navigator.clipboard.writeText`），而**缺陷在调用点的 `void`**，与走哪条分支无关。所以修法和 openExternalUrl 一模一样（一个把 rejection 送进吐司的包装 + 三处换调用），不需要另一套错误通道。
   - 边界（写给后人，不是结论）：浏览器分支我**没测过它的失败**——本轮 headless 里 `writeText` 都成功；规范上文档失焦时它会 reject（`Document is not focused`），那是一条**候选**造红路线，我没走，所以别把它当已验证。Tauri 分支的 `writeText` 会因窗口失焦/权限失败，那是真正上线的那条，但需要 Rust 运行时才能证。
   - 因此这条的现状是"同构缺陷 + 两条分支都暂无本机证据"。**没有为了"修对称"而改代码**；要动的时候连同这三处一起，并先造出一次红。
6. **默认分支 `main` 指向另一项目**：依旧只交方案、未执行任何分支操作，方案与影响面见上一批第 5 条。

## Unreleased - 2026-09-30（视觉：先量再改，只改一个界面）

新增的长期要求是"看得见的界面要高级"。这一批**没有为形容词写代码**：先出一份可重跑的基线（`docs/VISUAL_BASELINE.md`），再只改新手教程弹窗，改完用同一把尺子复量。

### 你提的六条，逐条裁决（成立 / 程度修正 / 不成立）

| # | 你的判断 | 实测裁决 |
| --- | --- | --- |
| 1 | 没有层级，6 张卡一样重 | **成立**，但准确说法是"没有从属关系"：6 张卡五件套完全相同，顺序信息只挂在全弹窗最弱的那个元素上（10px、2.56:1 的 `STEP n`） |
| 2 | STEP 3/4/6 底部 30–40% 是空的 | **成立但程度高估**：卡片末尾留白 8–18%，其中等高网格真正拉伸出来的只有 **25px（10%）**，且只出现在 STEP 3 与 STEP 5；另外四张的"留白"就是卡片自己的 `padding-bottom: 20px` |
| 3 | 主次分不清，链接按钮和标题一样大 | **成立，且根因是一条全局 CSS**：`styles.css:71` 的 `button { font: inherit }` 写在 Tailwind 的 `@layer utilities` 之外，未分层规则层叠优先，于是按钮上的 `text-xs font-medium` 整条被吞——动作按钮实际 **16px/400**，而它所属的卡片标题是 **14px/600**，主次正好颠倒。全站 10 屏共 **23 个按钮**如此 |
| 4 | 底部 5 个 chip 与 6 步重复 | **成立**：`steps: 6` + `numberedItems: 5`，且两套编号不一致（chip 4 = step 5）。**裁决见下** |
| 5 | 字体没显式指定，`STEP n` 缺 tabular-nums | **两条都成立**：字体栈首个候选 Inter **未安装**（canvas 探针：`Inter` 与 `sans-serif` 宽度同为 669），仓内无 `@font-face`、无 `<link>`，所以拉丁落到 Segoe UI（648）、中文落到系统兜底；栈里**一个中文字体都没列**。`STEP n` 的 `font-variant-numeric` 实测 `normal`，6/6 |
| 6 | 关闭 × 与 chip 微文本可能低于 3:1 / 4.5:1 | **一处半对**：关闭 × 前景 `rgb(148,163,184)`，合成背景 ≈ `rgb(249,249,250)`，比值 **2.44:1**（图形阈值 3:1，不达标）；chip 微文本前景 `rgb(71,85,105)`，比值 **7.20:1**，达标——它的问题是 11px 太小太挤，不是对比度 |

### 序列裁决：删掉底部 5 个 chip，保留 6 步（你让我定，我按证据定）

理由四条：(a) 6 步是信息超集，chip 是它的有损缩写，删 chip 不丢内容、删步骤丢内容；(b) chip 的编号与步骤编号**冲突**（chip 4 = step 5），留着就仍在制造"两套顺序"这个原缺陷；(c) 弹窗实测 `scrollHeight 945 / clientHeight 612`，**333px 在折叠线以下**，删掉直接换回可读高度；(d) 那一块的标题挂着 `Keyboard` 图标，但 5 个 chip 里没有任何快捷键——它连自己的图标都在说谎。

### 改前 / 改后（同一把尺子、同一视口 1406×803、`visible`、动画已清空）

| 指标 | 改前 | 改后 |
| --- | --- | --- |
| 文本对比度 < 4.5:1 | 7 条（最差 2.45） | **0 条** |
| 字号被 `font: inherit` 吞掉的按钮 | 6 个 | **0 个** |
| 同一屏内的编号序列 | 6 步 + 5 chip | **6 步 + 0** |
| `STEP n` tabular-nums | 0/6 | **6/6** |
| 字号档数 | 6 档（含 16px/400 按钮） | 5 档（18/600、14/600、12/400、12/500、11/600） |
| 圆角种数 | 5 种（30/22/16/12/full） | **3 种（24/16/12）**，其中 24 与 12 正是 `--radius-card` / `--radius-control` |
| gap 种数 | 3 种（16/12/8） | **2 种（16/12）** |
| 最大等高拉伸死白 | 25px | **1px**（动作按钮改为落在卡底，跨卡对齐） |
| 卡片高度 | 226/226/250/250/250/250 | 204/204/228/228/228/228 |
| 内容总高 / 折叠线以下 | 945px / 333px | **740px / 128px** |

**哪个像素变了**：三处最明显。(1) 每张卡右下角那个灰色胶囊按钮（16px、和标题同宽同级）变成标题下方的 accent 色文字链 `去云端 →`，12px/500，标题重新是卡内最重的东西；(2) `STEP 1…6` 从 10px/2.56:1 提到 11px/7.56:1 并等宽数字；(3) 底部那一整块"推荐的第一次使用顺序"（含 5 个 chip 与其容器）整块消失，原本压在它上面的 STEP 5/6 两行提上来，头部副标题与关闭 × 从 2.45 提到 7.23。

### 测具这一轮自己错了四次（全部写进基线文档的"作废"表）

1. `numberedChips: 0` —— 探针要求元素无子节点且文本恰为纯数字，而 chip 文本是 `1.连接 GitHub` 且内部包了 `<span>`：**它报"没有重复序列"的同一刻，5 个 chip 就在截图里**。
2. `utilityDrift: {}` —— 正则写进 Node 模板字符串时单反斜杠 `\s` 到达页面变成 `s`，一个元素都没匹配上，而"没有漂移"和"没看"打印得一模一样。现在自报 `checked/matched`，`checked>0 && matched===0` 直接判测具故障退 2。
3. `contrast` 模式两条链返回 `[]` —— `find` 命中的是祖先元素，取到的是继承色。改成取最深匹配。
4. 我**假设** Tailwind 的 `slate-400` 与 `--text-muted` 是同一个灰，并据此写下"这是一个 token 问题，合并成一个变量"。加了 `palette` 探针用浏览器颜色引擎归一化后自证：`oklch(70.4% 0.04 256.788)` 渲染为 `rgb(144,161,185)`，`#94a3b8` 是 `rgb(148,163,184)`，`identical: false`。**假设被自己的探针否掉，结论改回"同一层级的两个灰"**——合并变量不会让 2.45 变成 4.5。

另外：`visual` 模式跑过一次 `no page target`，原因是上一轮遗留的 headless Edge 还占着固定默认端口 9333，探针连到了那个陌生浏览器。已把失败信息改成"那个浏览器现在开着哪几个标签页"并写明 `--port` 是绕法（本轮所有截图改用 9377+ 的端口）。

### 登记但**不修**的两条全局缺陷（越出"只改一个界面"）

1. `styles.css:71` 的 `button { font: inherit }` 吞掉全站 23 个按钮的字号/字重。修法是把这条规则放进 `@layer base`（或删掉，Tailwind 已有 preflight）——一次动 10 个界面，需要单独批准。
2. `--text-muted`（12 条）与硬编码 `text-slate-400`（59 条）合计 **76 条 AA 失败里的 71 条**，比值 2.45–2.63。这是"弱化灰"这一层整体不达标，不是 76 个孤立问题；但改 token 同样一次动 10 个界面。

### 红 / 绿证据原文

运行时门禁（把弹窗换成 `ab13df8` 的旧组件即红，改回即绿）：

```text
$ node scripts/verify_dialog_interactions.mjs visual          # 旧组件
FAIL 7 text runs below 4.5:1 (先完成第一次真实云端@12px=2.45, STEP 1@10px=2.56, ...)
FAIL 6 buttons render at a size their own class does not declare (button.text-xs probe=12px/500 actual=16px/400)
FAIL a second numbered sequence reappeared next to the 6 steps (1.连接 GitHub, 2.上传 1 张图, ...)
FAIL 6 of 6 STEP ordinals are not tabular-nums
visual: 4 regression(s) on the onboarding dialog              -> rc=1
$ node scripts/verify_dialog_interactions.mjs visual          # 新组件
visual: onboarding dialog holds its baseline (0 below 4.5:1, 0 discarded button sizes, 1 sequence, all ordinals tabular)   -> rc=0
```

静态门禁（M13–M16，各破一条性质、每次都还原）：

```text
$ node scripts/verify_guard_mutations.mjs M13 M14 M15 M16
OK   M13 -> FAIL a non-important size/weight utility on a button is discarded by styles.css (['text-[12px]', 'font-medium'])
OK   M14 -> FAIL the duplicated five-chip ordering block stays deleted
OK   M15 -> FAIL the dialog avoids the muted grey measured at 2.45:1 / 2.56:1
OK   M16 -> FAIL the STEP ordinals are tabular
guard mutations: 4/4 alarms reproduced | tree restored: clean
```

`check_user_flow.py` 新增 8 条（序列唯一性 / chip 不得复现 / 不用 2.45 灰 / 显式 CJK 字面 / tabular / 逐个 `<button>` 的字号工具类必须带 `!` / 循环真的扫到过 ≥2 个按钮），计数 **183 → 191**，`USERFLOW_CHECKS total=191 failed=0`。`verify:all` 加了 `visual` 一道：**12 → 13 stages**。

### 本批放弃的选项

1. **放弃改 `styles.css:71` 根治 23 个按钮**——它一次改到 10 个界面，越出"只改一个界面"，且需要单独批准；弹窗内用 `!` 抵消，并在守卫里写明"这里的 `!` 是有承重作用的，不是装饰"。
2. **放弃改 `--text-muted` 抬全站对比度**——同理；且 `midnight` / `sakura` 两套主题各自重新定义了这个 token，改一处要连带重测三套配色，本轮没有那三套的数据。
3. **放弃挂 webfont（含自托管 Inter）**——新增依赖/改 lock 已禁；挂 Google Fonts 更糟：一个阻塞样式表在 CDN 不可达时就是白屏。改成**把栈写明确**（拉丁 Segoe UI、中文显式列微软雅黑 / 苹方 / Noto Sans CJK），这三个是探针确认机器上真有的。
4. **放弃把弹窗改成 3 列以彻底消除滚动**——6 张卡改 3 列只剩 2 行、高度可再降，但 `tauri.conf.json` 的 `minWidth: 640` 下 3 列会挤；且"滚动"不在你列的六条里，不替它编一个缺陷。剩余 128px 折叠线以下如实记下。
5. **放弃"删 6 步、留 5 个 chip"**——你倾向删 chip，我按证据也删 chip；但先真量过反向方案：chip 是缩写，删步骤会丢"资源页 vs 图库页复制的东西不同"这类只有正文才说得清的内容。
6. **放弃把基线做成 HTML 一页纸**——它要能被守卫读到、要能进 diff，Markdown 表格够用，且 `check_docs_site.py` 不覆盖 `docs/` 的任意 md，不会引入新的文档站约束。
7. **放弃给 `visual` 做"和上一次运行 JSON 做差"的自动对比**——两份 JSON 里 `sample` 字段是截断的 UI 文本，一旦文案改动，差值会同时报出真回归和纯文案变化，反而更难判。改成把关键数字断言成 4 条会退出的门禁。
8. **放弃修 `no page target` 的端口分配**（改成 `listen(0)` 抢空闲端口）——`ab` 模式用 `PORT + c.port - 14570` 给子进程推导端口，换成语义会连带改动一个已经验绿的模式。买到的是"失败时能看见连到了谁的浏览器"，这条已经够诊断。



## Unreleased - 2026-09-30（第二批：排版地板与合成层对比度）

"整体使用功能没问题，页面排版设计不出问题"是地板。地板之前没探过：`pages` 模式只证明路由画出来了，**一个几何量都没量**。

### 三条裁切判据是并集，不是替换

| 形 | 判据 | 控制注入实测 |
| --- | --- | --- |
| (a) 元素比视口宽 | `VIEWPORT-OVERFLOW` + `DOC-OVERFLOW` | +994px / +994px，两条各自红一次 |
| (b) 叶子被祖先 `overflow:hidden` 裁掉 | `CLIP-BY-ANCESTOR`（rect × 最近裁剪祖先 **padding box** 求交） | +1664px，而 **DOC-OVERFLOW 停在 0px** —— 文档级判据在这一形上是瞎的，本仓实测 |
| (c) 元素自己裁自己 | `SELF-CLIP`（`scrollWidth - clientWidth`） | +254px；`overflow:hidden` **不**算逃生口，只有 `auto/scroll` 算 |

(b) 看不见 (c)：元素的 rect 就是它的 border box，自裁发生在盒子内部，永远不越祖先的界。(c) 看不见 (b)。所以必须并列。
`CONTROL-D` 再钉一条可达性：叶子在滚动轨里 ⇒ **不报**（滚得到），而那个轨自己被外层 `hidden` 裁掉 220px ⇒ **报**。

### verify:all 里没接 `layout`（故意的，不是漏了）

单独跑：`checked=21 matched=21 skipped=0 failures=23`，全是真缺陷。
塞进聚合器：1024 档的 `setDeviceMetricsOverride` 从未生效（`innerWidth` 报回上一档的 1440），640 档时注入的 `window.__H` 已经没了 —— 于是产出 **7 条"navigation entry point not reachable"假缺陷**。一个会自己造缺陷的门比没有门更坏，所以先摘出来，并加了两道测具故障保护（覆盖轮询最多 3s 等生效；每档开头检查 `__H/__L` 是否还在，不在就退 2 而不是逐路由报错）。接回来的条件是它在聚合器里跑出与单独跑一致的 23 条。

### `stuckLoading` 升级为门

`LAYOUT_GATE checked=N matched=M skipped=K failures=F`，退码 **0 看了且干净 / 1 有缺陷 / 2 测具故障 / 3 什么都没看到**。还在转 spinner 的页 **既不进 findings 也不计通过**，它看到的条件另列 `SKIPPED-FINDINGS` 供翻查。

### 几何层实测到的真缺陷（未修）

- **最小窗口 640×480 下侧栏底部整块被裁**：`div.mt-auto.space-y-2` 越界 33px，**"教程与帮助"按钮越界 25px**，而 `body{overflow:hidden}` 不给滚动 —— 也就是说应用缩到最小尺寸时，打新手教程的那个入口点不到。
- 图库页 `刷新` 按钮文字被自己裁掉 5px（1024 与 640 都有）。
- 640 档每页 14–23 个可点目标小于 44×44，最小 13×13（`发布完成自动复制` 复选框）与 16×16（吐司关闭按钮）。
- 焦点判据改成"焦点前后自身 + 3 层祖先的 outline/box-shadow/border/background 差分"以后，**上一轮报的 5 条"无可见焦点"全是假红**（那些输入框靠 `focus:border-` 换描边色表达焦点，是真环）；同时植入两次对照：`outline:none` 无环必须红、环画在包装层必须绿，两次都过。

### 对比度：按渲染像素算，不按 token 算

方法：注入 `* { color: transparent }` 后截图，把每个文字元素中心点的**像素值**当背景 —— 渐变、`backdrop-filter`、壁纸遮罩全部天然包含。壁纸取两张极值图（全黑 / 全白）当包络。

| 主题 | (a) token↔token：`--text-muted` vs `--app-bg` | (b) 文字↔渲染合成背景，最坏值 |
| --- | --- | --- |
| default | `#94a3b8` vs `#f6f7fb` = **2.40:1** | 无壁纸 **2.46** / 黑壁纸 **1.42** / 白壁纸 **2.48** |
| midnight | `#64748b` vs `#090d16` = **4.08:1** | 无壁纸 **1.02** / 黑壁纸 **1.02** / 白壁纸 **1.01** |
| sakura | `#ad8798` vs `#fff8fb` = **3.00:1** | 无壁纸 **2.51** / 黑壁纸 **1.44** / 白壁纸 **2.53** |

**六个值没有一个是"达标"的**，所以本批不报"对比度全达标"。9 个主题×壁纸×路由组合 **全部报红**（`below=9`，`unresolved=0`）。

按渲染像素算，暴露出 token 算术**结构上看不见**的第二类缺陷，比灰度不达标更重：

- 设置页 `还需要完成上传配置` 在 midnight 下前景 `rgb(248,250,252)`、采样背景 `rgb(251,248,237)` = **1.02:1**，几乎不可见。原因不是 token，是**硬编码 `bg-white` 的分区不跟随主题**：文字换成近白，底还是白的。
- 同一页 `设置` 28px 标题在 midnight 黑壁纸下 `rgb(2,6,24)` on `rgb(7,10,17)` = **1.02:1**，是反过来的同一类（硬编码 `text-slate-950`）。
- 云端的 `article.border.bg-white` 说明这不是孤例。

⇒ 修对比度不是"把 `--text-muted` 提亮度"一件事，至少两件事：三套主题各自的弱化灰，**以及把硬编码调色板从主题里清出去**。后者范围大，本批只登记。

### 更正：裁切链要**逐轴**停，不是逐元素停

我先前实现的 `rail` 是**单布尔**：`/auto|scroll/.test(overflowX) || /auto|scroll/.test(overflowY)`，撞到任一轴的滚动轨就把整条链、**两轴一起**赦掉。而 `.app-main` 恰好是 `overflow-y:auto; overflow-x:hidden` —— 于是**纵向的滚动轨替横向作了保**：横向真被裁的元素会被漏掉。现改为每轴各自往上走、各自停。

`CONTROL-F` 是能区分两种实现的形状：`overflow-x:auto` + `overflow-y:hidden` 的轨里塞一个比盒子高的文字。逐轴实测 `lostY=9px 报`、`lostX=0px 赦`；单布尔会把两轴一起赦掉。

**代价在本仓是 0，这条要如实写**：全部 21 条被报的裁切，其裁剪祖先的 overflow 对都是 `hidden/hidden`；整轮扫描里被轨赦掉的计数是 `railY=1613 / railX=3`——也就是说 `.app-main` 的 `overflow-x:hidden` 在本应用里**从未真的截断过任何内容**。这个 bug 是**潜伏**的，不是活跃的。隔壁单词站那个 `clip 2628→0` 是"治理滚动轨"带来的，不是"逐轴"带来的，两个数字不能混着报。

### 本批放弃/未做的选项

1. **没做 `verify_dialog_interactions.mjs` 的拆分**（现 1963 行 / 133KB）。它确实该拆，但这批同时新增了三道门（几何、合成层对比度、焦点差分），拆分会移动共享的浏览器引导与三道门禁代码；在同一批里既加门又搬家，一旦聚合器变红我分不清是新门抓到了回归还是搬家搬断了。计划：先抽 `scripts/verify_probes.mjs`（三段页面侧探针，约 400 行，纯字符串导出、零控制流），再按模式拆；每步跑同一套命令对账行数与用例计数。**这条是欠账，不是已完成。**
2. **没接 `layout` 进 `verify:all`** —— 理由与复现日志在上面。
3. **没修任何一条几何缺陷与任何一条对比度** —— 这批交付的是"能验的地板读数 + 门"，修是下一批的活；先把它们报成红，而不是为了让聚合器好看去调阈值。
4. **放弃把 `sr-only` 负对照做成"用夹具 DOM 命中应用真分支"** —— 造一行假插件数据要在浏览器态里伪造 Rust 返回的存储配置，那是"用测具的复制品测测具"；现在改成把这条覆盖缺口写进输出（`COVERAGE:` 行），让读日志的人知道那条排除在保护什么、以及它在应用里没被跑到。


## Unreleased - 2026-09-30（第三批：门自己得先能被弄红）

边界照旧：不新增依赖、不改依赖清单/lock/配置、不 push、不出包、不改版本号（仍 1.4.4）、不打 tag。

### 一句话结论

这一批没有改界面，改的是**量界面的那套东西**：给它补了"能被证明会红"的部件，然后用这些部件发现
上一轮交给你的那条"具名未决缺陷"是测具自己造的。四件事收齐在下面，两件是撤回。

### 队列四件

**① 逐轴停 vs 整链停，定性：顺手，不是故意。** 已把这句话写进判据注释本体（`scripts/verify_probes.mjs`
的 `clipperForAxis`），并写明为什么逐轴才是对的：Chrome 对 `overflow-x`/`overflow-y` 是**各自独立**解析的
（一轴 visible 配另一轴非 visible 会算成 auto），用一个布尔走整链，`.app-main`（`overflow-y:auto` +
`overflow-x:hidden`）就会替水平方向的裁切作保 —— 1440×900 下它替 22 个"看不见其实在滚得到"的按钮作了保。

**② 逐面三档清单（22 个面 + 1 行合计；旧写法照 `--verify` 的 `faces=23` 写成"23 个面"，把合计行算成了一个面，生成器在 `scripts/theme_face_inventory.mjs`）。** 合计
**令牌可达 962 / 需 class 规则 121 / 设计上不分主题 44 / `dark:` 前缀 0 / 字面色值 0**，
与你的计数（`bg-white 112`、`bg-slate-50 40`、`bg-slate-100 43`、`text-slate-950 4`、`text-slate-900 5`、`dark: 0`）同源。
三档为什么各存在一次，写在 `docs/VISUAL_BASELINE.md` 4.1；`dark: 0` 不等于"没做暗色"，主题挂在
`documentElement[data-theme]` 上，靠 `--color-*` 的层级变量整体翻转。表由 `--verify` 核对，改一个数字就 exit 1。

**③ 六个控件比值，各自对它实际坐着的面（1.4.11 的对象）**，取三套壁纸极值 × 8 个面里最差的一次：

| 控件 | mist | midnight | sakura |
|---|---|---|---|
| primary-fill | 20.16 | 20.16 | 20.16 |
| danger-fill | 4.77 | 6.47 | 4.77 |
| subtle-fill | 6.83 | 6.95 | 6.83 |
| field | 17.39 | 16.96 | 16.83 |
| icon | 5.17 | 6.31 | 5.04 |
| ghost | 4.74 | 4.92 | 4.93 |

背景一律从"隐藏字形后那张照片"里取，所以渐变、`backdrop-filter`、壁纸合成都在数里；
`background-image` 面**不取单点**（取该行墨迹覆盖的整片区域的最差点，中心值同排印出来做对照）。

**④ 拆分对账：交台账，不交一次性数字。** `scripts/verify_shape.mjs` 把"拆前拆后"变成一条可重跑的断言：
模式集合双向对称差、跨文件总行/总字节、六族决策点数、以及三段页面侧探针是否仍逐字节等于 `58be53f^` 的那份。
现状 `SHAPE_SELFTEST cases=6 failed=0` + `SPLIT_SHAPE OK checked=17 failed=0`。
按关注点把 190 KB 的 harness 真正切开这件事**本批仍没做**，理由与台账一起写在 4.35/本节末。

### 撤回的两条

**第一条：上一轮那条"具名未决缺陷"不是缺陷，是我的测具。** `设置` 页那行 11px 说明文字报
4.12:1（mist）/ 4.09:1（sakura），墨迹下方取到 `rgb(224,224,224)`。我当时的判断是"这个纯灰不是该渐变画得出来的值，
所以真正的底另有其物"——后半句对，前半句把它当成了界面问题。**那块灰是当时叠在页面右下角的 4 条错误吐司的落影**：
浏览器里没有 `invoke`，进 `设置` 就必然弹那 4 条，而这一行字的尾端伸进了它们的投影里。
三条自证：纯灰（R=G=B）三套 token 里都不存在；全黑壁纸与全白壁纸下它是同一个 224（真表面不可能对壁纸极值无感）；
midnight 下同一行不报红（因为它的字是浅色）。处置不是"把 `--text-muted` 压暗到数字过"，而是：
每个面开拍前清空 toast 栈、断言 `[role=alert]/[role=status]` 归零，没归零该组合直接 `finish(2)`；
`COMBO` 行加印 `toasts=N`。清空后 **72 组合 / 1,890 行 / 120,042 点，`below=0`**，
`contrast-tier` 因此从"暂不作 stage"改回**接入**（`verify_all.mjs` 里那段注释原地改写，不删）。
这条作废登记在 `docs/VISUAL_BASELINE.md` 0.1 第十行。它比"没红过"更值得留：红过一次、红的是测具的门，
吐出来的数字带着元素、坐标和比值，看起来比谁都像证据。

**第二条：M25 起草后撤回，不占功。** 退码 latch（`finish(2)` 被后面的 `catch` 降成 1）修好之后，
**没有任何一条路径会在已定退码之后再去要第二个判据**，所以任何变异都改变不了 oracle 看得见的东西。
"变异改不动判据"的测试不是测试。latch 只由产生它的那个症状覆盖（`red-demo` 必须退 2 而不是 1）。
同理没给 `SHAPE_SELFTEST` / `THEME_FACE_SELFTEST` / `AGGREGATE_SELFTEST` / `gate-unit` 的覆盖率五例再补 M 号：
它们长在门的必经路径上，每次绿跑都自带植入式反例，比外挂变异更难绕过。

### 这一批新加的门，以及它们各自先证明自己能红

| 门 | 判据 | 两面夹具 |
|---|---|---|
| stage 名唯一 | `verify_all.mjs` 里 `duplicateNames()` 非空即 exit 2 | `node scripts/verify_all.mjs selftest`：现状 0 重复；粘一行重复必须报"恰好 1 个名字且就是它"；粘两行必须报 2 |
| 重复 stage 的实际事故 | 你报的 `contrast-tier`/`theme-surfaces` 两对，我恢复备份时又发现 `theme_face_inventory`/`verify_shape` 两对 —— 同一张表里 4 对重复 | 上表 selftest 的判据就是按这个事故形状写的 |
| 覆盖率上限（`unknown` 三态不当逃生口） | 判据抽成 `coverageVerdict({judged, dropped})` | `gate-unit` 里 5 例：现状读数放行、400/1000 拦、恰好 25% 放行、`judged=0` 拦、`judged=0` 且全丢也拦 |
| 台账自证 | `verify_shape --verify` 先跑 6 例才允许报树 | 改一个字节要红、删一个模式要红、把 extraction 弄瞎必须报 5 条（旧版报 0 条） |
| 逐面清单自证 | `theme_face_inventory --verify` 先跑 4 例 | 自己的输出干净、改一个数字**恰好**报 1 行且行号对、表被截断要报 |
| 重签基线 | `--snapshot` 无 `--reason` 直接 exit 2，并把 `takenAt`/`head`/`reason` 写进基线 | 本轮先让旧基线红（`DRIFT failed=3`）再 `--snapshot --reason "..."` |

### 顺手抓到的四个"半坏的门"（都不是界面缺陷，第一个是我自己上一轮弄坏的）

0. **`verify:all` 在工作树里根本跑不起来**：`const python = resolvePython()` 这一行在我上一轮的编辑中丢了
   （HEAD 里还在，第 94 行；工作树里只剩 `if (!python)`），于是聚合器一启动就 `ReferenceError: python is not defined`。
   **而 `node --check` 是过的** —— 少一个顶层绑定是运行时错误，语法检查看不见它。我这一轮已经对着这个坏掉的聚合器
   跑过若干次"语法 OK"，然后把它的输出当成"门还在"。修法就是把那行补回来，并且让 `selftest` 去碰这个真实绑定
   （多一条 case：`the preflight interpreter binding resolves`），这样"便宜的自检"走的是和真跑同一条启动路径；
   聚合器现在 18 stages，`selftest` 若崩就说明启动路径本身断了。

1. `verify_shape.mjs` 里 `execFileSync` **根本没用 import** —— `gitShow()` 每次抛 `ReferenceError` 被自己的
   `catch` 吞掉返回 `null`，于是"pre-split 源可读"与三段探针是否逐字节等于拆前，四项全部读成 0。
2. 同文件里那四项**永远不可能让退出码变红**：判据是 `p.exact ? value!==expect : value!==0`，
   而它们只写了 `expect: 1`、没写 `exact` —— 期望写在标签里、没写进比较里。总数字一匹配就打印 `OK failed=0`。
   修法不是补 `exact`，是**删掉这个开关**：所有判据一律 `value !== expect`，让"期望 1 却按 0 比"这个形状无法表达。
3. `CONTRAST_GATE` 行里 `unresolved=0` 是**字面量**，不是读数 —— 唯一一个不可能与本行数据不一致的数字。
   现在 `unresolvedTotal` 真算出来。同一类：`--doc-write` 第一次跑被自己的未知 flag 门禁拦下（它只认 `opt('…')`，
   我用了 `process.argv.includes`），于是加了 `flag('…')` 并让名单推导同时读两种调用。

### 指纹表：从"手写"变成"生成"

`node scripts/fingerprint_rows.mjs --patch` 只重写每行的 行/字节/sha 三格，**散文两格留给人写**；
表里没有该文件时它**拒绝**（本轮就拒了一次：三个新文件没有行）。理由写在文件头：上一版这张表漂移了一笔提交，
而我这一批又复现了一次 —— 我手填的行数错了两个（`verify_modes` 37→36、`verify_shape` 274→273），是 `--patch` 改回来的。
入表规则同时改了：以前按文件名前缀 `verify_*.mjs`，于是**接进聚合器的 `theme_face_inventory.mjs` 完全不在指纹集里**；
现在按"是不是一个 stage"取（`verify_all.mjs` 里被引用的 `scripts/*.mjs` 一律入表），生成器与检查器各自实现同一条规则，
两边不一致由"表集合 == 磁盘集合"那条断言抓住。

### 孤儿浏览器进程：0（已查，无残留）；以及"timeout 会带走子进程"这句是怎么被证伪一半的

`Get-CimInstance Win32_Process -Filter "Name='msedge.exe'"` 全量 **28 个**，其中命令行带
`--user-data-dir=…image-hosting-*` 的 **0 个**（磁盘上留着 197 个 profile 目录，那是目录不是进程）。所以"杀子进程"
不做成收尾断言。

但聚合器那句 timeout 注释原本是错的。它写的是"外层 timeout 在 Windows 上就是 TerminateProcess，只杀 stage 自己，
它起的浏览器会留着，所以必须 `taskkill /T /F` 扫树"。`node scripts/verify_all.mjs timeout-demo` 六例：

```text
TIMEOUT_DEMO cases=6 failed=0 budget=4000ms
  ok   a hanging stage is stopped at its budget: timedOut=true wall=4163ms budget=4000ms
  ok   it is stopped near the budget, not after it: wall=4163ms
  ok   the stage process is gone after the tree kill: parent=26164 alive=false
  ok   the GRANDCHILD is gone too (this is the orphan this exists for): grandchild=25812 alive=false taskkill status=128
  ok   a stage that finishes in time is NOT reported as a timeout: timedOut=false exit=0
  ok   control: the budget ALONE (no taskkill) leaves no orphan: grandchild=28836 survived=false (taskkill not called)
```

第 6 例是消融：同一个"挂死并自己再 spawn 一个孙进程"的夹具，**不调 taskkill**，孙进程照样没了 ——
这台机器上 Node 的 `spawnSync({timeout})` 已经把整树带走了，`taskkill` 每次都返回 128（"没有这个进程"），
即它到场时已经没东西可杀。所以显式扫树是**兜底不是承重**；留着它是因为"哪天 Node 改了行为"这一条我赌不起，
但注释已按实测改写，因为一句"不加它就会漏"的错误机制说明，会把下一个人送去修错的那一行。
夹具本身要两面：第 5 例（正常结束的 stage 不得被报成 timeout）是防"永远报超时也算对"的负对照。

### 本轮末次运行读数（原文，非转述）

聚合器（干净树、`0d98ff4` 之后 8 个提交之上）：

```text
verify:all | 18 stages: 18 passed, 0 failed, 0 skipped
```

其中与本轮相关的几行（`detail` 就是各 stage 自己那台计数，聚合器双向核对过退码）：

```text
PASSED  check_user_flow  USERFLOW_CHECKS total=222 failed=0
PASSED  theme_face_inventory  THEME_FACE_VERIFY faces=23 docLines=25 mismatch=0
PASSED  verify_shape  SPLIT_SHAPE OK checked=17 failed=0
PASSED  gate-unit  gate-unit checked=11 failed=0
PASSED  contrast-tier  contrast-tier checked=1890 failed=0
PASSED  theme-surfaces  theme-surfaces checked=198 failed=0
PASSED  red-demo  red-demo checked=2 failed=0
PASSED  mutations  mutations checked=24 failed=0
```

`gate-unit` 从 6 例变 11 例（覆盖率上限那 5 例）；`contrast-tier` 是本轮**新接入**的一 stage；
`mutations` 那格是全部 24 个变异，不只本轮新增的四个。

单跑本轮那六个（同一棵干净树，逐条 oracle 归属）：

```text
OK   M21 scripts/verify_dialog_interactions.mjs -> oracle ran: true, exit 1, named expected failure: true
OK   M22 scripts/verify_dialog_interactions.mjs -> oracle ran: false, exit 2, named expected failure: true
OK   M23 apps/desktop/src/pages/SettingsPage.tsx -> oracle ran: true, exit 1, named expected failure: true
OK   M24 scripts/verify_dialog_interactions.mjs -> guard-removal: pristine run exited 2 naming the guard, mutated run exited 0 and named nothing (baseline alarmed: true)
OK   M18 apps/desktop/src/lib/theme.ts -> oracle ran: true, exit 1, named expected failure: true
OK   M19 apps/desktop/src/lib/theme.ts -> oracle ran: true, exit 1, named expected failure: true
GATE_JSON {"gate":"mutations","checked":6,"failed":0,"ok":true,"unrestored":0}
guard mutations: 6/6 alarms reproduced | interpreter: D:/anaconda/python.exe  | tree restored: clean
```

M18 抓它的是 `settings-guard`（apply 侧：`banana`/`42`/`MIDNIGHT` 三个非法值被直接写进 `data-theme`），
M19 抓它的是同一台 oracle 的 load 侧那条（`the load boundary rejects an unknown stored theme key`）。
M22 那格 `oracle ran: false` 是**符合预期**的：它把取样器退回中心点后，先红的是 CHIP 夹具，
run 在第一个故障处停下，所以 `CONTRAST_GATE` 那行根本没印 —— 判"抓到"的依据是"退码非 0 且点名了被破坏的性质"。

反向自测（"拔了守卫仍全绿"这一类）现在只有 M24 一条是**按那个形状写的**，因为它的判据要求
"未变异必须红 + 变异后必须绿"两半都在同一次里成立；其余 23 条是"弄坏性质 ⇒ 守卫必须响"。


### 三处程序性自曝

- **提交信息被 amend 过一次**（未推；旧→新：`7137196` → `bc53a45`，复算式 `git log --grep="4.5:1 floor"`）。
  第一条消息写着"调用点不用动"，而同一个提交里就含 13 处
  alpha 调用点的改动 —— 消息与自己的 diff 矛盾。amend 只改消息，且当场断言了 tree 未变：
  `e2d855149df4c26342ac648f7b339b1c601daeea` 前后一致。
- **另有一次带内容的 amend**（`cd6e995` → `fad34e3`，同样未推）：那条提交的信息声称"逐轴判据在注释里写明了
  是否故意"，而我检查文件后发现注释只讲了"为什么逐轴对"、没讲"故意/顺手"这个裁决 —— 也就是说消息在替一件
  当时还没做的事领功。裁决与两边的证据补进 `verify_probes.mjs` 后 amend 进去（该提交尚未被任何后续提交依赖）。
- **shape 台账这一轮重签了四次**，每次 `--snapshot` 之前都先跑一次 `--verify` 看到 `SPLIT_SHAPE DRIFT` 才签
  （漂移来源：本轮新增的门改了 harness 体量 → 聚合器补 `timeout-demo` 与 python 绑定 → 逐轴判据注释并进
  同一提交 → 变异器修好之后又长了一次）。**但"签了几次"这件事不在盘上**：`--snapshot` 覆盖 `_meta`，
  所以基线 json 里只有最后一次的理由，前几次只活在本节这段文字里。这是"重签即签字"的代价，
  要真做成可审计的签字流水，得让快照累积成一个 append-only 的历史文件 —— 本轮没做，记在这里。

### 本批没做/放弃的（连理由）

1. **190 KB harness 按关注点真拆**：基线与台账已就位（拆前形状已快照），但拆完要在同一预算里跑绿，
   拆一半不能验，所以不动。
2. **`layout` 仍不接进聚合器**：它 standalone 报 23 条真几何缺陷，聚合器里 1024 档视口覆盖没生效、
   640 档注入助手提前消失，报出 7 条不存在的"入口不可达"。会造缺陷的门不接。
3. **23 条几何缺陷、25 处 `text-muted` 调用点归类、sr-only 的应用内路径**：都还挂着，本批一条没修。
4. **没给 M25 留位**（理由在上面撤回那条里）。

### 追加一轮：一次假的加速，和它顺出来的两个"门一直在指错元素"

`verify:all` 印出每个 stage 的成本之后（`verify:all | wall=… cost (slowest first): …`），最贵的一格是
`contrast-tier=63.3s / 140.2s`。它自己那行再拆一层 `PHASE-COST`，结论跟我的猜测相反：
**取样 + 拍照合计 6.7s，页面加载一个人 32.5s。** 我原本准备动的是前者。

改了两处：① 循环顺序改成"路由在外、壁纸在内"（壁纸只是 `documentElement` 上一个自定义属性，
不值得为它重载页面：576 次加载 → 192 次）；② 固定 `sleep(120)` 换成"等到那一帧真的画出来"。

**"整轮 59s → 34s" 这个结果随后被我自己作废了。** 连跑两次得到 `measured=1890` 与 `measured=1921` ——
**候选集每次不一样**。原因在这个 app：它给"到目前为止每一个失败的查询"都画一条错误横幅，
浏览器态里这些失败异步落地，所以这一门的分母取决于哪场赛跑赢了。`--doc` 当场把生成的表判成
"手写的"，就是这件事的证据。补上 quiescence 等待（文本长度连续三次相同才拍；每次页面加载只等一轮，
壁纸第 2/3 趟只做一次比较）之后，连跑两次 `measured=1929 points=121632` 逐字相同。

| 阶段 | 改前 | 只加速 | 加速 + 可重跑 |
|---|---|---|---|
| nav（页面加载） | 32.5s | 15.6s | 17.0s |
| quiet（等页面停止变化） | —— | —— | 11.7s |
| prep（断言 + 清覆盖层） | 9.4s | 1.9s | 2.6s |
| collect / shot / sample | 7.7s | 7.5s | 18.9s（同机有别的量具在跑） |
| **整轮** | **59s** | **34s（不可重跑）** | **68–71s** |

**净结果比原始版本慢 9 秒。** 原来那 59s 之所以便宜，正是因为它在页面还在变的时候就把照拍了 ——
**便宜本身就是症状**。所以本轮"优化"交的不是那 25 秒，是"同一棵树重跑得到同一个数"；
`PHASE-COST` 那一行如果不印，我下一步就会去稀采样密度，那正是把门弄瞎的方向。

**加速没改结论，但把两个漏看顶出来了**（详见 `docs/VISUAL_BASELINE.md` 4.36）：

1. `对话框` 那一面以前无条件枚举 `main/aside/section`，也就是**把弹窗背后那一页算进弹窗**。
   它的行数看着对（5 行），只是因为错误吐司栈挡着其余行 —— 巧合，不是正确。
   现在覆盖层面只量自己的子树，并且**断言 `[role=dialog]` 真的在屏上**；这条断言第一次跑就抓到
   "壁纸第 2、3 趟时弹窗已经关了"。
2. `theme-surfaces` 按"哪个盒子的几何范围包含这个点"记账，于是确认框那个红色"重置 Token"按钮的像素
   被算到它底下一张 `rounded-2xl … bg-white` 卡片名下，报警指着卡片说"它不跟主题"。
   现在按**谁真的把漆落在那一点上**记账，报警点名 `button.rounded-xl.px-4`。

改完之后剩下 **1 条真红，我没有进白名单**：危险按钮三套主题都是 `rgb(185,28,28)`，因为
`--danger-solid` 没有分主题值。危险色全局一致可以是设计（它白标签的比值 4.77 / 6.47 / 4.77 都过），
也可以算"暗色没落地"——**这板该你拍**，所以 `verify:all` 现在是 17 passed / 1 failed，红的就是这一条，
不加豁免、不改颜色去凑绿。

另外补了一条 token：`--color-red-600` 在 `:root` 定成 `#b91c1c`。Tailwind v4 自带的 oklch red-600
压在 `bg-red-50` 上是 **4.36:1**（33 处 `text-red-600` 大多落在那 38 处面板上），而这个组合以前从没被量到 ——
那些错误提示行一直躲在吐司底下。

一次我自己造出来的race，也记一下：清吐司这件事本来是"先 dismiss 再 sleep(120) 再断言没有节点"，
有一轮报 `1 toast node still painted after dismissing 0` —— _store 是空的，但一个还没落地的查询错误
在断言之前把吐司画了出来。改成"清空 + 给覆盖层上 `display:none`，断言的是**没有被绘制**"，
这条 race 才不再依赖时序。**判据要长在它能被保证的东西上，不是长在我等了多久上。**

## Unreleased - 2026-09-30（第四批：两条读数活，一条红自己认领成因，23 条分档）

边界照旧：不新增依赖、不改依赖清单/lock/配置、不 push、不出包、不改版本号（仍 1.4.4）、不打 tag。

### 一、`--danger-solid`：普查答案落第三个分支，而且我上一轮的描述是错的

新量具 `scripts/theme_token_census.mjs`（只报数不判，因为口径还没定）。
语义色族 7 个 token：**分主题 2 个（`--accent`、`--accent-soft`，各 3/3 块），只声明一次 5 个**
（`--danger`/`--success`/`--warning` 在 `:root` 独占；`--accent-solid`/`--danger-solid` **只在 midnight 块里**）。
全仓 85 个主题块 token 里 16 个分主题、69 个只一份，其中 61 个是 midnight 的 `--color-*` 覆写、**sakura 独占 0 个**。

我上一轮把它写成"`--danger-solid` 没有分主题值"——**这句方向反了**：它不是"只有全局一份"，是"只有 midnight 一份"，
读起来像"这个 token 忘了分主题"，实际它是暗色专属覆写，亮色侧对应值走 Tailwind 自己的 `--color-red-600`。

**顺着查下去，那条红是我自己造的**：`ConfirmDialog.tsx:53` 的危险按钮是 `bg-red-600`，
亮色走 `var(--color-red-600)`、midnight 走 `var(--danger-solid)`；而我上一轮为了让 `text-red-600` 在 `bg-red-50`
上够 4.5:1，把 `:root --color-red-600` 定成了 `#b91c1c`——**与 midnight 那个 fill 同一个 hex**。
改之前亮色是 oklch red-600 `rgb(231,0,11)`，两边不同，所以不冻结。
所以它不需要"危险色是否主题无关"这种拍板，只需要亮色那个红别撞同一个 hex（约束：`L ≤ 0.1633` 才在
`rgb(254,242,242)` 上过 4.5:1）。**本轮按边界没改颜色**，也没加白名单。

### 口径已定并升成断言（同笔带着一处真违规）

`theme_token_census.mjs --verify` 现在断言一条规矩：**同一语义色族内声明方式必须一致——族里只要有一个成员分主题声明，
全部成员都必须分主题；全族都只声明一次合法（那是故意的主题无关常量）。**
先自证再判树（`TOKEN_POLICY_SELFTEST cases=5 failed=0`：混合族必须报、统一全局族必须不报、单成员族不报、
`--color-*` 梯子不在范围内），然后当场咬到 **1 处真违规、exit 1**：

```text
TOKEN_POLICY families=13 breaches=1
  BREACH accent: per-theme --accent,--accent-soft but declared once --accent-solid
```

分工要说白：**这条口径治"声明方式不一致"，看不见"两套主题渲染成同一个颜色"**。
`danger` 族按口径是**合规**的（全族都不分主题）；danger 撞 hex 是**渲染事实**，只有量像素的 `theme-surfaces`
能报——所以那条红不是口径违规，是门的假阳性，它要的是签名豁免而不是改色。
`--accent-solid` 才是口径违规，且**修它不需要动任何颜色**（唯一消费它的规则是 midnight 作用域的，
在 `:root` 补一份同值声明不改变任何主题的渲染结果）——本轮按边界没做，`verify_all.mjs` 里写明它为何不作
stage、复算式是什么，留到颜色那一轮同笔接入。

### 二、`layout` 23 条：分档，一条没修

`LAYOUT_GATE checked=21 matched=21 skipped=0 failures=23`。**23 条报警行不是 23 个缺陷**：

| | 行数 | 档 |
|---|---|---|
| A `CONTROL-CUT` 640×480 侧栏底部"教程与帮助" +25px | 7 | 真缺陷 |
| B `CONTAINER-CUT` 640×480 同一块的容器 +33px | 7 | 真缺陷，**与 A 同一条** |
| C `TOUCH-TARGET` 640×480 | 7 | 2 行假象 + 5 行分不清 |
| D `SELF-CLIP` 图库 1024/640 "刷新" 0px 水平 / 4px 垂直 | 2 | 分不清 |

**净：14 真 / 2 假 / 7 分不清。** 三条支撑 A+B 判真的独立读盘：`tauri.conf.json:18-19` `minWidth:640, minHeight:480`
（⇒ 640×480 是产品自己的最小窗口，"用户到不了"这条豁免不成立）；`AppShell.tsx:51` 侧栏 `fixed inset-y-0`；
`styles.css:301-309` 的 `overflow-y:auto` 属于 **`.app-main` 不是 `.app-sidebar`**，全文件找不到给侧栏上 overflow 的规则。

C 的 2 行假象是 label 套 input 那一族（`PublishPage.tsx:217` 的 `<label class="… cursor-pointer … px-3 py-3">`
被按 13×13 的 `input` 记账）；5 行分不清是因为它们的"最小 16×16"全是**吐司关闭按钮**
（`div.pointer-events-none.fixed > … > button`，`关闭提示`）——目标本身真的小，但它是瞬态覆盖层，
现在被并进"这一页有多少可点目标"的计数，于是每路由那个 23/18/15/16/17/14/20 **不是页面的属性，是当时飘几条吐司的属性**。
D 的两个候选因反都能解释"4px 垂直"：真下缘裁切，或 `Range.getClientRects()` 给行盒而非墨迹；分辨它只要一次
`height`/`line-height`/`scrollHeight` 读数，本轮没做，所以留"分不清"。

### 二·五、我自己上一条里有一句说过头了，当场改

写"连跑两次 `measured=1929 points=121632` 逐字相同 ⇒ 可重跑"之后，一小时再跑是 `1902 / 121602`。
区分清楚了：**quiescence 等待保证"拍照那一刻不在重排"，不保证"这一页每次装同样的字"** ——
浏览器态里哪些查询失败、页面上因此有几条错误横幅，是**内容**不是**时序**。
所以"可重跑"要说准：**同批次内可重跑，跨批次候选集会漂**。

处置不是假装分母恒定：`--doc` 的比对**只取比值列**（那才是这一节要钉的不变量），
`判读文字数` 照常生成给人看但不进断言。这条投影带两面夹具，任一方向不成立就报红：
**改一个比值必须仍被抓到**、**只改计数必须不报**。当前同批次两次连跑 `below=0 docDrift=0`。

### 二·七、第一刀已落：同一个根因不再进两个家族

改前原样读数（exit 1）：`LAYOUT_GATE checked=21 matched=21 skipped=0 failures=23`
= 7 `CONTROL-CUT` + 7 `CONTAINER-CUT` + 2 `SELF-CLIP` + 7 `TOUCH-TARGET`。
改后：`failures=16` = **7 `CUT-ROOT`** + 2 + 7，并印恒等式：

```text
LAYOUT_FAMILIES pages_with_cuts=7 family_lines_before_grouping=14 distinct_root_causes=7
                lines_not_double_counted=7 records_listed=21 records_total=21 truncated=0
```

分组键是 `by|axis`（哪个祖先切的、哪根轴）——这是唯一不可能巧合相同的两件事。每行仍带成员构成
（`control=1 container=2`）和最坏超出量，所以信息没丢，只是行数不再冒充缺陷数。
两处恒等式当场 exit 2：`root_causes != distinct(by|axis)` 或 `members != listed`；
以及 `listed + truncated != records_total` —— 最后这条拿的是探针**截断前**自己的计数，
与这里的分组代码无关，所以"分组时漏了一条"会被独立数字抓到。**分档判断本身没变**（那 14 行仍是同一个 bug）。

### 二·八、第二刀已落：侧栏在最小窗口下可滚

改前（第一刀之后那版）`failures=16`（7 `CUT-ROOT` + 2 + 7）→ 改后 **`failures=9`（0 `CUT-ROOT`）**，
`LAYOUT_FAMILIES … records_total=0`。选"给 `.app-sidebar` 上 overflow-y:auto"而不是"把底部块搬出侧栏"，
理由：底部那块在层级上属于导航列尾端，搬走是改 IA；而 `.app-main` 已经是"固定高 + 自身滚动"的同一套模式。
内层栏的 `h-full` 同时改成 `min-h-full`——写死 100% 时溢出的是子盒，滚动条没东西可滚。

**"变成 rail"不等于"滚得到"**，所以判据改成真滚一遍：`RAIL-PROOF … 712 候选 / 712 滚到即见 / 0 unreachable`。
这条判据连吃三个自己的坑才有对：要求整盒进视口（686 假红）→ 只滚到 rail 底端把中段推出去（301 假红）→
`.app-main` 的 `scroll-behavior: smooth` 让 `scrollTop=` 变成动画、量到旧位置（683 假红，必须 `behavior:'instant'`）。
**它目前没有反向夹具**（没种过"滚不到的 rail 必须被报"），所以 `unreachable=0` 只是读数、这条判据**不占功**，
反向夹具排下一轮。另：本轮又踩了一次"注入模板字符串的注释里写反引号"⇒ 文件直接语法坏（第 4 次），已顺手清掉。

### 二·九、反向夹具补上了，它第一次跑抓到的是我自己三个 bug

`RAIL-PROOF` 从"读数"变成"会红的门"。靶子要真滚不到，只能是**被 overflow 裁到负方向**那种形状
（第一版放在 rail 内容之下，`scrollIntoView` 向外连滚祖先，其实滚得到 ⇒ 夹具判的是"靶子不对"）。
顺出三个真 bug：① 可见性只看 rect 与视口相交，被祖先裁到**零高度**的盒子照样通过 ⇒ 现在逐层求交后再量，且要 ≥8px 一条带；
② `scrollIntoView` 滚了外层不还原，同一次跑里两次 `geometry()` 得到 `proven=123` vs `100`——判据自己把页面挪走了 ⇒ 每个被滚祖先先记后原；
③ 靶子的绝对定位偏移是滚动相关的，页面滚过之后靶子落进视口内 ⇒ 先 `scrollTo(0,0)` 再种。
红绿两面都写进 `layout-rail-control.json`；红时三条判据并排印出（`whole-box-fits / after-rail-extreme / after-element-scroll` 全 false
且 `rail moved=false`），这样"红"只能归因于真滚不到，不会退回那三个旧坑。

### 二·十、静态守卫：反引号写进被注入的模板注释里（本仓第 4 次）

我上一轮说"顺手清掉"，你读成"加了守卫"——**当时确实没有守卫，只有 `node --check` 每次接住**。这轮补上：
`check_user_flow.py` 按**反引号奇偶**跟踪是否处在模板字符串内，只对"模板里的注释行含反引号"报红。
自带三面夹具（模板内 planted 违规必须报 / 模板外普通注释不许报 / 闭合后状态必须回到外面）。
第一版写成"任何注释含反引号就报"，立刻在 6 条无害的 Node 侧注释上误报——**六条假红的守卫下一个就会被静音掉**，所以收窄了范围。

### 三、本轮明确不做的

不改任何颜色、不修任何 layout 条目、不给 `paintedByUnmarked` 设上限（你说得对：要卡它得先修标记集定义，
现在那个分母量的是"门自己的粒度"，不是"覆盖率"）、不拆 190 KB harness 也不记成欠账。

## Unreleased - 2026-09-30（第五批：C 的记账拆完，D 那一次读数把一条更大的拽出来）

边界照旧：不新增依赖、不 push、不打 tag、版本仍 1.4.4、不动依赖清单。**本轮没动任何界面。**

### 一、C：`TOUCH-TARGET` 原来把两件事记成一个数

七条 `TOUCH-TARGET` 里有五条的"最小目标"是同一颗吐司近按钮（`关闭提示` 16×16）。
它属于 `ToastViewport`，不属于那五个页面——页面计数现在按 `[role=alert],[role=status]`
把覆盖层拆出去，**跨路由去重后单独成一条**，仍然报红，但不再让五个页面替一个组件背五条：

```text
LAYOUT_OVERLAY distinct_controls=1 instances=28 probe_reported=28 routes_involved=7
```

第二条记账错：`<label>` 套着 `<input>` 时量的是复选框自己的盒子，而手指点的是 label。
判据改为"控件与其关联 label 中较大的盒子"（关联含包裹与 `for=` 两条路径）。
**你点的那两行了落了，但没有一行因此变绿**：

| 原来报的 | 真实可点盒子 | 结论 |
| --- | --- | --- |
| 设置 `13×16 input.size-4` | `36.9×32` 的 label | 缺陷真，要改的是 label 高度 |
| 发布 `13×13 input`（发布完成自动复制） | `446×40` 的整行 label | 缺陷真，差的是那 4px 高度 |

每路由真实计数（640 档，吐司已拆出）：**发布 19、资源 14、云端 11、图库 12、插件 13、任务 10、设置 15**。
恒等式对得起来：改前 123 = 改后 94 页面自有 + 28 覆盖层实例 + 1 个被 label 豁免的目标。
七页现在的"最小目标"是同一族真缺陷：侧栏压到 64px 后 `button.flex.w-full` 只剩 **35×30 / 35×37**。

两条豁免各配一对夹具（`CONTROL-T`）：该免的免掉、**不该免的必须仍然报红**，
且必须以 label 的盒子（60×18）报出——否则修的对象还是错的。覆盖层那半边同时断言
"从页面计数里出去了"与"仍然被记了一次"，因为"拆分"最容易退化成"丢掉"。

### 二、D：那一次读数，判据错了，但它指着的元素有一个真缺陷

图库 `刷新` 那两条（1024 / 640 各一，我挂了"分不清"两轮）按你说的只取一次读数：

```text
box 40px (client 38 / scroll 43), line-height 24px on font 16px,
padding 0px/0px, overflow visible/visible, ink box 45px 伸出 border box [3, 2]
```

`overflow: visible / visible` —— **一个不裁切的盒子不可能"自我裁切"**。那 4px 是行盒
（两行 24px 折行 = 45px）伸出 40px 盒子的部分，它照常上漆。判据现在要求
"被量的那一轴真的在裁切"，作废为 0.1 表最后一行。

绿夹具的第一版是**空转的**：我用拉丁文当文本，它根本不折行，墨迹 21px 从没超过 40px 的盒子，
"没报红"看起来和"判据修好了"一模一样。加了 `plantReproduces`（墨迹必须真的超出盒子，否则判为
测具故障）才咬住。红的那半边同时断言 `hDelta=0`，证明报上来的是纵向那一刀。

而 `刷新` 之所以会折成两行——这才是真缺陷，也是读数顺手拽出来的那条。

### 三、`font: inherit` 写在层外，把 23 个控件的字号整条吞掉

`styles.css:223` 的 `button, input, select, textarea { font: inherit; }` 在**层外**，
未分层声明优先级高于 Tailwind 的 `@layer utilities`，所以这四类元素上自己声明的
`text-xs / text-sm / font-medium` 全部失效。Tailwind 的 preflight 本来就在 `@layer base`
里给了同一条（`tailwindcss/index.css:796`）——**这一行是重复声明，它唯一的净效果就是把层序反过来**。

新判据 `FONT-SWALLOW` 不写死数字：在页面上放一个只挂 `text-xs` 的 `<span>`（控件豁免够不着它），
量出这个工具类在本 app 里真正等于多少 px，再和控件的渲染值对账。`CONTROL-H` 那对夹具
**自带一份 bug**（注入 `button.lctl-swallow{font:inherit}`），所以 app 那行被删掉之后它依然能证明会红。

**两个独立仪器给出同一个 23**：已签字的 §1 基线表里"漂移按钮"合计 = **23**（`visual` 模式
span/button 参照比出来），`layout` 这边 class/计算值比出来也是 **23**
（`FONT_SWALLOW distinct_controls=23 instances_sum=109`）。

**这一条我没修、也没加白名单。** 删那一行会让 23 个控件渲染字号变小、`刷新` 不再折行，
并把 §1 表"字号阶梯"与"漂移按钮"两列一起改掉——那是**重签基线**，按规矩归你签字。
修法是删一行，不是改 23 个调用点。

**自我交代**：这个缺陷早就被量过、早就写在已签字的表里、`visual` 模式里也早就有
`regressions.push(...)`，甚至 `styles.css:169` 的注释里我自己写过"the cascade fact that made
`button { font: inherit }` swallow text-xs"——**知道这个事实，却从没把它当成一条待修缺陷上报**。
这轮不是新发现，是把一个已经量了两轮的数归到了因上。

### 四、判据改动与违规同笔

`layout` 结论：改前 9 条（7 `TOUCH-TARGET` 含 5 条被吐司冒充 + 2 条假 `SELF-CLIP`）
→ 改后 9 条（7 条真实页面计数 + 1 条覆盖层 + 1 条 `FONT-SWALLOW`，`SELF-CLIP` 归零）。
`RAIL-PROOF 712 proven / 0 unreachable`、`LAYOUT_FAMILIES records_listed=0 records_total=0` 不变。
`check_user_flow.py` 新增一条静态断言：源码里不许出现响应式/状态相关的字号工具类
（`sm:text-xs`、`hover:text-sm` 等），因为 `FONT-SWALLOW` 只在 640 一档读——
它自带两面夹具，且把"单档读数为什么是完整的"这件事从我的判断变成断言。

### 五、落盘盲区：先纠正前提，再补守卫

你派活时引用的我那句自报是"落盘守卫只扫 `.log/.tmp/.verify/`，看不见 `.cjs`"。
**盘上查了，本仓没有这条守卫**——`grep` 遍 `scripts/` 与 `tools/` 没有任何扫临时件的代码，
只有一个 `.gitignore`（`*.log`、`*.tmp`、`*.temp`、`*.bak`、`*.swp`、`*~`），
而 `git log --all --diff-filter=A -- '*.cjs'` 空 ⇒ 本仓从未提交过任何 `.cjs`。
所以那个形状要么属于隔壁仓，要么属于一次没留下的临时件；**我不能拿它当"已核实的本仓违规"**。

但前提错了不等于盲区不存在，而且真实方向相反：

| 我以为的盲区 | 盘上的盲区 |
| --- | --- |
| 守卫看不见 `.cjs` | **根本没有守卫**；而 `.gitignore` 恰好把 `.log/.tmp/.bak` 从 `git status` 里藏掉 ⇒ 临时后缀那一路连"有人看一眼"都没有 |
| 按后缀禁就够 | `.cjs/.mjs/.py` 是**真源码后缀**，按后缀禁等于禁掉 `scripts/`；所以 `.tmp-readme-fix.cjs` 只能靠**文件名形状**抓 |

新守卫三条规则，各自写明了为什么：
`STRAY_SUFFIXES` 12 个后缀（树内任意位置、**跟踪与否都算**，因为提交进去的 `.bak` 同样是垃圾）；
`STRAY_NAME_PREFIXES` 12 个自证抛弃的前缀（`tmp-` `temp-` `scratch-` `debug-` `wip-` 两种分隔符）；
根目录未跟踪脚本（`.cjs/.mjs/.py/.js/.ps1/.sh` 且深度 1）——依据是"本仓所有可执行工具都在 `scripts/` 下"
这条事实本身也被断言（根目录跟踪脚本数 = 0）。`node_modules`/`dist`/`target` 等构建区跳过。

**四条"零误报"断言全部带正例对照**：`git ls-files` 里 `.py`=8、`.md`=41 看得见，
才允许说 12 个临时后缀跟踪数 = 0。夹具两面都落盘：
`stray-guard-red.txt`（4 行，每行带"是被哪条规则抓到的"）与 `stray-guard-green.txt`（**必须是 0 字节**，
非空的绿输出本身就是一条发现）。夹具种在临时目录里，不种在工作树——
否则守卫会把自己下一轮跑红。

**与真实违规同笔这一条我没做到，原因是没有可笔的违规**，不是跳过了：
本轮按你的要求重扫了未提交 diff 与整棵树——

```text
live_walk_hits=0   porcelain_untracked=0   uncommitted_diff_hits=0
porcelain_modified=2 ['docs/VISUAL_BASELINE.md', 'scripts/check_user_flow.py']
```

所以 `STRAY_GUARD` 那行自己印的是 `status=not-yet-earned: never caught a real stray, only the planted one`。
**这条门不占功**，等它第一次真的在地上捡到东西再摘这个标。

### 六、门禁自己的输入清单漏了一张签过的纸

顺手扫 membership 时发现：`scripts/verify_shape.baseline.json` 从第一次拆分起就在仓里、
已经被 `--snapshot` 重签过十次，而指纹表的成员规则按名字匹配 `.mjs` ⇒ **唯一一份"改了它就改了
什么算漂移"的文件，是表里唯一没有的文件**。成员现在按形状导出（多一条 `scripts/*.baseline.json`），
两处派生（`fingerprint_rows.mjs` 与 `check_user_flow.py`）同时改，
新行必须先写出来 `--patch` 才肯填数——它拒绝给不存在的行编号，这条行为留着。

### 七、`CONTRAST_FACE_TABLE` 那条红只报数、不报名，被它绊住一次之后修了

`verify:all` 里 `contrast-tier` 有一轮报的是：

```text
FAIL CONTRAST_FACE_TABLE 1 row(s) in docs/VISUAL_BASELINE.md do not match this run
```

**哪一行？没说。** 我去翻上一次跑存的 JSON 才对出来是 `插件` 行。修完之后的原文：

```text
FAIL CONTRAST_FACE_TABLE 1 row(s) ... : 插件 mist: doc 4.74 -> run 4.41;
     插件 midnight: doc 4.92 -> run 4.08. --doc-write regenerates it, but only sign
     numbers you mean to keep: if the run is worse than the doc, regenerating makes
     the regression the baseline.
```

顺带把 `gate-unit` 加了第三组（`doc-table` 5 例，16/16）：表相同 ⇒ 0 行；改一个比值 ⇒ 恰好 1 行且**必须**含
`插件 midnight: doc 4.08 -> run 4.92` 这个串；只改计数列 ⇒ 仍然 0 行；两边行数不等 ⇒ 各自点名。

**这张表我没有 `--doc-write`，故意的。** 存进去的是 `插件 4.74/4.92/4.93`，而跑出来是
`4.41/4.08/4.38`——差的就是那条还没定的 `暂无插件执行记录`。而且它**分批漂**：
同一份代码，一批里三列全漂，下一批只有两列漂（另一批存的又是 `28/26/26`）。
也就是说 `--doc-write` 会把"哪一批"签成基线。**要修的是那个元素，不是这张表。**

### 八、坑③补上了断言（`e0f39cf`）

反向夹具当初为三个坑而写，其中两个有断言、一个只有打印：

| 坑 | 症状 | 此前 | 现在 |
|---|---|---|---|
| ① 686 条假红 | 要求"整个盒落进视口"，比视口高的容器永远不合格 | 有断言（`wholeBox=false`） | 不动 |
| ② 301 条假红 | 只把 rail 滚到底端，中段元素被推到视口上方 | 有断言（`afterRailExtreme=false`） | 不动 |
| ③ 683 条假红 | `scrollIntoView` 走外层、祖先滚动没复原 ⇒ 同一页两次读数 123 vs 100 | **只有 `railDelta/proven_without/proven_with` 三个打印量** | **断言：三量必须自洽，否则 exit 2** |

红绿各跑过一次（改的是 `verify_probes.mjs` 里那两行复原，跑完 `git diff --exit-code` 证字节回到 HEAD）：

```text
拔掉的复原：  HARNESS FAULT: RAIL-CONTROL: the reachability proof does not restore what it
              scrolled: two geometry() calls on one page disagree
              (proven_without=4 proven_with=2 railDelta=0) … 712/0 is not reproducible   EXIT=2
              同时 ① 那条"没报出靶子"也独立报了红（unreachable total=3）
复原在位：    railDelta=0, proven_without=4 === proven_with=4，RAIL-CONTROL 零故障
```

**上一轮"只报不改"的那条，本轮改了**：夹具存的 `probe.unreachable` 是按靶子文本过滤后的数组，
而 `total` 是过滤前的计数（`total=2` 而文件里只有 1 条）。现在拆成 `plantCount` / `pageOthers` /
`total` 三个数，断言 `total === plantCount + pageOthers.length`，并把非靶子那几条**原样印出来**。

### 九、"骑在 4.5 上、分批漂"是我算错了，真因是分母会动

我上一轮手算 `#5b6b80` 压 `#e2e8f0` 得 4.51，据此说这三条红"本来能过、被合成拉到 4.0x"。
**4.51 是错的，真值 4.410**（他独立重算推翻）。而且 fg/bg 逐字等于声明的不透明 token
（`rgb(43,58,82)` 就是 `#2b3a52`），掺了壁纸 alpha 的像素不可能还落在 token 上 ⇒
**三档本来就全低于 4.5，没有"被拉下来"这回事**。

推翻那句错话之后，真问题浮出来：**`checked=1902 failed=0` 那一批不是"硬币另一面"，是分母会动。**

| 证据 | 读数 |
| --- | --- |
| 同一次跑内、同一路由同一主题、只换壁纸，测到的**内容**就不一样 | 批次 A `插件 default` = none 26 / black 28 / white 28；批次 B = 26 / 26 / 28 |
| 动的是哪两个 run（逐元素 diff，不是只报两个数） | `div.mt-0.5.text-xs.text-indigo-700` "配置 OpenAI-compatible…" 与 `div.rounded-2xl.border.border-dashed` "插件列表读取失败：TypeError…" |
| 根因 | `PluginsPage.tsx:18` 的 `plugin-execution-logs` 是 **`refetchInterval: 2500` 轮询查询**；哪几个组合恰好拍在"查询已失败"的时刻，就多带那两行 |
| 我那个"空状态字串"的猜测 | **元素猜对、机制猜错**：`暂无插件执行记录` 72 个组合全在（它就是那条红的元素），出现/消失的是它旁边的**错误面板**，而错误面板改变了它背后被采到的漆 |

⇒ 新判据 `CONTRAST-DENOM`：同一 batch 内、同一路由同一主题的三个壁纸组合，测到集合必须相同，
不同就报红并点名；它在 `CONTRAST_TALLY` 里占**自己一格**（`below + docDrift + denom = stopping`），
不跟"低于阈值的行数"混。今天当场就红：`contentDifferences=4`。

**同时自曝一个我自己的量具缺陷**：我给"逐元素身份"造的串（tag+class+text）**不是单射**——
`云端` 38 个 run 只有 37 个不同身份。第一版用 Set 比，把这件事藏成了"两边各 37 条、恒等式不成立"。
现在改用多重集比，并印 `nonInjectiveIdentityReads=9`，**不拿 Set 抹平**。

### 十、"改了 baseline 会红"这句，第一次演示是失败的

他要我当场演示指纹表纳管 `.baseline.json` 之后真的会红。**第一次翻一个字节 ⇒ 门是红了，
但红的是我自己未提交的代码增长，我翻的那个字节根本没产生信号。** 查下去：`verify_shape.mjs`
的 `problems()` 只比 `totals` 与六族总数，**`baseline.files[]` 每行的 lines/bytes/families 记了
却从来没比过**——所以"这个文件被指纹了"这句话，除聚合数以外对每个字段都是假的。

补上后（每文件 lines/bytes/六族 + 文件集合双向），两面演示留档：

```text
翻 files[1].lines 一个字节（totals 不动）：
  SPLIT_SHAPE DRIFT checked=65 failed=1
    MISMATCH scripts/verify_dialog_interactions.mjs lines: 3101 (expect 3102)     EXIT=1
恢复：SPLIT_SHAPE OK checked=65 failed=0                                          EXIT=0
自证 8/8，新增两例就是"只改每文件行、聚合全对"与"只改每文件某族计数"，各须恰好报 1
```

**这一条现在才算占功。** 上一轮我写"成员按形状导出"时它并不成立。

### 十一、定案：产物里录了却没人核的字段 = 装饰

**规矩（入仓，适用所有门）**：一份产物里记了、但没有任何断言去比对的字段，是装饰，不是证据。
要么给它加断言，要么把字段删掉。**"我把数记下来了"不等于"这个数被看着"**。

第一次演示的原始输出，按"它比第二次成功更值钱"归档在这里——**我翻了一个字节，门红了，
但红里没有一个字提到我翻的那个字段**：

```text
$ python -c "flip one digit inside a per-file 'lines' value"   # 结果翻到了 totals.lines 上
$ node scripts/verify_shape.mjs --verify                       # EXIT=1
SPLIT_SHAPE DRIFT checked=17 failed=3
  MISMATCH total lines across harness files: 4830 (expect 4774)
  MISMATCH total bytes across harness files: 360709 (expect 356002)
  MISMATCH decision points: positive control: 16 (expect 15)
```

三条 MISMATCH 全部来自我自己未提交的代码增量；**我篡改的那个字节零信号**。
根因：`problems()` 只比 `totals` 与六族总数，`baseline.files[]` 每行的 lines/bytes/families
记了却从来没被读过。补完逐文件断言后，同样的篡改变成 `MISMATCH scripts/…​.mjs lines: 3101 (expect 3102)`，
且自证 8/8 里有两例专门钉这件事。

### 十二、身份不单射：选"隔离"而不是"加字段"，并且它现在拦得住绿

`CONTRAST-DENOM` 用的身份串是 `tag+class+text`，**不是单射**（`云端` 38 个 run 只有 37 个身份）。
两条出路里选了隔离，理由是：要单射就得加位置，而**位置会在上方插入内容时整体平移**——
那等于把每一次真实内容变更都变成一次假 diff，这种门一周内就会被人静音。
所以"这一组的 run 我分辨不了"必须记成**本组未验**，并且**让这一批不能算通过**。

拦住的现场就是它自己：这一批 `below=0`（没有任何一行低于阈值），但

```text
DENOM_STABILITY combos=72 routeThemeGroups=24 contentDifferences=6 nonInjectiveIdentityReads=9 unverifiedGroups=3
CONTRAST_TALLY below=0 + docDrift=0 + denom=9 = stopping=9      EXIT=1
FAIL CONTRAST-DENOM-UNVERIFIED 云端|default: 3 combo(s) have runs the identity string cannot tell apart
      (distinct keys < measured runs), so this group's set equality was NOT established
      and it cannot count as verified
```

**换成上一轮的写法，这批会报绿。** 这正是你担心的"漏报而不是误报"。

### 十三、问 2 的答复：TypeError 本体找到了，但我的"间歇招"是过度声明，撤回

| 我上一轮说的 | 盘上查到的 |
| --- | --- |
| 错误面板来自 `refetchInterval: 2500` 那个 logs 轮询 | **错**。面板绑的是 `pluginsError`（`PluginsPage.tsx:116`），即 `listPlugins`，与 2.5s 轮询无关 |
| 查询本身在间歇招 | **错，撤回**。`desktop.ts:92` 的 `invoke` 没有运行时守卫，直接 `import('@tauri-apps/api/core')` 再调 `invoke`；浏览器里 `window.__TAURI_INTERNALS__` 是 `undefined` ⇒ **每次加载都必然抛**，不周期。现测 5 次采样（间隔 350ms）面板 `NO-PANEL` ×5、`distinct=1` |
| 那"同一次跑内进进出出"是什么 | 是**我的普查在抢拍**：`await import(...)` 是异步的，某个组合拍在它 reject 之前、某个拍在之后。所以分母会动是**量具的 settle 竞态**，不是产品缺陷 |

**但确实有一条真的产品问题，只是比我想的小一层**：`PluginsPage.tsx:117` 把 `String(pluginsError)`
**原样上屏**。Tauri 用户平时看不到（invoke 在），可一旦命令层真出问题（命令没注册、panic、权限），
用户屏幕上就是 `TypeError: Cannot read properties of undefined (reading 'invoke')` 这一坨。
这条属于"内部异常直供用户"，和对比度不是一档，**我没有为了跑康普查把它遮掉**，登记待批。

### 十四、拍 1+2（抬 token 到 ≥5.0）本轮没做，明写降级

不是忘了：我剩余上下文不足以完成"改前三拍 → 改 → 改后三拍 → 重跑 `contrast-tier` 判红绿"这一整串，
而**没跑过的编辑不算交付**，半截的颜色改动更糟。

**改前三张已进仓**（原来只钉在 `%TEMP%\image-hosting-probes\2026-09-30\before-token-lift\`，
那是这台机器上最容易被清的位置，而它们是下一笔颜色改动唯一的改前凭证）：
`contrast-tier` 每批都会覆盖 `ct-*.png`，所以复制进 `docs/baseline-images/` 并按 SHAPE 那条规矩登记：

| 改前凭证（`docs/baseline-images/`） | 字节 | sha256 |
| --- | --- | --- |
| `docs/baseline-images/before-token-lift-2026-09-30-default-black-插件.png` | 85,030 | `9459ff00eb3424f3265bb8ed7117ec75ee1a4bfe173a3b8699856522ef5eedf4` |
| `docs/baseline-images/before-token-lift-2026-09-30-midnight-black-插件.png` | 82,303 | `59bc153b4d56b837e03c7fce7c3b231a6c1d97ced7c65c16f722589fbf962146` |
| `docs/baseline-images/before-token-lift-2026-09-30-sakura-black-插件.png` | 85,780 | `1a78aeb57d9bf4228f77d2fa3e48cc8900542c056bb044f891a9076b0a0342f3` |
| `docs/baseline-images/after-token-lift-2026-09-30-default-black-插件.png` | 85,249 | `02bcd5f836cd015efc9038038f85321862b05aff93fa807ff1f4ea8ccf0a6134` |
| `docs/baseline-images/after-token-lift-2026-09-30-midnight-black-插件.png` | 82,139 | `3904359e73edfaad5532401ab0a8bf91227139411dee4f2053ad374f32638523` |
| `docs/baseline-images/after-token-lift-2026-09-30-sakura-black-插件.png` | 86,094 | `fb572ca1651d42cb2c6afa672fd16f90c3323c5d26e1f7586c6ea63f0bcf076d` |
| `docs/baseline-images/before-raw-error-2026-10-01-default-white-插件.png` | 85,837 | `9155d443b85efde767aef5c6b7551443ea0c91ba4e1d73e8c8db5d3f48888cee` |
| `docs/baseline-images/after-folded-error-2026-10-01-default-white-插件.png` | 83,022 | `e99ee164d81276ec06bf004f9c7d8d24d378c37a76e66353421721e870f21a83` |

六张（改前三张 + 改后三张）都含目标元素 `暂无插件执行记录`（`PluginsPage.tsx:136`，`text-slate-400` 压在 `bg-white` 面板上）。
**这张表不是纪律，是断言**：`check_user_flow.py` 逐行比对磁盘上的字节数与 sha256，
图被删、被换、被重新截一张"看起来一样"的都报红——按 §十一 那条定案，登记了没人核的哈希就是装饰。

下一轮只做一件事：按 ≥5.0 抬 `--color-slate-400` 三档、贴改后三张与新的 `CONTRAST_GATE` 读数，**判据一行不动**。
`String(pluginsError)` 那条排在它之后（且修法只许降级措辞、原始异常必须留在用户可取到的位置）。

### 十五、采样过期判据落到"每个元素自己"，MC-2 的两条候选被分开（`80a9ec3`）

**盘上事实**：这条判据只动量具，产品代码一行没改。采集器给每个被采样的元素打标记，
照片落地后立刻重读那个元素的矩形，`moved` / `gone` / `uncomparable` 三个数分开报，
`uncomparable` 不并进"没动"。判据先过自己的五个夹具（植入 470px 必须报、同一份矩形必须 0、
1px 抖动必须 0、缺盒子与畸形必须返回 null 而不是 0），夹具挂在同一批输出里，所以它的 0 是可读的。

同 HEAD、同一条命令跑三批（逐字）：

```text
批 1  GEOMETRY_STALE combosWithStaleRuns=3 movedRuns=21 goneRuns=0 uncomparableRuns=0 of 1896 sampled
      CONTRAST_TALLY below=0 + docDrift=0 + denom=6 + drift=3 = stopping=9      EXIT=1
批 2  GEOMETRY_STALE combosWithStaleRuns=0 movedRuns=0 goneRuns=0 uncomparableRuns=0 of 1902 sampled
      CONTRAST_TALLY below=0 + docDrift=0 + denom=9 + drift=0 = stopping=9      EXIT=1
批 3  GEOMETRY_STALE combosWithStaleRuns=1 movedRuns=7  goneRuns=0 uncomparableRuns=0 of 1900 sampled
      CONTRAST_TALLY below=0 + docDrift=0 + denom=8 + drift=1 = stopping=9      EXIT=1
```

4 个 stale 组合全是 `插件/black`、全是 58px，那条空状态文字自己的读数分成两族：
`moved` 的三条比值 5.32–5.37（底 `226,232,240` / `43,58,82`），`fresh` 的六条 6.56–8.42。
⇒ MC-2 那两条候选：**第 2 条被数成 `0/9`**（没有一个采样像素需要链外的兄弟元素来解释，
§7.5 那次"六层没一层等于被采到的颜色"在这三批没复现）；**第 1 条只落地一半**——
"坐标与像素不同源"成立（同一批里整页两次读都是 null，而那个元素的盒子差 58px），
"照片站在重排的哪一侧"未证（重排落在 `sigShot` 之后、元素重读之前，即在 `captureScreenshot`
这次往返里或它紧邻的几毫秒内）。所以"历史那条红是被过期像素骗的"是推定，不是闭环。
`docs/VISUAL_BASELINE.md` §7.6 有逐行原文、两处自我更正（整页指纹结构上看不见这件事；
`WATCH-PAINT` 那句"是重绘不是采样移位"是错的）
和一条仍开着的缺口（成功布局里被面板替换掉的那一块是什么，没有命名；为什么只落在 `black` 没有解释）。
**这三批 `below` 都是 0**，所以这不是"那条红重现了"，是共现成立、机制独立可观测。

**58px 这一笔后续量过了，方向和我先写的相反**：错误面板自己的盒子实测 `top=287 h=102`，
面板在的布局日志标题在 459、面板不在在 517 ——**面板出现时内容上移 58px**（102px 的面板换掉约 160px
的成功态内容），不是"顶下去"。过期坐标上现在印着 `ownerAtStalePoint = div.p-8.text-center{bg:rgba(0,0,0,0)}`
⇒ 那一点采到的是透明容器**背后**的页面底，这才是低比值的全部来源。
四批合计 stale 组合 3 / 0 / 1 / 2 = **6/288**，全在 `black`（非 black 四批合计 0/192）。

**判据本身现在能从仓里重跑了**（`78111d0`、`503f3c3`）：`rectMoved` / `layoutDrift` 提到模块作用域，
夹具表 `gate-unit` 与扫掠共用同一份，不需要浏览器：

```text
gate unit check: 26/26 correct (viewport 6/6, coverage 5/5, doc-table 5/5, staleness 10/10)
node scripts/verify_guard_mutations.mjs M26 M27 -> 2/2 alarms reproduced, tree restored: clean
  FAIL staleness: rectMoved planted 470px shift -> 0 (expected 470)          # M26 拔掉比较循环
  FAIL staleness: rectMoved live box missing (element unmounted) -> 0 (expected null)  # M27 把"比不了"当"没动"
```

M26 第一次落地时锚点写的是旧的内块缩进（6 空格），runner 报
`anchor missing - mutation definition is stale` 而**没有当通过跳过**——这句留在提交信息里是因为
"锚点烂掉不被静默跳过"就是这本台账的设计要点，本轮是它第一次被自己的手滑验证。
M25 这个编号故意空着不用：它当年针对退出码闩所起草、后因"改不动 oracle 所见"而撤回，
重新编号会让那条撤回说明指向另一条测试。

**跨制品对账一笔**：§十四 末尾那句"下一轮只做一件事：按 ≥5.0 抬 `--color-slate-400`"**已经履行了**，
在 `e65962c`（`--color-slate-400` = `#4e5e73` / `#a4b2ca` / `#6d5765`，磁盘上现值，本轮重读确认）。
本节的 9 条空状态读数是对它的再次确认：**新鲜样本 6.56–8.42，全部 ≥5.0**；
而 5.32–5.37 那三条是过期采样，**今后不得被引作 floor 证据**——它们量的不是那个元素。

**交回你定**：这个门会当场变红，而且是间歇的（同 HEAD 同命令 3 / 0 / 1）。三个处置我都不自行执行——
收下间歇红（每批都可能红）、把 stale 判据从退码里摘出来只留报告行、或者让扫掠等稳态再拍（那是另一件活）。
按老规矩：不加白名单、不放宽阈值。

### 十六、聚合里第三道红不是内容的错，是门自己在 CRLF 下错位（`theme_face_inventory`）

`verify:all` 在 `c57d0d3` 上跑出 **16 passed, 3 failed of 19**（wall=120.0s）：`contrast-tier`
`checked=1900 failed=12`（denom + 间歇的 drift，是我交回你的那件）、`theme-surfaces failed=1`（挂着的那条豁免）、
以及 **`theme_face_inventory THEME_FACE_VERIFY faces=23 docLines=26 mismatch=25`**。

先排除自己：文档里那张表**逐字节没被我动过**——
`diff <(git show 09fb50b 的 BEGIN..END) <(HEAD 的 BEGIN..END)` 只差两行标记。生成器输出与文档表同样逐字相同。
**内容没错，25 行全报红的是门自己的解析。**

根因在块边缘的剥离方式：verify 侧写的是 `doc.slice(...).replace(/^\n/, '').replace(/\n$/, '')`，
而这台机器 `core.autocrlf=true`、工作副本是 CRLF —— BEGIN 标记之后的第一个字节是 `\r` 不是 `\n`，
那个 `replace` 根本不吃，于是 `have[0] === ""`，整表**错位一格**：
`doc 说 页面·图库 / code 说 页面·插件`。docLines 也因此从 25 变成 26。
⇒ 判据取决于 checkout 状态而不是取决于内容，属于"半坏的门"，而且它这次是**喊狼**（内容一致却报 25 条）。

修法把归一化收进 `compare()` 这一个出口（块首块尾空行都去掉），并补**两面**夹具：

```text
THEME_FACE_SELFTEST cases=7 failed=0
  ok   the same table written with CRLF verifies clean: got=0 expect=0
  ok   a leading blank line verifies clean: got=0 expect=0
  ok   a changed digit is still reported under mixed endings: got=1 expect=1
THEME_FACE_VERIFY faces=23 docLines=25 mismatch=0     REAL_EXIT=0
```

第三例是承重的那一面：**只证"能容忍"是不可证伪的**，必须同时证混合行尾下改一个数字仍然恰好报 1 行。

两处**具名但没动**的：① `faces=` 这个标签把合计行也算进去了（`checked = 行数 - 2`，23 = 22 个面 + 合计），
改它要同时动 `verify_all.mjs` 的 `count:` 正则和已登记读数，没批不动；
② `contrast-tier` 的 DOC-TABLE 切片用的是**同一形状**的边缘剥离，本轮没给它加行尾夹具，
它在 CRLF 工作副本下的行为**未验**——记为待办，不记为"没问题"。
另自曝一次取数错误：我第一次跑 `--verify | head -3` 拿到 `VERIFY_EXIT=0`，那是 `head` 的退码，
重跑不带管道才是门的真退码。

### 十七、同一形状的边缘剔离：全仓普查，具名到行号，逐条标有无夹具

普查命令（可复算，范围是 `scripts/` 下的 `.mjs`/`.py`/`__fixtures__`）：

```bash
cd /d/image-hosting-platform && grep -rnE "split\(.{1,2}\\\\n|\^\\\\n|\\\\n\\\$|splitlines|replace\(.\\\\r" scripts/*.mjs scripts/*.py scripts/__fixtures__/*.mjs
```

本轮它返回 **25 行 / 11 个文件**（`theme_face_inventory` 5、`check_user_flow` 4、`verify_dialog_interactions` 4、
`verify_shape` 2、`verify_all` 2、`verify_release_assets` 2、`fingerprint_rows` 2，其余各 1），
下表按这个集合逐条标。**表里列的位置是这 25 行里参与"跨源按行号比对 / 或把行尾写进数"的那几条**，
纯解析子进程 stdout 的（`verify_all:300,308`、`verify_guard_mutations:283`）也在表里，理由一并写。

| 位置 | 形状 | 会不会咬 | 夹具 |
| --- | --- | --- | --- |
| `scripts/theme_face_inventory.mjs:107`（`norm`，被 `:108/:109` 按行号比对消费） | 归一化在比较里 | 修前咬过：CRLF 工作副本 ⇒ 25 行全红 | **有**（`--selftest` 例 4/5/6：整表 CRLF 干净、前导空行干净、混合行尾改一个数字仍报 1 行） |
| `scripts/theme_face_inventory.mjs:180`（`.replace(/^\n/,'').replace(/\n$/,'')`） | 边缘剔离本身 | 不会——`:107` 已吞掉块首空行 | 由上一行的例 5 覆盖 |
| `scripts/verify_dialog_interactions.mjs:231-235`（`normBlock` + `stripCountCol`，DOC-TABLE 按行号比对） | 与 `theme_face` 同形 | **修前未验**，本轮补 | **有**（gate-unit `doc-table` 新增 3 例：CRLF 干净、前导空行干净、混合行尾仍抓到改比值；`M28` 从仓里把归一化拔掉） |
| `scripts/verify_dialog_interactions.mjs:2208`（slice 后那两个 `replace(/^\n/,'')`） | 边缘剔离本身 | 不会——`stripCountCol` 内部已归一 | 同上 |
| `scripts/verify_shape.mjs:53,57`（`readFileSync` 工作副本 ⇒ `split('\n').length` 与字节） | 台账把行尾写进数 | **会——已证，本轮未改**：同文件磁盘 `3356L/275,995B` vs 表里 `3355L/272,640B`，差 **3,355 = CR 计数** | **无**（下表"活体差值"就是它的现测） |
| `scripts/fingerprint_rows.mjs:59`（`git show HEAD` ⇒ 恒 LF，`bytes: data.length`） | 同上但只吃 blob | 不会（blob 无 CR），但**与上一行不同源⇒两份台账的字节数不可互引** | 无（本轮只标，未改定义） |
| `scripts/check_user_flow.py:518`、`scripts/verify_release_assets.py:71` | 读 blob 后**先 `replace('\r\n','\n')` 再 split** | 不会——这是同族的正确写法 | 无（本轮只标） |
| `scripts/check_docs_site.py:145`、`scripts/check_user_flow.py:354,633`、`scripts/check_workflow_action_pins.py:25`、`scripts/verify_release_assets.py:163` | `splitlines()` 逐行、不做跨源按行号比对 | 不会——Python `splitlines()` 按 Unicode 行边界切，`\r\n`/`\r`/`\n` 都算，残留不到比较值里 | 无（本轮只标） |
| `scripts/theme_token_census.mjs:45`、`scripts/verify_all.mjs:300,308`、`scripts/verify_guard_mutations.mjs:283` | 行内容再 `trim()` 或解析子进程 stdout（LF） | 不会 | 无（本轮只标） |

**无夹具的那几条不得当"已验"引用。** 其中 `verify_shape` 的活体差值本轮现测：

```text
git show HEAD:scripts/verify_all.mjs    | wc -c = 25424    工作副本 wc -c = 25424    CR = 0
git show HEAD:scripts/verify_probes.mjs | wc -c = 47295    工作副本 wc -c = 47295    CR = 0
scripts/verify_dialog_interactions.mjs  工作副本 wc -c = 281912   CR = 3424   指纹表记 278,488B
                                        281912 − 3424 = 278488  ⇒ 两份台账的差恰是该文件的 CR 数
docs/VISUAL_BASELINE.md                 805/806 行以 \r 结尾（node 侧读原文数出来）
```

⇒ **这台机器的工作副本是"逐文件混合行尾"**：未编辑过的脚本是 LF，被我编辑过的脚本与文档是 CRLF。
所以 `verify_shape` 记工作副本字节这件事**现在还没咬**（上面那两个未编辑文件 blob==work），
但它编码的是 checkout 形态而不是受版本控制的内容；真实差值本轮已见两例：
`281,912 − 3,424 = 278,488`，以及更早一批的 `275,995B` vs `272,640B`（差 **3,355 = 当时的行数 = CR 数**）。
**改法我没动手**：动它等于改台账定义，`--verify` 会对 6 个文件报红并要求一次写清"行尾归一"的重签——这条等你拍。
**同时撤回我自己**：这一节第一版配的数（`blob=278488B / work=281897B / 差 3409` 与一个不存在的 SHA `24f16a4`）
是我**没测就写进去的**；上面这块是现测替换，每行都能用同一条命令复算。

`theme_face_inventory --selftest` 的 7 例**不在 `verify_all` 的 19 个 stage 里**（`check_user_flow.py` 也不跑它），
所以它今天只在这条命令被手打时执行——登记了没人打，属于"录了没读"家族，一并具名。

### 十八、四处"把异常当标题"改成折叠可取（产品侧，本轮唯一改动）

`PluginsPage.tsx:117`、`AssetsPage.tsx:163`、`StoragesPage.tsx:206`、`TasksPage.tsx:58` 原先都是
`X读取失败：{String(error)}`——浏览器里跑会看到
`插件列表读取失败：TypeError: Cannot read properties of undefined (reading 'invoke')`，
真机上则是 Rust 侧原文。**我第一版只列了三处，`TasksPage` 是 grep 剩下的形状时自己撞出来的第四处。**

统一走 `components/ReadFailurePanel.tsx`：标题只说人话（`插件列表读取失败`），下面一行说明去哪儿看，
原始异常收进 `<details><summary>原始错误</summary>`——**降级措辞但没删证据**，按你给的约束办。
面板几何（圆角/内距/`col-span-*`）逐页原样传进去，配色沿用各页现有的 `text-red-600 on bg-red-50`，
**没有新增主题反色面**（`bg-slate-950 + text-slate-200` 那种写法在 midnight 下是深压深，
`SettingsPage.tsx:341` 已经有一份，我不再复制第二份）。

改前/改后各一张已进仓并按哈希登记（`docs/baseline-images/before-raw-error-…` 85,837B /
`after-folded-error-…` 83,022B，表从六行改到八行，`BASELINE_IMAGES registered=8 verified=8`）。
渲染实测：面板在场时该组合 `rows=29`（26 + 标题 + 说明 + `原始错误` 摘要），折叠内的原文不进采样。
`contrast-tier --routes=插件` 三主题九组合 `below=0`。

**新断言先红后绿**（`check_user_flow.py`，253 项）：禁 `读取失败：{String(` 形状、要求四页**渲染**
`<ReadFailurePanel`、要求组件里有 `<details>`。红演示是把 `PluginsPage` 那一行临时改回旧写法后跑出来的，
逐字在 `%TEMP%\image-hosting-probes\2026-10-01\userflow-red-plant2.log`：

```text
FAIL no read-failure panel prints String(error) as its headline (offenders: apps/desktop/src/pages/PluginsPage.tsx)
FAIL all four read-failure panels render the shared component (missing: apps/desktop/src/pages/PluginsPage.tsx)
user-flow checker FAILED: 3 of 253 check(s)
```

**第一版断言被 import 糊过去了**（我写的是 `'ReadFailurePanel' in text(p)`，改回旧写法后那半边没红，
因为 import 还在）——正是我自己记过的"符号存在≠接线"。收紧成找 `<ReadFailurePanel` 之后两条都红了。
上面那个 `3 of 253` 里第三条是指纹表过期（我那时还在改这个文件），不是断言。

### 十九、MC-2 的仪器侧关闭：照片属重排之后，被换掉的块有名字

第二次拍照 + 一次"布局有没有又动"的复核（`layoutSettled`），三组全同一方向：`shot1 == shot2` ⇒
**第一张照片拍的就是重排之后的布局，过期的是坐标**；反方向 **0/3**。§7.6 留的"照片站哪一侧"到此关闭。
被换掉那块也命名了：日志卡上面是**"上传插件"那张卡**（`section.mt-8.rounded-[28px].border`，当前态 `h=328`），
58px 出在它内部（102px 错误面板换掉约 160px 列表），不是另一张卡。逐行读数在 `docs/VISUAL_BASELINE.md` §7.7。

方法上自曝一条：`PIXEL_AT` 第一版把 `img.src=` 写在 `await` **之后**，`onload` 永不触发 ⇒ 整批扫掠**死锁**，
被外层 timeout 抓到（日志停在第 6 行）。**探针自己死锁时不会报错，只会让上一行读数变成
"最后一次成功运行的输出"**——所以这类跨进程取证的每一段都得带 timeout，没有 timeout 就等于没有证人。
判据一行未动：`drift` 桶的处置仍在 owner 名下，本轮只加取证。

### 二十、`CONTRAST-DENOM` 的机制我写错了：不是 2.5s 轮询来回开关，是一次性 settle

§十一 那行根因写的是"`PluginsPage.tsx:18` 的 `plugin-execution-logs` 是 `refetchInterval: 2500` 轮询查询；
哪几个组合恰好拍在'查询已失败'的时刻，就多带那两行"。**"哪几个组合拍到"这个结论对，机制不对**——
它不是被轮询来回开关的。新探针 `--churn=<text>`（每 250ms 采一次存在性，窗口 20.5s，只进报告行、不进退码）
两轮 × 三主题 = **6 个窗口、123.3 秒观测**：

```text
RUN4  default  window=20642ms first=0 last=1 transitions=1 at=[3021ms:0->1]
RUN4  midnight window=20575ms first=0 last=1 transitions=1 at=[31042ms:0->1]
RUN4  sakura   window=20568ms first=0 last=1 transitions=1 at=[59033ms:0->1]
RUN5  default  window=20549ms first=0 last=1 transitions=1 at=[2856ms:0->1]
RUN5  midnight window=20527ms first=0 last=1 transitions=1 at=[30771ms:0->1]
RUN5  sakura   window=20594ms first=0 last=1 transitions=1 at=[58195ms:0->1]
```

⇒ **翻转 6 次全是 `0->1`，`1->0` 零次。** 若真是 2.5s 轮询在开关内容，20.5 秒窗口里该有约 8 次、且双向。
所以那两行是"进入路由后出现一次、之后常驻"；组合之间看到 26 还是 28，取决于**那次访问距它自己的挂载过了多久**，
不是轮询相位。

**我第一版把 3021/2856ms 说成"与默认重试退避 `100+1000+2000=3100ms` 吻合"，这句是错的，两处错**：
① `main.tsx:22-26` 的实际配置是 `staleTime: 10_000` + **`retry: 1`** + `refetchOnWindowFocus: false`，
默认三次重试的算术前提根本不存在；② 那三个数是 `performance.now()` 的**累计值（距文档加载）**，
SPA 不重载文档，所以它不等于"距路由挂载"。补上锚点（导航后立刻读一次页面时钟）重测两轮，真数是：

```text
RUN6 default/none/插件  at=[3024ms[距挂载919ms]:0->1]   RUN6 midnight/none/插件 at=[31427ms[距挂载698ms]:0->1]
RUN6 sakura/none/插件   at=[59740ms[距挂载663ms]:0->1]
RUN7 default/none/插件  at=[3199ms[距挂载1027ms]:0->1]  RUN7 midnight/none/插件 at=[31149ms[距挂载670ms]:0->1]
RUN7 sakura/none/插件   at=[58769ms[距挂载663ms]:0->1]
```

⇒ 面板在**挂载后 663–1027ms（6 个窗口，两轮 × 三主题）**出现一次并常驻，零次 `1->0`，
与 `retry: 1`（一次失败 + 一次约 100ms 退避重试）一致。
**这才是 `CONTRAST-DENOM` 与 58px 过期采样的共同上游**：静默等待在第一次 fetch 落地之前就判了"稳"，
所以它保证的是"拍照那一刻页面没有在动画"，不保证"这一页的查询已经定下来"。
判据一行未动；`denom`/`drift` 两个桶的处置仍在 owner 名下。

### 二十一、把静默等待对齐到实测 settle：`denom` 漂移与 `drift` 过期一起归零

§二十 找到的上游是**等待条件本身**：原来要求 3 个 120ms 等值采样（360ms 静音），
而面板落在挂载后 663–1027ms，中间"查询在退避"那段**本身就是静音**——所以旧规则可以先判"稳"，
再被 58px 重排抽掉地板。改成 **12 个连续等值采样 = 1440ms 静音**（余量 ≥ 实测振幅，按他定的规矩），
并把每次实际 `waited` 印出来（本批 24 次页面装载：18 次 1440ms、**6 次 2040ms**，
说明这 6 次确实又动过、被新窗口等到了）。

**先 diff 集合再谈阈值**（同一命令 `contrast-tier --watch=暂无插件执行记录`）：

| 读数 | 修前（五批） | 修后（本批） |
| --- | --- | --- |
| 插件路由 9 个组合的 `rows` | `26/26/28/26/28/28/26/28/28`（三种态混着来） | **9 个全 29** |
| `DENOM_STABILITY contentDifferences` | 6 / 6 / 8 / 9 / 4 | **0** |
| `GEOMETRY_STALE combosWithStaleRuns` | 3 / 0 / 1 / 2 / 1（合计 7/360） | **0/72** |
| `CONTRAST_TALLY` | `below=0 + docDrift=0 + denom=8..9 + drift=0..2 = 8..11` | `below=0 + docDrift=0 + denom=3 + drift=0 = stopping=3` |

**分母是涨上去并稳住的，不是遮掉的**：26 → 29 是因为读取点挪到"面板已在"之后，
加上本轮那处 UI 改动把面板从 1 行变成 3 行（标题 + 说明 + `原始错误` 摘要）。
剩下 `denom=3` 是 `CONTRAST-DENOM-UNVERIFIED`（`云端` 三组的身份串不单射），
与 settle 无关、仍拦退码，**没有为它加任何豁免**。

`drift` 桶本批为 0，但**不摘"会间歇红"的横幅**：修前它真红过 7 次，判据留着；
它的处置（收下/摘出退码/等稳态再拍）仍在 owner 名下。

## Unreleased - 2026-10-01（v1.4.5 出包失败的根因、danger 家族、分母单射）

本轮提交：`36e02e3`（测具）、`291349e`（产品 + 文档）。状态以 `git -C D:/image-hosting-platform status -sb` 为准，
本文件不写 ahead 数（理由见上面那节：写了就少一笔）。**未 push**，远端 `dev` 仍在 `1e951f9`。

### 1. v1.4.5 的 Release Bundle 为什么红：runner 掉线，不是代码坏

读数全部出自 GitHub 接口，未认证即可取（`logs` 端点要登录，未认证回 404）。

- run `36848037622`（`Release Bundle`，`event=push`，`ref=v1.4.5`，`head_sha=1e951f9`）= `completed/failure`，`attempt=1`，
  `updated_at=2026-10-01T11:10:00Z`（本地 07:10）。
- 作业 `windows-bundle` 19 步里 [1]–[10] `success`，**[11] `Build Windows bundles` 停在 `in_progress` 而作业已 `completed/failure`**，
  [12]–[17] 全 `pending`；`publish-release` = `completed/skipped`。
- 注解原文（`check-runs/110322789414/annotations`）：**`The hosted runner lost communication with the server.`**
- 三条判别证据把它和"代码报错"分开：`windows-bundle` 写着 `timeout-minutes: 75` 而作业死在 **54m01s** ⇒ 不是超时；
  `/timing` 的 `billable.WINDOWS.total_ms=0` ⇒ GitHub 按未正常结束计费；`v1.4.4 → v1.4.5` 共 132 笔提交，
  但 `Cargo.toml` 只改 version 一行、`Cargo.lock` 无新增依赖、`release.yml` 只**删掉** `docs-bundle` 作业、
  `windows-bundle` 的 19 步一步没加 ⇒ 2.4 倍耗时（1340s → 3245s）在构建输入侧找不到解释。
- `releases/tags/v1.4.5` = **404**；releases 列表共 6 个（`v1.4.0`–`v1.4.4` 各 4 个资产）**没有 v1.4.5**
  ⇒ 没有任何对外资产被发布，也就没有"下载即坏"暴露给用户。
- **一条测量工具缺陷（本机复现）**：上一轮盯包的轮询器从 06:46:37 起连打 31 分钟 `NORUN`，把"已失败"读成"进行中"。
  原因是未认证 REST 配额 60 次/时/IP 被耗尽（本机是共享出口 IP）：`remaining=0`、`reset=07:15:48`、
  报文 `API rate limit exceeded for 111.27.26.147`，而轮询器把 403 落进了"查无此项"的默认分支。
  **该改的方向**：轮询器每行必须打印 HTTP 码与剩余额，非 200 走独立状态——换通道，不换期望值。
- **本轮未做**：重跑作业、改 workflow、任何出包动作。触发 CI 与对外发布不在这轮的范围里。

### 2. danger 家族：亮色主题的底色不再继承 midnight

细节与改前/改后渲染图见 `docs/VISUAL_BASELINE.md` §5.2。

- `theme-surfaces`：`frozen=8 offThemeUnwhitelisted=1`（rc=1）→ `frozen=7 offThemeUnwhitelisted=0 whitelisted=7`（rc=0，186 面全判）。
- 同一页面、同一对话框、只换 CSS 文件的两面像素：sakura `rgb(185, 28, 28)` → `rgb(168, 19, 48)`，墨色始终 `rgb(255, 255, 255)`。
- 机制改动是把两条 midnight 专属的 `.bg-red-600` / `.hover:bg-red-700:hover` 覆写改成**无主题前缀**、读 `var(--danger-solid)`；
  `ConfirmDialog.tsx:53` 的 className 一个字没动，default 与 midnight 渲染逐字不变。
- 口径一升当场咬到真违规：`token_policy` 报 `danger` 族混合，追出 **`--danger` 是零消费者的死声明**
  （`grep -rn "var(--danger)" apps/desktop/src website examples` = 0 命中），删除。
  `--success` / `--warning` 同样零消费者，但各自成单成员族、不违反口径 ⇒ **只在此列名，不顺手删**。
- 台账签字（`--doc-write`，只重写标记块；先红的原始输出已存档）：`danger-fill` sakura `6.47 → 7.5`；
  `插件` midnight `5.95 → 6.18` 且**分母动了** `26/28/26 → 29/29/29`。后者**不记成本轮改色的功劳**——
  `--danger-solid` 不参与该面测量，其形状与 §4.36 的 2.5s 轮询错误面板一致，按"未证实的外因"登记。

### 3. 分母单射：上一批欠的 `denom=3` 闭合

上一批写着"剩下 `denom=3` 是 `CONTRAST-DENOM-UNVERIFIED`（`云端` 三组身份串不单射），仍拦退码，没有为它加任何豁免"。
现已闭合（详 §4.38）：身份串带**同一基础键内的出现序号**，`auditDenominators()` 抽成纯函数，
配 4 + 3 条夹具，其中含**负面对照**——植入重复键必须仍隔离、`#1/#2` vs `#1` 必须仍报内容差异，任一不符 `finish(2)`。

- `DENOM_INJECTIVE selftest identityCases=4 denomCases=3 allAsExpected=1`
- `DENOM_STABILITY combos=72 routeThemeGroups=24 contentDifferences=0 nonInjectiveIdentityReads=0 unverifiedGroups=0`
- `CONTRAST_GATE combos=72 measured=1917 below=0 docDrift=0 denom=0 drift=0 unresolved=0`（rc=0）
- `visual` 新增 `--theme=`：外观证据必须能按主题渲，否则只动一套主题像素的改动拍出来前后一样。

### 4. 推送与 dev 上的 CI 终态（run `36863157166`）

- 推送事实：`1e951f9..e55cc34 dev -> dev`，快进、无 `--force`；推后 `git ls-remote origin refs/heads/dev`
  复核远端 = `e55cc34c6f09df5386327ed4dbdf89d25ff4d7d2`，与本地 HEAD 逐字相同。
  通道：本机 `github.com:443` 直连超时（DNS → `20.205.243.166`）而 `api.github.com` 通，
  故 git 走内联 `-c http.proxy=http://127.0.0.1:7897`，**未写任何 config 文件**。
- run `36863157166`（`CI`，`run_number=144`，`head_sha=e55cc34`，`event=push`，`attempt=1`）
  = **`completed / success`**，`created=2026-10-01T12:38:52Z`、`updated=12:42:38Z`
  （本地 08:38:52 / 08:42:38，wall 226s）。**没有 annotation 需要读**：结论是 success，且唯一作业没有失败步骤（下表）。
- 覆盖面（作业 `desktop-check` 单作业，wall=222s，25 步 = 24 `success` + 1 `skipped`）：
  真跑过的有 [6]–[12] 七个静态契约（validate / command / user-flow / docs-site / action-pin / release-version / tauri-family）、
  [13] Node 与 `.node-version` 一致、[14] 提交的锁文件一致、[15] `cargo fmt --check`、[17] `cargo check --workspace --locked`、
  [18] `cargo test --workspace --locked`、[19] Desktop build、[20] Docs build、[21] 上传锁文件。
  **唯一被 skip 的是 [16] `Upload rustfmt diff`** —— 该步只在 rustfmt 产出 diff 时上传，skip 即"格式无差异"，不是漏跑。
  artifact 恰 1 个：`dependency-locks` 95,675 B，未过期。
- **这道绿不覆盖什么**（不许把"作业存在且未失败"读成"验过了"）：`ci.yml` 根本不跑 `verify:all`
  （grep 不到 `verify_all`），所以 19 stage 的浏览器门（`contrast-tier` / `theme-surfaces` / `visual` / `gate` /
  `mutations` 等）**只在上节那次本地干净树跑里被验过**，CI 这道绿不为它们作证；
  `windows-bundle`（`tauri build` + NSIS/MSI 冒烟 + 资产暂存 + 发布）属 `release.yml`、只在 tag push 上跑，本道绿也不为它作证。
- **我挂的推进器是半瞎的，记成人读的一行**：它每行印 `http=200` 与剩余配额，看着健康，但 20 次全 `PARSE_ERROR`
  后按预算退出（09:06:30 `BUDGET_EXHAUSTED`），一次状态都没读到。根因是路径两侧不一致——
  `curl` 写 MSYS 的 `/tmp/cirun.json`，`node` 按 Windows 的 `C:\tmp\cirun.json` 读。
  ⇒ **纪律补一条：`http=200` 只证明传输，不证明解析**；载荷读不出来必须是独立退码并立刻停，
  不能继续轮询到预算耗尽——这是"半坏自检比没有更坏"的又一例，因为它比没挂推进器更像在工作。
- 复算（**该读数只对该 run 在该时刻有效**，引用前现查）：

```text
$ curl -s -o ci_run.json -w "run_http=%{http_code}\n" \
    https://api.github.com/repos/159357yangjun/image-hosting-platform/actions/runs/36863157166
$ node -e "const r=require('./ci_run.json');console.log(r.status+'/'+r.conclusion+' @'+r.updated_at)"
completed/success @2026-10-01T12:42:38Z
```

本轮三份原始产物落盘：`image-hosting-probes/2026-10-01/ci_run.json`、`ci_jobs.json`、`ci_art.json`。

### 5. 盯包的推进器进了仓：`scripts/watch_ci.mjs`（那把半瞎的已删）

**位置按仓里的约定来，不自创**：`scripts/` 下**没有任何 `.sh`**（实测 9 个 `.mjs` / 8 个 `.py` / 4 个 `.ps1`），
运维件放 `scripts/` 并由本文件引用（`release.ps1`、`fingerprint_rows.mjs` 同此路）⇒ 它是 `.mjs`，
依赖只有 `node:fs` + `node:path` + 全局 `fetch`，**零第三方、无 token、无代理**。

**三条硬规矩，每条对应本轮真翻过的车**：

1. 每行必须带上**本轮真解析出来的** `status=` / `conclusion=` / `updated=` 字段本身，不是只有 `http=200`
   —— `http=200` 只证明传输，不证明解析；
2. **非 200 是"瞎"，不是"没有"**：立刻停、退 2。（上一版把配额耗尽的 403 落进"查无此项"分支，
   于是把已经失败的包读成"进行中"，还连着读了 31 分钟。）
3. **预算关不掉**：`--polls` 默认 20，`0` / 负数 / `NaN` / `Infinity` 一律拒绝并退 2。

**两面夹具**（`node scripts/watch_ci.mjs --selftest`，不联网）：`WATCH_CI_SELFTEST cases=7 failed=0`，
其中 4 条是负向（缺 conclusion、HTML 冒充 200、`polls=0`、`polls=Infinity`）。
**夹具第一轮就咬出我自己两处 bug**，这正是它存在的理由：

- 解析器原先要求 `conclusion` 是非空字符串，而 GitHub 在 `in_progress` 期间它就是 `null`
  ⇒ 监视器会在第一次未终态时退出，**等于根本不能盯**。改成：只有 `status=completed` 时 `conclusion` 必须是字符串，
  未终态印 `-`；这条用例永久留在夹具里（`an in_progress payload is NOT terminal`）。
- 负例的**退码是 127 而不是 2**：Windows 上 `process.exit()` 撞在未关闭完的 fetch 句柄上会触发 libuv 断言
  （`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c`）。**退码就是契约**，
  所以全文不再调用 `process.exit`，改为 `main()` 返回码 + `process.exitCode`。

**runner 级两面，原文归档**（`image-hosting-probes/2026-10-01/watch-{selftest,positive,neg-path,neg-404}.txt`）：

```text
$ node scripts/watch_ci.mjs --run 36863157166 --polls 1                                rc=0
POLL pass=1 12:09:44 http=200 quota_remaining=45 run=36863157166 status=completed conclusion=success updated=2026-10-01T12:42:38Z archived=...\watch_ci_36863157166_pass1.json
TERMINAL pass=1 12:09:44 run=36863157166 completed/success updated=2026-10-01T12:42:38Z

$ node scripts/watch_ci.mjs --run 36863157166 --polls 20 --dir <某个普通文件>/nope      rc=2
POLL pass=1 12:09:45 http=200 run=36863157166 :: HARNESS FAULT - ENOTDIR: not a directory, mkdir '...\ci_run.json\nope'; the transport worked and the reading did not, which is exactly the shape that produced a false "in progress" before. Stopping.

$ node scripts/watch_ci.mjs --run 999999999999 --polls 20                               rc=2
POLL pass=1 12:09:46 http=404 run=999999999999 :: BLIND - a non-200 is not "the run disappeared"; stopping rather than polling on.
```

两条负例都在 **pass=1 就停**；旧版是刷满 20 行 `http=200` 再按预算退出、且退码 0。

**覆盖关系说白**：`watch_ci.mjs` **不在指纹表的成员规则里**（成员由 `scripts/verify_*.mjs`、`__fixtures__/*.mjs`、
被 stage 引用的 `scripts/*.mjs`、`*.baseline.json` 四条规则导出）。这不是漏，是实测确认的归属：
`USERFLOW_CHECKS total=253 failed=0` 与 `SPLIT_SHAPE OK checked=65 failed=0` 都不含它。
它的牙来自**自己文件里的 7 条夹具**，与 `release.ps1` 同属"自带夹具的运维件"，不靠台账背书。

**被删的那把**：`Documents\Qoder\2026-10-01\7098e13a\watch-ci-dev.sh`（1473 B，08:39，从未入库）。
删除前的引用普查全部为空：`git log --all -- '*watch-ci-dev*'` 无、仓内 ripgrep 无命中、
会话目录 grep 无、`image-hosting-probes` 目录 grep 无。取代它的记录 = 本文件第 4 节那段推进器缺陷 + 本节这件仓内脚本。

### 6. `confirm` 与 `pages` 从"显示"升成"门"，聚合成 21 stage

上一节记的是"读数缺失"，这一节记的是**读数从来不判定**。`confirm` 与 `pages` 两个模式块内
`process.exit`/`finish`/`emitGate` 命中为 0（`pages` 连 `throw` 都是 0），
它们把"Escape 是否关闭对话框""点框内是否误关""没有 Tauri 运行时路由是否整页塌掉"全部 `record()` 打印后
**一律退 0**。它们又不在聚合里，所以此前所有"19/19 全绿"从没为这些性质作证过。

**改法**（判定与测量分离，判定是纯函数）：

- `confirmVerdict(steps)` 19 条断言：初始焦点必须落在"取消"而不是危险按钮、Escape/遮罩/X 三种关闭路径各自成立、
  **框内按下不得关闭**、Enter 只激活聚焦的取消键（不能触发删除）、四个长文本尺寸都无横向溢出、
  确认按钮在应用真实可达的窗口里"在屏上或可滚到"、z-[95] 与 toast/upload 层的共现次序确定（平手必须恰好一方胜出）、
  以及**步骤本身不能悄悄少一步**。
- `pagesVerdict(entries, routes)` 每路由 5 条 + 1 条"路由集合完整性"：`heading` 必须等于该路由名、
  `#root` 子节点 >0、文本长度 >0、侧栏导航仍在、导航不得抛错。
- 两者在模式末尾 `emitGate` + `finish(failed?1:0)`，因此可被聚合的双向对账（退码 vs `ok`/`failed`）接住。

**夹具先行**（`VERDICT_SELFTEST cases=14 failed=0`，无网络）：14 条里 7 条是植入失败必须被抓到
（Escape 不关、框内按下把对话框关了、Enter 触发了动作、按钮既不可见也滚不到、z 平手两边都不命中、
某一步整个消失、路由少访问了一条），另含一条**反向**——
`below-app-minimum-420x720` 低于 `minWidth 640/minHeight 480`，产品进不去，
所以它**只印 INFO 不进退码**；而同一尺寸上的横向溢出**仍然要判**（防止"跳过"变成整块豁免）。

**夹具先行的价值当场兑现**：第一版判据在真记录上报了 3 条红，逐条查全是**我自己的判据错**——
长文本尺寸我数成 3 个（实为 4）、1440 那个采样器字段名是 `documentHasHorizontalScroll` 而非 `docOverflowX`、
`/app-minimum/` 把 `below-app-minimum` 也吞了进去。若直接按"让它变绿"去放宽，这三处会被写成永久漏判。

**聚合接入**：两条 stage 加在 `ab` 之后（`needsServer`、`gateJson`、timeout 300s），
`AGGREGATE_SELFTEST cases=5 failed=0 stages=21`。顺带修掉 `verify_all.mjs` 头部那段编号注释——
它写着 12 stage 而数组已有 19，"每次加 stage 都得记得改它"正是漂移来源；改成"顺序规则 + 每次运行印 `stages=N`"。

```text
$ node scripts/verify_dialog_interactions.mjs confirm   rc=0
VERDICT_SELFTEST cases=14 failed=0
INFO 5-long-text-below-app-minimum-420x720: confirm button not on screen (...) - below minWidth 640/minHeight 480, so this is a CSS contract reading, not a reachability failure
CONFIRM_GATE steps=12 checked=19 failed=0
confirm: all 19 dialog behaviours hold

$ node scripts/verify_dialog_interactions.mjs pages     rc=0
PAGES_GATE routes=7 judged=7 checked=36 failed=0
pages: every route stayed alive with no Tauri runtime (7 routes)
```

**仍未闭环的（不藏）**：`links`/`external`/`contrast` 也走中心收尾，现在各自印一行
`NO_VERDICT mode=<x> - this mode reports only; nothing above is a pass` —— 它们依旧没有判据，
只是不再能被误读成"过了"。`layout` 的 9 条（触摸目标 44×44 与 `button{font:inherit}` 吞字号）仍是产品面缺陷，
后者按 `docs/VISUAL_BASELINE.md:111`、`:164` 明写"登记不修、需单独批准"。

**一次消融，证明夹具不是装饰**（把 `confirmVerdict` 临时换成"永远返回 0 失败"，跑真模式）：

```text
$ # 拔空判定函数后
$ node scripts/verify_dialog_interactions.mjs confirm            rc=2
HARNESS FAULT: verdict fixture "confirm: Escape leaving the dialog open is caught" did not hold
HARNESS FAULT: verdict fixture "confirm: a press inside that closes the dialog is caught" did not hold
HARNESS FAULT: verdict fixture "confirm: Enter performing the action is caught" did not hold
HARNESS FAULT: verdict fixture "confirm: a confirm button neither visible nor scrollable-to is caught" did not hold
HARNESS FAULT: verdict fixture "confirm: a z-tie where neither layer wins is caught" did not hold
HARNESS FAULT: verdict fixture "confirm: a step that silently disappears is caught" did not hold
HARNESS FAULT: verdict fixture "confirm: horizontal overflow is charged even below the minimum" did not hold
VERDICT_SELFTEST cases=14 failed=7
```

一把被拔空的门交出的是 **rc=2 + 7 个具名失效夹具**，不是 `CONFIRM_GATE failed=0`；
原文在 `image-hosting-probes/2026-10-01/confirm-ABLATION.txt`，改动已 `git checkout HEAD --` 复原（porcelain 0）。

**聚合终态（干净树、`HEAD=bc1be95` 之上，退出码 0）**：

```text
$ node scripts/verify_all.mjs
verify:all | wall=178.6s stages=21 sumOfStageWalls=178.5s
verify:all | cost (slowest first): contrast-tier=78.5 mutations=33.4 theme-surfaces=14.3 confirm=13.2 visual=11.8 pages=11.6
verify:all | 21 passed, 0 failed, 0 skipped of 21
```

新增两条的分子：`confirm checked=19 failed=0`、`pages checked=36 failed=0`；
`mutations` 仍是 27/27 且 `unrestored=0`（它跑在最后，会临时改跟踪文件后复原）。
产物：`image-hosting-probes/2026-10-01/verify-all-21stages.log`。

### 7. 顺手修掉一处量具的行尾污染（第 30 次签字，改的是口径不是数字）

上面那次消融做完，我用 `git checkout HEAD -- <文件>` 复原，`git status` 干净，但 `verify_shape` 立刻红了 2 条。
根因不在消融：这台机 `core.autocrlf=true`，**checkout 会把工作副本写成 CRLF**，而 blob 存 LF；
`verify_shape` 原先按**原始字节**量，所以任何一次 git 碰文件都会让每本字节账变化，代码一行没动。
实测证人：`verify_guard_mutations.mjs` 26116 → 25797，差的 **319 正是它 319 行里的 CR 字节**，不是内容丢失。

`check_user_flow` 早在 `1e951f9`（"read source with line endings normalised, so CI and this box agree"）
就修过同一件事，`verify_shape` 当时漏了 —— 这次是把它补齐，并共用一个 `toLF()`：读取归一、`measureText` 也归一，
所以夹具能打到生产路径而不是自证。

```text
$ node scripts/verify_shape.mjs --verify
SHAPE_SELFTEST cases=9 failed=0
  ok   CRLF and LF of the same text measure identically: bad=0 expect 0
  ok   one lost byte reports drift: bad=1 expect 1        <- 归一没有把尺子磨钝
SPLIT_SHAPE OK checked=65 failed=0
```

基线重签为第三十次，理由里写明"这次改的是口径不是计数"，并把 319 字节的去向写进去，
免得下一次有人把它读成"少了内容"。

### 8. 把上面那次一次性消融变成可重跑的变异 `M29`

§6 里那次"把 `confirmVerdict` 拔空"是我手工做的、只在 `%TEMP%` 留了一份输出——**口头跑过不可复算**，
所以它不算证据链的一环。现在它是变异表里的一条，每次 `verify:all` 都会重跑：

```text
$ node scripts/verify_guard_mutations.mjs M29
OK   M29 scripts/verify_dialog_interactions.mjs -> oracle ran: true, exit 2, named expected failure: true
GATE_JSON {"gate":"mutations","checked":1,"failed":0,"ok":true,"unrestored":0}
guard mutations: 1/1 alarms reproduced | tree restored: clean
```

变异内容是把判定的**上报那一半**摘掉（`checked` 照常累加、`failures` 永远不 push），
证人换成新加的 `confirm-gate` oracle（marker `VERDICT_SELFTEST`）：抓到的不是"应用坏了"，
而是**七条植入夹具当场点名**、模式退 2。这回答的是新门特有的那个问题——
"如果它停止发现缺陷，还有谁知道"。

**没被变异证明的部分照实说**：`emitGate`/`finish` 那一层接线没有对应变异（试着加过，它不会被夹具抓到——
判定完好时没人报警）。它由另一条独立机制看着：聚合对每个 stage 做**退码与 `ok`/`failed` 的双向对账**
（`exit 0 but failed>0`、`exit!=0 but ok=true` 都算 problem），不是"我测过了"，是"另一把尺子会拦"。
第 31 次签字就是这次变异表增长本身。

**本节的终态读数**（干净树、`HEAD=bdd92be`，退出码 0）：

```text
$ node scripts/verify_all.mjs
verify:all | wall=190.9s stages=21 sumOfStageWalls=190.7s
verify:all | cost (slowest first): contrast-tier=77.0 mutations=46.7 theme-surfaces=14.4 confirm=13.3 pages=12.0 visual=12.0
verify:all | 21 passed, 0 failed, 0 skipped of 21
--- mutations
    => passed (exit 0) 46.7s mutations checked=28 failed=0
```

变异从 27 涨到 28（`M29`），聚合从 19 涨到 21（`confirm`、`pages`）。
产物：`image-hosting-probes/2026-10-01/verify-all-FINAL3.log`、`mutation-M29.txt`。

### 9. `layout` 的触摸目标：把 24 档以下修干净，把 44 档的问题留成一道有数字的选择题

**方法**：同一扫描跑两个底线（`--touch 44` 与 `--touch 24`），差集就是"落在 24–43 之间有多少"。
不需要猜，也不需要改判据默认值去让计数消失。

| 口径 | 修前 | 修后 |
|---|---|---|
| floor 24（WCAG 2.2 / 2.5.8，AA） | 2 条：`select 100x23`、`toast 关闭 16x16` | **0 条** |
| floor 44（WCAG 2.5.5，AAA；本仓门的默认） | 8 条（7 路由 + toast），occurrence 合计 94 | 8 条，其中 toast 那条从 `16x16` 变成 `24x24` |

**改了什么**（两处，都是命中区，不动字形）：`ToastViewport.tsx` 关闭键 `p-0.5` 的 16×16 → `grid min-h-6 min-w-6 place-items-center` 的 24×24（图标仍 12px）；
`AssetsPage.tsx:153` 复制格式 `<select>` 从 23px 高改为 `h-full`，撑满它本来就坐在的 `h-10` 行（40px）。
改前/改后各一张，四张都进仓：

| 文件 | bytes | sha256 前缀 |
|---|---|---|
| `docs/toast-close-target-2026-10-01-before.png` | 222473 | `c94f76918d39f0dc` |
| `docs/toast-close-target-2026-10-01-after.png` | 222454 | `a47adef6cda14817` |
| `docs/select-target-2026-10-01-before.png` | 109601 | `586ec11a4a209262` |
| `docs/select-target-2026-10-01-after.png` | 109594 | `40135f361f4ad1fe` |

**剩下那 8 条为什么没修**：44 是 AAA 档。要把 94 个 occurrence 全抬到 44×44，改的是 7 屏的控件密度（侧栏那组 35×30 的主题键、每屏的图标按钮），
这是"本产品承诺哪一档可访问性"的决定，不是我能靠改代码替它决定的；
我也**没有**去把门的 `--touch` 默认改成 24 —— 那只会让报警消失，不会让事实改变。

**我试过把 `FONT-SWALLOW` 一起修，然后撤回了**（把 `button, input, select, textarea { font: inherit }` 从层外移进 `@layer base`，
让声明了 `text-xs/text-sm` 的控件赢回自己的字号）。全部读数留下备用：

- 修好的：`FONT_SWALLOW distinct_controls 23 → 0`；`layout failures 9 → 0`（24 档）；`CONTRAST_*` 两行 `5.17 → 5.21`（变好）；`measured 1917 → 1944`。
- 代价一：4 个文字按钮/输入框按声明字号渲染后高度掉到 16–20px，**反而低于 24 档** ⇒ 必须同笔补 `min-h-6`/`h-full`（我写了并验证：补完 24 档 0 条）。
- 代价二（这条决定我为什么撤回）：主上传按钮从 52px 缩到 44px，**掉出 `theme-surfaces` 采样器 `≥120×48` 的粒度** ⇒
  `frozen 7 → 0`、白名单条目 `/app-upload-button/` 被自己的 `DEAD-EXEMPTION` 规则判死。
  也就是说：一次排版修正会**同时**改掉 10 屏的视觉密度和一把门的覆盖面，
  而覆盖面的丢失是被另一条规则抓到、不是静默发生的——这条恰好证明那把门是活的。
- 撤回后实测：`SURFACE_GATE routes=7 surfaces=186 frozen=7 offThemeUnwhitelisted=0 whitelisted=7`（rc=0），
  `layout --touch 24` 只剩 `FONT-SWALLOW` 一条。

`docs/VISUAL_BASELINE.md:111`、`:164` 早就写着这条"登记不修、需单独批准"。现在它带上了代价数字，
所以那一次批准可以只凭这张表做，不必再量一遍。

### 10. `links` 是一把会印静默绿的门——它连我新加的 `NO_VERDICT` 行都到不了

审计"哪些模式真有判据"时发现：`links` 块尾直接 `finish(0)`，**不经中心收尾**，
所以 §6 加的 `NO_VERDICT` 提示对它也不生效——跑 `verify:dialog links` 的人拿到的 rc=0 与它测到什么完全无关。

它最近一次的真实读数就是证据：三个文档入口 **全部 `found=false`**，而它退 0。
但这里差点被我写成一条**永红判据**：读了记录才明白 `found=false` 是对的——
`baseEnv` 三个 URL 全 `null`，没配 `VITE_DOCS_BASE_URL` 时应用**不该**给"在线文档"入口，
它给的是内置教程（同一次记录里 `panelCopy` 就印着"教程内置在应用里，不依赖文档网站"）。

所以判据是双向的：配了基址 ⇒ 三个入口必须都在、点击必须真打开东西**或**给出失败原因；
没配基址 ⇒ 三个入口必须都不在，且内置教程文案必须在。8 条夹具两个方向都植了失败。

```text
$ node scripts/verify_dialog_interactions.mjs links
VERDICT_SELFTEST cases=22 failed=0
LINKS_GATE sites=3 base=unset checked=4 failed=0
links: the three docs entry points agree with the base URL the server was started with (unset)
```

夹具用的是**精确相等**，所以它当场抓到我自己的一个用例写错（缺探测 + 缺兜底文案其实是 2 条，我写成 1）。
`links` 同笔进聚合（`AGGREGATE_SELFTEST stages=22`），第 32 次签字随之落地。
**还剩**：`external` 与 `contrast` 走中心收尾，仍各印 `NO_VERDICT`（它们没有判据，但也不再能被当成通过）。

### 11. 聚合里那一次 `0xC0000409`：`finish()` 不再猜收尾时间

22:49 那次 22-stage 聚合红了 1 条：`settings-guard => failed (exit 3221226505) no GATE_JSON line emitted`。
`3221226505 = 0xC0000409`，正是这文件自己的注释警告过的那类 Windows 中止——**在 CDP socket 与浏览器子进程还在关的时候调用 `process.exit`**。

分母先量清楚再动手（不拿一次偶发当"已修"也不当"无关"）：

| 场景 | 次数 | abort |
|---|---|---|
| 聚合（21/22 stage，本机连续起多个浏览器） | 4 | **1** |
| `settings-guard` 单跑 | 8 | 0 |
| `links` → `settings-guard` 相邻对跑 | 3 | 0 |

根因不在 settings-guard，也不在我新加的 `links` 相邻关系（两条都测过）：`finish()` 写的是
`setTimeout(() => process.exit(code), 300)`——**一个对"句柄多久关完"的猜测**，猜输了就中止且不报任何东西。
本会话早些时候我在 `scripts/watch_ci.mjs` 上已经被同一类问题咬过一次（那次退码变成 127），修法是让事件循环自己排空。

**改法**：判定码交给 `process.exitCode`，循环排空后自然退出；另加一个 **unref 的 5s 兜底**，
真有关不掉的句柄时它才触发，并且**印出来说明是哪个码被强制收尾**——不再静默。

```text
gate-unit      rc=0 wall=0s  FINISH_WATCHDOG=0
settings-guard rc=0 wall=3s  FINISH_WATCHDOG=0
links          rc=0 wall=7s  FINISH_WATCHDOG=0
confirm        rc=0 wall=13s FINISH_WATCHDOG=0
```

第 33 次签字随之落地。**限定的说法**：改后我只跑了下面两次聚合，都没再出现 abort；
按 1/4 的历史率，n=2 不足以证明它消失，只足以说明"没有变得更糟"。要把它当已闭环，需要更多聚合轮次。

### 本轮验证命令与实际输出

```text
$ node scripts/verify_dialog_interactions.mjs theme-surfaces
SURFACE_GATE routes=7 surfaces=186 frozen=7 offThemeUnwhitelisted=0 whitelisted=7 paintedByUnmarked=316   rc=0

$ node scripts/verify_dialog_interactions.mjs contrast-tier
CONTRAST_GATE combos=72 routes=7 measured=1917 below=0 docDrift=0 denom=0 drift=0 unresolved=0 points=127044   rc=0

$ node scripts/theme_token_census.mjs --verify
TOKEN_POLICY_SELFTEST cases=5 failed=0
TOKEN_POLICY families=13 breaches=0   rc=0

$ node scripts/verify_guard_mutations.mjs          # 工作树干净时跑（脏树它会拒绝，这是设计）
guard mutations: 27/27 alarms reproduced | tree restored: clean
GATE_JSON {"gate":"mutations","checked":27,"failed":0,"ok":true,"unrestored":0}   rc=0

$ node scripts/verify_dialog_interactions.mjs visual --theme=sakura
VISUAL_GATE total=4 failed=0   rc=0        # 产出上面那两张渲染图
```

聚合层终态读数（工作树干净、`HEAD=3f716f0` 时跑，退出码 0）：

```text
$ node scripts/verify_all.mjs
verify:all | repo D:/image-hosting-platform
verify:all | dev server http://127.0.0.1:1420/ reachable
verify:all | wall=171.4s stages=19 sumOfStageWalls=171.2s
verify:all | cost (slowest first): contrast-tier=85.0 mutations=38.7 theme-surfaces=16.4 visual=12.7 red-demo=4.7 settings-guard=4.3
verify:all | 19 passed, 0 failed, 0 skipped of 19
```

关键计数逐条：`validate` 13 migrations OK · `check_contracts` 66/66/66 · `check_user_flow` 253/0 ·
`theme_face_inventory` faces=23 docLines=25 mismatch=0 · `verify_shape` checked=65 failed=0 ·
`token_policy` families=13 breaches=0 · `gate-unit` 29/0 · `contrast-tier` 1917/0（`docDrift=0 denom=0 drift=0`）·
`theme-surfaces` 186/0（`frozen=7` 全在白名单）· `mutations` 27/27 复现且 `unrestored=0`。

**这一绿覆盖到哪为止要说准**：它覆盖 19 个 stage 各自声明的谓词，不覆盖"安装包能装能跑"——
后者是 `windows-bundle` 的第 [11]–[17] 步（`tauri build`、NSIS/MSI 冒烟、资产暂存），本轮一次都没跑到，
CI 侧那条作业仍是 `completed/failure`。上面那句"没有一条是产品代码的红"只描述本仓库内这些门的归因。

本笔之前的一次聚合跑是 `16 passed, 3 failed, 0 skipped of 19`，三条红分别是：
指纹表未跟改动（`check_user_flow`）、shape 基线未重签（`verify_shape`）、`mutations` 在脏树拒绝启动——
前两处已在上笔（`--patch` / 第二十八次签字）落平，第三处需要干净树，故本笔的 19/19 才是它的证人。

### 12. v1.4.5 重打 tag 后的出包终态与资产三方对账（2026-10-02）

tag `v1.4.5` 移到 `f922ce5` 并 force 推单 refspec 后，`Release Bundle` 触发了新 run `36960220083`。

- 读数：`watch_ci.mjs` pass=18 `TERMINAL completed/success updated=2026-10-02T03:49:01Z`；
  此前该会话的第一把后台 watcher（`b4ftmglfb`）输出文件在 23:27–23:41 间为 **0 字节**，完成时才落盘——
  引用它的"exit code 0"不算证人，本轮的终态是从 API 独立重测的（`http=200 status=completed conclusion=success`）。
- Release 对象：`releases/tags/v1.4.5` = **200**，`release_id=401526603`，assets=4
  （source.zip / windows-x64-setup.exe / windows-x64.msi / SHA256SUMS.txt），§1 里那句"没有对外资产"自本笔起过时，保留原文并注明。
- 三方对账（本地 Node `crypto` 独立重算 vs `SHA256SUMS.txt` vs GitHub `assets[].digest`），3/3 全一致：

  | 资产 | 大小 | sha256（三处相同） |
  |---|---|---|
  | source.zip | 3,124,579 B | `7b331a18…726a6537` |
  | setup.exe | 8,205,472 B | `b54c4a92…f2502000` |
  | installer.msi | 12,161,024 B | `4485c4d6…daeef2a1` |

- 判别式：对捏造值 `'0'.repeat(64)` 走同一比较逻辑正确判 MISMATCH（`NEGATIVE-CONTROL teeth OK`）， hasher 不是永绿。
- NSIS 安装包 **8.2 MB**（对照 PicList 的 dmg 141.7 MB，量级差 ~17×），这是 P3"打包面收益"的第一个实测锚点。
- 下载产物落在 `%TEMP%/v145_assets/`（我的临时产物，不入仓；入仓的是上面的哈希与结论）。
- **未覆盖的部分要说准**：对账证明"发布的就是构建的"，不证明"装得上、跑得起来"——安装冒烟仍是 Windows 侧人工验收项。

### 13. P2 的估计被实测推翻，P3 缺的是设备不是算力（2026-10-02）

上一轮我按"四家加 opendal feature 即可"把后端差距排成性价比最高的一档。本轮核对依赖后**其中三条是错的**，逐条入档防止再被估错：

- crates.io `opendal/0.58.2` 的 103 个 features 里只有 **`services-upyun`** 存在；
  `services-qiniu` / `services-imgur` / `services-smms` **不存在**（上游 `v0.58.2/core/Cargo.toml` grep `qiniu` = 0 命中）。
  ⇒ PicList 那三家是自实现的，我们接同样要每家写完整 HTTP 集成，功能差距里只有 1/4 是配置项。
- 新 provider 在本仓的接线面测绘为 **9 个点**（两处 `build_provider` + cli.rs 第三处、ProviderSummary 目录、Input struct、
  create 命令、lib.rs 注册、前端 6 个文件）；`storages.provider_key` 无 CHECK 约束 ⇒ 不需要迁移。
- 落点：`docs/REFERENCE_COMPARISON_PICGO_PICLIST_PICUPLOADER.md` §5「下一步」下的实测底数表。

P3（冷启动 ms / 空闲 RSS MB）**本机测不了，原因不是工具而是机器状态**：三处独立取证一致——
进程表按 CommandLine 匹配 `image|hosting|piclist|tauri` = 0 条、卸载注册表 HKCU/HKLM/WOW6432Node 对 `image-hosting` = 0 匹配、
四个常见安装目录全 absent ⇒ 这台机器从未装过 v1.4.x。CI 的 `smoke_windows_installers.ps1` 装完即卸且 runner 无头，
云端也产不出这两个数。已交付 `docs/PRE_RELEASE_PERF_CHECKLIST.md`（含 n=5、冷/热分开、多进程 WebView2 必须整组相加的采样纪律），
数值回来后进 `verify_shape.mjs` 棘轮。**清单里没有预填任何推测数字。**

`website/src/content/docs` 的孤儿门只扫站点内容目录，`docs/*.md` 不在其枚举范围（`check_docs_site.py:21`），新增文档不会造孤儿。
本轮聚合复跑：`22 passed, 0 failed, 0 skipped of 22`，`wall=216.7s`。

### 14. 改名：图床 → 镜云 | Mirror Cloud（2026-10-02，`d2ed700`）

用户拍板"名字要短而可独占"。旧名两头都输：**"图床"是类别词**（谁都自称图床，占不住搜索位次），
英文名与 Kuingsmile/PicList（3774★）撞车。我先提"多云发布台"（过长被否）、再提"云栈/Cloudstack"
（自查撞 Apache CloudStack，风险非零），最终定 **镜云 / Mirror Cloud**——两字、几乎无冲突、自带机制含义（一次发布、多镜像）。

- **改动面**：UI 侧栏品牌区、窗口标题、`productName`、release.yml Release 名、冒烟脚本 `-ProductName`、
  validate.py 断言、身份门夹具、Cargo authors、README/docs/website 文案，共 20 个文件 51 行。
- **盲替换咬到 10 处类别词**（"切换图床""公网图床""很多图床"这类把图床当普通名词用的句子被连坐换成品牌名），
  逐锚点 `count==1` 断言改回；8 个只含类别词用法的文件因此净变化为零、未进提交。**批量改名后必须人工读句子，这条写死在这里。**
- **刻意不动的四类**：`identifier dev.multicloud.publisher`（动了老用户 `%APPDATA%` 数据目录"消失"）、
  crate/二进制名 `image-hosting-platform-desktop`、Release 资产文件名、GitHub 仓库 slug——
  前两类动的是升级兼容，后两类属 P1 范围之外，等一句授权再开。
- **指纹台账同笔更新**：夹具字节数变了（3,897→3,887），`fingerprint_rows --patch` 与改动同笔落，
  HEAD-blob 双向断言在提交态过（`USERFLOW_CHECKS total=253 failed=0`）。
- 渲染证人：`docs/rebrand-2026-10-02-after-default.png`（侧栏「镜云 / Mirror Cloud」、页脚、资源页文案三处可见）。
- **遗留要说准**：截图里那条红色吐司 `Cannot read properties of undefined (reading 'invoke')` 是无头 harness
  没有 Tauri IPC 通道的既有现象，不是本轮回归；但"浏览器里测功能完整性"那一轮我报过"无报错"，
  这个吐司当时是否也在、我当时是否漏看，属于未解释事项，不顺手归因。

### 15. Mirror Cloud v1.4.5：改名后的重打包 + 本机首次真装实测（2026-10-02）

他点名"快打包我要使用"⇒ 解除移 tag/出包边界。tag `v1.4.5` 从 `f922ce5`（tag 对象 `3b3fe1e`，已存档
`image-hosting-probes/2026-10-02/tag-v1.4.5-pre-move-r2.txt`）移到 `2808d25`（新对象 `34f5c1e`），force 推单 refspec 复核一致。

- run `36969276229` = **completed/success**（watcher pass=10 TERMINAL + API 独立复核 `updated=05:53:00Z`）。
- Release 标题更新为 **"Mirror Cloud v1.4.5"**（同一 release_id `401526603`，`softprops/action-gh-release` 的更新语义确认：
  同名资产被覆盖、**没有留下旧名与新名并存的孤儿资产**，assets=4）。published 时间戳仍是旧的 03:48 ⇒ 它记的是首次发布不是本次刷新。
- **注意**：资产文件名仍是 `image-hosting-platform-*`（§14 刻意未动项），所以"名字变了但文件名没变"是预期状态不是漏改。
- 三方哈希对账 **3/3 一致**（本地 Node crypto / SHA256SUMS.txt / API digest）：
  source.zip `5e25d88b…` / setup.exe `f3065d1a…` / msi `db82c85f…`。与早间旧包对比：exe 仅 **+4 B**、msi −4 KB、
  source.zip +107 KB（docs/README 文本变化），量级符合"只改了文案与元数据"的预期。
- **本机首次真装**（授权范围内，测完已卸）：静默安装成功，注册表 `HKCU\…\Uninstall\Mirror Cloud` DisplayName 即新名；
  测量后 `uninstall.exe /S` → 注册表 CLEAN、安装目录 GONE 复证。
- **P3 两个欠数首次有真值（n=5，本机）**：
  - 冷启动（进程创建→主窗口可见）：**首启 938 ms**（冷缓存），热启 138–211 ms，中位 **~150 ms**。
  - 空闲内存（静置 ≥20s，**含 WebView2 子进程整组**，MEMBERS=7）：WS ≈ **623–646 MB**，私有 ≈ **373–407 MB**。
  - ⚠️ **诚实限定**：这台机同时跑着别的会话（Defender、多路 vite），WS 绝对值偏高且不可跨机引用；
    "比 Electron 低一档"的说法**没有被本轮数字证实**——Electron 对照组没在同机测过。可引用的只有"镜云自身基线五连读"。
  - 采样脚本在 `%TEMP%\v145_assets\measure_*.ps1`，可复算。

### 16. 用户第一人称端到端：Typora→镜云→GitHub 真链走通（2026-10-02）

他装的是 `D:\Mirror Cloud\` 的 v1.4.5，配好 GitHub storage（仓库 `PicList`/main/assets），在 Typora 里完成 Custom Command 配置并上传成功。我侧独立核验：

- 那条 Raw URL 重新下载 = **HTTP 200、17,510 B、magic `RIFF….WEBP`** ⇒ 图真实在 GitHub 上，且默认处理链把 PNG 转成了 WebP（"3 步完成第一次公网发布"链路端到端成立）。
- 直连 `raw.githubusercontent.com` 这台机不通（http=000），核验必须走 `127.0.0.1:7897` 代理——与 git push 同一通道。
- **本轮暴露的真缺陷已修**：教程截图里两条红吐司 `Command plugin:opener|open_url not allowed by ACL`——
  capabilities 只发了 `opener:allow-default-urls`（mailto/tel），所有外链点击必死。修复 `ac54483`：
  补 `opener:allow-open-url` + `check_user_flow` 新增 2 条断言（直接解析 default.json；摘掉授权行当场变红已演示）。
  这条是"grep 命令字符串永远看不见能力清单"的门禁盲区，由用户而非任何门抓到。
- tag 再次移到 `ac54483`（对象 `c5995be`），ACL 修复版 bundle run `36973698922` 在跑，watcher `b0f9bp69l` 盯终态。
- Typora 那侧注意：他机器上 PicGo 仍在（`D:\PicGo\PicGo.exe`），当前上传服务已切自定义命令；两不冲突，但以后看到"上传走了 PicGo"先查这个下拉框。

### 17. ACL 修复包发布 + "浏览器能看 Typora 不能"的真因（2026-10-02）

**ACL 修复版出包闭环**：run `36973698922` = completed/success（watcher pass=10 TERMINAL + API 复核 `updated=06:50:56Z`）。
三方哈希对账 **3/3 一致**：setup.exe `809f84cd…` / msi `7115c855…` / source.zip `c3bfd8e7…`。
exe 与上一版差 418 B、msi 回到 12,161,024 B，符合"只动了 capabilities JSON"的量级。tag 现指 `ac54483`（对象 `c5995be`）。

**§16 里那条"CDN 缓存延迟"的猜测被用户实测推翻，撤回**：真因是网络出口差异——
`raw.githubusercontent.com` 直连不可达；浏览器走代理插件所以能看图，Typora（Electron）只认系统代理，
没开加速器时它加载外链必挂，开加速器即好。**这不是产品缺陷，但暴露了 GitHub 当 Primary 的真实短板**：
分享出去的链接对国内读者同样不稳。⇒ 根治方向是把 R2/OSS 配成 Primary、GitHub 降为 Mirror（多云副本本来就是为此设计的），
待用户提供 Cloudflare 侧操作。引用"上传成功但显示不出"类问题时，先问"对方开没开代理"，不再猜 CDN。

### 18. M30：给 lock 对账门补上变异证人（2026-10-02）

§17 收口时挂账"新门没有 M 位"，本轮清偿。过程被门连咬三次，每次都是真教训：

1. **CRLF 锚点**：第一版 `from` 用 `\n` 写、盘上是 `\r\n` ⇒ anchor stale（harness 如实报"定义过期"而不是装通过）。
2. **健康树上不可达的行不能当证人**：直接摘 lock 检查的 `return 1`，正常树根本不执行那行——变异体和自己比，M30 假绿。
   解法 = 给门加 `--poison-lock-check` tripwire（argparse 注册；不带 flag 照常绿 rc=0、带 flag 必红 rc=1，两面都验过），
   oracle 走带 flag 的那条路径，marker/expect 统一到 `LOCK_CHECK_POISONED`。
3. **marker≠expect 时 `oracle ran: false`**：第三稿 FAIL 读数暴露两者字符串不同源，对齐后 OK。

终态读数：**mutations 29/29**（`GATE_JSON checked=29 failed=0 unrestored=0`）、user-flow 255/0、
shape 第 **35** 次签字（漂移行点名 verify_guard_mutations +9L/+837B 与总量 433615B，别无他名）、台账指纹同笔两更新。
`check_release_version.py` 自身不在 ledger 六文件内——它的行为证人就是 M30 本身。

### 19. 默认链输出格式做成设置（2026-10-02）

用户可感知的短板收口：`cli.rs` 建"自动上传链"时 Convert 步骤硬编码 `"webp"`，且 `upsert_system_default`
每次运行都覆盖 DB ⇒ UI 里改 workflow 会被静默冲掉（此前仓内无任何改格式入口）。本轮把它变成真设置：

- **单一真源** = settings 行 `output.preferences.imageFormat`；`default_chain_image_format()`（integrations.rs）
  从该行读值、只认 `original|jpeg|png|webp`，其余/读失败一律降回 webp（= 旧发布行为，不造空管道）；
  cli.rs 建链处消费该函数。GUI 与 CLI 本就同库同表（`connect_path(data_dir/publisher.sqlite3)`），四个入口一起生效。
- `save_output_preferences` 加同枚举校验（后端边界，非法值拒绝入库）；前端 types + SettingsPage「链接输出」卡加下拉。
- **验证跑了什么**：`tsc --noEmit` rc=0（含新字段全链路）、python 门 255/0、grep 证 `imageFormat` 全仓仅一处消费者。
  **没跑的**：Rust 编译（本机无 cargo，CI 是证人）、真机上传矩阵（四格式各传一次验扩展名与 mime）——换包后做。
- 已知未挡面（挂账不装看不见）：手改 SQLite 里的 imageFormat 为非法值不会被拦（读侧已降级安全）；
  settings-guard 夹具吃的是 localStorage 主题键，覆盖不到这条 IPC 偏好路径，补它需要给该模式加第二注入点，暂不做。

### 20. 端到端矩阵：格式设置在新包里真生效（2026-10-02）

第三次移 tag（`33de596`，对象 `0e8b8ed`）后的 bundle run `36995685107` = **completed/success**；
Release 资产原地刷新，setup.exe 三方对账一致（`68d3fa2f…`，msi/zip digest 同报）。
覆盖安装到 `D:\Mirror Cloud`（用户既有目录），跑 §19 欠的矩阵——偏好写 `app_settings.output.preferences`，CLI 读同一行：

| imageFormat | URL 扩展名 | 下载后文件头 magic | 判定 |
|---|---|---|---|
| webp（基线，改前） | .webp | RIFF/WEBP | ✓ 默认行为未变 |
| jpeg | **.jpg** | FFD8FF | ✓ 偏好被消费 |
| png | .png | 8950 4E47 | ✓ |
| original | .png | 8950 4E47（=原图字节，72B 与探针同大） | ✓ 不转码 |
| banana（非法） | .webp | — | ✓ 按承诺降级回 webp |

四行输出互不相同 ⇒ 不是永绿量具。测毕卸载：注册表 CLEAN、`D:\Mirror Cloud` GONE。
**注意**：这台机现在处于"未安装"状态（矩阵需要干净基线），直链在下面重报给用户。
过程小坑两条如实记：settings 真表名是 `app_settings`/列 `value_json`（第一次 INSERT 撞 no-such-table）；
cmd //c 吃带空格路径又翻车一次，改 PowerShell Start-Process 即好。

### 21. 更新功能发布门禁 G0–G5 定稿 + rustfmt 归因反转三次收口（2026-10-02）

**图标换装**：终选深海青水晶云（z6），裁水印→tauri icon→icons/ 50 文件替换，两笔（`70cd60e`+误提交预览图的`69e44bf`）。32px 实况可辨；任务栏观感留用户真机验收。

**rustfmt 归因链（如实记三次反转）**：① "宽度判据"被 v1.4.5 绿色包内 60+ 条 >99 列的行推翻（那些全是字符串/注释，rustfmt 不动它们——此反驳过头一半，收回）；② run#29 step[8] 耗时 8m41s ⇒ 当时断言"红在 check/test 不在 fmt"，**未经日志证实**（未认证日志端点 404），维持 unknown；③ 外部审计贴出 CI #180 的 rustfmt diff 原文才定案：offender = parse_sums 条件（join 后恰 100 列）+ 三条 >90 列注释。修于 `838627d`（两处代码）与 `38d99ca`（注释重折行）。**规矩：本机无 cargo 时以 CI diff 原文为判据，不猜列数。**

**tag 纪律事故入档**：v1.4.6 tag 本轮被 force-move 五次当测试触发器（b5cfec2/dd3d1aa/013cb3a/7614a0a/262a70d）。用户与外部会话定稿新规矩并批准为固定门禁：**RC 不用正式 tag**；tag 只在保真矩阵全绿后创建一次、不可变。当前远端 tag 停在 `262a70d`（失败候选），按新规不再挪动——G0 恢复后走 workflow_dispatch 出 RC。

**G0–G5 状态机**（全文 `docs/RELEASE_GATE_UPDATER.md`，锚点由 check_user_flow 看护，门 262→267）：
G0 dev 全绿 → G1 P0-4 信任边界（Rust 自持 PendingUpdate{version, canonical_path, expected_sha256, bytes}，前端只拿 opaque id；install 前 canonicalize+目录约束+重算 SHA256；**禁止前端传 verified/path 作安全证明**）→ G2 无 tag RC 构建 → G3 真机升级 E2E＝十行保真矩阵（版本/SQLite/Storage/token/默认目标/Typora bridge/主题/资源索引/插件配置/新传一图；版本号变了≠通过）→ G4 不可变 tag → G5 Release 成功——之后"应用内安全自更新"才许写进卖点。

**竞品定性修正（用户校正为准绳）**：PicGo/PicList **有**检查更新+提醒（PicGo 开发分支明写 temporarily disable auto update＝主动不做），差异点只能是"Windows 单一发行面的完整闭环"，且 G5 前一律描述"开发/验证中"，禁写"更安全/更先进/领先"。固定约束：**不因竞品没做完整自动更新而推导镜云更先进**。

### 22. 证据优先原则定稿：六轮猜测的真凶是一个 derive（2026-10-02 深夜，run#194–#198）

**事实链**：#184–#190 五轮"Rust format"红期间我做的宽度/链形/注释折行假设全部作废（反例都在绿色 commands.rs 里）。#193 artifact（外部会话取到）确认 rustfmt 只剩两处 → `943553d` 照抄后 **#194 的 step[15] Rust format 首绿**，红点后移到 step[17] cargo check。给 CI 装自证通道两笔（`7d53041` rustcheck-log artifact + `4c2f3eb` 公开 annotation 回显），#197 第一次送达编译器原话：**E0277 CommandArg 不满足 @ updater.rs:238 = `DownloadedUpdate` 缺 `Deserialize`**（install_update 吃前端回传对象必须可反序列化）。修复 `757d5f4`，run#198 在验。
**过程账（如实）**：`cdc6616` 把 CmdResult 降回私有、`d20629b` 又恢复——两轮都是无证据动作，最终树与 v1.4.6 bump 一致，但各消耗一次 CI。中途还误判过"pub(crate) 抬级是多余的"——它恰是 #[tauri::command] 对外签名所需。
**沉淀规则（用户批准，写入本仓协作纪律）**：CI 红 ⇒ **先读一手诊断（annotation/compiler error/artifact），只有证据不足才允许假设；禁止沿同一假设连续多轮盲改**。顺序固定：读证据 → 锁第一错误 → 最小修复 → 复验。本次事故的正解路径本来只要两步：#194 起红已不在 fmt，早一天装 annotation 通道就早一天结案。
**副产品（保留，非本轮验收项）**：ci.yml 的两条失败自证通道从此常驻——rustfmt 有 patch artifact，cargo check 有 log artifact + 公开 annotation（取首个 `^error` 起 9 行，GBK 无关、annotations API 无认证可读）。

## 1.4.5 - Legible Read-Failure Panels and Measured Contrast Floors

自 `v1.4.4` 起 115 笔提交（09-29 43 / 09-30 54 / 10-01 18）。改到 `apps/desktop/src` 的只有 8 笔；
**Rust 侧与 `Cargo.toml`/`Cargo.lock` 在 bump 之前零改动**，远端 tip `fe57911` 的 CI 是
`completed/success`，所以 cargo 作业吃的输入与上一版相同。

- **读取失败面板不再把异常当标题**：`插件`/`资源`/`云端`/`任务` 四处原先直接渲染 `String(error)`
  （真机上是 Rust 原文），现在标题只说人话，原始错误收进 `<details>` 可展开复制——降级措辞但不删证据。
- **主题墨色按实测表面抬到下限**：`bc53a45` 先把三档 `--color-slate-400` 解到 4.5:1 地板，
  `e65962c` 再按每套主题**合成后的真实表面**补余量到 ≥5.0；壁纸两个极值一并界定，改前/改后截图进仓带哈希。
- **`data-theme` 只能由主题的写入者写**（`6e6a12f`），非法值在装载边界被拒并被界面显式报出。
- **侧栏在产品最小窗口 640×480 下可滚**（`3060785`），可达性用滚动实测证明而不是推断。
- 新手教程弹窗：一处层级、一处顺序、一处可读灰（`c1ac825`）。
- 测具加固：对比度普查改为"隐藏字形后拍照取真实合成底"、逐元素采样过期判据（`moved/gone/uncomparable`
  三数分开）、投影比对做行尾归一；`verify:all` 现为 19 个 stage。

## 1.4.4 - Gallery Render Bound and Installer Publisher



- Bound gallery rendering: past 600 revealed entries the page reports how many remain and asks you to narrow the directory or search instead of offering another batch forever. The cap is soft, so up to about 720 files stay fully reachable with no limit message. This also bounds what 全选本页文件 can select, which previously could reach every entry you had revealed.
- Name the installer publisher. `bundle.publisher` was unset, so WiX fell back to the second segment of the identifier and the MSI reported `Manufacturer = multicloud`; publisher and copyright now carry the string from `LICENSE`. This affects Windows Installer metadata only - the `.exe` `CompanyName` version resource has no Tauri configuration key and stays empty.

## 1.4.3 - Online Tutorials Reachable

- The tutorial site is published at `https://159357yangjun.github.io/image-hosting-platform`, so this is the first bundle whose **在线文档 / 配置教程 / 本机 API 教程** entries resolve: release.yml probes one real tutorial route before building and bakes the base URL only when it answers 200.
- Document how API and Typora publishes differ from a desktop publish: they persist a `typora_publish` task but cannot raise `task://updated` or `asset://published`, so the open window refreshes by polling and auto-copy after publish does not happen.
- Give the exact Raw URL the app builds for Gitee when no custom domain is set.

## 1.4.2 - Error Channel and Cloud Onboarding Truthfulness

- Stop reporting one plugin failure twice. Those mutations declare no `onError`, so the global handler already raises a toast; the inline `window.alert` was a second report for the same event, and in WebView2 an alert suspends painting until it is dismissed. Storage pages that did own their error path now use the same toast channel instead of a native dialog, and batch enable/disable reports that the remaining plugins were left untouched rather than dumping a raw error string.
- State when the object-storage / WebDAV **public access domain** actually matters. Nothing derives an image URL from an Endpoint, so leaving it empty means the provider can only serve as a mirror or backup member; as a publish target the upload is rolled back with `Upload succeeded but the provider did not return a public URL`. The field label, the five provider step lists and the OSS / COS guides now say that conditionally, and `check_user_flow.py` pins the wording to the backend facts.
- Tutorials may only name reachable UI, and errors may only reach the user through one channel; both are now enforced per file.

## 1.4.1 - Image Loading, Tutorial Reachability, Docs Publishing

- Fix the Gallery / Assets / Cloud Browser image storm: each card rendered the same remote original twice and only the main image was lazy, so the eager blur backdrop fetched a full-size image for every mounted tile and decoded it on the main thread. Tiles now load near the viewport and decode asynchronously, enforced per `<img>` tag by `check_user_flow.py`.
- State plainly when a 资源 search only covers the loaded page instead of the whole index.
- Tell tutorials to open only UI that exists: the R2 guide pointed at a 方案 page and a 上传资源 button that have no navigation entry, and two pages quoted panel names the app does not render. `check_docs_site.py` now derives the sidebar from `AppShell.tsx` and rejects instructions whose first segment is not a real navigation item.
- Publish `website/` to GitHub Pages from `docs.yml` and build the desktop bundle against that same base URL, probing it first: reachable means the app shows online tutorial links, unpublished means the links stay hidden instead of shipping dead ones. A missing docs site no longer blocks a release.
- Document the Local HTTP API (endpoints, Bearer auth, status codes, 32 MiB behaviour, no CORS) and link it from the Settings API panel; it had been the only shipped entry point with no tutorial.

## 1.4.0 Preview - UX / Sync / Theme consolidation

- Rebrand the active development line as **图床 | Image Hosting Platform** and align desktop/docs package metadata on v1.4.0.
- Add metadata-only cloud asset index sync so existing images in GitHub / Gitee / R2 / S3 / OSS / COS / WebDAV can appear in the Asset Index without downloading image bodies.
- Keep **资源** and **图库** as separate concepts: Asset Index for metadata/output/multi-cloud state, remote Gallery for live Provider browsing.
- Harden GitHub browsing when the configured root does not exist yet and retry upload conflicts after refreshing remote state.
- Add the v1.4 Theme Engine foundation with design tokens, presets, accent color, wallpaper URL, glass strength and blur controls.
- Add first-run Help Center onboarding while keeping it reopenable from the sidebar.
- Replace misleading Typora “one-click configuration” wording with an explicit Custom Command configuration guide; the app copies the command and opens Typora but does not silently rewrite Typora settings.
- Upgrade Gallery presentation toward a photo-album layout and make copy actions explicit.
- Make the main application content area independently scrollable so long Settings / Plugins / AI sections remain reachable.
- Clean temporary cloud-index wiring scripts/workflows after the guarded implementation landed.
- Upgrade Release Bundle so `v*` tags can publish Windows installers, tracked-source archive and SHA256 checksums to GitHub Releases; manual dispatch remains a build-only preview path.
- Keep the legacy Tauri application identifier and Rust library crate name for upgrade/source compatibility while public product/package naming moves to Image Hosting Platform.

## 1.3.5 - Task Control, Plugin Observability & Diagnostics

- Added cooperative cancellation for persistent Cloud Manager batch delete/move/rename tasks.
- Added item-level progress updates that cannot revive a task after it has been cancelled.
- Added bounded retry for failed/cancelled Cloud Manager batch tasks using the original persisted payload and a maximum retry budget.
- Added Task Center cancel/retry controls plus retry-attempt visibility.
- Added migration `0013_plugin_execution_logs.sql` and persistent plugin execution audit records for hook, status, duration and failure summary.
- Audit Desktop, Typora/Local API and manual plugin executions through the same plugin repository.
- Added a plugin-page execution activity panel for recent success/failure timing.
- Added Settings system diagnostics for Local API, Storage, plugins, default Workflow and task health.

## 1.3.4 - Lifecycle Completion & Persistent Cloud Tasks

- Added `before_process`, `after_process` and `on_publish_failure` plugin hooks.
- Unified expanded lifecycle execution across Desktop, Typora and the Local HTTP API bridge.
- Upgraded the official Webhook manifest to v1.2.0 without auto-enabling newly introduced hooks.
- Added migration `0012_official_webhook_lifecycle.sql` for existing installs.
- Moved provider-neutral cloud move overwrite/fallback/rollback semantics into `application::CloudMutationCore`.
- Added persistent Task Center jobs for batch cloud delete, move and template rename.
- Updated Cloud Manager to enqueue long-running batch mutations instead of blocking the page.
- Fixed CLI `PluginContext` construction to include lifecycle metadata.

## 1.3.3 - Lifecycle Hooks & Batch Cloud Operations

- Add explicit plugin lifecycle hooks with persisted per-plugin user selections; legacy installs default to `after_upload` only.
- Add host-runtime hook gating and first-class `after_upload`, `on_gallery_delete` and `manual_trigger` events.
- Let Webhook Publisher optionally receive real cloud-delete events with storage/path metadata without making plugin failures roll back a completed remote delete.
- Add Cloud Manager batch move and safe template batch rename with `{name}`, `{stem}`, `{ext}` and `{index}` placeholders.
- Keep batch mutations bounded to 100 files, preserve destination overwrite protection and reconcile Deployment locations after successful moves.
- Split cloud-management and plugin commands into dedicated Rust command modules to continue reducing the monolithic Tauri API layer.
- Expand command contracts to 60/60/60 and source user-flow/reliability/lifecycle contracts to 103 checks.

## 1.3.2 - Zero-context Upload & Cloud Manager Mutations

- Add a real global shortcut (`CommandOrControl+Shift+U`) that uploads the clipboard image through the existing default Workflow and writes final URLs back to the clipboard.
- Persist the global-shortcut preference and actually unregister the OS shortcut when disabled so the key combination is released for other applications.
- Add a Windows Explorer current-user image context-menu integration backed by `--shell-upload`; no administrator-level registry write is required.
- Keep shell, shortcut, Typora, Local HTTP API and desktop uploads on the same default Workflow / multi-cloud / plugin path.
- Extend `StorageProvider` with move/create-directory capabilities and implement native OpenDAL rename/create-dir operations.
- Add safe cloud move fallback (download → upload → delete), destination-overwrite protection and rollback of the destination if source deletion fails.
- Reconcile SQLite Deployment `remote_path` / `public_url` after cloud moves and mark active deployments deleted after batch cloud deletes.
- Upgrade Cloud Manager with create directory, rename, move, multi-select and bounded batch delete controls.
- Expand source user-flow/reliability/integration/cloud-manager contracts from 79 to 93 checks and Tauri command contracts from 49/49/49 to 57/57/57.

## 1.3.1 - Integration Layer & Background Publisher

- Add a token-protected Local HTTP API bound only to `127.0.0.1:36677` for scripts, ShareX-style tools, editor integrations and future agents.
- Reuse the existing default Workflow bridge for both raw-body and local-path HTTP uploads; no second uploader implementation is introduced.
- Keep the Local API token in OS Credential Store and support in-app token rotation that invalidates previous clients immediately.
- Add a real Tauri system tray entry; closing the main window hides it instead of terminating the background publisher, while the tray menu provides explicit open/quit actions.
- Move Typora/output/integration commands out of the monolithic `commands.rs` into `commands/integrations.rs` as the first command-layer decomposition.
- Move CPU-heavy workflow image decode/resize/encode work to Tokio blocking workers for both desktop and CLI/Typora paths.
- Add Settings UI for Local API status, token copy/rotation and call examples.
- Harden command-contract validation to scan nested Rust command modules and keep frontend/Rust/Tauri registration at 49/49/49.
- Expand source user-flow/reliability/integration contracts from 69 to 79 checks.

## 1.3.0 - Publisher Core, Publish Center & Cloud Manager

- Move Storage Group strategy semantics into `application::PublisherCore`; Tauri now delegates `mirror_all` and ordered primary/backup failover instead of owning those rules.
- Make a new Publish Center the default desktop entry: current target, quick target switching, drag/drop, clipboard, URL, output-format controls, recent assets and recent tasks.
- Keep every Publish Center action on the existing hidden workflow/task path instead of introducing a second uploader implementation.
- Upgrade Gallery/Storage Browser with remote download and confirmed permanent delete.
- Reconcile direct cloud deletes back into SQLite by marking every matching active Deployment as deleted.
- Add two Tauri cloud-management commands and keep frontend/backend/registration contracts at 47/47/47.
- Preserve v1.2.5 integrity hardening, plugin Permission Gate and OS credential isolation.
- Product direction is informed by PicGo's low-friction upload flow and PicList's cloud-management/task experience, without copying their Electron/npm-plugin security model.

## 1.2.5 - Publish Integrity Hardening

- Let backup failover survive desktop preflight instead of rejecting a group when Primary is temporarily unhealthy.
- Validate URL batches before task creation so an invalid later URL cannot leave hidden partial tasks.
- Make new remote paths unique per publish and protect shared legacy remote objects during deletion.
- Verify repair sources against the stored content hash before copying them to other clouds.
- Persist Typora partial/cloud/plugin warnings as completed-with-warning, matching the desktop task model.
- Add compensation cleanup when a safe unique remote upload succeeds but local persistence fails.
- Strengthen object-storage and Gitee connection tests, automatic-pipeline setup, long-history loading and public URL validation.

## 1.2.4 - Explicit Plugin Authorization

- Separate plugin Manifest declarations from user-granted permissions; declaration alone no longer authorizes a capability.
- Persist `granted_permissions_json` in SQLite and add migration `0010_plugin_permission_grants.sql`.
- Existing plugins keep only baseline `read_asset`; plugins requesting network, secrets, or external writes are disabled until the user explicitly re-authorizes them.
- Add `set_plugin_permissions` as a Tauri command and share the same grant state across desktop uploads and Typora CLI uploads.
- Add plugin-page permission confirmation before enabling a plugin with missing grants, plus a one-click way to revoke sensitive grants.
- Keep v1.2.3 reliability fixes: real backup failover, GitHub write-access validation, multimodal AI Caption, remote SHA verification and automatic hidden publish chain.
- Expand user-flow/reliability regression contracts from 33 to 40 checks.
- Dependency lock policy remains honest: networked CI generates the resolved lock files and then uses `cargo --locked` / `npm ci`; this offline package does not fabricate lockfiles.

## 1.2.3 - Publish Reliability & Plugin Safety

- Keep the hidden automatic publish chain introduced in v1.2.2 and preserve the single user flow across local, URL, clipboard and Typora uploads.
- Make `primary_with_backups` real failover semantics: mirrors always publish, backups publish only if the primary fails or cannot be initialized.
- Make GitHub connection tests reject tokens that can read the repository but do not have effective repository write access.
- Send the actual remote image as OpenAI-compatible `image_url` multimodal content for AI Image Caption.
- Enforce plugin manifest permissions inside the host runtime for asset reads, network calls, secrets and external writes.
- Upgrade existing official AI Caption plugin manifests to request `secret` permission.
- Pin direct npm dependency versions and make CI/release resolve lock files first, then build with `cargo --locked` and `npm ci`; publish the resolved locks as an artifact.
- Expand user-flow regression checks from 22 to 33 contracts.
- Retain plugin output persistence, post-plugin `asset://published`, OS credential storage for AI keys and automatic default target repair.

## 1.2.1 - Plugin Switches

- Replace the primary “方案” navigation entry with a single plugin control surface.
- Make installed plugins first-class on/off switches; add enable-all and disable-all actions.
- Enabled plugins now participate automatically after successful uploads, including Typora uploads.
- Keep workflow records as an internal processing compatibility layer instead of exposing them as a primary product concept.
- Update Typora and upload copy so users think in terms of upload target + enabled plugins.

## 1.2.0 - Plugin Runtime + AI Planner

- Add manifest-based plugin runtime and plugin marketplace UI.
- Add plugin persistence migration and enable/disable/config/remove commands.
- Add template, webhook and OpenAI-compatible AI prompt host runtimes.
- Add AI provider settings and natural-language workflow planner.
- Keep third-party native code disabled; WASM sandbox remains future work.
