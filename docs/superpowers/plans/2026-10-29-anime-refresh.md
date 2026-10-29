# 晴空樱花桌面与教程站实施计划

**Goal:** 实施已确认的二次元风格，两边共用原创 AI 插画、蓝粉配色与清晰的操作层级。

**Architecture:** 桌面沿用 React/CSS token/本地主题偏好；桌面插画进入 public，网站插画进入 src/assets，预设壁纸只接受枚举标识。教程沿用 Astro/Starlight，样式放 custom.css，首页使用 Starlight 组件及 Astro base 路径。

**Tech Stack:** 当前已安装 TypeScript/Vite、Node assert、现有浏览器测具；不增加依赖。

## 1. 共享素材

- 使用内置 imagegen 生成原创晴空、晚霞、星夜三张动漫风景，桌面保存于 public/art/，网站保存于 src/assets/art/ 供 Astro 处理，不保留旧外部素材。
- 添加 ART_ASSETS.md，记录生成提示、工具、文件与 SHA256；主界面无需署名。

## 2. 桌面主题与布局

- 先为 theme.ts 增加行为测试：默认新用户为 sakura；原保存主题/自定义壁纸继续加载；枚举预设解析成本地资源；未知/危险路径不能进入 CSS；原 http/https 兼容。
- 增加 WALLPAPER_PRESETS 与 safeWallpaperUrl，把默认主题设为 sakura；已保存选择不覆盖。ThemePanel 添加三张预设/无壁纸选择；支持用户确认的本机图片导入，不增加全盘文件权限。
- AppShell 增加品牌与侧栏风格类，PublishPage 添加局部动漫欢迎区；保留七页导航、上传按钮、事件回调、查询键及错误提示。
- styles.css 按主题使用语义变量绘制天空/粉色高光、选中导航和欢迎区，并处理小屏、深色及 reduced-motion。

## 3. 教程站

- astro.config.mjs 接入 customCss；首页改为带插画的开始页，使用可到达的七个图床与使用教程链接；原四步流程保留。
- custom.css 统一 Starlight 明暗主题、导航、卡片、步骤与移动布局；图片使用 BASE_URL。
- R2 教程按现有四步向导和公开/私有语义更正，不让用户误把 API Endpoint 当公开地址，不在网页采集密钥。
- 所有教程用准备项、实际字段、验证和排错组织，精简重复术语；保留 API 必需限制。个人图片经本机解码、缩小为有界 JPEG，独立保存；失败保留原设置，清除和恢复不触及业务数据。
- 404 先核对实际 Pages 设置与部署 URL；没有远端授权时不改后台或声称恢复线上，代码与云端缺口分别交付。

## 4. 验证与交付

- 运行新增主题行为测试、test:unit、desktop build、contracts、user-flow、docs contract、差异检查。
- 浏览器验证七页、主题预设及用户自定义地址、不同尺寸和 reduced-motion。已有主题表漂移继续报告，涉及测具变化保留覆盖及指纹校验。
- 网站依赖本机缺失，运行配置与内容静态检查，最终 Astro 构建及 Pages 部署由对应源码云端流程验证；不隐式 npm ci。
- 本地提交前独立审查；仅提交本轮文件，记录完整 SHA、文件范围、未运行项及线上状态。
