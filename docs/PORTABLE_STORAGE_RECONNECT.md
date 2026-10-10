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

## P1 reference inventory and confirmed group restoration

A separate `mirror-cloud-relationships.json` (schema version 1) exports the
existing group names, strategies, old group UUIDs, old member storage UUIDs,
roles and priorities. It exports non-system workflow **names and publish target
references only**. No workflow steps/templates, secrets, signed URLs, images,
deployments, or resource verification statuses leave the machine. This is an
allowlisted relationship snapshot, **not** a full application backup.

On a new device, import the v2 storage manifest, reconnect each storage with
fresh credentials, and preserve the old→new ID mapping in the Settings session.
Import the relationship file and use **重新检查冲突** to view unmapped members,
existing group names and mixed private/unknown storage intent. Each ready group
requires its own user confirmation. The app gives the group a new UUID.

The SQLite group header and all members are inserted within one transaction;
a member failure rolls back the header, and an atomic conditional INSERT
refuses to overwrite an existing same-name group. The command revalidates
mappings, enabled storages, Provider identities, group membership and access
isolation when clicked, so an old browser-side preview is not trusted.

Workflow target references are **read-only previews** because the relationship
file deliberately excludes processing steps and templates. No workflow is
auto-created, no default upload target changed, and no old UUID is reused.
Restored group IDs are shown in the current UI session but are not yet part of
a durable cross-device workflow mapping. These are explicit remaining gaps.

Run Windows human acceptance and real remote ACL verification only during the
final consolidated product acceptance stage, per project policy.

## P1 workflow restore (strict relationship manifest v2)

Relationship inventory version **2** allows `spec` only for workflows whose
entire step sequence is the standard generated format: optional Resize,
Convert, Rename, Publish and Output(`{url}`). The rename path must match one
of four approved built-in templates, and format/quality/dimensions are checked.
Unrecognized, modified or potentially sensitive templates are **not exported**
and cannot be automatically restored. Version-1 relationship files remain
readable as target-only previews, not silently upgraded to executable workflows.

With source Storage IDs mapped to new enabled local storages, restore each
compatible workflow explicitly. For old group targets, first restore the group
and export or load the **Group ID mapping receipt** tied to the selected
relationship manifest. Backend validation checks the mapped group still has
the expected name, strategy, member storages, roles and priorities, not merely
matching names or a copied UUID.

The UI can now also reload the earlier Storage ID mapping receipt, provided
the selected v2 source manifest, UUIDs, Providers and destination enabled state
match. Receipts contain no credentials. No original Storage/Group/Workflow
primary key is reused.

New workflows use fresh UUIDs, exact reconstructed standard steps and a
single atomic conditional SQLite insert that refuses duplicate names. They
are deliberately created **non-default**, without modifying source recipes,
default upload settings, cloud permissions, group content, images, deployment
records or remote objects. Source snapshots and mapping files are untrusted
imports; manual acceptance must still examine the resulting publication target.

The group mapping receipt is a separate allowlisted JSON file. It must be
saved explicitly after group recovery; the app does not silently persist old
UUID mappings as authoritative. Full arbitrary custom workflow backup, user
secrets and real Windows/cloud acceptance remain **unimplemented**.

## P2: image/asset metadata catalogue (read-only first phase)

Settings now exports `mirror-cloud-assets.json`, schema v1, with up to
1,000 image/variant rows and the non-secret **source** Storage UUID, Provider,
role and object key for each deployment. A non-relative key, query or fragment,
percent-escaped key, protocol URL, traversal path, or backslash-containing key
is **omitted** (null) rather than copied, because these might contain a
signed URL or unsafe path. No public URL, credentials, error/log messages,
deployment status, online claim, verification or observation timestamps,
plugin output, local image bytes or user database is exported. Export
fails rather than silently truncate more than 1,000 resource variants or
a JSON file larger than 4 MiB. Existing destination files are not overwritten.

The new **导入并检查资源** button performs strict JSON and schema validation,
then compares variant content hash + MIME + size against the **entire**
local variant index and checks current Storage-ID rebindings and remote object
path collisions. Results classify a row as duplicate, path conflict,
needs manual rebinding, or unverified, always marked `applied: false`.

**Important:** this phase is read-only by design. No source Asset/Variant/
Deployment ID is copied into SQLite, and no guessed status becomes
`online`, `degraded` or `last_verified_at`. An apparently mapped object
is **not** proof of its presence, ownership, privacy or content integrity.
The next phase must add a safe staging and revalidation mechanism before
restoring any active resource-index entry. Provider and Windows end-to-end
acceptance remain deferred as requested.
