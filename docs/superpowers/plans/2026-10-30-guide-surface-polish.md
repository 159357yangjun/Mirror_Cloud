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
