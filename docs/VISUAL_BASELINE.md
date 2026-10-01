# 视觉基线（改前）— 2026-09-30

本文只记录**量到的数字**，不记录"觉得"。它是"只改一个界面"这一批的前置：没有这份基线，改完那句"变好看了"没人能验。

## 0. 这份数据怎么来的

```text
$ cd apps/desktop && npm run dev            # 只起前端，不打包、不起 Rust
$ node scripts/verify_dialog_interactions.mjs visual --port 9383
```

| 项 | 值 |
| --- | --- |
| 被测提交 | `e936c90`（`HEAD`，dev） |
| 应用版本 | 1.4.4（未发新版） |
| 视口 | 1406×803，`visibilityState: visible`，`hasFocus: true`，dpr 1 |
| 身份门禁 | `IDENTITY {"packageJsonMatches":true,"exportsChecked":75,"exportsMissing":0}` |
| 采样前置 | 每屏截图前 `getAnimations().finish()` 并复过视口门禁 |
| 覆盖界面 | 发布 / 新手教程弹窗 / 确认框 / 上传弹窗 / 资源 / 云端 / 图库 / 插件 / 任务 / 设置（10 屏） |
| 产物 | `%TEMP%\image-hosting-probes\2026-09-30\`：`visual-baseline.json` + `vis-*.png`（10 张首屏 + 弹窗尾部图） |

**截图未进仓**（`.gitignore` 之外，产物目录在 TEMP）。JSON 里的 `provenance` 字段随每次运行重写，所以任何一份 JSON 都能自证是哪棵树上量的。

### 0.1 本轮作废的读数（全部是测具或我自己的假设的错，不是界面的错）

标题原先写"十行"，而表里已经有 12 行——一个手抄的计数漂了两次都没人发现，所以把数词摘掉，让表自己数。

| 作废读数 | 真相 | 怎么发现的 |
| --- | --- | --- |
| `help-center numberedChips: 0`（"底部没有重复序列"） | 底部确实有 5 个编号 chip | 旧探针要求元素**无子节点**且文本恰为纯数字；chip 文本是 `1.连接 GitHub` 且内部包了 `<span>`，两个条件都不满足 → 假阴性。改成"以序号开头 + 允许 1 个子节点"后计到 5 |
| `utilityDrift: {}`（"字号工具类都生效"） | 23 个按钮的字号被整条吞掉 | 探针正则写在一个 Node 模板字符串里，单反斜杠 `\s` 到页面变成 `s`，正则**一个都没匹配上**却和"没有漂移"打印得一模一样。现在探针自报 `checked/matched`，且 `checked>0 && matched===0` 直接判为测具故障（exit 2） |
| `contrast` 模式 `chip: []` / `stepWord: []` | 两条链都能取到 | 取的是**祖先**元素的文本，`find` 命中父节点后返回其继承色。改为取最深匹配 |
| `插件 页 "AI 与自动化" 1.31:1，背景 rgb(0,0,0)`（3 行） | 那 3 行不是缺陷，是**取样点不在画布上** | 元素半出屏时取元素几何中心，中心 y=808 而截图高 803，`getImageData` 越界返回全黑 → 任何深色字都被算成 1.3:1。改为取"元素与视口交集"的中心，交集 <4×4 判 clipped、点在画布外判 offcanvas 并**停机**，且用两种植入夹具证明这两个计数器真的会动 |
| `CONTRAST_GATE combos=18`（我当成 63 组合报的那一轮） | 只跑了默认 2 个面，`--routes=发布,资源,…` 被**静默忽略** | 参数解析只认 `--routes 值`（空格式），等号式匹配不到就回落到默认值，仍然打印一条自信的 CONTRAST_GATE。现在两种写法都认，且任何未登记的 `--flag` 直接 exit 2；可接受的 flag 名单由**读本文件里的 `opt('…')` 调用**导出，不手数 |
| `deadSpace.emptyPct`（单值） | 卡片自身 `padding-bottom` 20px 被算进"死白" | 拆成 `emptyPct`（含 padding）与 `stretchPct/stretchPx`（等高网格真正多出来的部分） |
| 我写下的"slate-400 与 `--text-muted` 是同一个灰" | 实测 `rgb(144,161,185)` vs `rgb(148,163,184)`，`identical: false` | 这是**我的假设**不是读数；加 `palette` 探针用浏览器颜色引擎归一化后自证，把这句话从"合并成一个 token"改回"同一层级两个灰" |
| `alpha=0 的像素被当黑底`（34 行 1.04:1） | 未绘制的像素**不是颜色**；白字压在"无"上不可能只有 1.04:1 | 数字自相矛盾暴露了它（白字对真黑应是 20:1）。现在 alpha<250 的点记为 unpainted 并计数，绝不带一个"合法颜色"进结论——默认白与默认黑是两个相反方向的假绿 |
| `拖放区按钮 1.76:1，坐在 rgb(52,42,172) 上` | 那块紫砖是按钮**自己的装饰后代**，本行没有一笔压在它上面 | 包装型控件的标签来自后代元素，量整盒就会量到装饰。现在容器控件跳过并计 `skipped.containers`；其后代自己上漆的点拒为 foreign |
| `foreign=0`（我一度读作"没有外来像素"） | 真实原因是网格**没看到行尾**：步长从 0 起、停在末点之前 | 夹具把 chip 压住行尾 6px 时 `refused=0` 才暴露。现在每条 fragment 的两端恒在网格内 |
| 一次 `below=0`（我加归属过滤的第一版跑出来的） | 37 行普通文字被自己的过滤器拒了：归属判据放在**取样阶段**，而 DOM 在截图后又动了（侧栏宽度过渡、吐司挤页面） | 结论：判"这个点属于谁"必须与取几何在**同一次页面求值**里完成。该次 `below=0` 与它想证明的结论同源于已作废路径，一并作废 |
| `设置` 页那行 11px 说明文字 4.12:1 / 4.09:1，压在 `rgb(224,224,224)` 上（6 行，我把它当"具名未决缺陷"交回了一轮） | 那块灰**不是这个面的表面**，是当时叠在页面上的 4 条错误吐司的**投影**。纯灰（R=G=B）在本 app 任何主题里都不画，且全黑壁纸与全白壁纸下同一个数——两者都指向"这块漆与被测主题无关" | 看截图：文字尾部正好伸进吐司栈的落影里。取样前清空 toast 栈并断言 `[role=alert]/[role=status]` 归零，该组合直接 exit 2；清空后 72 组合 `below=0`。**教训：读数必须带输入状态**——COMBO 行现在打 `toasts=N`，N 是这一格开拍前屏上的吐司数 |
| 图库 `刷新` 按钮"自己的文字被切掉 4px 纵向墨迹"（2 行，1024 与 640 各一行，我按"分不清"挂了两轮） | 一笔都没被切：该按钮 `overflow: visible / visible`，一个不裁切的盒子不可能"自我裁切"。那 4px 是**行盒**（两行 24px 折行 = 45px）伸出 40px 盒子的部分，它照常上漆 | 按他给的"只做那一次读数"办了：`height 40 / clientHeight 38 / scrollHeight 43 / line-height 24px / font-size 16px / overflow visible/visible / 墨迹盒 45px`。读数顺带把**真正的**缺陷指了出来——`刷新` 之所以折成两行，是因为它声明 `text-xs`(12px) 却渲染成 16px。判据现在要求"被量的那一轴真的在裁切"，并配一对夹具：`overflow:hidden` 切 24px 行仍须报红，`刷新` 那个形状不再报红（第一版绿夹具用拉丁文，根本不折行，墨迹 21px < 盒子 40px，"通过"得毫无意义——加了 `plantReproduces` 断言才咬住） |

另：上一批的 `dlgWidth: 186.8px` 已作废（隐藏窗口 0×0 视口下量得），本轮所有屏先过视口门禁再采样。

## 1. 六条尺子 × 10 个界面

"字号档"= 该界面实际出现的 `fontSize/fontWeight` 组合数；"圆角/gap 种数"= 不同取值个数；"AA 失败"= 文本对比度 < 4.5:1 的元素数（`+n?` = 背景为渐变、无法判定）；"漂移按钮"= 同一 class 挂在 `<span>` 上算 12px/500、挂在 `<button>` 上算 16px/400 的元素数。

| 界面 | 字号档 | 字号阶梯(px) | 圆角种数 | gap 种数 | AA 失败 | 最差比值 | 漂移按钮 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 发布 | 9 | 28/24/16/14/14/14/12/12/11 | 6 | 4 | 9 | 2.46 | 8 |
| 新手教程弹窗 | 6 | 18/16/14/12/11/10 | 5 | 3 | 7 | 2.45 | 6 |
| 确认框 | 3 | 16/14/12 | 4 | 2 | **0** | — | 2 |
| 上传弹窗 | 6 | 20/16/14/12/12/11 | 6 | 1 | 4 | 2.56 | 2 |
| 资源 | 8 | 28/16/14/14/12/12/12/11 | 5 | 5 | 7 | 2.46 | 0 |
| 云端 | 7 | 28/16/16/14/14/12/11 | 5 | 5 | 20 | 2.46 | 1 |
| 图库（空状态） | 5 | 28/16/14/14/12 | 4 | 2 | 2 | 2.46 | 0 |
| 插件 | 7 | 28/16/14/14/12/12/10 | 6 | 4 | 7 | 2.46 | 2 |
| 任务（含错误态） | 3 | 28/14/12 | 3 | 2 | 2 | 2.46 | 0 |
| 设置 | 10 | 28/16/14/14/14/12/12/12/11/11 | 7 | 5 | 18 +8? | 2.46 | 2 |
| **合计** | | | | | **76（+8 未判定）** | | **23** |

空状态与错误态各有一张实拍：图库 `还没有可浏览的云端`（14px/600，17.85:1，正文 2.63:1 不达标）；任务页 `数据加载失败：TypeError: Cannot read prop…`（12px，5.87:1，达标）。

## 2. 逐条判据的实测结论

### 判据 1 · 层级 —— 成立，但不是"6 张卡一样重"，是**没有从属关系**

新手教程弹窗 6 张卡：图标容器 `size-9 rounded-xl`、`STEP n`、标题、正文、动作按钮——**每张卡的五件套完全相同**，字号阶梯只有 6 档（18/16/14/12/11/10），卡内没有任何一档比另一档更"低"。真正缺的是主次：6 张卡是并列的，但用户要按顺序做，顺序信息只挂在最弱的 10px `STEP n` 上（比值 2.56，全弹窗最看不清的元素）。

### 判据 2 · 死白 —— 成立，但**程度是 10%，不是 30–40%**

| 卡 | 卡高 | padding-bottom | 末尾留白 | 其中网格拉伸 |
| --- | --- | --- | --- | --- |
| STEP 1 / 2 | 226px | 20px | 9% | 0%（1px） |
| STEP 3 | 250px | 20px | 18% | **10%（25px）** |
| STEP 4 | 250px | 20px | 8% | 0%（1px） |
| STEP 5 | 250px | 20px | 18% | **10%（25px）** |
| STEP 6 | 250px | 20px | 8% | 0%（1px） |

只有同一行里"内容较短"的那张（STEP 3、STEP 5）被 `grid` 等高拉伸多出 25px；其余四张的"留白"就是卡片自己的 padding。**"30–40% 是空的"这个估计偏高，按实测 18%/10% 记。**

### 判据 2b · 弹窗改前几何（本批唯一要改的界面，逐值登记）

| 位置 | 圆角 | 间距 | 内边距 |
| --- | --- | --- | --- |
| 外壳 `section` | `rounded-[30px]` | — | — |
| 头部 `header` | — | `gap-4`（16px） | `px-6 py-5`（24/20px） |
| 图标容器（头部） | `rounded-2xl`（16px） | — | `size-10`（40px） |
| 内容滚动区 | — | — | `p-6`（24px） |
| 卡片网格 | — | `gap-4`（16px） | — |
| 卡片 `article` | `rounded-[22px]` | — | `p-5`（20px） |
| 卡内图标容器 | `rounded-xl`（12px） | — | `size-9`（36px） |
| 图标 → `STEP n` | — | `gap-3`（12px） | — |
| `STEP n` → 标题 | — | `mt-4`（16px） | — |
| 标题 → 正文 | — | `mt-2`（8px） | — |
| 正文 → 动作按钮 | `rounded-xl`（12px） | `mt-4`（16px） | `px-3 py-2`（12/8px） |
| 底部 chip 容器 | `rounded-2xl`（16px） | `mt-5`（20px） | `p-5`（20px） |
| chip 网格 | — | `gap-2`（8px） | — |
| 单个 chip | `rounded-xl`（12px） | — | `px-3 py-3`（12px） |

弹窗内圆角共 5 种取值：`12px`×17、`22px`×6、`16px`×2、`30px`×1、`rounded-full`×1（JSON 里那个 `3.35544e+07px` 就是 9999px 的全圆角，不是异常读数）。**`22px` 与 `30px` 都不在 token 上**——`styles.css:25-26` 定义 `--radius-card: 24px`、`--radius-control: 12px`，弹窗却自己写了两个新值。gap 共 3 种：`12px`×6、`16px`×2、`8px`×2。

### 判据 3 · 主次 —— 成立，且根因是**一条全局 CSS 把按钮字号整条吞掉**

同一串 class（含 `text-xs font-medium`）：挂在 `<span>` 上算 `12px/500`，挂在 `<button>` 上算 `16px/400`。全站 10 屏共 **23 个按钮**如此。机制：`apps/desktop/src/styles.css:71` 的 `button, input, select, textarea { font: inherit; }` 写在 Tailwind 的 `@layer utilities` **之外**，未分层的规则在层叠里高于分层规则，于是 `text-xs` / `text-sm` / `text-[11px]` 连同 `font-medium` 一起被 `font: inherit` 覆盖。

这条直接解释了"链接按钮和卡片标题一样大"：卡内动作按钮实际 **16px/400**，而卡片标题是 **14px/600** —— 按钮比它所属的标题**更大更轻**，主次正好颠倒。

**本批不修全局**（改 `styles.css:71` 会一次动到 10 个界面，越出"只改一个界面"的范围）。登记为缺陷，弹窗内用作用域受限的规则抵消它。

### 判据 4 · 信息架构重叠 —— 成立，同一个弹窗里两条编号序列

探针实测：`steps: 6`，`numberedItems: 5`。

- 序列 A（6 步）：`STEP 1 连接一个真实云端` … `STEP 6 Typora 不是只能用 PicGo`
- 序列 B（5 个 chip）：`1.连接 GitHub`、`2.上传 1 张图`、`3.图库确认远端`、`4.复制 Markdown`、`5.再配置 Typora`

B 的 5 项是 A 的 1/2/3/5/6 的缩写重述，**且编号不一致**（B 的第 4 项对应 A 的第 5 步）。同一屏两套编号指向同一流程，用户无法判断哪条才是"顺序"。

**裁决：删序列 B（底部 5 个 chip 那一整块），保留 6 步。** 理由：(a) A 是信息超集，B 是它的有损缩写，删 A 会丢内容、删 B 不丢；(b) B 的编号与 A 冲突，留着就制造"两套顺序"这个原缺陷；(c) 弹窗实测 `scrollHeight 945 / clientHeight 612`，**有 333px 内容在折叠线以下**，删掉 B 直接换回可读高度；(d) B 的标题带一个 `Keyboard` 图标，但 5 个 chip 里没有任何快捷键——它连自己的图标都在说谎。

### 判据 5 · 字体 —— 成立，两处

- 字体栈 `Inter, "SF Pro Display", "SF Pro Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif`（`styles.css:4`）里**没有任何 CJK 字体**；仓内无 `@font-face`、`index.html` 无 `<link>`，所以 Inter 从未被加载。canvas 宽度探针实测：`Inter` 与 `sans-serif` 宽度**完全相同（669）**= 未安装；`"Segoe UI"` 648、`"Microsoft YaHei"` 704 各自独立。结论：**拉丁文实际落到 Segoe UI，中文落到系统默认**，两者都不是显式指定的——正是你看到的现象。
- `STEP n` 的 `font-variant-numeric` 实测 `"normal"`（3 个样本全中）：数字未开启等宽。这一条只到"属性没设"为止——本弹窗只有 STEP 1…6，没有出现可量的对齐跳动，不夸大成已见缺陷。

