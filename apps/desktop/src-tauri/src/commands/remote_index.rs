use std::collections::{HashSet, VecDeque};

use super::*;
use domain::scan_completeness::{ScanCompleteness, ScanObservation};
use persistence_sqlite::remote_scan::{RemoteScanRecord, insert_scan, insert_scan_entries};

const MAX_REMOTE_FILES_PER_STORAGE: usize = 2_000;
const MAX_REMOTE_DIRECTORIES_PER_STORAGE: usize = 1_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteIndexSyncView {
    pub storages_scanned: usize,
    pub files_scanned: usize,
    pub imported: usize,
    pub skipped_existing: usize,
    pub skipped_non_images: usize,
    pub errors: Vec<String>,
    /// Per-storage verdicts, newest sweep persisted in `remote_scans`.
    ///
    /// A list rather than one aggregate level because completeness is per storage: a second
    /// account that walked cleanly is not made unreliable by the first one's failed read, and
    /// collapsing them would let one bad credential mark every library as untrustworthy.
    pub scans: Vec<ScanOutcomeView>,
}

/// One storage's sweep result, as the UI sees it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOutcomeView {
    pub storage_id: String,
    pub storage_name: String,
    pub completeness: &'static str,
    pub stop_reason: &'static str,
    pub directories_listed: i64,
    pub entries_seen: i64,
    pub truncated_dirs: i64,
    pub error_count: i64,
}

fn remote_image_mime(path: &str) -> Option<&'static str> {
    let extension = path
        .split('?')
        .next()
        .unwrap_or(path)
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())?;
    match extension.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "bmp" => Some("image/bmp"),
        "avif" => Some("image/avif"),
        "svg" => Some("image/svg+xml"),
        "ico" => Some("image/x-icon"),
        _ => None,
    }
}

fn normalize_index_path(path: &str) -> String {
    path.trim().replace('\\', "/").trim_matches('/').to_string()
}

/// Whether a directory listing came back at exactly the provider's ceiling.
///
/// Reaching the cap is the only signal the Contents API gives: it returns the first N entries in
/// ordering and omits the rest without a flag or a cursor. Equality (not `>=`) because a listing
/// longer than the stated ceiling means the adapter's constant is wrong, which is a different bug
/// than truncation and must not be papered over here.
fn listing_hit_page_limit(count: usize, limit: Option<usize>) -> bool {
    limit.is_some_and(|ceiling| count == ceiling)
}

#[tauri::command]
pub async fn sync_storage_asset_index(
    state: State<'_, AppState>,
    storage_id: Option<String>,
) -> CmdResult<RemoteIndexSyncView> {
    let storages = if let Some(storage_id) = storage_id {
        let id = Uuid::parse_str(&storage_id).map_err(|error| error.to_string())?;
        vec![
            state
                .storages
                .get(id)
                .await
                .map_err(|error| error.to_string())?
                .ok_or("Storage not found")?,
        ]
    } else {
        state
            .storages
            .list()
            .await
            .map_err(|error| error.to_string())?
            .into_iter()
            .filter(|storage| storage.enabled)
            .collect()
    };

    let mut summary = RemoteIndexSyncView {
        storages_scanned: 0,
        files_scanned: 0,
        imported: 0,
        skipped_existing: 0,
        skipped_non_images: 0,
        errors: Vec::new(),
        scans: Vec::new(),
    };

    for storage in storages {
        summary.storages_scanned += 1;
        let provider = match build_provider(&state, &storage) {
            Ok(provider) => provider,
            Err(error) => {
                summary.errors.push(format!("{}：{error}", storage.name));
                continue;
            }
        };
        if !provider.capabilities().list {
            summary.errors.push(format!(
                "{}：当前 Provider 不支持列出远端文件",
                storage.name
            ));
            continue;
        }
        sync_one_storage(&state, &storage, &provider, &mut summary).await;
    }

    Ok(summary)
}

