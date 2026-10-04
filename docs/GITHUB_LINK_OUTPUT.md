# GitHub 图片链接输出规则

## 背景

GitHub `blob` URL 指向仓库文件网页（HTML），不是图片内容本身。图片发布场景必须使用 Raw 内容 URL。

错误示例：

```text
https://github.com/159357yangjun/PicList/blob/main/01_实现层_二维真实地图.png
```

正确目标：

```text
https://raw.githubusercontent.com/159357yangjun/PicList/main/01_%E5%AE%9E%E7%8E%B0%E5%B1%82_%E4%BA%8C%E7%BB%B4%E7%9C%9F%E5%AE%9E%E5%9C%B0%E5%9B%BE.png
```

Markdown 应使用图片语法：

```markdown
![01_实现层_二维真实地图](https://raw.githubusercontent.com/159357yangjun/PicList/main/01_%E5%AE%9E%E7%8E%B0%E5%B1%82_%E4%BA%8C%E7%BB%B4%E7%9C%9F%E5%AE%9E%E5%9C%B0%E5%9B%BE.png)
```

## v1.0.1 行为

1. GitHub Provider 上传成功后优先保存 GitHub API 返回的 `download_url`，并通过 URL parser 统一规范化。
2. API 未返回 `download_url` 时，Provider 生成 `raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>`。
3. 非 ASCII 文件名通过 URL parser 自动做 UTF-8 百分号编码，不手工拼接编码字符串。
4. 前端复制 URL / Markdown / HTML / BBCode / Custom Template 前再次规范化 URL。
5. 旧数据库中若已有 `github.com/.../blob/...` 链接，复制时自动转换成 Raw 链接。

## 真实问题回归样例

以下文件名用于回归检查：

- `02_实现层_三维城市沙盘.png`
- `04_算法层_算法对比.png`
- `06_规范_设计规范.png`

这样避免出现 `%城市`、`%E5对比` 之类“部分编码、部分中文”的无效 URL。