**本批不引入 webfont**（挂 Google Fonts = 国内演示时一个阻塞样式表就能白屏；新增依赖/改 lock 已被禁止）。做法是**把栈写明确**：拉丁用系统已确认存在的 Segoe UI，中文显式列 微软雅黑 / 苹方 / Noto Sans CJK，并给 `STEP n` 加 `tabular-nums`。

### 判据 6 · 对比度 —— 成立，且 76 条失败里 71 条来自同一个灰色的两种写法

按计算后的前景色聚合（不是按 class 猜）：

| 计算色值 | 写法 | 失败数 | 比值区间 | 涉及界面 |
| --- | --- | --- | --- | --- |
| `oklch(0.704 0.04 256.788)` | Tailwind `text-slate-400`（硬编码残留） | **59** | 2.46–2.63 | 8 |
| `rgb(148, 163, 184)` | `text-[var(--text-muted)]`（#94a3b8） | **12** | 2.45–2.56 | 2 |
| `oklch(0.554 0.046 257.417)` | `text-slate-500` | 2 | 4.35 | 1 |
| 其余 3 条 | 琥珀/蓝/靛的半透明强调色 | 3 | 3.14–3.56 | 3 |

前两行**不是同一个颜色**——我先假设它们相同，然后被自己的探针否掉了：`palette` 用浏览器颜色引擎归一化后，`oklch(70.4% 0.04 256.788)`（`apps/desktop/node_modules/tailwindcss/theme.css:218` 的 `--color-slate-400`）实际渲染为 `rgb(144,161,185)`，而 `#94a3b8`（`styles.css:18` 的 `--text-muted`）是 `rgb(148,163,184)`，`identical: false`。两者是**同一天花板上、各自不达标的两个灰**，比值区间几乎重合只是因为颜色本身只差 (4,2,1)。

所以结论要说准：**76 条失败里 71 条落在"弱化灰"这一个层级上**，写法有两种（硬编码 `text-slate-400` 59 条 + token `--text-muted` 12 条）。要做的是"把这一层灰提到达标"，不是"合并成一个变量"——合并变量不会让 2.45 变成 4.5。

新手教程弹窗内实测（含手算复核，两者一致）：

