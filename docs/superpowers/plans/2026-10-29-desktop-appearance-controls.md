# Desktop Appearance Controls Implementation Plan

**Goal:** 落实用户已确认的独立背景强度与面板透明度。

**Architecture:** 沿用theme.ts保存偏好及CSS变量；新增wallpaperStrength，保留glass字段兼容。CSS以两层背景+柔光保持背景边界，以统一表面颜色和glass改变内容卡片；覆盖弹窗使用自己的不透明token。ThemePanel仅调用现有onChange。

**Tech Stack:** 现有React、TypeScript、CSS color-mix、Node assert与现有浏览器工具，不加依赖。

## Task 1: 偏好独立与兼容

Files: apps/desktop/src/lib/theme.ts, scripts/test_anime_theme.mjs。

- [x] 测试先失败：默认wallpaperStrength=100，旧记录补100；apply写 --wallpaper-strength，0/100均可，修改glass不改它；NaN/Infinity/undefined回落默认，数值超界夹取。
- [x] 新增字段和默认值；以有限数字检查封装numberPreference(value,fallback,min,max)，加载与apply共同使用；保留旧glass的45–100范围。
- [x] node scripts/test_anime_theme.mjs验证通过。

关键表达式：`Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback`；`--wallpaper-strength: 100%`。

## Task 2: CSS独立呈现

File: apps/desktop/src/styles.css。

- [x] 背景保留两层：linear-gradient主题底色遮罩 + var(--wallpaper)，遮罩比例为calc(100% - var(--wallpaper-strength))；blend模式normal, soft-light。
- [x] 原壁纸不透明表面转换为按主题的surface-base/soft-base/hover-base；最终surface使用color-mix(in srgb, var(--surface-base) var(--glass-strength), transparent)。让现有token消费者统一生效，移除侧栏主题规则对glass的覆盖与重复混合。
- [x] .fixed.inset-0覆盖弹窗局部surface/soft/glass/hover恢复base，不降低文字和控件不透明度。

## Task 3: 两个具名滑块

Files: apps/desktop/src/components/ThemePanel.tsx, scripts/test_anime_theme.mjs。

- [x] 新增背景图片强度range 0–100；未选壁纸时禁用并提示先选择，不自动更换图片。
- [x] 面板透明度range 0–55，value=100-value.glass，onChange写glass=100-number，说明不改变原生窗口透明度。保留模糊、导入和恢复。
- [x] 验证实际渲染的label与回调独立，旧值可正确显示。

## Task 4: 验证和交付

- [x] npm run test:unit、npm run build、check_contracts.py、check_user_flow.py、check_docs_site.py、diff --check。
- [x] 浏览器比较0/100壁纸与0/55面板透明度的计算样式与实际图片、弹窗不透明、重开保留；不写一次性探针文件。
- [x] 按requesting-code-review技能独立审查，修正发现；更新本轮记录并本地提交。推送、云端打包和Release只按授权范围进行。

自检：用户两项要求均有任务；无未定义依赖、不加框架、不改安全业务逻辑；截图/原生WebView/安装包证据分别报告。


执行结果：16项主题/真实滑块回调检查、16套单元、构建、640项用户流程、97项命令契约、16项文档契约通过。浏览器独立控制、刷新保留、无壁纸禁用、恢复、三主题21页面及640×480通过，已保存截图。三主题正文token的柔光背景数学下界检查9项通过（最小4.75），不替代完整像素对比度巡检。独立审查无遗留发现。主题表核对仍为12行漂移，没有重签。本轮仅本地提交，不推送、不打包、不发布安装包。
