# Publisher Guide

M4 起，官网/教程站进入真实工程结构：Astro + Starlight。

目标不是做传统 API 文档，而是降低第一次配置成本：

- `/guides/r2`：Cloudflare R2 5 分钟配置
- `/guides/github`：GitHub Repository Storage
- `/guides/gitee`：Gitee Repository Storage
- `/recipes/choose`：Recipe 选择说明
- `/use/local-api`：本机 HTTP API 的端点、鉴权、状态码与已知限制

安全原则：教程页永远不收集 Token / Secret。敏感凭据只在桌面应用内录入。

## 发布

`.github/workflows/docs.yml` 在 `website/**` 变化时构建 `website/dist` 并部署到 GitHub Pages 项目站点：

```text
https://159357yangjun.github.io/image-hosting-platform
```

因此 `astro.config.mjs` 必须显式声明 `site` 与 `base`：Pages 项目站点带仓库名子路径，`base` 缺失会让所有资源 404。

桌面应用只在构建时注入 `VITE_DOCS_BASE_URL` 才显示「在线文档」入口（见 `apps/desktop/.env.example` 与 `release.yml` 的 `windows-bundle` 作业变量）。`scripts/check_docs_site.py` 在 CI 中守住三件事：侧边栏 slug 与 `src/content/docs/**` 双向一致（不留死链、不留孤儿页）、每页 frontmatter 有 `title`、以及 `site` / `base` / `VITE_DOCS_BASE_URL` 三者不漂移。`docs.yml` 部署完成后还会逐条 curl 侧边栏路由，确认线上真的可访问。

本地预览：`cd website && npm ci && npm run dev`，站点挂在 `/image-hosting-platform/` 路径下。