| 元素 | 前景 | 实测比值 | 阈值 | 判定 |
| --- | --- | --- | --- | --- |
| 头部副标题（12px） | `rgb(148,163,184)` | **2.45** | 4.5:1 | 不达标 |
| `STEP 1…6`（10px） | `rgb(148,163,184)` | **2.56** | 4.5:1 | 不达标 |
| 关闭 ×（18px 图标，非文本） | `rgb(148,163,184)` | **2.44**（手算，同公式；扫描器只覆盖文本） | 3:1（WCAG 1.4.11） | 不达标 |
| 卡片标题（14px/600） | `rgb(15,23,42)` | 17.8 | 4.5:1 | 达标 |
| 卡片正文（12px） | `rgb(71,85,105)` | 7.20（同公式手算；未进失败清单=扫描器判其达标） | 4.5:1 | 达标 |
| chip 文本（11px） | `rgb(71,85,105)` | 7.20（同上） | 4.5:1 | 达标 |

背景链是一手的：`SECTION rgba(255,255,255,.94)` 叠在 `oklab(0.129 …/0.35)` 遮罩上，合成后 ≈ `rgb(249,249,250)`，`#94a3b8` 对其 2.44:1。

**"你怀疑的两处，一处半对"**：关闭 × 确实 <3:1（2.44），chip 微文本 7.2:1 并不低——它的问题是**小（11px）和挤**，不是对比度。

## 3. 本批范围

- **只改 `apps/desktop/src/components/HelpCenterDialog.tsx`**（判据 1/2/3/4/5/6 在弹窗内可达成的部分）。
- 全局 `button { font: inherit }`（判据 3 根因）与 `--text-muted` / `text-slate-400`（判据 6 根因）**登记不修**：改它们会一次动到 10 个界面，越出"只改一个界面"，且需要单独批准。
- 不新增依赖、不改依赖清单/lock、不 `npm install`、不 `build`/`tauri`、不打包、不 push、不改版本号、不改 `tauri.conf.json`、不挂 Google Fonts。
- 改完必须重新量同一批指标并给出改前/改后数值，而不是给形容词。

## 4. 主题落地与对比度（第二批，改后实测量）

下面三张表都不是手写的：第一张由 `node scripts/theme_face_inventory.mjs` 生成、`--verify` 比对本文；第二、三张由
`node scripts/verify_dialog_interactions.mjs contrast-tier --doc=docs/VISUAL_BASELINE.md` 在实测结束后比对本文——
**表里的任何一个数字与实跑不符，那条 gate 就 exit 非 0**。手写表格呯不住写表格的人，所以这里没有手写的表格。

### 4.1 逐面主题分类（三层，带"为什么分在这一层"）

生成器：`scripts/theme_face_inventory.mjs`。三层的判据不是"种类数"，是**修它要动哪一层**：

- **令牌可达**：class 编译成 `var(--color-hue-rung)`（Tailwind v4 的行为）或直接 `var(--token)`，或走 `.theme-*` 原语。
  改一个变量就整片跟着主题走 —— 本轮 962 处里绝大多数是 `text-slate-400`（138）、`text-slate-500`（43）、`border-slate-200`（87）这类。
- **需 class 规则**：`bg-white` / `text-slate-900|950`。同一个 rung 在本仓**既是前景又是填充**（`bg-slate-950` 是代码块填充，`text-slate-950` 是标题前景），
  一个变量不能同时把两边反过来，所以只能按 class 名钉住；写这些规则用的是 unlayered 声明，故意压过 Tailwind 的 layered utilities。
- **设计上不分主题**：`bg-slate-950` 的代码块 / 命令块（44 处）—— 它们本身就是"终端黑"，三套主题都该是黑的。
  这一层不是没做，是**决定不做**，因此必须由白名单逐条署名（见 4.4 的 DEAD-EXEMPTION）。

`dark:` 前缀 **0 处**、字面色值（`bg-[#...]`）**0 处**：这与雇主数到的一致。0 个 `dark:` 不是"暗色没实现"，
而是这仓的暗色**从来没有 class 分支**，它整个挂在一个我上一轮看不见也守不住的开关上 —— `documentElement[data-theme]` +
每套主题各自的变量表。所以修法只有两种：改 token，或按 class 名加规则；"逐个加 `dark:` 前缀"在这个架构里是**第三种更贵的做法**，
它还会漏掉第三套主题（sakura 既不是 light 也不是 dark）。

<!-- THEME_FACE_TABLE:BEGIN -->
| 面 | 令牌可达 | 需 class 规则 | 设计上不分主题 | dark: 前缀 | 字面色值 |
|---|---|---|---|---|---|
| 页面 · 发布 | 86 | 7 | 2 | 0 | 0 |
| 页面 · 资源 | 63 | 1 | 2 | 0 | 0 |
| 页面 · 云端 | 52 | 6 | 6 | 0 | 0 |
| 页面 · 图库 | 75 | 20 | 3 | 0 | 0 |
| 页面 · 插件 | 102 | 12 | 3 | 0 | 0 |
| 页面 · 任务 | 32 | 3 | 0 | 0 | 0 |
| 页面 · 方案 | 35 | 4 | 2 | 0 | 0 |
| 页面 · 设置 | 146 | 21 | 6 | 0 | 0 |
| 弹窗 · Confirm | 14 | 0 | 1 | 0 | 0 |
| 弹窗 · 帮助中心 | 15 | 0 | 1 | 0 | 0 |
| 弹窗 · Provider 选择 | 12 | 1 | 2 | 0 | 0 |
| 弹窗 · 上传 | 87 | 16 | 4 | 0 | 0 |
| 弹窗 · 云端浏览 | 59 | 12 | 2 | 0 | 0 |
| 弹窗 · 云端配置 | 37 | 4 | 2 | 0 | 0 |
| 弹窗 · 多云组 | 25 | 4 | 3 | 0 | 0 |
| 弹窗 · 方案配置 | 38 | 3 | 2 | 0 | 0 |
| 面板 · 主题 | 24 | 0 | 1 | 0 | 0 |
| 壳层 · AppShell | 21 | 0 | 2 | 0 | 0 |
| 壳层 · PageHeader | 2 | 1 | 0 | 0 | 0 |
| 浮层 · Toast | 6 | 0 | 0 | 0 | 0 |
| 浮层 · 索引横幅 | 10 | 1 | 0 | 0 | 0 |
| 卡片 · 图库条目 | 21 | 5 | 0 | 0 | 0 |
| **合计（22 个面）** | **962** | **121** | **44** | **0** | **0** |
<!-- THEME_FACE_TABLE:END -->

### 4.2 逐面 × 逐主题 最差比值（文字对它实际坐着的面）

比值不是 token 对 token 算的：**隐藏字形 → 拍照 → 在该行文字自己的墨迹矩形上取若干点 → 逐点合成 → 判最差那一点**
（判据本体的来历、两条相反方向的夹具与成本读数见 4.35）。渐变、`backdrop-filter`、壁纸合成都已经在里面。
壁纸极值取"全黑图"和"全白图"两端 —— 用户能填任何一张，只有两端都过才算下限。8 个面 = 7 个路由 + Confirm 弹窗；每格是三种壁纸极值里最差的那一次。

改前（同一判据、同一测具，在 `0d98ff4` 的工作树上取的红）：**63 组合里 43 行不达标**，最差 1.31:1。
其中 3 行是测具自己的假红（元素半出屏、取样点落在画布外读到 `rgb(0,0,0)`），已在 0.1 作废登记；
其余 40 行是真缺陷，分四类：暗色未落地的深色字级（`text-violet-800/70` 1.48:1）、半透明前景（`text-amber-800/70` 1.8–3.66:1）、
被填充类 rung 反转连带改坏的控件填充（`bg-indigo-600` 上的白字 2.28:1）、以及坐在壁纸上的正文（2.93:1）。
改后：**72 组合、1,902 行、121,602 个取样点（同一批次内可重跑；跨批次这一列会漂，见 4.36），0 行不达标**，下表 8 个面的最差格是 4.74:1（mist 与 sakura 同值）/ 4.92:1（midnight）。
中间那一版这里曾印过"6 行不达标 + 具名未决项"，那 6 行是测具的输入状态（叠在页面上的错误吐司落影），
已作废并记在 0.1 第十行、来龙去脉在 4.37 —— 保留这段，是因为"红过一次但红的是测具"比"没红过"更需要留痕。

<!-- CONTRAST_FACE_TABLE:BEGIN -->
| 面 | mist | midnight | sakura | 判读文字数（每主题） |
|---|---|---|---|---|
| 发布 | 5.26 | 6.18 | 5.23 | 38/38/38 |
| 资源 | 5.26 | 6.18 | 5.23 | 31/31/31 |
| 云端 | 5.26 | 6.18 | 5.23 | 38/38/38 |
| 图库 | 5.26 | 6.18 | 5.23 | 18/18/18 |
| 插件 | 5.09 | 5.95 | 5.09 | 26/28/26 |
| 任务 | 5.26 | 6.18 | 5.23 | 17/17/17 |
| 设置 | 5.26 | 6.18 | 5.23 | 37/37/37 |
| 对话框 | 5.17 | 6.31 | 5.04 | 5/5/5 |
<!-- CONTRAST_FACE_TABLE:END -->

### 4.3 控件对它自己的表面（WCAG 1.4.11 的对象）

