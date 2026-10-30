# TASKS

## 2026-10-30 — 教程网站质感细化完成

沿用用户批准的顶部选择、整页JPG、原透明度与简单实用文案，增加6px轻磨砂/柔边/内高光、中文字体优先和适度标题字距、字段两列对齐与编号；原7使用入口改为整行链接，手机单列。没有改桌面、依赖、Provider52字段或指南正文。

- 最终产品源码 `ac20ece3f692b76bf9e883d2016d46233f57270c` 已推送。CI41070881002成功，Rust221通过/0失败/1真实R2 E2E忽略；七页契约41070880971成功。Docs41070880980构建和浏览器41/0成功，含原31及实际字段几何/键盘/低运动/320与390检查；两个窄屏h1/正文left均26.59375。
- **发布状态与实际网站分开**：该Docs作业三次创建Pages部署API均500，整体failure，不写PASS。只读Pages配置仍build_type=workflow/status=built；官网组件operational，不能称全站公告故障。独立HTTP已证实新版实际在服务：36个HTML/CSS/JS/JPG与该SHA Pages归档逐字节一致，0不匹配。网页可刷新使用，不把发布状态回报失败解释成旧版仍在。
- 证据：Pages归档12983254792为1487095字节、SHA256 5276a2c2ea9d11acedb6a6215c3c0e6b23bd6d83b8cc3d0e188784fde93086c4；浏览器归档12983204859为3665434字节、SHA256 e140f751e5cee0612b9131065cd8460bd3fe5b60abf551592451a5e2e2ec56d0，均本机下载核对。9截图与report在本轮outputs/cloud-ac20ece，主代理/独立复核手机/字段/资源无可用性阻断。
- 本地Node语法、52字段canonical hash、16文档、640流程与diff通过。磨砂不增加面板不透明度；明暗最差正文7.7929/6.3775、链接4.7871/5.5597均>=4.5。无新增下载字体或依赖，无本机浏览器控制重试/SDK安装，stdin对照无探针脚本。

报告和线上36文件逐字节核对：`C:/Users/yyyy/Documents/Codex/2026-10-24/d-image-hosting-platform/outputs/guide-quality-2026-10-30/交付报告.md`、`published-byte-verification-ac20ece.json`。先前Enter事件测具、低运动优先级、内层copy居中三个问题均修复并被最终41检查覆盖；失败过程仅保留WORKLOG/报告供追溯，不作为待执行指令。


## 前轮结构批次

已完成共享PageLayout/PageHeader、共享Provider构造、七平台数据与六类样式拆分、原生桥和10个后台query门控；对应0c3a340实际CI/UI/原生证据见前轮报告。教程新版部署证据以上方本轮精修为准，不再沿用1e7网站状态。后续职责与真实验收仍如下保留。

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


## 2026-10-30 — DeepSeek网站壁纸与本机换壁纸展示

用户明确网站改用C:/Users/yyyy/Downloads/【哲风壁纸】AI拟人-DeepSeek娘.jpg；允许该JPG公开作为整页背景。两段新MP4仅供桌面本机导入，不提交/上传/打包。网站只原样替换website/src/assets/art/user-wallpaper.jpg，2560×1440、574196字节、SHA256 c2069e77410a7ca8047e3875adbb0a404495d13f3b8a7083f6f22141adab58e1；源/目标逐字节相同。CSS、透明度、布局和文案保持。独立核对文档16/0、平台7/字段52及diff通过；新SHA云端和实际线上待验。

桌面请求仍在进行：Computer Use主工具初始化两次均“failed to write kernel assets: 系统找不到指定的路径。 (os error 3)”，重置后仍失败；备用CUA入口同错。尚未取得可操作窗口，不能称完成图片/MP4实际导入播放。先准备本机当前前端预览，不要求安装SDK/软件；不尝试绕过先前浏览器控制停止条件。素材未改原件。
