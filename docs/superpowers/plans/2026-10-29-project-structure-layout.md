# 项目结构与布局统一实施计划

> 依照2026-10-26已批准结构设计，沿用React/Tauri/Rust和Astro。新增用户约束：网页文字直接、实用、简单，不使用宣传和文艺表述。按现有授权在main实施、审查、云端验证，执行期间不要求重复确认。

**目标**：减少重复职责，让每个页面的布局、存储构造和教程维护位置明确；现有命令、数据、权限、壁纸及访问方式保持兼容。

**当前基线**：本地4ee3b19收尾记录与远端1d3c763仅新增历史分支审计文件，已正常合并保留双方成果；不执行该审计中的远端分支清理。未发现未提交用户修改。

- [x] 桌面统一页框：在components/PageLayout.tsx导出PageLayout（children、width、className），七页与旧Workflows页使用同一组件，保留页面最大宽度；styles.css统一自适应留白、页头换行、操作区换行，文字使用主题token。标题描述改用途/动作，发布欢迎区去文艺文案。
  核心接口：`PageLayout({ children, width = 'standard', className = '' }: { children: ReactNode; width?: 'standard' | 'wide' | 'compact' | 'tasks' | 'plugins'; className?: string })`。纯组合，不改变页面状态和操作；布局不得创建fixed弹窗的新包含块。
- [x] 教程数据按平台拆分：data/providers/types.ts维护SetupField/ProviderGuide，七个平台各一文件，providerGuides.ts仅统一导出，保持providerGuides/ProviderKey及顺序、52字段逐字节内容。拆分前后运行真实TS模块输出与原始JSON逐项对照，不靠注释或全仓字符串凑覆盖。
- [x] 网站样式按职责拆分：custom.css保留@import入口，theme/layout/navigation/content/providers/responsive六模块；响应式覆盖最后加载，保留层叠次序、透明度/对比和整页JPG。首页简化为“使用教程”、存储选择入口、配置→上传→复制流程及按任务查阅；删宣传式文案、不删平台步骤和字段。使用内容纠正壁纸/MP4说明与上传用途混杂。
- [x] Rust共享Provider工厂：services/provider_factory.rs维护唯一构造，commands.rs/cli.rs保留同名薄包装；缺凭据引用→配置解析→凭据读取→构造顺序不变，未知Provider保留各入口原错误。CredentialReader泛型适配系统凭据库，测试用内存假数据、不访问真实凭据或云端。覆盖七Provider构造、无引用、错误配置/凭据、未知Provider入口差异与错误透传。已有私有目标和发布策略不变。
- [x] 验证与审查：本地桌面build、既有单元、97命令契约、640流程、文档契约、Rust格式、差异检查；已有云端CI负责Rust及原生/UI检查、Astro构建与24项隔离浏览器验收，新增首页/详情文字与字段检查。独立只读审查有问题先修复，再对实际源码SHA核对完成状态。一次性对照仅stdin执行，保留结果证据、不留探针代码。
- [x] 更新docs/ARCHITECTURE.md、README及.ai/CHANGELOG；每提交完整路径/风险/源码SHA/CI在outputs交付报告记录。桌面不重打候选/正式发布，已安装候选与源码区分；网站按既有授权部署。

预期验证命令：既有Node `scripts/test_unit.mjs`、Python `scripts/check_contracts.py`/`check_user_flow.py`/`check_docs_site.py`、桌面npm run build。本机只用现有工具和依赖；Rust cargo fmt只校验语法格式，编译与单测结果以新SHA云端为准。


## 收尾状态（2026-10-30）

本地build、20套单元、97命令、640流程、16文档、46Actions pin和Rust格式通过，独立只读审查无实质遗留。最终产品0c3a340的CI/Rust221通过0失败1真实R2忽略、原生窗口/SQLite/安装卸载与离线合同成功。UI首次页面/确认/布局通过，键盘App mount超时；同SHA第2次completed/success，页面36/0、确认19/0、布局21/0无跳过、键盘42/0，最终截图无原TypeError，归档digest核对通过。

浏览器预览新增可调用invoke判断、当前10个原生query可用性门控：runtime11/7红→11/0绿、查询22/4红→22/0绿；保留原生行为与选择条件。通知fixture用真实notifyError受控通知、原断言保留并加强，gate-unit29/0；hit-test仅取证。失败过程见WORKLOG与本轮报告，不用旧布局PASS替代无错误截图。

网站1e7d2c7已部署，31浏览器检查、15路由/52字段/原JPG核对通过；之后未改网站。最终0c3首次归档云端/设置/插件截图已无旧TypeError。后续架构拆分、历史主题基线、真实云端/G3和更新闭环不在本轮完成结论内；现有9cc用户候选未重打。