"控件 vs 它实际坐着的面"——主按钮的背景**就是**它自己的表面，不是旁边那块卡片。分六类（分类读元素自身的
class/tag，新出现的按钮形状会落进 `ghost` 而被判读，不会不被计数）；每一格取三套壁纸极值、全部 8 个面里最差的一次：

<!-- CONTRAST_CONTROL_TABLE:BEGIN -->
| 控件类型 | mist | midnight | sakura | 判读控件数（每主题） |
|---|---|---|---|---|
| primary-fill | 20.16 | 20.16 | 20.16 | 12/12/12 |
| danger-fill | 6.47 | 6.47 | 6.47 | 3/3/3 |
| subtle-fill | 6.83 | 6.95 | 6.83 | 27/27/27 |
| field | 17.39 | 16.96 | 16.83 | 6/6/6 |
| icon | 5.17 | 6.31 | 5.04 | 3/3/3 |
| ghost | 5.77 | 6.45 | 5.99 | 15/15/15 |
<!-- CONTRAST_CONTROL_TABLE:END -->

原生控件（checkbox / radio）单独一条：它们的填充由浏览器调色板决定，任何 CSS 变量都到不了。
容器级的开关是 `color-scheme`，`styles.css` 里按主题各写一个值；`contrast-tier` 对每个主题断言
`getComputedStyle(documentElement).colorScheme` 的极性必须与主题一致 —— 这是"取样时跳过 checkbox"能成立的前提。

### 4.35 取样判据本身（这一节的全部数字都出自它）

比值不是 token 对 token 算的。做法：**隐藏字形 → 拍照 → 在该行文字自己的墨迹矩形上取若干点 → 逐点合成前景与背景 → 判最差那一点**。

- **"按 text run 取点"是判据本体**，不是精度优化。`background-color` 在这批卡片上是空的（漆在 `background-image` 里），
  单点取样则把渐变的一次落点当成整个答案。本仓为此付过两次学费：一次 `theme-surfaces` 报"0 个离题面"而截图上有一整片白色渐变区，
  一次是那四张 `via-white to-white` 卡。
- **端点恒在网格内**：只采内部点会漏掉"重叠只盖住行尾几像素"的真缺陷（我今天真漏过一次，`foreign=0` 当时读作"没有外来像素"，实际是"根本没看到那里"）。
- **一个点属于谁，在采点那一刻判**：后来再判就会拿旧矩形去问已经动过-layout 的 DOM（侧栏宽度过渡、吐司挤动页面），
  结果是 37 行普通文字被自己的过滤器拒成"没有一个点属于本行"。
- 属于后代元素且**后代自己上漆**的点，不算本行的底（上传拖放区曾被自己的装饰砖误判成 1.76:1）。
  已知边界：`elementFromPoint` 会穿透 `pointer-events:none` —— 一个"不吃输入但照样上漆"的覆盖层会被认成本行的底；夹具的 chip 因此必须是普通上漆兄弟块。

两条**方向相反**的夹具（每次跑实植、用完即拆，任一条不成立该门 exit 2）：

| 夹具 | 读数 | 钉住的是 |
| --- | --- | --- |
| `GRADIENT-CONTROL`（白→#333 渐变上的白字） | 中心 **7.28:1**（合格）/ 最差内部点 **1.71:1**（不合格）/ spread 19.11 / 66 点 | 多点确实与单点不同：渐变不再瞎 |
| `CHIP-CONTROL`（文字右段压一块不透明 chip） | 判定 **17.38:1** / 采 36 点、拒 30 点为"不属于本行" | 邻块的漆不被当成本行的底（这方向的过报我今天做出过 6 条） |

另有取证行（"这套取样在本仓是否真的改变过结论"）：
`GRID-EVIDENCE textRows=1692 disagreeWithCentre=27 worstDelta=0.74 centreWouldHaveMissed=0 inkFallbacks=0`
——27 行最差值与中心值差 ≥0.2，但**在现状的 app 上没有一行因此翻判**（`centreWouldHaveMissed=0`）。
上一轮这里印的是 6，那 6 条正是下面 4.37 说的那批假缺陷：单点取样当时"会漏"的，是本来就不该存在的缺陷。
所以这套多点网格在本仓的现行价值是**给出区间**（渐变/合成壁纸/落影面确实不是一个数），
"能翻判"这件事目前只有植入夹具（`GRADIENT-CONTROL` 中心 7.28 判合格、最差 1.71 判不合格）在证。
这一条按不利方向写，是为了不让夹具的正例冒充成真缺陷的证据。

成本随行印在门自己那行，不由外部 `ps` 反推：
`CONTRAST_GATE combos=72 routes=7 measured=1902 points=121602 nodeWall=53s nodeCpu=1.9s`（聚合器里量到 56.7s；同批次两次连跑逐字相同，跨小时那一次是 1929 逐字相同，见 4.36）。
`nodeCpu` 不是这个门的成本（活在页面里做），墙钟才是；`--deadline`/`VERIFY_DEADLINE_MS` 到点会停并印
`BUDGET: stopping the grid after N/72 ... UNMEASURED`，随后 `CONTRAST_GATE INCOMPLETE` 走 exit 2 —— 部分覆盖 + 具名未测，不是一句"跑完了"。

但"没红过"不等于"会红"，所以判据被抽成 `coverageVerdict()` 单独喂数，正反两面挂在 `gate-unit` 上（5 例）。
它顺手抓到一个更空的假绿：旧写法 `if (judged && dropped > judged*0.25)` 在 `judged=0`（采集器整个瞎掉）时**放行**。

### 4.36 一次假的加速：门快了一倍，代价是发现它的分母每次都变

先说结论：**"59s→34s" 那句是假的。** 循环顺序（路由在外、壁纸在内，壁纸只是 `documentElement` 上一个自定义
属性，不值得为它重载页面）与"固定 `sleep(120)` 换成等到那一帧真的画出来"确实把整轮打到 34s，
但连着跑两次得到 `measured=1890` 和 `measured=1921` —— **候选集本身在两次之间会变**。原因在这个 app：
它给"到目前为止每一个失败的查询"都画一条错误横幅，而浏览器态里这些失败是异步落地的。
一门的分母取决于哪场赛跑赢了，它印出来的表就永远会被下一轮判成"手写的"（`--doc` 当场就是这么报的）。

加上 quiescence 等待（文本长度连续三次相同才拍，且**每次页面加载只等一轮**、壁纸第 2/3 趟只做一次比较）之后，
连跑两次 `measured=1929 points=121632` 逐字相同 —— **而这句话当时就说得过头了，一小时后再跑是 `1902 / 121602`。**

区分开两件事：quiescence 保证的是"**拍照那一刻页面不在重排**"，不是"**这一页每次装同样的字**"。
浏览器态里哪些查询失败、于是页面上有几条错误横幅，是**内容**不是**时序**，它跨小时会变、跨分钟不变。
所以"可重跑"要说准：**同一批次内可重跑，跨批次候选集会漂（1929 vs 1902，差 27 行）**。

处置不是假装分母恒定，而是**把不变量钉住、把会漂的量只印不钉**：`--doc` 现在比对**只取比值列**，
`判读文字数` 那一列照常生成给人看、但不进断言。这条投影自己带两面夹具（任一方向不成立就 docDrift 报红）：
**改一个比值必须仍被抓到**（否则投影什么都没钉）、**只改计数必须不报**（否则列没真被丢掉）。
当前两次连跑：`below=0 docDrift=0`，`measured=1902 points=121602`。

**净结果比原始版本慢约 9 秒（59s → 68–71s，机器空闲时 52–57s）**，换来的是"同一批次内重跑得到同一个数 +
跨批次不再拿内容的漂移冒充缺陷"。原来那 59s 之所以便宜，正是因为它在页面还在变的时候就把照拍了 ——
**便宜本身就是症状**。
（`shot`/`sample` 两栏涨了是同一台机器上并发跑着别的量具；`nav` 与 `prep` 才是这两处改动该有的方向。）

### 4.37 一条具名"未决项"是怎么作废的（它不是被修好的）

上一轮我在这里写下：`设置` 页 `SettingsPage.tsx:270` 的 11px 说明文字，mist **4.12:1**、sakura **4.09:1**，
墨迹下方取到的漆是 `rgb(224,224,224)`，并判断"这个中性灰不是该渐变能画出来的值，所以真正的底另有其物"。
后半句对了，前半句把它当成了界面缺陷。**它是测具自己的输入状态**：浏览器里没有 `invoke`，
那 4 条"数据加载失败"吐司在每次进 `设置` 时都会叠在右下角，而这一行文字的字尾伸进了吐司的**落影**里。
三条自证它不是本 app 画的漆：R=G=B 的纯灰在 mist/midnight/sakura 三套 token 里都不存在；
全黑壁纸与全白壁纸下它是同一个 224（真表面不可能对壁纸极值无感）；midnight 下同一行不报红（因为它的字是浅色）。

处置（不是"把数字调过去"）：
- 每个面开拍前清空 toast 栈，并断言 `[role=alert]/[role=status]` 归零；没归零该组合直接 `finish(2)`，
  因为**覆盖层的影子不是被测主题的表面**；
- `COMBO` 行加印 `toasts=N`（N=开拍前屏上的吐司数），读数从此自带输入状态；
- 清空后 72 组合 `below=0`，`contrast-tier` 因此**从"暂不作 stage"变成一 stage**（`verify_all.mjs` 里那条注释同步改写，
  连同作废理由一起留在原处，不删）。

