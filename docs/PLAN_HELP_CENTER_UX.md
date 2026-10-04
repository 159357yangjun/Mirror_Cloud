# 新手教程页优化方案（HelpCenterDialog）

状态：**待你放行，未动代码**。改完必须过的门：contrast-tier（三主题逐面）、theme-surfaces、layout、face inventory、聚合 22 stage。

## 一、现状与问题（全部指到行号）

文件：`apps/desktop/src/components/HelpCenterDialog.tsx`（86 行，6 张步骤卡 + 头部）。

**内容面**
1. 只有"从零开始"一条线（STEP 1–6），**已配置好云端的老用户打开它没有第二屏可看**——快捷键、右键菜单、Local API、多云副本、格式设置（今天刚加的）全都不在教程里。
2. STEP 5 说"按当前格式复制 URL/Markdown…"没提新出现的「上传时的图片格式」；STEP 6 之后没有"下一步去哪"的收口。
3. 文案本身准确（我逐条对过代码），不需要大改，需要**补第二组卡片**。

**界面面**
4. 色彩单调：图标底、STEP 徽标、正文全是 `--accent-soft / --text-secondary` 两档（L34/L76/L77），六张卡视觉完全同权，扫视时抓不住"先做哪个"。
5. 头部与内容区无层次差（都是白卡+细边框），滚动后不知道自己在第几步。

## 二、改法

### A. 内容：两段式
- **第一段保留 STEP 1–6**（首次上手路径，一字不动的地方多，微调仅两处：STEP 5 加一句"上传格式也能在这里改"、STEP 6 后加一张 STEP 7「进阶入口」卡 → 跳设置页，文案列 快捷键/右键/HTTP API/图库管理）。
- 卡数 6→7，grid 保持两列。

### B. 颜色：语义分色，不是花
每张卡的图标底与 STEP 徽标按**动作语义**取色，全部走 CSS 变量、禁字面量（design-debt 门会抓硬编码色）：
| 语义 | 覆盖卡 | 色源 |
|---|---|---|
| 接入（云/存储） | 1、3 | `--info`（蓝，新增 token，三主题各一档） |
| 发布（上传） | 2 | `--accent`（现有主色，不动） |
| 理解（资源/复制） | 4、5 | `--success` 复活为低饱和绿（现死 token，正好转正） |
| 集成（Typora/进阶） | 6、7 | `--warning` 复活为琥珀（同上） |
- 新增声明：`:root` 一套 + midnight/sakura 各一套（face inventory 会 +1 面，表同笔重生成）。
- 对比度纪律：所有新组合进 contrast-tier 实测（≥4.5:1 才落），**达不到就换深浅不硬上**；数字随 CHANGELOG 签字登记。
- 头部加一条 4px 渐变条（`--accent` → `--info`），滚动容器顶部 sticky 一行步骤进度点（7 个点，当前可视区的亮）——纯 CSS，无新依赖。

### C. 不做（写出来免得跑偏）
- 不加插画/大图（体积与主题适配代价不值）；不加动画序列（尊重 prefers-reduced-motion 的门还没为它开）；不改弹窗宽度与 z-index（被 dialog 交互门钉着）。

## 三、验收顺序
1. 先拍"改前"三主题截图存档 → 2. 实现 → 3. contrast-tier/theme-surfaces/layout 三路 + 聚合全绿 → 4. 再拍"改后"同角度图入仓 → 5. face inventory 与 shape 基线按规矩签字。

预计改动：HelpCenterDialog.tsx ~+40 行、styles.css ~+12 行（token 三套）、文档两处。
