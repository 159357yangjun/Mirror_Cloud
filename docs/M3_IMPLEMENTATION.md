# M3 Implementation — Multi-cloud Collaboration

Version: **0.4.0**

M3 turns the project from a collection of individual storage adapters into a real multi-cloud publisher.

## 1. Storage Group

A Storage Group is persisted in `storage_groups` and `storage_group_members`.

Each group requires:

- at least two storage members;
- exactly one `primary` member;
- optional `mirror` and `backup` members;
- one strategy: `mirror_all` or `primary_with_backups`.

The UI exposes this as a compact group editor on the Cloud page. Users select existing Storage connections, assign roles, and then publish to the group from the normal upload dialog.

## 2. Multi-cloud publish

`publish_files_to_group` creates one durable Task per selected file.

The Rust task does the following:

1. read the local image once;
2. calculate SHA-256 once;
3. build one logical remote path;
4. construct Provider adapters for every group member;
5. upload to every configured cloud;
6. persist one Asset + one Variant + N Deployments;
7. select the public URL from the healthy Primary deployment, falling back to another healthy deployment when needed.

`mirror_all` starts every available target concurrently.

`primary_with_backups` publishes the Primary first. Mirror targets always synchronize. Backup targets are failover-only and run only when the Primary upload or Primary initialization fails.

A publish is considered usable when at least one deployment succeeds. Partial success is persisted as a `partial` Asset instead of throwing away the healthy public copy.

## 3. Deployment diagnostics

Migration `0004_multicloud_groups.sql` adds `deployments.last_error` and indexes for group ordering/status lookup.

A failed deployment therefore remains attached to the Asset with:

- target Storage;
- role;
- remote path;
- failed status;
- last provider error.

The Assets page surfaces unhealthy deployment chips instead of hiding failures.

## 4. Cross-cloud Repair

M3 adds `StorageProvider::download`.

Implemented download paths:

- S3/R2 through OpenDAL;
- GitHub through repository Contents API with raw fallback;
- Gitee through repository Contents API.

When an Asset is `partial`, the Repair action:

1. finds an online deployment that supports download;
2. downloads the source bytes from that cloud;
3. uploads the same bytes to failed/degraded deployments;
4. updates public URL, verification timestamp and error state;
5. leaves unresolved failures visible if a target still rejects the write.

This means Repair does not require the original local file to still exist.

## 5. Task semantics

New task kinds:

- `publish_group`
- `repair_asset`

A multi-cloud task can finish as `completed` with a warning note when at least one cloud succeeded but another cloud failed. The Tasks page renders this state as amber rather than treating it as a total failure.

## 6. UI changes

Cloud page:

- Storage Group cards;
- group creation dialog;
- Primary / Mirror / Backup role editor;
- strategy selector;
- group delete action.

Upload dialog:

- Multi-cloud groups are the preferred destinations;
- individual Storage targets remain available;
- selected group shows its member/role composition.

Assets page:

- deployment roles are visible;
- provider errors are available as hover details;
- partial resources show one-click Repair.

## 7. Architecture boundary

The domain is still Storage-provider agnostic:

```text
React UI
   ↓
Tauri Commands
   ↓
Task Engine
   ↓
Storage Group orchestration
   ↓
StorageProvider Port
   ↓
OpenDAL / GitHub / Gitee adapters
```

The application does not branch on provider-specific HTTP rules during multi-cloud orchestration. Those differences remain inside the adapters.

## 8. Next milestone

M4 should build on this foundation rather than changing it:

- image processing pipeline;
- Workflow execution;
- Recipe presets;
- guided provider onboarding;
- static tutorial site;
- deep-link import of non-secret configuration.