这条作废记在 0.1 的第十行。它同时是"没红过我不当门"的反面教材：**红过一次、但红的是测具的门，
比没红过更危险**——它给出的数字带着具体的元素、坐标和比值，看起来比谁都像证据。

### 4.4 白名单只能签给"量到过的"面

`theme-surfaces` 的白名单原有 5 条，本轮加了一条机器断言 **DEAD-EXEMPTION**：一条豁免如果这次跑没有任何
**frozen** 面命中它，就算失败。跑出来的结果是 4 条豁免命中 0 次 —— 不是那 4 个面没被扫到（弹窗和 Toast 现在都是
被扫的面），而是调色板重映射之后**它们已经跟随主题了**（`bg-red-50` 在亮色是 254,242,242、在 midnight 是 43,21,25）。
一条为会动的面设立的豁免，就是给下一个不会动的面预备的执照，所以**删掉 4 条**，只留 1 条真正不变的：

- `app-upload-button` —— 三套主题都是 slate-950 实心 + 白字，primary action 的识别度靠的就是它不跟随主题。

当前 `SURFACE_GATE routes=7 surfaces=196 frozen=8 offThemeUnwhitelisted=0 whitelisted=8`（改前 off-theme 21）。

## 5. `--danger-solid` 那条红：先答口径普查，再答它是不是缺陷

复算式：`node scripts/theme_token_census.mjs --family=accent,success,warning,danger`

语义色族一共 7 个 token，**分主题的 2 个，只声明一次的 5 个**：

| token | 声明在 | 说明 |
|---|---|---|
| `--accent` | `:root` + midnight + sakura（3/3） | 分主题 |
| `--accent-soft` | 3/3 | 分主题 |
| `--danger` | 只有 `:root` | 全局一份 |
| `--success` | 只有 `:root` | 全局一份 |
| `--warning` | 只有 `:root` | 全局一份 |
| `--accent-solid` | **只有 midnight** | 不是"全局一份"，是"只有暗色那一份" |
| `--danger-solid` | **只有 midnight** | 同上 |

全仓 85 个主题块里的 token，16 个分主题、69 个只声明一次；只声明一次的里面 **61 个是 midnight 的 `--color-*` 覆写**，
8 个是 `:root` 独占（`--success/--warning/--danger/--radius-*/--backdrop-blur/--glass-strength/--wallpaper`），
**sakura 独占 0 个**。

这组数落进你给的三个分支的**第三个**（同族里一半一半、文档里没有声明过口径）——但要点比你预设的更具体：
**`--danger-solid` 不是"只有全局一份"，它是"只有 midnight 一份"**。我上一轮把它写成"没有分主题值"，那句是错的，
错在一个会误导决策的方向上：它读起来像"这个 token 忘了分主题"，实际上它是**暗色专属覆写**，
亮色侧的对应值走的是 Tailwind 自己的 `--color-red-600`。

### 那条红的成因是我自己造的，不是历史设计

`ConfirmDialog.tsx:53` 的危险按钮是 `… text-white bg-red-600 hover:bg-red-700`。
- 亮色主题：`.bg-red-600` 走 Tailwind 工具类 → `var(--color-red-600)`；
- midnight：走 `styles.css:185` 那条 midnight 作用域的覆写 → `var(--danger-solid)` = `#b91c1c`。

而我上一轮为了让 `text-red-600` 压在 `bg-red-50` 上够 4.5:1，把 `:root` 的 `--color-red-600` 定成了 **`#b91c1c`——
和 midnight 那个 fill 同一个 hex**。改之前亮色是 oklch red-600 = `rgb(231,0,11)`，与 midnight 不同，所以不冻结。
**所以 `theme-surfaces` 那条红是我把两件事撞成同一个颜色造成的，不是"危险色是否该主题无关"这个设计问题。**

因此它真正需要的决定比上一轮我框的要小得多：只要亮色侧那个红**不取 midnight 的同一个 hex**，
且仍满足 `L ≤ 0.1633`（在 `rgb(254,242,242)` 上够 4.5:1）即可，两条性质互不干扰。
本轮按你的边界**没有改颜色**；口径（哪些语义 token 必须分主题）也仍未定，`theme_token_census.mjs` 只报数不判，
等你定了口径我再把它升成断言。

### 5.1 口径已定，并已升成断言（它当场咬到一处真违规）

**规矩（`--verify` 只断言这一条）**：同一语义色族内**声明方式必须一致**——族里只要有一个成员分主题声明（≥2 个主题块），
全部成员都必须分主题；全族都只声明一次是合法的（那表示这个角色**故意**与主题无关）。

```text
$ node scripts/theme_token_census.mjs --verify
TOKEN_POLICY_SELFTEST cases=5 failed=0        <- 先自证：混合族要报、统一全局族不许报
TOKEN_POLICY families=13 breaches=1
  BREACH accent: per-theme --accent,--accent-soft but declared once --accent-solid
EXIT=1
```

13 个非调色板族里**只有 1 个违规**，就是 `accent`：`--accent`/`--accent-soft` 三块齐全，`--accent-solid` 只在 midnight。
`danger` 族（`--danger` 全局 + `--danger-solid` 只在 midnight）**按这条口径是合规的**——这句要说白：
口径治的是"声明方式不一致"，它**看不见**"两套主题渲染成同一个颜色"。后者只能由量像素的 `theme-surfaces` 报，
也就是本轮那条红。所以两件事分开：`--accent-solid` 是口径违规（未修，本轮不改颜色），
danger 撞 hex 是渲染事实（不是缺陷，是门的假阳性，需要的是签名豁免而不是改色）。

修 `--accent-solid` 不需要动任何颜色：它唯一的消费规则（`styles.css:184`）是 midnight 作用域的，
在 `:root` 补一份同值声明不改变任何主题的渲染结果。**本轮没做**，因为边界写着不碰颜色，
留到颜色那一轮与断言接入 stage 同笔落地（复算式已写在 `verify_all.mjs` 的注释里）。



## 6. `layout` 那 23 条：分档，不修

复算式：`node scripts/verify_dialog_interactions.mjs layout` → `LAYOUT_GATE checked=21 matched=21 skipped=0 failures=23`
（21 = 7 路由 × 3 档宽度；三档都真生效，`assertRealViewport` 逐次核过）。

**23 条报警行不是 23 个缺陷。** 它们归成 4 个家族，其中两个家族是同一个物理问题的两种记账口径：

| 家族 | 行数 | 现象 | 档位 |
|---|---|---|---|
| A `CONTROL-CUT` 640×480 | 7（每路由 1 条） | 侧栏底部"教程与帮助"按钮被裁，超出裁剪祖先 **+25px y**，裁剪者是 `html>body`（overflow hidden） | **真缺陷** |
| B `CONTAINER-CUT` 640×480 | 7（每路由 1 条） | 同一个按钮的**容器** `div.mt-auto.space-y-2` 被裁 **+33px y** | **真缺陷，但与 A 是同一条** |
| C `TOUCH-TARGET` 640×480 | 7（每路由 1 条，计数 23/18/15/16/17/14/20） | 见下面拆分 | **2 条假象 + 5 条分不清** |
| D `SELF-CLIP` 图库 1024 与 640 | 2 | "刷新"按钮文字墨迹被裁 **0px 水平 / 4px 垂直**，无 ellipsis 无 title | **分不清** |

### A + B：一条真缺陷，被记成 14 行

证据链（三处独立读盘，不靠门自己说）：
- `tauri.conf.json:18-19` `minWidth: 640, minHeight: 480` ⇒ **640×480 是产品自己的最小窗口**，不是量具臆造的档位，"用户到不了这个尺寸"这条豁免不成立；
- `AppShell.tsx:51` 侧栏是 `aside.app-sidebar … fixed inset-y-0` ⇒ 高度锁死为视口高（480）；
- `styles.css:301-309` 里 `overflow-y: auto` 属于 **`.app-main`，不属于 `.app-sidebar`**；全文件搜不到给 `.app-sidebar` 上 `overflow` 的规则。
⇒ 侧栏内容高于 480 时，底部那块既不在滚动容器里、又被 `body` 裁掉，**"教程与帮助"在最小窗口下真的点不到**。
A 与 B 是同一次越界的两种口径（控件盒 +25px、容器盒 +33px），修一处两条一起消。

### C：7 条里 2 条是我已经见过的同族假象，5 条还分不清

- **假象（2 条）**：`发布` 的"最小 13×13 `发布完成自动复制`"、`设置` 的"最小 13×16 `启用`"，都落在 `input` 上。
  但这两个 input 外面套着 `<label className="… cursor-pointer … px-3 py-3">`（`PublishPage.tsx:217`）
  和 `label.flex.items-center`（设置页），**真正可点的目标是 label，不是 13px 的方框**。
  这和对比度那侧"包装型控件被按整盒量"是同一族（拖放区按钮 1.76:1 那次）。
- **分不清（5 条）**：`资源/云端/图库/插件/任务` 五条的"最小 16×16"全是 **`关闭提示`**，选择器是
  `div.pointer-events-none.fixed > div.pointer-events-auto.flex > button` —— 那是**吐司的关闭按钮**。
  两件事没定下来所以不敢判：① 它确实是用户要点的东西，16px 在 640 宽的窗口上是真问题；
  ② 但它是**瞬态覆盖层**，`layout` 现在把它的节点并进"这一页有多少可点目标"的计数里，
  于是每路由那个 23/18/15/16/17/14/20 **不是这一页的属性**，而是"这一页当时飘着几条吐司"——
  和我刚在对比度侧作废过的分母同源。要判它，得先把覆盖层从页面计数里拆出来（拆法现成：`contrast-tier` 那套）。
