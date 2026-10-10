# Portable storage reconnection wizard (phase 2)

**Status:** product functionality in a stacked Draft PR. Windows manual
acceptance and real-cloud testing are deliberately left for the end.

## Flow

1. Settings → **存储配置迁移清单** → **导入前检查**.
2. Inspect the version-1 manifest. Each row displays a provider, display
   name, bucket/repo where available and whether the old S3/R2 target
   requested privacy.
3. Click **逐项重新连接** for exactly one selected entry. The existing
   StorageSetupDialog opens in **migration reconnection mode**.
4. Only metadata from the strict manifest allowlist is prefilled: name,
   Bucket, region, root, repo owner/repo/branch and S3/R2 private intent.
   **All cloud credentials, tokens, R2 Account ID, cloud Endpoint and public
   domain/URL are blank and must be supplied/reviewed on the new computer.**
5. If an R2/S3 record's access mode is `unknown`, the user must explicitly
   choose **public** or **private** before the Save button is enabled.
6. User clicks **测试并新增连接**, approves the separate confirmation
   dialog, and the existing provider creation command verifies the new
   credentials/target before inserting a *new* local StorageRecord.
7. Only a successful creation marks the corresponding manifest row as
   **已新增连接**; cancelling or provider failure does not mark it restored.

## Conflict rules

- The original inventory view checks current local storages by provider
  plus normalized name, object Bucket or repo identity.
- A **fresh** list of local storages is fetched in the creation path after
  explicit confirmation, immediately before running the existing create
  command. If a possible conflict is found, creation stops with a generic
  warning. It does **not** rewrite or reuse old record IDs.
- The conservative Bucket-level check may block two legitimate configurations
  with different roots. This is intentional until a more rigorous conflict
  resolver and mapping audit exist.
- No existing storage or cloud object is updated, copied or deleted by this
  reconnection wizard. Existing default target and workflow group mappings
  are not automatically changed.

## Privacy and compatibility

- Private R2/S3 settings are preserved as **intent** only. The UI cannot
  certify remote Bucket ACL or whether an alternate public endpoint exists.
- Signed/hidden endpoint details and access tokens are excluded from the
  export. Cloud Endpoint and public URLs must be entered afresh.
- The migration-mode setup form suppresses raw provider SDK errors in the UI
  to avoid accidentally exposing a credential or signed URL.
- OSS, COS, GitHub, Gitee and WebDAV use their existing connection forms;
  do not reinterpret them as S3 private targets. Their public URL settings
  must be confirmed again.
- This is **not a full backup restore**: it does not restore SQLite assets,
  deployment history, original images, plugin settings, workflows, tasks,
  group IDs, or encrypted credentials. Those are separate future phases.
- Real Windows interaction (cancel/retry/duplicate/invalid credentials) and
  provider tests remain pending until the owner's final acceptance stage.

## Acceptance to run during the final test stage

- Import valid file, reconnect one R2/S3 item with fresh credentials, verify
  a new local record exists, while old stored IDs and group mappings remain
  unchanged.
- An unknown S3 mode must require a manual choice, and private mode must
  never take a public URL.
- Conflicting name/Bucket/repo is rejected, including a conflict that appears
  after opening the wizard; no existing connection is overwritten.
- Missing/bad credentials fail and do not mark a row as reconnected.
- Importing one profile never automatically creates another.
- Cancelling and selecting a different JSON resets per-file wizard progress.
