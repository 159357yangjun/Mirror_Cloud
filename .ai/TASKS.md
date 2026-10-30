# TASKS

## 本轮：结构、布局与实用教程

本轮共享页框、共享Provider工厂和教程模块化已实现。用户要求网页文字简单实用：网站首页只保留配置选择、三步上传和使用链接，七平台52项填写说明保留，新增独立外观说明，现15路由。顶部分类、整页JPG、透明度与明暗文字对比保留。

- 完成：桌面共享页框/页头、七平台数据拆分、网站六类样式拆分、简洁首页与独立外观教程、Rust共享Provider工厂、README与架构说明。
- 完成：可调用原生桥判断、10个原生后台query门控及22项生命周期回归；修正通知测具对偶发错误的依赖，使用真实notifyError受控通知，原断言保留，额外检查实际文案。hit-test只取证，不宣称判定命中归属。
- 验证：本地build、20套单元、97命令契约、640用户流程、16文档、46Actions pin、Rust格式通过；独立只读审查无实质遗留。最终产品0c3a340的CI/Rust221通过0失败1真实R2忽略、原生窗口/SQLite/安装卸载、R2离线、候选身份、七页契约成功。
- 完成：同SHA Windows UI40994185267第2次completed/success，页面36/0、确认19/0、布局21/0无跳过、键盘42/0；最终截图目视无原TypeError，归档digest已核对。首轮键盘App mount超时保留为测具未完成记录，不冒称首轮成功。
- 已上线：网站源1e7d2c7，Docs40989020969成功，31浏览器断言、15路由/52字段/锚点/原JPG一致性通过；后续桌面提交未改网站。

完整源码SHA、每个提交文件清单、CI和截图证据见本轮outputs报告及HANDOFF。本轮没有交付新安装包或正式发布。

## 结构统一后续批次

- 第一批已完成：异步订阅生命周期、云端浏览共享计算、开发和离线测试入口。
- 第二批已完成部分：Workflow/任务/资产API与共享查询键、平台runtime/对话框/剪贴板、独立诊断面板、本轮页框。待实施：其余领域API、设置大组件和其他职责拆分。
- 第三批已完成部分：已保存连接Provider构造共享及7项Rust回归。待实施：发布生命周期、其他服务和仓储拆分。
- 历史主题统计基线11/12行漂移未解决、未重签；不记作全部视觉基线通过。大chunk/无效动态导入警告仍在。

原批准范围见 `docs/superpowers/specs/2026-10-26-structure-unification-design.md`；本轮计划见 `docs/superpowers/plans/2026-10-29-project-structure-layout.md`。长期规则统一见根目录AGENTS。

## 用户验收与发布缺口

- 已交付9cc88524d034候选保留在D:/image-hosting-builds/1.4.10-candidate-9cc88524d034，本轮源码改动尚未进入用户安装包。
- 待用户验收实际显示器/DPI及原生图片/MP4；G3真实旧数据、凭据、图床、Typora、插件与新上传；正式发布后的自动更新闭环。云端干净runner、浏览器模拟和安装卸载不能替代。
- 不占用正式tag，不要求安装本机SDK；真实R2 E2E仍未执行，云端离线通过不等于真实图床写入通过。
- 旧批次清理被策略拒绝的残留见各旧outputs报告，未再次绕过清理；本轮只保留交付证据，无一次性探针脚本。


## 2026-10-30 — 教程网站质感细化（本地完成，云端待验）

沿用用户批准的顶部导航、整页JPG、透明度和简单实用文案。本轮只改网站：6px轻磨砂、明暗边缘/内高光/阴影、中文字体优先与适度标题字距、移动标题左对齐、字段两列wrapper清零margin、编号和分隔线；主页7个原使用入口变整行可点击，文字/目标保持。没有改桌面、Provider字段/指南正文或依赖。

已有check_docs_navigation保留31条断言，新增实际字段两列dt几何、320/390首页对齐、7个资源目标/触达尺寸、details Space/Enter、资源Tab/focus和reduced-motion。浏览器只在Linux CI自有loopback，不重试先前停止的本机控制。Node语法、7平台52字段canonical hash与16文档契约通过；独立只读复核及新SHA云端构建/截图/部署待完成，不用旧CI代替。本次脚本比较和编辑均stdin，无保存一次性探针。


本轮云端纠正：f0de9d7bf7ce3bf7c3d0e29219e8eb7eb37c5ad3的Docs41069429150/build124109320775已完成构建，但新增Enter检查超时，deploy跳过；report检查31条已通过（包含字段dt同线和Space），并非完整41通过。官方Chromium HTMLSummaryElement/HTMLElement及Puppeteer输入实现表明Enter激活依赖keypress的回车字符；本测具原keydown/up没有text，Space在keyup激活所以通过。现只给Enter keyDown补text/unmodifiedText=回车，不另发char、不改产品或任何断言/等待。待新SHA云端实际证明，不将源码推断记为已通过。

失败归档12984526937已下载核对1221749字节、SHA256 a078cc8b74d1e857ebfb8e440b38d376df9cd747b970e485417ba1b9b596a8c6，保留report和截图到outputs/guide-quality-2026-10-30/cloud-f0de9d7；此批尚未上线，不能称最终网站证据。


0901的Docs41069957244/build124111113328构建成功，Enter关闭/焦点与资源Tab检查已通过；新减少动画断言失败，deploy跳过。源码确认content.css的资源链接规则有.sl-markdown-content限定（0,2,1），responsive.css原覆盖少该限定（0,1,1），后加载仍无法覆盖。补相同限定使reduce下transition:none真正生效；不改变用户正常动效或删断言。浏览器检查补打印真实matchMedia与各duration，便于以后区分媒体模拟与样式。新SHA实际结果待复查。


7b3210d的Docs41070393865/build124112623548实际reduce匹配true且10个目标duration全0，通过；随后390首页左轴断言失败，deploy跳过。读取真实HTML发现.hero > .stack > .copy > h1，内层.copy在手机仍align-items:center；此前只覆盖外层.stack不足。现同一左对齐规则扩到.copy，保留原1px阈值，并打印实际左右坐标。归档12983044409已下载核对3056347字节、SHA256 092d0a75d9aa1f1dbf901a185f5ed66496a00dad5cc87e64af5228b00952bd13；新SHA截图仍待全量通过，不把此失败源码当作已部署。