- 另外每路由那串计数里除 label-input 和吐司按钮之外**还剩多少真小目标，我没逐条核**，所以 C 的整体不写"真缺陷"。

### D：2 条分不清，两个候选因反都能解释读数

"刷新"按钮（`header… > button.flex…`）报 **0px 水平 / 4px 垂直** 墨迹被裁。
- 可能一（真）：按钮定高小于 line-box，中文行的下缘被切掉 4px；
- 可能二（假象）：`Range.getClientRects()` 给的是**行盒**不是墨迹，行盒比字形高，
  固定高度 + `items-center` 的按钮上会稳定虚报几像素垂直"裁切"。
分辨它只要一次读数：该按钮的 `height` / `line-height` / `getClientRects()` 与 `scrollHeight`。本轮没做，所以留"分不清"。

### 6.00 第二刀已落：侧栏在最小窗口下可滚，且"滚得到"是被滚出来的、不是被推断出来的

改前（第一刀之后那一版，exit 1）：`failures=16` = 7 `CUT-ROOT` + 2 `SELF-CLIP` + 7 `TOUCH-TARGET`。
改后：`failures=9` = 0 `CUT-ROOT` + 2 + 7，`LAYOUT_FAMILIES … records_total=0`（整页再没有一条"被不可滚祖先裁掉"的记录）。

修法二选一里选了**给侧栏上滚动**：`.app-sidebar { overflow-y:auto; overflow-x:hidden; overscroll-behavior-y:contain; scrollbar-gutter:stable }`
（`styles.css`）+ 内层栏 `h-full → min-h-full`（`AppShell.tsx:52`）。
**选它的理由一行**：底部那块（教程与帮助 / 版本卡）在信息层级上属于导航列的尾端，把它搬出侧栏是改 IA；
而 `.app-main` 早就是"固定高 + 自身滚动"的同一套模式，侧栏跟它一致不引入新范式。
`h-full` 必须一起改：内层栏写死 100% 高度时内容溢出的是**子盒**，`min-h-full` 才让栏子真的长高、滚动条才有东西可滚。

**"变成 rail" 本身不是可达性证明**，所以量具加了一条真滚一遍的判据（`RAIL-PROOF`）：
把每个"底边超出视口且被某个 rail 挡住"的元素 `scrollIntoView({block:'center', behavior:'instant'})`，再量它是否真的有一段（≥8px）落在视口里。
当前读数：**712 个候选，712 个滚到即见，0 个 unreachable**。

这条判据是踩了三个自己的坑才对的，都记在代码注释里：
① 第一版要求"整个盒落进视口"，于是**比视口还高的容器永远不合格**（686 条假红）；
② 第二版只把 rail 滚到**底端**，于是中段元素反而被推到视口**上方**（301 条假红）——判"能不能滚到"必须滚**那个元素**；
③ `.app-main` 带 `scroll-behavior: smooth`，普通 `scrollTop=` 赋值启动的是**动画**，紧接着量的还是旧位置
（这一版把 683 条明明可达的报成不可达）；必须 `behavior:'instant'`。
**反向夹具已补，而它第一次跑抓到的是我自己三个 bug**（不是页面 bug）：
① 第一版靶子把元素放在 rail 内容原点**之下**，但 `scrollIntoView` 会向外连滚祖先滚动容器，所以它其实滚得到——
真滚不到的形状是被 `overflow` 裁到**负方向**（没有滚动条能滚到负位置）；
② 判据原先只看 rect 与视口**是否相交**，于是被祖先裁到**零高度**的盒子照样判"可见"。现在先逐层与所有
非 visible 祖先求交，再要求**至少 8px 的一条带**，不是相交即可；
③ 夹具还拓出一个副作用 bug：`scrollIntoView` 滚了外层却没还原，同一次跑里连着两次 `geometry()` 得到
`proven=123` 与 `proven=100`——**判据自己把要量的页面挪走了**。现在每个被滚的祖先先记后原，
修完后连续两次 `proven` 相等（122/122）。

红绿两面都落文件（`layout-rail-control.json`，路径印在 `RAIL-CONTROL artifact` 行）：

```text
RAIL-CONTROL diag {"childRect":[1033,1051],"railRect":[1063,1103],"railOverflowY":"auto","pastViewport":true,
  "proven_without":122,"proven_with":122} | criteria side by side:
  whole-box-fits=false after-rail-extreme-scroll=false after-element-scroll(shipped)=false |
  rail moved=false scrollSize=40/clientSize=40 | probe flagged it=true (proven=122 unreachable_total=1)
RAIL-CONTROL artifact .../layout-rail-control.json red_flagged=true green_proven=712
RAIL-PROOF elements_past_viewport_needing_a_rail=712 proven_reachable_by_scrolling=712 unreachable=0
```

三个判据并排印出来就是为了归因：红时必须**三条全 false**（不是退回"整盒进视口"或"只滚到底"那两个旧坑），
且 `rail moved=false` 证明它确实滚不动。拆掉靶子回到 712/0。**这条判据现在占功。**

改后：`failures=16` = **7 `CUT-ROOT`** + 2 `SELF-CLIP` + 7 `TOUCH-TARGET`，并印恒等式

```text
LAYOUT_FAMILIES pages_with_cuts=7 family_lines_before_grouping=14 distinct_root_causes=7
                lines_not_double_counted=7 records_listed=21 records_total=21 truncated=0
```

分组键是**唯一不可能巧合相同的东西**：哪个祖先切的、在哪根轴（`by|axis`）。
每行仍带成员构成（`control=1 container=2`）与最坏超出量，信息不丢、行数不再冒充缺陷数。
恒等式两处当场判死：`root_causes != distinct(by|axis)` 或 `members != listed` ⇒ exit 2；
`listed + truncated != records_total` ⇒ exit 2 —— 后一条用的是探针自己**截断前**的计数，
与我这里的分组无关，所以"分组时漏记一条"会被独立数字抓住，而不是靠我自觉。

### 6.01 第三刀：C 的覆盖层拆分与 label 记账，D 的那一次读数

`TOUCH-TARGET` 原来把整篇文档里所有可见可点元素一锅数，于是两件事被混在一个数里：

1. **吐司的近按钮被算进每一页。** 7 个路由里 5 个的"最小目标"都是同一个 `关闭提示` 16×16，
   它属于 `ToastViewport`，不属于那 5 个页面。现在按 `[role=alert],[role=status]` 归到覆盖层，
   **跨路由去重后单独成一条**：`LAYOUT_OVERLAY distinct_controls=1 instances=28 routes_involved=7`，
   结论行仍然报红（它是真缺陷），但不再让 5 个页面替一个组件背 5 条。
2. **`<label>` 套着 `<input>` 时量错了盒子。** 手指点的是 label（点 label 会激活控件），
   判据现在取"控件与其关联 label 中较大的那个盒子"（关联含包裹与 `for=` 两条路径）。
   两条被点名的记账错都落定了，但**没有一条因此变绿**：
   设置页 `13×16 input` ⇒ 真实目标是那个 label，**36.9×32**；
   发布页 `13×13 input`（"发布完成自动复制"）⇒ 真实目标是整行 label，**446×40**。
   也就是说缺陷是真的、只是高度不够，而**要改的元素从来不是那颗 13px 的复选框**。

两条豁免各配一对夹具（`CONTROL-T`），豁免必须"该免的免掉、不该免的仍然报红"：
220×60 的 label 里的 13px 复选框 ⇒ 免；18px 高的 label 里的 13px 复选框 ⇒ 仍红，
且**必须以 label 的盒子 60×18 报出**（否则修的对象还是错的）。覆盖层那半边同时断言
"从页面计数里出去了"与"仍然被记了一次"，防止"拆分"退化成"丢掉"。

D 的读数见 0.1 表最后一行。它顺带把 `SELF-CLIP` 判据修对了：**被量的那一轴真的在裁切**
才算自我裁切；并配一对夹具（`CONTROL-G`），其中绿的那半边第一版是**空转的**——拉丁文不折行，
墨迹 21px 从没超过 40px 的盒子，"没报"看起来和"判据修好了"一模一样。
现在 `plantReproduces` 断言墨迹必须真的超出盒子，否则判为测具故障。

**而这次收窄把 M17 弄瞎了。** 收窄之后当场跑变异：`M17`（把确认框 `<p>` 的 `break-words` 摘掉，
64 字符哈希在 440px 卡里撑开）——**没有任何一条判据报红**。它从来不是"被切"，
是字**画到盒子外面去了**，所以正确的处置是给它一条自己的判据，而不是把假阳性的
`SELF-CLIP` 退回去。新判据 `TEXT-ESCAPE` 连踩两个坑才咬住：

| 第一版 | 为什么看不见 |
| --- | --- |
| 用 `scrollWidth - clientWidth` 判"超出自己的盒子" | `overflow: visible` 的块**不是滚动容器**，`scrollWidth` 根本不涨 ⇒ 恒为 0 |
| 用 `clipperForAxis(e,'x')` 判"没人裁它" | 该 helper 找的是**最近的非 visible 祖先**，问的不是"哪一层真的把这段字切掉了" |

