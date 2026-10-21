# B05 · R2 受保护 Live E2E 激活草案源代码保全

- 来源 PR：[Draft #9](https://github.com/159357yangjun/Mirror_Cloud/pull/9)，旧分支 `chore/r2-live-e2e-default-activation`，HEAD `94ebfe161ef2b9adb51fa0c28f1d6c4ae0f1d9c2`，原始工作流 Blob SHA `61124c5221767ea7eaec0b820f0e152541c566e8`。
- 备份到 `docs/archive/legacy_ci/PR9_R2_LIVE_ACTIVATION_DRAFT.yml`，**不在 GitHub Actions 可执行目录**；只增加注释，原测试代码保留供将来审查。
- 为什么有价值：该草案曾提出 main-only workflow_dispatch、受保护 Environment 人工复核、固定不可变测试 SHA、签名访问和公开域检查的严格门禁。
- 为什么不能直接合并为可运行工作流：真实 Cloudflare R2 写入、隐私权限、签名 URL 和残留对象清理仍需受保护测试 Bucket 及单独人工授权。仓库 `.github/workflows/r2-private-live-e2e.yml` 现有 `if: ${{ false }}` 的拒绝执行状态必须保留。
- 即便草案已被备份，PR #9 仍属待审依赖，禁止把它标为测试通过或自动关闭。先确认正式受保护激活路径的未来方案，再由所有者决定是否删除旧分支。
- 本提交不修改 Rust、TypeScript、SQLite、工作流、密钥、版本号或 Release，也不运行任何 R2 live 测试。
