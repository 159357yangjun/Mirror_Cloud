# 更新签名与升级验收

本实现仍须通过目标源码的云端 Rust 检查、候选包和真实升级验收，不能仅凭源码或协议测试宣称完整自更新已验收。门禁继续遵守 [RELEASE_GATE_UPDATER.md](RELEASE_GATE_UPDATER.md)。

## 信任依据和公开产物

- `apps/desktop/src-tauri/update-public-key.hex` 是随源码固定并编译进客户端的 Ed25519 公钥。公钥可以公开；客户端不接受前端或 Release 提供的新公钥。
- `update-manifest.json` 包含 schemaVersion、version、target、assetName、bytes、sha256。平台固定为 Windows x64；文件名必须精确对应版本。
- `update-manifest.json.sig` 是对清单原始字节的 Ed25519 签名，编码为 128 位十六进制文本。不要重排或重新序列化签名后的 JSON。
- `SHA256SUMS.txt` 继续保留原有 EXE、MSI、源码 ZIP 的哈希，兼容旧客户端。签名清单与签名另行验签，不加入原有三项校验清单。

新客户端通过公开的 `releases/latest/download/update-manifest.json` 与其签名检查更新，不依赖匿名 GitHub API 配额。GitHub/CDN 不可达时仍可能失败；不回退到未签名清单。

下载时，后端重新获取指定版本的签名清单，拒绝不高于当前版本的目标，不信任 IPC 里的 URL、大小或“有更新”标记。清单限制 16 KiB、签名 256 B、安装包 64 MiB，按实际读取的分块累计限制大小。

验证成功后，安装包进入 `%TEMP%\mirror-updates\<随机目录>\`，后端内存登记不透明句柄及原始签名清单。安装前重新规范化并约束路径、重新验签、重读磁盘文件并复算哈希，全部通过才启动安装器；启动失败不退出应用。重启会丢弃句柄，需要重新下载。

## 私钥与发布配置

私钥不进入仓库、SQLite、构建参数或工件。发布工作流需要仓库 Actions Secret `MIRROR_UPDATE_SIGNING_SEED`：32 字节 Ed25519 原始种子的 64 位十六进制编码。密钥格式不同的现有 PEM/minisign 文件不能直接填入。

新建私钥保存在维护者本机 Windows 凭据库；凭据目标和公钥指纹记录在本轮交付文件。公钥指纹为对 32 字节公钥计算的 SHA256，不是签名私钥。

工作流在编译前检查私钥是否与源码公钥配对；缺失或不匹配会失败，不会生成未签名的可发布包。私钥只在预检和签名步骤注入，Rust/前端构建步骤不接收私钥。签名步骤在安装器 smoke 及文件暂存完成后运行，随后独立验证签名和安装文件。

普通 push/PR CI 使用随机测试密钥，不需要生产私钥，不生成正式安装包。候选构建也需要签名 Secret，但手动 workflow_dispatch 仍不会创建正式 Release。

私钥备份应在用户确认的位置加密保存；仅保存在本机凭据库还不构成异地备份。不要将私钥粘贴到聊天、日志或源码。公钥轮换不能直接替换文件后期待旧客户端自动信任：通常须先用旧私钥签发一个包含新信任策略的过渡客户端。私钥丢失或泄漏时，停止签发并单独制定恢复方案。

## 本地验证

```powershell
node --test scripts/test_update_signing.mjs
python scripts/check_contracts.py
python scripts/check_user_flow.py
python scripts/check_release_version.py
python scripts/check_workflow_action_pins.py
```

下载正式资产后，使用独立可信的公钥核验，不能从同一待验 Release 获取公钥：

```powershell
python scripts/verify_release_assets.py --tag v<版本> --dir <下载目录> --require-signature --public-key <可信公钥的64位hex>
```

Rust 的签名协议、安装前磁盘校验、目录约束和无 Content-Length 下载上限测试由现有云端 `cargo test --workspace --locked` 运行。跨语言公开测试向量由 Python cryptography 生成，分别由 Node 和 Rust 验证，不包含生产私钥。

## 旧客户端与完整闭环验收

旧客户端没有新公钥，不能通过给服务器加签名文件就获得新的验签能力。第一次升级仍属于旧客户端原有 SHA256 路径；可先用可信源码公钥在外部核验新包后手动安装。新客户端之后才会强制签名验证。不要把首次旧版升级描述为已经由旧客户端完成独立验签。

以下两阶段分别记录旧/新客户端版本、安装包 SHA256、源码 SHA、构建来源、操作时间和实际结果：

| 阶段 | 操作 | 所需证据 |
| --- | --- | --- |
| 旧版 → 首个签名客户端 | 检查、下载、安装、重启 | 旧版确实发现目标版本；安装成功；逐项确认 G3 数据/凭据/配置/集成/插件/主题保留并上传新图 |
| 签名客户端 → 更高版本签名包 | 检查、验签、下载、确认安装、重启 | 检查与下载不依赖匿名 API；显示正确目标版本；安装后再次核对 G3；正式重建包单独记录字节哈希 |
| 拒绝路径 | 错签名、错公钥、篡改清单/包、截断、版本/平台/文件名不符、未签名包、同版/降级 | 拒绝安装；应用仍可使用；无真实云端写入 |

协议测试、模拟 IPC、安装卸载 smoke 和用户旧数据升级分别留证，不互相替代。当前方案不提供 Authenticode，不宣称抵御本机同一用户权限的恶意进程；签名也不能阻止网络阻断或保证云端链接永不失效。
