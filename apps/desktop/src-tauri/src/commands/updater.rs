use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::CmdResult;

const UPDATE_REPO: &str = "159357yangjun/image-hosting-platform";
const SETUP_ASSET_SUFFIX: &str = "-windows-x64-setup.exe";
const SUMS_ASSET_NAME: &str = "SHA256SUMS.txt";
const MAX_SETUP_BYTES: u64 = 64 * 1024 * 1024;

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

/// Strict-enough semver for this repo's tags: `v?MAJOR.MINOR.PATCH`,
/// numeric only. Anything else compares as "unknown" and never claims an update.
fn parse_version(raw: &str) -> Option<[u64; 3]> {
    let core = raw.trim().trim_start_matches('v');
    let mut parts = core.split('.');
    let a = parts.next()?.parse().ok()?;
    let b = parts.next()?.parse().ok()?;
    let c = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some([a, b, c])
}

pub fn version_is_newer(current: &str, candidate: &str) -> bool {
    match (parse_version(current), parse_version(candidate)) {
        (Some(c), Some(n)) => n > c,
        _ => false,
    }
}

fn client() -> CmdResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .user_agent("Mirror-Cloud-Updater/1.0")
        .build()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn check_for_updates(app: tauri::AppHandle) -> CmdResult<UpdateCheckResult> {
    let current_version = app.package_info().version.to_string();
    let response: serde_json::Value = client()?
        .get(format!("https://api.github.com/repos/{UPDATE_REPO}/releases/latest"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| format!("检查更新失败（网络或代理未开启？）: {error}"))?
        .error_for_status()
        .map_err(|error| format!("更新服务拒绝请求: {error}"))?
        .json()
        .await
        .map_err(|error| format!("更新服务返回了无法解析的内容: {error}"))?;

    let tag = response
        .get("tag_name")
        .and_then(serde_json::Value::as_str)
        .ok_or("更新响应缺少 tag_name")?;
    let assets = response
        .get("assets")
        .and_then(serde_json::Value::as_array)
        .ok_or("更新响应缺少 assets")?;

    // Exactly one setup asset or the whole thing is refused - picking "the first download URL"
    // would happily grab an msi or a source zip.
    let setup_candidates: Vec<&serde_json::Value> = assets
        .iter()
        .filter(|a| {
            a.get("name")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|n| n.ends_with(SETUP_ASSET_SUFFIX))
        })
        .collect();
    if setup_candidates.len() != 1 {
        return Err(format!(
            "最新发行版里的安装资产数量异常（期望 1 个 setup.exe，实际 {}）",
            setup_candidates.len()
        ));
    }
    let setup = setup_candidates[0];
    let setup_bytes = setup
        .get("size")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    if setup_bytes == 0 || setup_bytes > MAX_SETUP_BYTES {
        return Err(format!("安装包大小不合理: {setup_bytes} B"));
    }
    let setup_url = setup["browser_download_url"]
        .as_str()
        .ok_or("安装包缺少下载地址")?
        .to_string();

    Ok(UpdateCheckResult {
        latest_version: tag.trim_start_matches('v').to_string(),
        update_available: version_is_newer(&current_version, tag),
        current_version,
        release_notes: response["body"]
            .as_str()
            .unwrap_or_default()
            .chars()
            .take(2000)
            .collect(),
        setup_url,
        setup_bytes,
        published_at: response["published_at"].as_str().unwrap_or_default().to_string(),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedUpdate {
    pub installer_path: String,
    pub expected_sha256: String,
    pub actual_sha256: String,
    pub verified: bool,
    pub bytes: u64,
}

/// 103 columns joined would be rustfmt-reformatted; ac54483's own green
/// lines show the limit is width-after-joining, so this condition stays
/// deliberately split.
fn parse_sums(text: &str, wanted_name: &str) -> Option<String> {
    for line in text.lines() {
        let mut fields = line.split_whitespace();
        if let (Some(hash), Some(name)) = (fields.next(), fields.next()) {
            // Split form is what rustfmt 1.98 emits: joined this condition
            // is 100 columns.
            if name == wanted_name
                && hash.len() == 64
                && hash.bytes().all(|b| b.is_ascii_hexdigit())
            {
                return Some(hash.to_ascii_lowercase());
            }
        }
    }
    None
}

#[tauri::command]
pub async fn download_update(check: UpdateCheckResult) -> CmdResult<DownloadedUpdate> {
    if !check.update_available {
        return Err("当前没有可用的更新".into());
    }
    let file_name = std::path::Path::new(&check.setup_url)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| n.ends_with(SETUP_ASSET_SUFFIX))
        .ok_or("下载地址的文件名不是 setup.exe，已拒绝")?
        .to_string();
    let sums_url = format!(
        "https://github.com/{UPDATE_REPO}/releases/download/v{}/{SUMS_ASSET_NAME}",
        check.latest_version
    );
    let client = client()?;
    let sums = client
        .get(&sums_url)
        .send()
        .await
        .map_err(|error| format!("下载校验清单失败: {error}"))?
        .error_for_status()
        .map_err(|error| format!("校验清单被拒绝: {error}"))?
        .text()
        .await
        .map_err(|error| format!("校验清单读取失败: {error}"))?;
    let expected = parse_sums(&sums, &file_name)
        .ok_or_else(|| format!("校验清单里没有 {file_name} 这一行，已拒绝"))?;

    let stream = client
        .get(&check.setup_url)
        .send()
        .await
        .map_err(|error| format!("下载安装包失败（网络或代理未开启？）: {error}"))?
        .error_for_status()
        .map_err(|error| format!("安装包下载被拒绝: {error}"))?;
    if let Some(len) = stream.content_length() {
        if len > MAX_SETUP_BYTES {
            return Err(format!("安装包超过上限: {len} B"));
        }
    }
    let body = stream
        .bytes()
        .await
        .map_err(|error| format!("安装包下载中断: {error}"))?;
    if body.len() as u64 != check.setup_bytes {
        return Err(format!(
            "安装包字节数与发行页不符（下载 {} B，声明 {} B）",
            body.len(),
            check.setup_bytes
        ));
    }
    let actual = format!("{:x}", Sha256::digest(&body));

    let dir = std::env::temp_dir().join("mirror-updates");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|error| format!("无法创建更新临时目录: {error}"))?;
    let path = dir.join(&file_name);
    tokio::fs::write(&path, &body)
        .await
        .map_err(|error| format!("无法写入安装包: {error}"))?;

    let verified = actual == expected;
    if !verified {
        let _ = tokio::fs::remove_file(&path).await;
        return Err(format!(
            "sha256 校验不一致，安装包已删除（期望 {expected}，实际 {actual}）"
        ));
    }
    Ok(DownloadedUpdate {
        installer_path: path.to_string_lossy().into_owned(),
        expected_sha256: expected,
        actual_sha256: actual,
        verified,
        bytes: body.len() as u64,
    })
}

#[tauri::command]
pub async fn install_update(update: DownloadedUpdate, app: tauri::AppHandle) -> CmdResult<()> {
    if !update.verified || update.expected_sha256 != update.actual_sha256 {
        return Err("未通过校验的安装包不允许安装".into());
    }
    let path = std::path::PathBuf::from(&update.installer_path);
    if !tokio::fs::try_exists(&path).await.unwrap_or(false) {
        return Err("安装包已不在临时目录，请重新下载".into());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        std::process::Command::new(&path)
            .args(["/S", "/NS"])
            .creation_flags(CREATE_NEW_PROCESS_GROUP)
            .spawn()
            .map_err(|error| format!("无法启动安装器: {error}"))?;
    }
    app.exit(0);
    Ok(())
}
