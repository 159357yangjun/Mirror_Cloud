# 教程网站质感细化实施计划

**目标**：沿用已批准的顶部选择、整页用户JPG、明暗透明面板与简单实用文案，提升阅读和操作细节。当前用户再次授权界面优化，不重新选择视觉方向。

**设计取舍**：可只调整字体/边线，也可重做首页。采用保留信息结构的局部精修：主面板6px轻磨砂，透明度保持；柔和边缘/内高光；中文字体优先、适中字距与标题尺寸；首页整行资源入口；字段两列顶部对齐。布局仍在顶部，手机单列，原生details和现有导航脚本保持。无需新依赖、字体网络请求或图片。

**架构**：六类CSS各自调整；GuideResources.astro负责已有7个使用入口，index.mdx仅调用。Provider数据和所有教程正文保持；不改桌面或打包。本地主机浏览器控制先前已停止，本轮不重试；实际渲染交给既有云端隔离浏览器。

- [x] 读取当前源码、远端、已有截图与在线内容；只读审查定位壁纸干扰、移动标题轴、标题字距、字段列错位和列表层次。
- [x] 修改theme/layout/navigation/content/providers/responsive.css；保持阅读面板/字段原透明度和原JPG。
- [x] GuideResources.astro复用原7项说明，链接整个行可点击；index.mdx替换原项目列表。
- [x] 扩充现有check_docs_navigation.mjs：实际两列dt几何、320/390标题对齐、资源目标/44px触达、原生details键盘、资源Tab与focus、reduced-motion；保留31条原断言。
- [ ] 运行本地文档16/字段52/Node语法/diff检查；只读复核完整差异。
- [ ] 按既有授权推送main、云端Astro构建与浏览器检查后部署，核对对应SHA、截图和线上资源。不能用旧成功替代本轮。
- [ ] 刷新TASKS/HANDOFF/WORKLOG/CHANGELOG和逐提交完整路径报告；记录所有未运行项。没有桌面新包、真实账号或正式发布。

验证命令：`node --check scripts/check_docs_navigation.mjs`、`node --experimental-strip-types scripts/test_provider_guides.mjs`、`python scripts/check_docs_site.py`、`git diff --check`；云端执行`.github/workflows/docs.yml`现有构建/隔离Chrome/部署/15路由检查。样式微调使用实际截图和既有浏览器门禁，不增加镜像CSS字面量测试或重签基线。


本轮云端纠正：f0de9d7bf7ce3bf7c3d0e29219e8eb7eb37c5ad3的Docs41069429150/build124109320775已完成构建，但新增Enter检查超时，deploy跳过；report检查31条已通过（包含字段dt同线和Space），并非完整41通过。官方Chromium HTMLSummaryElement/HTMLElement及Puppeteer输入实现表明Enter激活依赖keypress的回车字符；本测具原keydown/up没有text，Space在keyup激活所以通过。现只给Enter keyDown补text/unmodifiedText=回车，不另发char、不改产品或任何断言/等待。待新SHA云端实际证明，不将源码推断记为已通过。

失败归档12984526937已下载核对1221749字节、SHA256 a078cc8b74d1e857ebfb8e440b38d376df9cd747b970e485417ba1b9b596a8c6，保留report和截图到outputs/guide-quality-2026-10-30/cloud-f0de9d7；此批尚未上线，不能称最终网站证据。


0901的Docs41069957244/build124111113328构建成功，Enter关闭/焦点与资源Tab检查已通过；新减少动画断言失败，deploy跳过。源码确认content.css的资源链接规则有.sl-markdown-content限定（0,2,1），responsive.css原覆盖少该限定（0,1,1），后加载仍无法覆盖。补相同限定使reduce下transition:none真正生效；不改变用户正常动效或删断言。浏览器检查补打印真实matchMedia与各duration，便于以后区分媒体模拟与样式。新SHA实际结果待复查。