第三版改用**墨迹右缘**，并把可见范围限定为"祖先链里真正 `hidden`/`clip` 的那些盒子的右缘与视口的较小值"。
`CONTROL-I` 两面：260px `nowrap` 长词挂在 `documentElement` 下 ⇒ 必须报（+173px）；
同一段字放进 `overflow:hidden` 的 200px 宿主里 ⇒ 必须**离开** `TEXT-ESCAPE`、
并且**仍然**出现在祖先裁切族里（恒等式：`dEscape === 1`，两面只动一条判据）。
红绿各跑过一次原文：

```text
pristine  confirm-longname  LAYOUT_GATE failures=3   (无 TEXT-ESCAPE)
M17 变异  confirm-longname  FAIL TEXT-ESCAPE 640x480 confirm-longname: 1 text run(s) ...
                            worst +127px past a 302px box
```

### 读数（每路由真实计数，吐司已拆出）

| 路由 | 改前 `TOUCH-TARGET` | 改后页面自有 | 其中 button/input/select |
| --- | --- | --- | --- |
| 发布 | 23 | **19** | 18 / 1 / 0 |
| 资源 | 18 | **14** | 12 / 1 / 1 |
| 云端 | 15 | **11** | 11 / 0 / 0 |
| 图库 | 16 | **12** | 11 / 0 / 1 |
| 插件 | 17 | **13** | 12 / 1 / 0 |
| 任务 | 14 | **10** | 10 / 0 / 0 |
| 设置 | 20 | **15** | 12 / 2 / 1 |
| 覆盖层（吐司，去重后 1 个控件） | 混在上面 7 条里 | **28 个实例 / 7 条路由** | — |

七页合计 123 → 94 页面自有 + 28 覆盖层实例（去重 1 个控件）+ 1 个被 label 豁免的目标。
每一页现在的"最小目标"都是同一族：侧栏在 640 档被压到 64px 宽后，
`button.flex.w-full` 只剩 **35×30 / 35×37** —— 这是断点级的真实缺陷，不是记账噪声。

### 顺手量到的、更大的那条：`font: inherit` 把 23 个控件的字号整条吞掉

`styles.css:223` 的 `button, input, select, textarea { font: inherit; }` 写在**层外**。
未分层的声明优先级高于 Tailwind 的 `@layer utilities`，所以这 4 类元素上自己声明的
`text-xs / text-sm / font-medium` **全部失效**。Tailwind 的 preflight 本来就在
`@layer base` 里提供了同一条 `font: inherit`（`tailwindcss/index.css:796`），
也就是说这一行是重复声明，它唯一的净效果就是把层序反过来。

新加的 `FONT-SWALLOW` 判据不写死数字：它在页面上放一个只挂 `text-xs` 的 `<span>`（控件豁免够不着它），
量出这个工具类**在本 app 里真正等于多少 px**，再和控件的渲染值对账。
`CONTROL-H` 那对夹具自带一份 bug（注入 `button.lctl-swallow{font:inherit}`），
所以将来 app 那行被删掉之后，这条判据依然能证明它会红。

**两个独立仪器给出同一个数 23。** 已签字的 §1 基线表里"漂移按钮"合计就是 **23**
（那是 `visual` 模式用 span/button 参照比出来的），`layout` 这边用 class/计算值比出来也是 **23**
（`FONT_SWALLOW distinct_controls=23 instances_sum=109`，109 是"每页各计一次"的实例数）。

**这一条我没有修，也没有加白名单。** 删掉那一行会让 23 个控件的渲染字号变小、
`刷新` 不再折行，同时把 §1 表里"字号阶梯"和"漂移按钮"两列一起改掉——
那是**重签基线**，按规矩是你的签字动作。修法是删一行，不是改 23 个调用点。

### 净结论

**改前 9 条 = 7 `TOUCH-TARGET`（含 5 条被吐司冒充）+ 2 `SELF-CLIP`（假象）。
改后 = 7 `TOUCH-TARGET`（页面自有，真实计数见上表）+ 1 `TOUCH-TARGET overlay(toast)` + 1 `FONT-SWALLOW`（23 个控件、同一行 CSS）+ `TEXT-ESCAPE` 0 条（判据新增，pristine 全 21 组合为 0，M17 变异上 +127px 报红）。
`SELF-CLIP` 那 2 条作废（0.1 末行），但它指着的元素有一个**真**缺陷：`刷新` 把两字标签折成两行，
根因就是 `FONT-SWALLOW`。分档落定：C 的 7 条现在全部是"真缺陷（侧栏断点级）+ 记账已纠正"，
D 的 2 条从"分不清"变成"1 假象 + 1 真缺陷换了名字"。

**本轮代价最大的一条不是任何界面缺陷，是我自己把 M17 弄瞎了**：收窄 `SELF-CLIP` 之后当场跑变异才发现
"少了一条判据"与"多了一条判据"都可能是零条。它现在写在 `verify_guard_mutations.mjs` 的 M17 注释里。

本轮按边界**没动任何界面**（只改判据与测具）。下一步顺序：`font: inherit` 那一行删不删由你定
（删 ⇒ §1 两列重签）；侧栏 35×30 那族要不要在 640 档给回宽度，也是界面改动，同样等你点头。

---

## 7. MC-2：`black ∧ y=576` 下文字底从主题实色换成 slate-200（P2，未修，不改产品代码）

标题写的是**合取**，不是"壁纸"也不是"竞态"。上一版标题叫"一条已入仓的安全声明被实测否证"——那是结论的上位说法，
容易被读成"壁纸能穿透面板"，而 12 条读数说的是更窄也更硬的一件事：`black` 单不自足，`y=576` 单不自足，
**两者同时成立才换底**。声明原文与九行读数并排保留在下面，不动。

### 7.1 声明原文（两处，逐字）

`bc53a45` 提交信息第 15 行：

> opaque surface, which bounds what any user-supplied image can do to the text.

`apps/desktop/src/styles.css:262`（同一件事在代码里的说法）：

> background-blend-mode: soft-light over the theme's own opaque --app-bg. That bounds every ...

**这句话现在被自己的读数否证了**：在插件面板的空状态文字上，用户壁纸能换掉它背后的漆。

### 7.2 证据：同一元素、四个批次、12 条 black 壁纸读数

元素：`PluginsPage.tsx:136` `div.p-8.text-center.text-xs.text-slate-400` "暂无插件执行记录"。
`normal` = 采到面板自己的表面（255,255,255 / 16,24,40）；`ANOMALOUS` = 采到**该主题的 slate-200**
（226,232,240 / 43,58,82）。

| 批次 | 主题 | box y | 采到的底 | 判定 |
| --- | --- | --- | --- | --- |
| ct-w X | default | 518 | 255,255,255 | normal |
| ct-w X | midnight | 518 | 16,24,40 | normal |
| ct-w X | sakura | **576** | **226,232,240** | **ANOMALOUS** |
| ct-w Y | default | 518 | 255,255,255 | normal |
| ct-w Y | midnight | **576** | **43,58,82** | **ANOMALOUS** |
| ct-w Y | sakura | 518 | 255,255,255 | normal |
| ct-p | default | **576** | **226,232,240** | **ANOMALOUS** |
| ct-p | midnight | **576** | **43,58,82** | **ANOMALOUS** |
| ct-p | sakura | **576** | **226,232,240** | **ANOMALOUS** |
| ct-chain | default | 518 | 255,255,255 | normal |
| ct-chain | midnight | 518 | 16,24,40 | normal |
| ct-chain | sakura | 518 | 255,255,255 | normal |

**12/12 按 box y 完美二分，零反例**（后续三批增至 15 条，仍零反例；其中两批压根没有出现 `black ∧ y=576`，那不算支持也不算反证）。 比值随之从 6.56–8.42 掉到 5.32–5.37，
grid 与 centre 的分歧从 0 涨到最高 4.39（midnight/black/576：5.36 vs 9.75）。

### 7.3 条件是一个合取，不是壁纸、也不是竞态

* 壁纸 `black` 单独不充分：y=518 时它是好的（6 条）。
* 布局 y=576 单独不充分：`none` 壁纸下同一个 y=576 是好的。
* **`black 壁纸 ∧ box y=576` ⇒ 该主题的 slate-200 出现在这段字背后，12/12。**

而 y 取 576 还是 518 由那个 2.5s 轮询何时落定决定（`listPlugins` 的错误面板在场与否改变面板高度）。
所以竞态是真的，但它**只决定选哪条布局**；决定漆的是布局与壁纸的组合。

### 7.4 归因链，含被推翻的三次

| # | 说法 | 结局 |
| --- | --- | --- |
| 1 | 来自 `refetchInterval: 2500` 的 logs 轮询 | **错**。面板绑的是 `pluginsError` / `listPlugins`（`PluginsPage.tsx:116`） |
| 2 | 是我的普查在抢拍（纯竞态） | **半对**：竞态只解释 y 的选择 |
| 3 | 三个主题在 black 下**系统性**中招，与竞态无关 | **错**。下一批 0/9 复现，且 y=518 的 black 读数全部正常 |
| 4 | `black ∧ y=576 ⇒ 采到的底不是面板自身表面`，n=15 无反例（sA/sB 两批根本没出现 y=576 的 black，不构成反例） | 现象成立；**成因未定**——同源链证明不是任何祖先层的 background（§7.5） |

