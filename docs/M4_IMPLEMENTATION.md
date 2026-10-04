# M4 Implementation — Workflow, Image Processing & Onboarding

版本：0.5.0

## 本阶段目标

把“上传到某个云端”升级为“执行一个发布方案”：图片先经过可重复的处理、命名，再发布到单云或 Storage Group。普通用户优先选择 Recipe，高级用户可以自定义参数。

## 新增核心模块

### `crates/image-processing`

- Resize：Lanczos3，按最大宽高等比缩放
- JPEG：可调质量
- PNG：标准重新编码
- WebP：libwebp 有损编码，可调质量
- Original：无 Resize 时直接透传原始文件，不做无意义重编码

### `crates/workflow-engine`

顺序解释 Domain Workflow：

```text
Input
  ↓
Resize
  ↓
Convert / Compress
  ↓
Rename
  ↓
Publish Target
  ↓
Output
```

Workflow 仍然保持顺序 `Vec<WorkflowStep>`，没有提前引入 DAG。当前业务不需要图结构，避免过度设计。

## Rename 模板

支持：

- `{year}` / `{month}` / `{day}`
- `{stem}` / `{name}` / `{ext}`
- `{hash}` / `{hash:8}` / `{hash:12}` / `{hash:16}` / `{hash:24}` / `{hash:32}`
- `{uuid}`

默认 Recipe 使用内容 Hash 参与命名，降低重名冲突。

## Recipe

M4 内置四个官方 Recipe：

1. 博客 · WebP 均衡：2560px / WebP Q82
2. 文档 · 清晰优先：1920px / WebP Q90
3. 分享 · 小体积：1600px / WebP Q72
4. 原图 · 不转换

Recipe 本身不携带密钥，也不绑定固定用户 Storage；安装时只选择目标。

## Workflow 持久化

现有 `workflows` 表继续复用，M4 migration `0005_workflow_recipes.sql` 新增：

- `description`
- `source_recipe`
- 默认方案索引

Workflow 的 Steps 以 JSON 持久化，具体 Provider 配置仍由 Storage 独立管理。

## 发布路径

新增 Tauri command：

- `list_recipes`
- `create_workflow_from_recipe`
- `create_custom_workflow`
- `list_workflows`
- `set_default_workflow`
- `delete_workflow`
- `publish_files_with_workflow`

Workflow 发布完成后仍落为统一模型：

```text
Asset
  └─ processed Variant
      ├─ Deployment → Primary
      ├─ Deployment → Mirror
      └─ Deployment → Backup
```

因此 M3 Repair 能直接复用，不需要知道图片之前经过哪个 Recipe。

## UX

新增一级“方案”页面：

- Recipe 卡片优先
- 已安装方案
- 默认方案
- 高级自定义方案

上传窗口默认选择默认 Workflow。直接发布到 Storage / Storage Group 仍保留在“高级”分组，方便调试与特殊情况。

资源为空时显示 3 步引导：

1. 连接云端
2. 选择 Recipe
3. 上传图片

## 教程静态站

`website/` 已升级为 Astro + Starlight 工程，并加入：

- 5 分钟上手
- Cloudflare R2
- GitHub
- Gitee
- Recipe 选择指南

安全原则：教程站永远不收集 Token / Secret，敏感凭据只在 Desktop 输入。

## 未在 M4 引入

- DAG/条件分支 Workflow
- Plugin marketplace
- Deep Link 一键导入
- AVIF/HEIC 专用高性能 codec
- libvips 批量处理

这些能力只有在真实需求出现后再扩展，避免第一版架构复杂度失控。
