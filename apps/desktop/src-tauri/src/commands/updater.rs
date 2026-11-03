use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use tokio::io::AsyncReadExt;

use super::CmdResult;
use crate::AppState;
use crate::update_security::{
    self, MANIFEST_NAME, MAX_MANIFEST_BYTES, MAX_SETUP_BYTES, SIGNATURE_NAME, UpdateManifest,
};

/// Where the last completed check is cached, and how long it stays answerable without a network
/// round trip. A separate key from every other settings value: `set` replaces whole values, so a
/// cache that shares a preference's row would be erased by the next unrelated save.
const UPDATE_CACHE_KEY: &str = "update.lastCheck";
pub const UPDATE_CACHE_MAX_AGE_HOURS: i64 = 24;

/// The repository updates come from, by its *current* slug. GitHub 301-redirects the pre-rename
/// path, but a redirect only survives until someone renames again - and an updater that follows it
/// into emptiness fails silently on every user's machine. `project_state.py --verify` pins this
/// value to the live API `full_name`; a mismatch goes red at gate time rather than at update time.
const UPDATE_REPO: &str = "159357yangjun/Mirror_Cloud";
const SETUP_ASSET_SUFFIX: &str = "-windows-x64-setup.exe";
const CONTROLLED_DIR_NAME: &str = "mirror-updates";

/// Backend-owned record of a verified download (G1 trust boundary): the frontend
/// only ever sees the opaque id. install_update re-reads this map, canonicalizes
/// the path, confirms it still lives under %TEMP%\mirror-updates and recomputes the
/// SHA256 from disk before spawning anything.
pub type PendingUpdates = Arc<Mutex<HashMap<String, DownloadedUpdate>>>;

pub fn new_pending_store() -> PendingUpdates {
    Arc::new(Mutex::new(HashMap::new()))
}