**教训按他定的口径入档：错的不是结论被推翻，错的是拿单次抽样当因果。** 第 3 条就是拿一批 3/9 当因果。

### 7.5 层名出来了：答案是否定式的——不是这段文字的任何祖先

`2d2c676` 那版链是**测量之后另一次 DOM 往返**取的，所以它自己就是过期的：异常读数里链整段没有面板。
漆变不会把元素从自己的命中测试里删掉，而过期的坐标会同时对像素和链做这件事。
现已把链挪进与几何同一次求值（`chain`），并把稍后那次（`under`）并排留着——**两者不一致就说明页面在中间动过**，
这条不一致从"看不见"变成"可读"。

同源链第一次复现（批次 sC，`black ∧ y=576`，midnight，采到 43,58,82、比值 5.36）：

```text
div.p-8.text-center{bg:rgba(0,0,0,0)} < div.max-h-72.overflow-auto{bg:rgba(0,0,0,0)}
< section.mt-6.overflow-hidden{bg:rgb(16,24,40)}      <-- 面板自己：16,24,40，不是 slate-200
< div.mx-auto.max-w-[1240px]{bg:rgba(0,0,0,0)} < main.app-main{bg:rgba(0,0,0,0)}
< div.app-shell-root{bg:rgb(9,13,22),img:linear-gradient(rgb(0,0,0)...}
```

**六层里没有任何一层的 background 等于被采到的那个颜色。** 对照同批干净读数（`default/black`，y=518）：
面板层是 `rgb(255,255,255)`，与采到的底**逐字相同**——所以"链的第三层 == 采样像素"在正常情况下成立，
异常读数上是**真的断了**。

剩下两种，我**没有手段分开**，因为它们预测同一份证据：

1. 截图取于页面重排之前 ⇒ 坐标与像素不同源（S1/S2 错配）；
2. 有一个**非祖先**元素（兄弟或覆盖层）在那一像素上画了 slate-200。

是面板真有一个透层、还是采样器把 `border-slate-200` 当成了底 —— **仍然不下结论，也不顺手修**。
本轮不改任何产品代码、不改判据、不放宽任何阈值。

### 7.6 分开那两种的手段做出来了，它选第 1 种（`80a9ec3`，三批实测）

上一节留下的两条候选"预测同一份证据"，是因为当时的量具只看整页。看**单个元素**就能分开：
采集器给每个被采样的元素打上标记（`data-ctid`，同一次求值里写），**照片落地后立刻**再读一次
它自己的矩形，与采样时那份逐轴比。`moved` / `gone`（元素已被 React 卸载）/ `uncomparable`
（比不了）是三个数，因为它们是三个不同的断言；`uncomparable` 永不并进"没动"。
判据 `rectMoved` 吃 1px 容差（记录值是浮点、重读值取整，静态元素差 ≤0.5px），
并且先过五个自己的夹具：植入 470px 位移必须报、同一份矩形必须 0、1px 抖动必须 0、
缺盒子与畸形输入必须返回 null 而不是 0。

三批同 HEAD、同一条命令（`contrast-tier --watch=暂无插件执行记录`）的原文：

```text
批 1  GEOMETRY_STALE ... combosWithStaleRuns=3 movedRuns=21 goneRuns=0 uncomparableRuns=0 of 1896 sampled
      GEOMETRY_DRIFT ... geomToShotMoved=0 preToGeomMoved=2
      WATCH-CAUSE "暂无插件执行记录": ... readingsMatchNoAncestorSolidColorAndNoAncestorImage=0/9 thisElementsOwnLayout={fresh:6 moved:3 gone:0 uncomparable:0}
      CONTRAST_TALLY below=0 + docDrift=0 + denom=6 + drift=3 = stopping=9
批 2  GEOMETRY_STALE ... combosWithStaleRuns=0 movedRuns=0 goneRuns=0 uncomparableRuns=0 of 1902 sampled
      GEOMETRY_DRIFT ... geomToShotMoved=0 preToGeomMoved=0
      WATCH-CAUSE ... thisElementsOwnLayout={fresh:9 moved:0 gone:0 uncomparable:0}
      CONTRAST_TALLY below=0 + docDrift=0 + denom=9 + drift=0 = stopping=9
批 3  GEOMETRY_STALE ... combosWithStaleRuns=1 movedRuns=7 goneRuns=0 uncomparableRuns=0 of 1900 sampled
      GEOMETRY_DRIFT ... geomToShotMoved=0 preToGeomMoved=1
      WATCH-CAUSE ... thisElementsOwnLayout={fresh:8 moved:1 gone:0 uncomparable:0}
      CONTRAST_TALLY below=0 + docDrift=0 + denom=8 + drift=1 = stopping=9
```

被点名的组合，三批都是同一族，位移都是 58px：

```text
GEOMETRY_STALE default/black/插件  : 7 moved + 0 unmounted of 26, worst 58px - "插件执行记录" [329,517,...]->[329,459,...]
GEOMETRY_STALE midnight/black/插件 : 同上
GEOMETRY_STALE sakura/black/插件   : 同上（批 3 只有 sakura/black 这一个组合）
```

那条空状态文字自己的 9 条读数里，被判 `moved` 的那几条记录的框是 `261,576,1096,80`，
采到的底是 `226,232,240`（default/sakura）与 `43,58,82`（midnight）、比值 5.32–5.37；
判 `fresh` 的那几条，同一个元素在 `white` 组合上落在 `261,518,...`、底是 `255,255,255` / `16,24,40`、
比值 6.56–8.42。**`y=576` 是重排之前的位置**：§7.2 那个合取里的 **`y` 那一半到此有了成因**
（低比值不是那个表面变淡了，是采样点落在了元素原来占的那块底上）。
**`black` 那一半没有**——本节末尾把它单列为未解释的集中度，不拿"恰好只有 black 跨过了重排"
冒充解释，那只是把同一件事换个说法。

所以两条候选的关系要说准。**候选 2 被数成 0**：
`readingsMatchNoAncestorSolidColorAndNoAncestorImage=0/9`，三批都是 0——没有一个采样像素需要靠
"链外的兄弟元素在画它"来解释；§7.5 那次"六层里没有一层等于被采到的颜色"在这三批**也没有复现**。
**候选 1 部分成立、部分未定**。成立的部分：坐标与像素不同源——同一批里 `sigA == sigGeom == sigShot`
（整页指纹两次比较都是 null），而那个元素的盒子在照片之后重读时差 58px，所以这次采样确实跨了一次重排，
`y=576` 是**重排之前**的位置。未定的部分：**照片自己站在重排的哪一侧**。重排落在 `sigShot` 之后、
元素重读之前，也就是发生在 `Page.captureScreenshot` 这次往返里或它紧邻的几毫秒内，
而量具伸不进那张 PNG 内部。所以"历史上那条红就是被过期像素骗出来的"是**推定**（颜色、位置、
机制三者都对得上，反证 0/9），不是当场闭环——这三批 `below` 全是 0，那条红没有重现。

**这不是因果闭环，别读成闭环**：这三批 `below` 全是 0，§7.2 里那条真正低于阈值的异常读数
**没有重现**。成立的是共现（4 个 stale 组合、颜色与位置都对得上、反证为 0/9），
不是"当场让那条红再出现一次"。§7 标题的合取照原样留着，它没失真。

自我更正两条，都在这轮：

1. 上一轮我提议并用上的**整页指纹结构上就看不见这件事**，不是"这次没轮到它看见"。
   它的两次读（`sigGeom`、`sigShot`）**都在照片之前**，照片之后的第一次读就是元素级重读——
   所以 `geomToShotMoved=0`（三批全 0）说的从来不是"页面没动"，而是"量具在照片之后没有整页读"。
   `preToGeom` 抓到 4 个里的 3 个纯属重排时刻的巧合（它比的两个点也都在照片之前），
   批 1 漏掉 `midnight/black` 是必然。承重的那行是 `GEOMETRY_STALE`，`GEOMETRY_DRIFT` 只解释机制。
   这条撤的是**我自己上一轮的期待**——"整页指纹可以当那把分叉的刀"，不是它印出来的数字。
2. `WATCH-PAINT` 那句"同一矩形有两种底 ⇒ 那是重绘，不是采样移位"**是错的**，它当时正在描述
   采样移位。这轮把标签拆开（`distinctAncestorChainReadings` 数带颜色的链、
   `distinctAncestorChains` 数元素身份链），并让每个 needle 带上自己元素的判定。

58px 从哪来：`插件` 路由上方那块错误面板 —— 也就是 `CONTRAST-DENOM` 每次点名的那 2 行
（`配置 OpenAI-compatible…` 与 `插件列表读取失败：TypeError…`，`PluginsPage.tsx:18` 的
`refetchInterval: 2500` 轮询决定它们在不在）。**那 2 行加起来正好 58px 我没量**，
所以这句是"与 denom 那 2 行同因"的相关，不是"面板高度 == 58"的断言。
同理，4 个 stale 组合全在 `black`（每批 24 个 black 组合里 3、0、1 个；非 black 0/144）
**为什么只落在 black，本轮没有证据**，只记为未解释的集中度。

产品代码一行没动。这个新门会**当场变红**（`drift` 桶，三批分别 3/0/1，同 HEAD 同命令），
所以按规矩交回你定：收下间歇红、还是让扫掠在非稳态里不进退码、还是别的；我不自行放宽判据、
不加白名单。
