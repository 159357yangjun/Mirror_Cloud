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

## Atomic reconnect guard (phase-2 hardening)

- Restoration requests set `restoreGuard: true` for all seven supported providers; ordinary new-storage creation keeps its previous behavior.
- The SQLite repository performs conflict checking and insertion in **one INSERT ... SELECT WHERE NOT EXISTS statement**, avoiding a read-then-insert race between reconnection windows. Conflict returns `RESTORE_CONFLICT` and the credential reference created by this attempt is deleted.
- Matches are scoped to provider and normalized display name; object storages also compare Bucket, and repository storages compare complete Owner/Repo/Branch identity. WebDAV uses the display name only, consistent with the current manifest's missing Endpoint.
- This is deliberately conservative: an existing Bucket with a different root still conflicts. No existing IDs are reused or overwritten.
- This guard does **not** establish global uniqueness for ordinary create commands, and it does not make remote connection tests or the default-workflow bootstrap transactional. Review rollback failures separately before treating recovery as fully atomic.
- Rust repository tests cover name/Bucket/Provider and repository identity cases; Windows interactive and real-cloud acceptance remain deferred.

## P1: Source-to-destination Storage ID mapping

- v2 manifests now include `sourceStorageId`. v1 imports remain valid but
  cannot reconstruct old IDs.
- Every successful reconnection records `sourceStorageId → created.id` in the
  current Settings session. The preview displays both IDs and local conflicts.
- Export **旧→新 ID 映射** explicitly to a new JSON file after reconnection.
  The backend rechecks every destination UUID exists and belongs to the same
  Provider. A mapping receipt is not an automatic database remap or proof of
  remote ownership. No old UUID is assigned to a newly created record.
- Mapping state is currently session-local. If the page is closed before
  export, the association is not durable. Do not silently infer it from a
  matching name on a later import. Never apply mappings to groups, workflows,
  deployments or assets until a separate conflict preview and reversible
  database transaction exist.