fn controlled_dir() -> std::path::PathBuf {
    std::env::temp_dir().join(CONTROLLED_DIR_NAME)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedUpdateSummary {
    pub update_id: String,
    pub version: String,
    pub file_name: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_notes: String,
    pub setup_url: String,
    pub setup_bytes: u64,
    pub published_at: String,
}

/// Strict-enough semver for this repo's tags: `v?MAJOR.MINOR.PATCH`, numeric only.
/// Anything else compares as "unknown" and never claims an update.
pub fn version_is_newer(current: &str, candidate: &str) -> bool {
    match (
        update_security::parse_version(current.trim_start_matches('v')),
        update_security::parse_version(candidate.trim_start_matches('v')),
    ) {
        (Some(c), Some(n)) => n > c,
        _ => false,
    }
}

fn client() -> CmdResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .https_only(true)
        .user_agent("Mirror-Cloud-Updater/2.0")
        .build()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn check_for_updates(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> CmdResult<UpdateCheckResult> {
    let current_version = app.package_info().version.to_string();
    // Public signed assets avoid GitHub's unauthenticated API quota.
    let (manifest, _, _) = fetch_manifest(&client()?, None).await?;
    let result = UpdateCheckResult {
        latest_version: manifest.version.clone(),
        update_available: version_is_newer(&current_version, &manifest.version),
        current_version,
        release_notes: "此更新已通过发布签名验证。发行说明请查看官方 Release。".into(),
        setup_url: asset_url(&manifest.version, &manifest.asset_name),
        setup_bytes: manifest.bytes,
        published_at: String::new(),
    };
    // Best-effort by design: a check that got a real answer must not report failure because the
    // cache row could not be written - the caller already has their answer.
    if let Err(error) = state
        .settings
        .set(
            UPDATE_CACHE_KEY,
            &json!({ "protocol": 2, "checkedAt": Utc::now().to_rfc3339(), "result": result }),
        )
        .await
    {
        tracing::warn!(%error, "could not cache the update check result");
    }
    Ok(result)
}

/// The cached outcome of the last completed check, with no network access at all.
///
/// This is what lets startup decide "is there a newer version" without every launch costing a
/// request: fresh answers are served from the row `check_for_updates` writes, and an absent or
/// malformed one simply reports "nothing known" rather than guessing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusView {
    pub checked_at: Option<String>,
    pub fresh: bool,
    pub result: Option<UpdateCheckResult>,
}

#[tauri::command]
pub async fn get_update_status(state: tauri::State<'_, AppState>) -> CmdResult<UpdateStatusView> {
    Ok(read_update_cache(&state).await)
}

/// Whether a stored cache row is inside the freshness window. Split from `read_update_cache` so the
/// clock rule - which has one dangerous direction (a future timestamp reading as fresh forever) -
/// is testable without a database or a settings repository.
fn cache_is_fresh(checked_at: Option<&str>, now: DateTime<Utc>) -> bool {
    let Some(parsed) = checked_at
        .and_then(|text| DateTime::parse_from_rfc3339(text).ok())
        .map(|when| when.with_timezone(&Utc))
    else {
        return false;
    };
    let age = now.signed_duration_since(parsed);
    // A record dated ahead of our own clock (NTP jump, timezone mishandling) must not read as
    // "fresh forever"; ages below zero re-check instead. `num_seconds() < 0` is chrono's real
    // predicate here - TimeDelta has no `negative()` method, which CI caught and this box cannot.
    age.num_seconds() >= 0 && age < Duration::hours(UPDATE_CACHE_MAX_AGE_HOURS)
}

async fn read_update_cache(state: &AppState) -> UpdateStatusView {
    let stored = state.settings.get(UPDATE_CACHE_KEY).await.ok().flatten();
    let empty = || UpdateStatusView {
        checked_at: None,
        fresh: false,
        result: None,
    };
    let Some(value) = stored else { return empty() };
    let Some(record) = value.as_object() else {
        return empty();
    };
    if record.get("protocol").and_then(serde_json::Value::as_u64) != Some(2) {
        return empty();
    }
    let checked_at = record
        .get("checkedAt")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    // An unparseable timestamp cannot prove freshness; the payload is withheld and the caller
    // re-checks rather than trusting an undated claim about versions.
    let fresh = cache_is_fresh(checked_at.as_deref(), Utc::now());
    let result = record
        .get("result")
        .and_then(|value| serde_json::from_value::<UpdateCheckResult>(value.clone()).ok())
        .filter(|_| fresh);
    UpdateStatusView {
        checked_at,
        fresh,
        result,
    }
}

#[derive(Debug, Clone)]
pub struct DownloadedUpdate {
    pub installer_path: String,
    pub bytes: u64,
    pub manifest: Vec<u8>,
    pub signature: String,
}

fn asset_url(version: &str, name: &str) -> String {
    format!("https://github.com/{UPDATE_REPO}/releases/download/v{version}/{name}")
}

async fn read_bounded(mut response: reqwest::Response, limit: usize) -> CmdResult<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|len| len > limit as u64)
    {
        return Err("更新下载内容超过大小上限".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "更新下载中断，请重试")? {
        if chunk.len() > limit.saturating_sub(body.len()) {
            return Err("更新下载内容超过大小上限".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

async fn fetch_manifest(
    client: &reqwest::Client,
    version: Option<&str>,
) -> CmdResult<(UpdateManifest, Vec<u8>, String)> {
    let key = update_security::trusted_key()?;
    let base = match version {
        Some(version) => {
            if update_security::parse_version(version).is_none() {
                return Err("更新版本格式无效".into());
            }
            format!("https://github.com/{UPDATE_REPO}/releases/download/v{version}")
        }
        None => format!("https://github.com/{UPDATE_REPO}/releases/latest/download"),
    };
    let raw = read_bounded(
        client
            .get(format!("{base}/{MANIFEST_NAME}"))
            .send()
            .await
            .map_err(|_| "获取更新清单失败，请检查网络或代理")?
            .error_for_status()
            .map_err(|_| "该发行版未提供签名更新清单，请从官方 Release 手动升级")?,
        MAX_MANIFEST_BYTES,
    )
    .await?;
    let signature = read_bounded(
        client
            .get(format!("{base}/{SIGNATURE_NAME}"))
            .send()
            .await
            .map_err(|_| "获取更新签名失败")?
            .error_for_status()
            .map_err(|_| "发行版缺少更新签名，已拒绝")?,
        256,
    )
    .await?;
    let signature = String::from_utf8(signature).map_err(|_| "更新签名格式无效")?;
    let manifest = update_security::verify_manifest(&raw, &signature, &key)?;
    if version.is_some_and(|version| version != manifest.version) {
        return Err("签名清单与请求的版本不符".into());
    }
    Ok((manifest, raw, signature))
}

#[tauri::command]
pub async fn download_update(
    check: UpdateCheckResult,
    pending: tauri::State<'_, PendingUpdates>,
) -> CmdResult<DownloadedUpdateSummary> {
    if !cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        return Err("此更新安装包仅支持 Windows x64".into());
    }
    let client = client()?;
    let (manifest, raw_manifest, signature) =
        fetch_manifest(&client, Some(&check.latest_version)).await?;
    manifest.require_newer(env!("CARGO_PKG_VERSION"))?;
    let setup_url = asset_url(&manifest.version, &manifest.asset_name);
    // IPC fields are not authority; the signed record defines URL and size.
    if !check.update_available
        || check.setup_url != setup_url
        || check.setup_bytes != manifest.bytes
        || !manifest.asset_name.ends_with(SETUP_ASSET_SUFFIX)
    {
        return Err("更新请求与签名清单不符，请重新检查更新".into());
    }
    let file_name = manifest.asset_name.clone();
    let stream = client
        .get(&setup_url)
        .send()
        .await
        .map_err(|_| "下载安装包失败，请检查网络或代理")?
        .error_for_status()
        .map_err(|_| "安装包下载被拒绝")?;
    let body = read_bounded(stream, MAX_SETUP_BYTES as usize).await?;
    manifest.verify_body(&body)?;
    let actual = format!("{:x}", Sha256::digest(&body));

    let dir = controlled_dir().join(uuid::Uuid::new_v4().to_string());
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|error| format!("无法创建更新临时目录: {error}"))?;
    let path = dir.join(&file_name);
    tokio::fs::write(&path, &body)
        .await
        .map_err(|error| format!("无法写入安装包: {error}"))?;

    let canonical = tokio::fs::canonicalize(&path)
        .await
        .map_err(|error| format!("无法解析安装包绝对路径: {error}"))?;
    let update_id = uuid::Uuid::new_v4().to_string();
    pending
        .lock()
        .map_err(|_| "更新状态锁毒化".to_string())?
        .insert(
            update_id.clone(),
            DownloadedUpdate {
                installer_path: canonical.to_string_lossy().into_owned(),
                bytes: body.len() as u64,
                manifest: raw_manifest,
                signature,
            },
        );
    Ok(DownloadedUpdateSummary {
        update_id,
        version: check.latest_version,
        file_name,
        bytes: body.len() as u64,
        sha256: actual,
    })
}

#[tauri::command]
pub async fn install_update(
    update_id: String,
    pending: tauri::State<'_, PendingUpdates>,
    app: tauri::AppHandle,
) -> CmdResult<()> {
    if !cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        return Err("此更新安装包仅支持 Windows x64".into());
    }
    let record = pending
        .lock()
        .map_err(|_| "更新状态锁毒化".to_string())?
        .get(&update_id)
        .cloned()
        .ok_or("未知或已过期的更新句柄，请重新下载")?;
    let canonical = verify_install_candidate(
        &record,
        &controlled_dir(),
        &update_security::trusted_key()?,
        env!("CARGO_PKG_VERSION"),
    )
    .await?;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        std::process::Command::new(&canonical)
            .args(["/S", "/NS"])
            .creation_flags(CREATE_NEW_PROCESS_GROUP)
            .spawn()
            .map_err(|error| format!("无法启动安装器: {error}"))?;
    }
    #[cfg(not(target_os = "windows"))]
    let _ = canonical;
    app.exit(0);
    Ok(())
}

