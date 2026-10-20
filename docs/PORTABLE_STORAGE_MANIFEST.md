# Portable storage reconnection manifest — phase 1

This is the **first safe slice** of migration, not a full backup/restore and
not a claim that the user's old machine can be reconstructed from one JSON.

## Desktop usage

Settings → **存储配置迁移清单** → **导出无密钥清单**.

This creates a versioned JSON file with:
- provider type and user-visible display name
- bucket, region and root, where present
- repository owner, repo and branch, where present
- `private_requested` intent for S3 and R2 (not proof of ACL/privacy)

The export intentionally omits:
- cloud Endpoint, public URL and arbitrary config_json: these URLs could embed
  bearer tokens or signatures
- credential_ref, actual Access Keys, Gitee/GitHub tokens, WebDAV passwords
- local API token, AI secrets, plugin settings/permissions
- SQLite DB, asset records, images, deployment status, workflow definitions,
  upload history, task history or the remote cloud objects themselves

No existing file is overwritten: choose a new `.json` filename.

Settings → **导入前检查** validates the schema v1 format, disallows unknown
fields (including any unexpectedly embedded credentials), limits file size
to 1 MiB and records to 1000, and displays a read-only inventory.

**The inspect action does not write or restore anything**, and cannot change
existing SQLite or credential store data.

## Security principles and future stages

1. All output fields are generated from a fixed allowlist rather than
   dumping `StorageRecord.config_json`. It is still a file containing metadata
   chosen by the user, so they should review what is shared.
2. `credentialRebindRequired=true` is mandatory, not an optional UI hint.
3. Restoration must not merge, replace, or relink records until explicit
   per-storage approval and fresh credentials have been entered locally.
4. After per-storage rebind is implemented, each profile needs a connection
   preflight, explicit mapping to new local IDs, and a conflict preview.
5. Asset indexes, workflow/group references and cryptographically safe
   secrets backup need **separate** designs and a rollback strategy.
6. Real Windows manual acceptance is deferred to the end at the owner's
   request. Normal CI only checks source/compilation/contract behavior.

## Validation coverage

The Rust test asserts an injected credential reference, arbitrary password,
token, public URL and signed Endpoint are absent from exported fields, and
rejects an extra `secretAccessKey` field on inspection. It also refuses
a `private_requested` declaration on unsupported non-S3 provider types.

## v2 mapping-aware export (phase P1)

New exports are schema version **2** and add `sourceStorageId` (UUID) for each storage
to allow explicit source-to-destination mapping. This is a local record identifier,
**not** an access token or permission proof. The source UUID must never be inserted as
the new database primary key.

The inspector also accepts version **1** manifests without IDs. v1 cannot produce an
auditable old-to-new mapping; upgrade by re-exporting from the old machine. v2
requires a parseable and unique UUID per profile. Extra fields remain forbidden.

A separate manual **ID mapping receipt** (schema version 1) records only
`sourceManifestExportedAt`, `generatedAt`, and the
`{oldStorageId,newStorageId,providerKey}` pairs collected after successful
reconnections. The backend checks the new ID exists and belongs to the claimed
Provider before writing, and never overwrites an existing file. Mappings live
only in the Settings page session until explicitly exported; this receipt is an
audit input for future reference-restoration work, not a completed restore.