/// Walk one storage's remote listing and import what is new locally.
///
/// Split out of the command so the background scheduler can run the same walk with a provider it
/// already resolved. The command keeps the parts that only make sense for an explicit request:
/// resolving storages, building providers, reporting a capability refusal, and returning errors to
/// the caller. This function reports into `summary` and never fails: by the time we are
/// walking, a partial import is better than no import, and every problem is already in `errors`.
pub(crate) async fn sync_one_storage(
    state: &AppState,
    storage: &StorageRecord,
    provider: &std::sync::Arc<dyn StorageProvider>,
    summary: &mut RemoteIndexSyncView,
) {
    let started_at = Utc::now();
    // Every exit from this iteration - including the `continue` paths below - has to land a
    // row, so the counters start outside the branches rather than inside the walk.
    let mut observation = ScanObservation::new();
    // Every file the walk saw. Capped at what the sweep actually browsed: storing more than we
    // looked at would hand reconciliation a listing wider than the scan that qualified it.
    let mut listed_paths: Vec<String> = Vec::new();

    let page_limit = provider.listing_page_limit();
    let mut pending_dirs = VecDeque::from([String::new()]);
    let mut seen_dirs = HashSet::new();
    let mut seen_files = HashSet::new();
    let mut storage_files_scanned = 0usize;
    let mut hit_file_limit = false;

    while let Some(directory) = pending_dirs.pop_front() {
        if !seen_dirs.insert(directory.clone()) {
            continue;
        }
        if seen_dirs.len() > MAX_REMOTE_DIRECTORIES_PER_STORAGE {
            summary.errors.push(format!(
                "{}：目录数量超过 {}，本次同步已停止继续深入",
                storage.name, MAX_REMOTE_DIRECTORIES_PER_STORAGE
            ));
            observation.directory_budget_exhausted();
            break;
        }

        let entries = match provider.list(&directory).await {
            Ok(entries) => entries,
            Err(error) => {
                let display_path = if directory.is_empty() {
                    "/".to_string()
                } else {
                    format!("/{directory}")
                };
                summary.errors.push(format!(
                    "{} {}：读取失败：{error}",
                    storage.name, display_path
                ));
                observation.record_read_failure();
                continue;
            }
        };

        observation.record_directory_listed();
        observation.record_entries_seen(entries.len() as i64);
        if listing_hit_page_limit(entries.len(), page_limit) {
            observation.record_api_truncation();
            // Only reachable when `page_limit` is Some: the predicate is false for None, so
            // the unwrap below can never print a ceiling of zero.
            summary.errors.push(format!(
                "{}：单次列目录达到上限 {}，该目录可能还有未返回的条目",
                storage.name,
                page_limit.unwrap_or_default()
            ));
        }

        for entry in entries {
            let remote_path = normalize_index_path(&entry.path);
            if remote_path.is_empty() {
                continue;
            }
            if entry.is_dir {
                if !seen_dirs.contains(&remote_path) {
                    pending_dirs.push_back(remote_path);
                }
                continue;
            }
            if !seen_files.insert(remote_path.clone()) {
                continue;
            }
            listed_paths.push(remote_path.clone());

            storage_files_scanned += 1;
            summary.files_scanned += 1;
            if storage_files_scanned > MAX_REMOTE_FILES_PER_STORAGE {
                summary.errors.push(format!(
                    "{}：文件数量超过 {}，为避免首次同步过载，本次已停止；可整理目录后再次同步",
                    storage.name, MAX_REMOTE_FILES_PER_STORAGE
                ));
                observation.file_budget_exhausted();
                hit_file_limit = true;
                break;
            }

            let Some(mime_type) = remote_image_mime(&remote_path) else {
                summary.skipped_non_images += 1;
                continue;
            };

            match state
                .assets
                .deployment_ids_for_remote(storage.id, &remote_path)
                .await
            {
                Ok(existing) if !existing.is_empty() => {
                    summary.skipped_existing += 1;
                    continue;
                }
                Ok(_) => {}
                // A lookup failure is about our own database, not about what the remote
                // contains, so it is reported but does not downgrade completeness: nothing was
                // left unobserved on the provider side.
                Err(error) => {
                    summary.errors.push(format!(
                        "{} /{}：查询已有索引失败：{error}",
                        storage.name, remote_path
                    ));
                    continue;
                }
            }

            let now = Utc::now();
            let asset = Asset {
                id: Uuid::new_v4(),
                name: entry.name.clone(),
                kind: AssetKind::Image,
                created_at: now,
                updated_at: now,
            };
            let synthetic_hash = format!(
                "remote-index:{}",
                hex::encode(Sha256::digest(
                    format!("{}:{remote_path}", storage.id).as_bytes()
                ))
            );
            let variant = AssetVariant {
                id: Uuid::new_v4(),
                asset_id: asset.id,
                label: "remote_index".into(),
                mime_type: mime_type.into(),
                size_bytes: entry.size_bytes.unwrap_or(0),
                width: None,
                height: None,
                content_hash: synthetic_hash,
                created_at: now,
            };
            let deployment = Deployment {
                id: Uuid::new_v4(),
                variant_id: variant.id,
                storage_id: storage.id,
                role: DeploymentRole::Primary,
                remote_path: remote_path.clone(),
                public_url: entry.public_url.clone(),
                status: DeploymentStatus::Online,
                // Observed in a listing, nothing more: no deployed_at (this build did not
                // upload it) and no last_verified_at (a listing proves presence, not content).
                // Rows of this kind used to look verified after every sync.
                timestamps: domain::DeploymentTimestamps {
                    last_observed_at: Some(now),
                    ..Default::default()
                },
            };

            match state
                .assets
                .insert_published(&asset, &variant, &deployment)
                .await
            {
                Ok(()) => summary.imported += 1,
                Err(error) => summary.errors.push(format!(
                    "{} /{}：写入资源索引失败：{error}",
                    storage.name, remote_path
                )),
            }
        }

        if hit_file_limit {
            break;
        }
    }

    finish_and_report(
        state,
        summary,
        storage,
        started_at,
        &observation,
        &listed_paths,
    )
    .await;
}

