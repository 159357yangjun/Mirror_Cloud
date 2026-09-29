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

### 三处调用点与两条踩坑记录

三处 `void` 调用点的确切位置：`HelpCenterDialog.tsx:32`（经 `AppShell.tsx:114` 注入）、`SettingsPage.tsx:328`、`StorageSetupDialog.tsx:256`（后者要先在云端页展开"配置教程"面板才出现）；同一批里另外 6 处是 `GalleryPage.tsx:321/342/388` 与 `StorageBrowserDialog.tsx:149/169/183` 的"浏览器打开"，它们共用同一个包装函数。逐基址的实际提示文本见上面那张表。

- 我第一版顺手加的 `if (!window.open(...)) throw new Error('浏览器拦截了新窗口…')` **是错的**：规范规定带 `noopener` 时 `window.open` 一律返回 `null`，实测三个本来能正常打开的链接全部误报成"被拦截"（那一次的吐司原文：「打开链接失败：Error: 浏览器拦截了新窗口，请允许弹出窗口后重试」，出现在明明已经开好的标签旁边）。已撤掉，并在注释里写明浏览器分支只能报告真正的 rejection。
- 丢弃 promise 这件事本身的红→绿是在同一页面里对照测的（等吐司栈清空后各调一次）：`void openExternalUrl('not a url…')` → `toastsAfterVoidCall: 0`，只留一条 `Uncaught (in promise)` 的页面错误；`openExternalUrlOrReport(同一个值)` → `toastsAfterWrapperCall: 1`，文本就是表里那条 TypeError。
- 诚实边界：`popup 被拦`这一种失败在浏览器分支仍**不可检测**（保留 `noopener` 比一个诊断信号更值钱）；Tauri 分支的 `openUrl` rejection 现在会被报告，但那条分支需要 Rust 运行时，本机没跑。

### 测具已进仓：`scripts/verify_dialog_interactions.mjs`

上面所有数字都出自这个探针。它此前只存在于会话目录（`cdp-dialog-probe.mjs`，34,750 字节 / 12:31），而仓库里已经有 11 个 `scripts/*` 检查器——**修搞出来了，别人重跑不了验证，会话目录一清测具就没了**。现在它、它的入口、以及"认证它的检查器"的指纹都在仓里。

**指纹（改动这两个文件后必须回来更新这里，对不上就说明测具与结论不是同一份）**

| 文件 | 行数 | 字节 | sha256 | 基线通过项数 |
| --- | --- | --- | --- | --- |
| `scripts/verify_dialog_interactions.mjs` | 888 | 55,706 | `c1d7a403b69a3b3388cb75c47cbbd078ec2899a51eff11f6c349da8946c9797d` | `gate-unit` 6/6、`gate` 3 项 + `sawMinimizedReject: true`、`ab` `deltaOverflowX: 210` |
| `scripts/check_user_flow.py`（认证上面这个测具的那份检查器，同址在 `scripts/`） | 405 | 38,178 | `1cb644121a89c4aac5c597ea214ab5f13ad3dd5a8fec6eaa8857116165a3ce32` | `total checks: 156` |

**指纹是对着 `git show <commit>:<path>` 的 blob 比的，不是对着工作区比的**——`core.autocrlf=true` 下工作区是 CRLF、库里是 LF，拿工作区算出的哈希别人复现不出来。

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
每次改完立即还原并 diff -q 确认字节一致；baseline 与 restored 均 rc=0。
```

真浏览器侧的端到端拦截（`gate` 模式，`Browser.setWindowBounds minimized`）：`visibilityState` 翻成 `hidden` 而 `innerWidth/innerHeight` **仍是 1406×803**，门禁照样抛错退出——所以"尺寸>0 就安全"是错的。`innerWidth=0` 那一支**本机无法在活页面上复现**（`setDeviceMetricsOverride` 忽略 0，最小化窗口保留旧尺寸），它由上面 `gate-unit` 的第 3、6 例覆盖，输入是本轮连接器实际报过的读数。**这是等价物的边界，别当端到端证据。**

守卫计数：`check_user_flow.py` 143 → 150 → 154 → 155 → **156**（本批 +1 条入口可达性、+1 条变更记录编码完整性）。


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

  上面是**捕获时刻**的快照，不是最终态。本批实际落了 5 笔提交（测具+入口+断言 `30ae300`、指纹记录 `3d0fb67`、编码守卫 `c688261`、本文件恢复 `582fddc`，以及上一批的 `8f8d1e3`/`f387a66`/`0bb8dfe`），最终 `git status -sb` 是 `## dev...origin/dev [ahead 7]` 且工作区无输出。**本轮指令是不 push**，所以远端仍停在 `fe57911`；推送状态以 `git status -sb` 为准，不以本文件为准。
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
5. **`StorageBrowserDialog.tsx:148 / :168 / :182` 还有 3 处 `void copyText(...)`**（三个"复制"按钮）：和这轮修掉的 `void openExternalUrl` 是同一类丢弃 promise 的写法，剪贴板写入失败时按钮不会给任何反馈。同一条线改起来只要把包装函数换成通用版，但本轮没有实测证据（浏览器分支的 `navigator.clipboard` 在 headless 下直接成功，构造不出失败），所以**只登记不动**，等真需要时一起改。
6. **默认分支 `main` 指向另一项目**：依旧只交方案、未执行任何分支操作，方案与影响面见上一批第 5 条。

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
