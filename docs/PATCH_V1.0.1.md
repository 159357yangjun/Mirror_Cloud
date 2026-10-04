# v1.0.1 — GitHub 图片直链修复

本补丁来自真实上传场景：GitHub `blob` 页面链接不能作为图片源，中文文件名手工编码容易出现局部漏编码。

## 修复内容

- GitHub Provider 统一规范化 `download_url`。
- 无 `download_url` 时生成 `raw.githubusercontent.com` 直链。
- 中文与其他非 ASCII 路径自动百分号编码。
- 输出层兼容旧数据：复制时把 GitHub `blob` 链接自动转换为 Raw。
- Markdown 输出固定使用 `![name](url)`。

## 本次 6 张图片的正确 Markdown

```markdown
![01_实现层_二维真实地图](https://raw.githubusercontent.com/159357yangjun/PicList/main/01_%E5%AE%9E%E7%8E%B0%E5%B1%82_%E4%BA%8C%E7%BB%B4%E7%9C%9F%E5%AE%9E%E5%9C%B0%E5%9B%BE.png)

![02_实现层_三维城市沙盘](https://raw.githubusercontent.com/159357yangjun/PicList/main/02_%E5%AE%9E%E7%8E%B0%E5%B1%82_%E4%B8%89%E7%BB%B4%E5%9F%8E%E5%B8%82%E6%B2%99%E7%9B%98.png)

![03_控制层_调度干预](https://raw.githubusercontent.com/159357yangjun/PicList/main/03_%E6%8E%A7%E5%88%B6%E5%B1%82_%E8%B0%83%E5%BA%A6%E5%B9%B2%E9%A2%84.png)

![04_算法层_算法对比](https://raw.githubusercontent.com/159357yangjun/PicList/main/04_%E7%AE%97%E6%B3%95%E5%B1%82_%E7%AE%97%E6%B3%95%E5%AF%B9%E6%AF%94.png)

![05_数据处理展示层](https://raw.githubusercontent.com/159357yangjun/PicList/main/05_%E6%95%B0%E6%8D%AE%E5%A4%84%E7%90%86%E5%B1%95%E7%A4%BA%E5%B1%82.png)

![06_规范_设计规范](https://raw.githubusercontent.com/159357yangjun/PicList/main/06_%E8%A7%84%E8%8C%83_%E8%AE%BE%E8%AE%A1%E8%A7%84%E8%8C%83.png)
```

> 注意：此前手工给出的第 2、4 张链接存在混合编码（例如 `%城市`、`%E5对比`），v1.0.1 不再依赖用户手工编码。