/// Closes one storage's sweep: writes the row and pushes the view the caller returns.
///
/// Shared by every exit path so a storage can never be counted in `storages_scanned` without also
/// appearing in `scans`. That invariant is what makes the two lists comparable in the UI; with a
/// separate early-return per branch, one of them would eventually forget a case.
async fn finish_and_report(
    state: &AppState,
    summary: &mut RemoteIndexSyncView,
    storage: &StorageRecord,
    started_at: DateTime<Utc>,
    observation: &ScanObservation,
    listed_paths: &[String],
) {
    let completeness = observation.completeness();
    let stop_reason = observation.stop_reason();
    let finished_at = Utc::now();
    let truncated_dirs = observation.truncated_dirs() as i64;

    let record_id = Uuid::new_v4();
    let record = RemoteScanRecord {
        id: record_id,
        storage_id: storage.id,
        started_at,
        finished_at,
        directories_listed: observation.directories_listed(),
        entries_seen: observation.entries_seen(),
        completeness,
        stop_reason,
        truncated_dirs,
        error_count: observation.read_failure_count(),
    };
    let pool = state.journal.pool();
    // A listing that hit our own file budget is not a set reconciliation may difference: the paths
    // we did collect are real, but storing them would let a later sweep conclude "this path is not
    // remote" from a list we know is short. So only a complete walk's entries reach the database;
    // partial ones stay in this response and the next comparison falls back to probing.
    let store_listing = completeness == ScanCompleteness::Complete;
    if let Err(error) = insert_scan(pool, &record).await {
        tracing::warn!(%error, storage_id = %storage.id, "could not record a remote scan");
    } else if store_listing {
        if let Err(error) = insert_scan_entries(pool, record_id, listed_paths).await {
            tracing::warn!(%error, storage_id = %storage.id, "could not store scan entries");
        }
    } else {
        // Reached when coverage was not Complete: nothing wrong happened, the listing simply must
        // not become a set anyone can difference against.
        tracing::debug!(storage_id = %storage.id, "listing not stored");
    }

    summary.scans.push(ScanOutcomeView {
        storage_id: storage.id.to_string(),
        storage_name: storage.name.clone(),
        completeness: completeness.as_str(),
        stop_reason: stop_reason.as_str(),
        directories_listed: observation.directories_listed(),
        entries_seen: observation.entries_seen(),
        truncated_dirs,
        error_count: observation.read_failure_count(),
    });
}
