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

## P2 phase 2: durable quarantine (still not active resource restoration)

A new SQLite migration, `0020_portable_asset_staging.sql`, introduces
`portable_asset_batches` and `portable_asset_staged_items`. They are entirely
separate from `assets`, `asset_variants`, and `deployments`: ordinary
resource listing, deletion, repair, sharing and reconciliation have no query
path to these staging tables. The only batch state is `pending`; the item
review vocabulary is strictly `blocked_duplicate`, `blocked_path`,
`needs_rebind` or `awaiting_verification`. No `online` or verified status
is accepted by the staging schema.

After inspecting a portable resource manifest, the operator may explicitly
choose **确认隔离暂存**. The backend performs fresh validation and conflict
previews rather than trusting any client-side flags, then writes a sanitized
snapshot of the allowlisted entries, source-to-destination ID bindings and
review labels in a single SQLite transaction. Existing source snapshot
timestamps are not overwritten or staged twice. Transaction errors roll
back both the batch header and its item rows.

The **本机待核验批次** section lists saved batches and item review labels
across application restarts. Each batch can be explicitly discarded;
foreign-key cascade deletes the quarantine rows only. A staging row is
*not* an active asset, remote identity proof, remote delete authorization, or
a claim that a file exists on any Provider. Even `awaiting_verification`
means only "locally eligible for a future verification pass."

**Not yet implemented:** confirmation-driven repair of individual staged
bindings, live cloud existence/content verification, copying metadata into
the active asset index, default publishing integration or any remotely
authorized delete/share. Those remain separate phases; manual Windows/cloud
E2E stays deferred to final product acceptance.

## P2 phase 3: persistent per-item review and local rebinding

SQLite migration `0021_portable_asset_item_review.sql` adds a per-row
operator decision (`review`, `defer`, `exclude`), a strictly local
`binding_overrides_json` array, a monotonic revision and an audit timestamp.
Previously staged batches default to review; the migration does not copy rows
into the active `assets`, `asset_variants` or `deployments` tables.

In the staging batch details, each row can be rechecked against **current**
local duplicate content and path collisions, deferred, or excluded. A source
storage ID appearing in that row can be mapped to an enabled destination of
the same Provider. The backend revalidates the source UUID and Provider,
rejects duplicate destinations, omits stale source bindings, recalculates
the local review status, and commits the decision plus overrides in a
compare-and-swap update using the expected row revision. Stale windows must
refresh instead of silently overwriting another decision. Rebinding is
per-row and never alters the global StorageRecord, original manifest, remote
objects or any workflow.

`awaiting_verification` means only that a local identity/path conflict was
not detected in this review. It is **not** remote existence, ownership,
accessibility, private ACL or content hash verification. The user may mark
rows excluded or deferred; they are excluded from the review-ready batch count.
The only supported operation on a staging batch remains local review or discard.
No remote deletion, sharing, automated verification, promotion, or active
resource writes are exposed by this phase. Future activation must introduce
separate provider checks and fail-closed authorization.

## P2 phase 4: fail-closed pre-activation gate (local only)

Each staged resource now offers **检查激活前条件** in Settings. The Tauri
command reads the exact pending batch+row, source image identity, original
storage mapping and saved per-row overrides, and looks up **current** enabled
local destination storages. It recomputes local variant duplication and
object-key conflicts against active records, independently of the older
`review_status` stored on staging.

Results distinguish `excluded`, `deferred`, `blocked_local` and
`awaiting_remote_evidence`. The latter means only that a current local
preflight found no immediate identity, mapping or object-key conflict.
Individual copies enumerate future required evidence: remote object
existence, authenticated readback matching the source content digest,
and independently verified access policy. R2/S3 targets with
`private_requested` also require actual anonymous-access refusal
and expiry behavior of a temporary share. This intent flag is **not** proof
of private cloud permissions; an object's ETag or unverified metadata is
also not a substitute for authenticated content verification.

The command deliberately returns `activation_allowed: false` for every
case. It neither requests cloud credentials nor accesses remote services,
writes evidence, changes active images/deployments, creates public links
or grants deletion. There is **no** override button or promotion path.
This gate is an actionable operator checklist that makes remaining
verification gaps visible; it does not imply real R2/S3 or Windows
acceptance has run.

A future phase must introduce authenticated, time-bound proof collection
bound to the exact destination Storage ID, object key, source digest
and current row revision; enforce fresh concurrency/ACL checks within an
atomic promotion transaction; and maintain fail-closed behavior when a
cloud provider cannot prove the requested policy.

## P2 phase 5: usable staged-resource triage and atomic bulk decisions

The Settings staging panel now includes name/variant search, persisted review
status filters, per-batch counts, an explicitly **local-only classification**
progress indicator and at-most-100 item selection from the current filtered
result set. This is not remote verification or import completion progress.

A user must explicitly confirm bulk `review`, `defer` or `exclude` decisions.
The backend accepts a bounded batch of item IDs with their expected row
revisions. It rejects invalid/duplicate IDs and writes all operator decisions
in a single SQLite transaction guarded by batch ownership, pending state and
revision checks. Any concurrent edit or missing item rolls back **every**
decision in that request, and the UI refreshes the batch. Bulk actions never
alter object bindings, content hashes, remote paths, stored local collision
labels, active assets, deployments, verification clocks or provider secrets.
They do not perform a remote request and cannot mark a staged record online.

Choosing a batch, changing the active search/status filter, discarding a batch
or making an individual update clears selection to minimize accidental
cross-context operations. A stale selected item will be rejected at the
database revision gate, not silently overwritten. Operator decisions remain
editable, with re-check and per-item rebind available for manual recovery.
