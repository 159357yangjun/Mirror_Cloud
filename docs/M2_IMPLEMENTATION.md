# M2 Implementation Notes

## 1. Repository Storage

M2 将代码仓库正式视为 `StorageProvider` 的一种实现，而不是散落在 UI 内的“图床插件”。

当前官方实现：

- `storage-github`
- `storage-gitee`

两者都实现统一行为：

- `test_connection`
- `upload`
- `delete`
- `list`
- `public_url`

仓库 Provider 的 API 差异只存在 Adapter 内部，Asset、Task 与 Desktop API 不关心具体平台。

## 2. Public URL

Repository Storage 有两种公开 URL 策略：

1. 用户配置 `public_base_url`：优先使用自定义域名/CDN；
2. 未配置时：公开仓库使用平台 Raw URL。

如果仓库是私有仓库且没有 `public_base_url`，连接测试会拒绝保存，因为产品的核心目标是让资源可被其他人直接访问。

## 3. Secret handling

GitHub/Gitee Token 与 S3 凭据一样，只写入系统 Credential Store。SQLite `storages` 表保存：

- provider key
- owner/repo/branch/root
- non-secret public URL config
- credential reference

不保存 Token 明文。

## 4. Remote deletion

资源删除不是直接删本地记录：

1. 创建 `delete_asset` Task；
2. 读取 Asset 的全部 Deployment；
3. 按各 Deployment 的 Storage 构建对应 Provider；
4. 删除远端对象；
5. 成功的 Deployment 标记 `deleted`；
6. 全部成功后才删除本地 Asset；
7. 任一失败则保留 Asset，并将任务标记为 failed，供用户后续重试/Repair。

该行为为 M3 的多云补偿与 Repair 提供基础。

## 5. Output preferences

新增 `app_settings` 表保存应用级输出偏好：

- URL
- Markdown
- HTML
- BBCode
- Custom template

自定义模板支持 `{url}` 与 `{name}`，并强制 `{url}` 存在。

## 6. UI

M2 UI 新增：

- Provider Picker
- GitHub/Gitee 简化连接表单
- Repository Browser
- 资源页默认复制格式选择
- 资源真实远端删除入口
- Settings 中的输出模板配置

复杂 API 参数仍不在默认路径暴露。