async fn verify_install_candidate(
    record: &DownloadedUpdate,
    root: &std::path::Path,
    public_key: &[u8],
    current_version: &str,
) -> CmdResult<std::path::PathBuf> {
    let path = std::path::PathBuf::from(&record.installer_path);
    let canonical = tokio::fs::canonicalize(&path)
        .await
        .map_err(|error| format!("安装包已不在临时目录，请重新下载: {error}"))?;
    let root = tokio::fs::canonicalize(root)
        .await
        .map_err(|_| "受控更新目录不可用")?;
    if canonical.parent().and_then(|parent| parent.parent()) != Some(root.as_path()) {
        return Err("安装包路径不在受控更新目录，已拒绝".into());
    }
    let manifest =
        update_security::verify_manifest(&record.manifest, &record.signature, public_key)?;
    manifest.require_newer(current_version)?;
    if canonical.file_name().and_then(|name| name.to_str()) != Some(manifest.asset_name.as_str()) {
        return Err("安装文件名与签名清单不符".into());
    }
    if tokio::fs::metadata(&canonical)
        .await
        .map_err(|_| "安装包不可读")?
        .len()
        > MAX_SETUP_BYTES
    {
        return Err("安装包超过大小上限".into());
    }
    let file = tokio::fs::File::open(&canonical)
        .await
        .map_err(|_| "无法重读安装包")?;
    let mut bytes = Vec::new();
    file.take(MAX_SETUP_BYTES + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| "无法重读安装包")?;
    if bytes.len() as u64 != record.bytes {
        return Err(format!(
            "安装包字节数与下载时不符（现在 {} B，登记 {} B）",
            bytes.len(),
            record.bytes
        ));
    }
    let recomputed = format!("{:x}", Sha256::digest(&bytes));
    if bytes.len() as u64 != manifest.bytes || recomputed != manifest.sha256 {
        return Err(format!(
            "安装前复核 sha256 不一致（期望 {}，实际 {}），已拒绝",
            manifest.sha256, recomputed
        ));
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn preinstall_guard_rechecks_real_disk_bytes_signature_version_and_confinement() {
        use ring::signature::{Ed25519KeyPair, KeyPair};
        let key = Ed25519KeyPair::from_seed_unchecked(&[7; 32]).unwrap();
        let root =
            std::env::temp_dir().join(format!("mirror-update-test-{}", uuid::Uuid::new_v4()));
        let dir = root.join("download");
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let body = b"fixture installer, never executable";
        let manifest = UpdateManifest {
            schema_version: 1,
            version: "2.0.0".into(),
            target: update_security::TARGET.into(),
            asset_name: "image-hosting-platform-v2.0.0-windows-x64-setup.exe".into(),
            bytes: body.len() as u64,
            sha256: format!("{:x}", Sha256::digest(body)),
        };
        let path = dir.join(&manifest.asset_name);
        tokio::fs::write(&path, body).await.unwrap();
        let raw = serde_json::to_vec(&manifest).unwrap();
        let record = DownloadedUpdate {
            installer_path: path.to_string_lossy().into_owned(),
            bytes: body.len() as u64,
            signature: hex::encode(key.sign(&raw)),
            manifest: raw,
        };
        let public = key.public_key().as_ref();
        assert!(
            verify_install_candidate(&record, &root, public, "1.4.11")
                .await
                .is_ok()
        );
        assert!(
            verify_install_candidate(&record, &root, public, "2.0.0")
                .await
                .is_err()
        );
        assert!(
            verify_install_candidate(&record, &dir, public, "1.4.11")
                .await
                .is_err()
        );
        let mut wrong_signature = record.clone();
        wrong_signature.signature = "00".repeat(64);
        assert!(
            verify_install_candidate(&wrong_signature, &root, public, "1.4.11")
                .await
                .is_err()
        );
        let mut changed = body.to_vec();
        changed[0] ^= 1;
        tokio::fs::write(&path, &changed).await.unwrap();
        assert!(
            verify_install_candidate(&record, &root, public, "1.4.11")
                .await
                .is_err()
        );
        tokio::fs::write(&path, &body[..body.len() - 1])
            .await
            .unwrap();
        assert!(
            verify_install_candidate(&record, &root, public, "1.4.11")
                .await
                .is_err()
        );
        tokio::fs::remove_dir_all(&root).await.unwrap();
    }

    #[tokio::test]
    async fn chunked_download_is_bounded_even_without_content_length() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = [0; 2048];
                stream.read(&mut request).await.unwrap();
                stream.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n4\r\n1234\r\n4\r\n5678\r\n0\r\n\r\n").await.unwrap();
            }
        });
        // This local transport fixture uses a separate client; production still requires HTTPS.
        let test_client = reqwest::Client::builder().no_proxy().build().unwrap();
        let response = test_client
            .get(format!("http://{addr}"))
            .send()
            .await
            .unwrap();
        assert!(read_bounded(response, 7).await.is_err());
        let response = test_client
            .get(format!("http://{addr}"))
            .send()
            .await
            .unwrap();
        assert_eq!(read_bounded(response, 8).await.unwrap(), b"12345678");
        server.await.unwrap();
    }

    fn stamp(minutes_ago: i64) -> String {
        (Utc::now() - Duration::minutes(minutes_ago)).to_rfc3339()
    }

    #[test]
    fn a_check_inside_the_window_is_fresh_and_one_outside_is_not() {
        assert!(cache_is_fresh(Some(&stamp(5)), Utc::now()));
        assert!(cache_is_fresh(Some(&stamp(23 * 60)), Utc::now()));
        assert!(
            !cache_is_fresh(Some(&stamp(25 * 60)), Utc::now()),
            "a day-old answer must not suppress the re-check"
        );
    }

    #[test]
    fn an_unreadable_or_future_timestamp_never_reads_as_fresh() {
        assert!(!cache_is_fresh(None, Utc::now()));
        assert!(!cache_is_fresh(Some("not a timestamp"), Utc::now()));
        // The dangerous direction: a record dated ahead of our clock would age negative and, if
        // only `< max_age` were checked, stay "fresh" forever without another request.
        let future = (Utc::now() + Duration::hours(2)).to_rfc3339();
        assert!(!cache_is_fresh(Some(&future), Utc::now()));
    }

    #[test]
    fn the_cache_key_is_its_own_row_and_the_window_is_a_day() {
        // Shared with the settings-replacement argument: `set` overwrites whole values, so this key
        // must never live inside another preference's JSON.
        assert_eq!(UPDATE_CACHE_KEY, "update.lastCheck");
        assert_eq!(UPDATE_CACHE_MAX_AGE_HOURS, 24);
    }
}
