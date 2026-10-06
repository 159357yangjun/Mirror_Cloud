use async_trait::async_trait;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use domain::StorageCapabilities;
use reqwest::{
    Client, Response, StatusCode, Url,
    header::{ACCEPT, USER_AGENT},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use storage_core::{
    ConnectionReport, StorageEntry, StorageError, StorageProvider, UploadRequest, UploadResult,
    VerificationOutcome,
};

const API_ROOT: &str = "https://api.github.com/";
const UPLOAD_MAX_ATTEMPTS: usize = 3;
/// Hard ceiling on the entries one GitHub Contents API directory read can return.
///
/// Declared here rather than inlined at the override so the `list` test below can assert against
/// the same number the scanner consumes: a literal in two places is a constant that can drift.
const CONTENTS_PAGE_LIMIT: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubStorageConfig {
    pub owner: String,
    pub repo: String,
    pub branch: String,
    #[serde(default)]
    pub root: String,
    pub public_base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubCredentials {
    pub token: String,
}

pub struct GitHubStorage {
    client: Client,
    config: GitHubStorageConfig,
    credentials: GitHubCredentials,
}

impl GitHubStorage {
    pub fn new(config: GitHubStorageConfig, credentials: GitHubCredentials) -> Self {
        Self {
            client: Client::new(),
            config,
            credentials,
        }
    }

    fn api_url(&self, tail: &[&str]) -> Result<Url, StorageError> {
        let mut url = Url::parse(API_ROOT).map_err(|e| StorageError::Provider(e.to_string()))?;
        {
            let mut segments = url
                .path_segments_mut()
                .map_err(|_| StorageError::Provider("invalid GitHub API root".into()))?;
            for segment in tail {
                segments.push(segment);
            }
        }
        Ok(url)
    }

    fn contents_url(&self, path: &str) -> Result<Url, StorageError> {
        let mut url =
            self.api_url(&["repos", &self.config.owner, &self.config.repo, "contents"])?;
        {
            let mut segments = url
                .path_segments_mut()
                .map_err(|_| StorageError::Provider("invalid GitHub contents URL".into()))?;
            for segment in path.split('/').filter(|segment| !segment.is_empty()) {
                segments.push(segment);
            }
        }
        Ok(url)
    }

    fn branch_url(&self) -> Result<Url, StorageError> {
        self.api_url(&[
            "repos",
            &self.config.owner,
            &self.config.repo,
            "branches",
            &self.config.branch,
        ])
    }

    fn repo_url(&self) -> Result<Url, StorageError> {
        self.api_url(&["repos", &self.config.owner, &self.config.repo])
    }

    fn auth(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        request
            .header(USER_AGENT, "image-hosting-platform")
            .header(ACCEPT, "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .bearer_auth(self.credentials.token.trim())
    }

    fn configured_root(&self) -> &str {
        self.config.root.trim().trim_matches('/')
    }

    fn repository_path(&self, path: &str) -> String {
        let root = self.configured_root();
        let path = path.trim().trim_matches('/');
        match (root.is_empty(), path.is_empty()) {
            (true, true) => String::new(),
            (true, false) => path.to_string(),
            (false, true) => root.to_string(),
            (false, false) => format!("{root}/{path}"),
        }
    }

    fn logical_path(&self, repository_path: &str) -> String {
        let root = self.configured_root();
        let repository_path = repository_path.trim_matches('/');
        if root.is_empty() {
            return repository_path.to_string();
        }
        repository_path
            .strip_prefix(root)
            .unwrap_or(repository_path)
            .trim_start_matches('/')
            .to_string()
    }

    fn custom_public_url(&self, repository_path: &str) -> Option<String> {
        self.config.public_base_url.as_ref().map(|base| {
            format!(
                "{}/{}",
                base.trim_end_matches('/'),
                repository_path.trim_start_matches('/')
            )
        })
    }

    fn canonical_url(value: &str) -> Option<String> {
        Url::parse(value).ok().map(|url| url.to_string())
    }

    fn raw_public_url(&self, repository_path: &str) -> Result<String, StorageError> {
        let mut url = Url::parse("https://raw.githubusercontent.com/")
            .map_err(|e| StorageError::Provider(e.to_string()))?;
        {
            let mut segments = url
                .path_segments_mut()
                .map_err(|_| StorageError::Provider("invalid GitHub raw URL root".into()))?;
            segments.push(&self.config.owner);
            segments.push(&self.config.repo);
            for segment in self
                .config
                .branch
                .split('/')
                .filter(|segment| !segment.is_empty())
            {
                segments.push(segment);
            }
            for segment in repository_path
                .split('/')
                .filter(|segment| !segment.is_empty())
            {
                segments.push(segment);
            }
        }
        Ok(url.to_string())
    }

    async fn response_error(response: Response, context: &str) -> StorageError {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let message = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|value| {
                value
                    .get("message")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| {
                if body.is_empty() {
                    status.to_string()
                } else {
                    body
                }
            });

        if status == StatusCode::UNAUTHORIZED {
            StorageError::Authentication(
                "GitHub Token 无效、已过期或已撤销。请使用 Personal Access Token（推荐 Fine-grained），并为目标仓库授予 Contents: Read and write。".into(),
            )
        } else if status == StatusCode::TOO_MANY_REQUESTS
            || is_secondary_rate_limit(status, &message)
        {
            // GitHub answers throttling with 403 plus a rate-limit sentence instead of 429,
            // so the status alone cannot separate "slow down" from "you lack scope". Filing that
            // as a permission problem sends someone to edit settings that are already correct.
            StorageError::Network(format!("GitHub 限流，稍后会自动重试。GitHub 返回：{message}"))
        } else if status == StatusCode::FORBIDDEN {
            StorageError::Authentication(format!(
                "GitHub 已识别 Token，但拒绝当前操作。请检查仓库授权、Contents: Read and write 权限以及组织 SSO/策略。GitHub 返回：{message}"
            ))
        } else if status == StatusCode::NOT_FOUND {
            // One branch for every 404 now that the kind travels separately. The message still
            // names what was missing; sorting no longer depends on the caller's context string.
            let detail = if context.contains("branch check") {
                "找不到指定 GitHub 分支。请检查分支名（例如 main），并确认 Token 可以访问该仓库。"
            } else if context.contains("repository check") {
                "找不到 GitHub 仓库。请检查 Owner / 仓库名，或确认 Fine-grained Token 已授权这个仓库。"
            } else {
                "GitHub 上找不到该对象。请检查路径与分支是否存在。"
            };
            StorageError::MissingObject(format!("{detail}（{context}）"))
        } else if status == StatusCode::CONFLICT && context.contains("upload") {
            StorageError::Conflict(format!(
                "GitHub 分支在上传期间被其他提交更新，连续重试后仍发生 409 Conflict。请稍后重试；如果正在批量上传，应用会继续避免把一次瞬时并发冲突当成永久失败。GitHub 返回：{message}"
            ))
        } else {
            StorageError::Provider(format!("{context} ({status}): {message}"))
        }
    }

    async fn existing_sha(&self, repository_path: &str) -> Result<Option<String>, StorageError> {
        let response = self
            .auth(self.client.get(self.contents_url(repository_path)?))
            .query(&[("ref", self.config.branch.as_str())])
            .send()
            .await
            .map_err(|e| StorageError::Network(e.to_string()))?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(Self::response_error(response, "GitHub content lookup failed").await);
        }
        let payload: Value = response
            .json()
            .await
            .map_err(|e| StorageError::Provider(e.to_string()))?;
        Ok(payload
            .get("sha")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned))
    }

    async fn root_status_note(&self) -> Result<String, StorageError> {
        let root = self.configured_root();
        if root.is_empty() {
            return Ok("repository root is readable".into());
        }

        let response = self
            .auth(self.client.get(self.contents_url(root)?))
            .query(&[("ref", self.config.branch.as_str())])
            .send()
            .await
            .map_err(|e| StorageError::Network(e.to_string()))?;

        if response.status() == StatusCode::NOT_FOUND {
            return Ok(format!(
                "configured root '{root}' does not exist yet; the first upload will create it"
            ));
        }
        if !response.status().is_success() {
            return Err(Self::response_error(response, "GitHub root browse check failed").await);
        }
        Ok(format!("configured root '{root}' is readable"))
    }

    fn entry_from_value(&self, value: &Value) -> Option<StorageEntry> {
        let name = value.get("name")?.as_str()?.to_string();
        let repository_path = value.get("path")?.as_str()?.to_string();
        let is_dir = value.get("type").and_then(Value::as_str) == Some("dir");
        let public_url = if is_dir {
            None
        } else if let Some(url) = self.custom_public_url(&repository_path) {
            Self::canonical_url(&url).or(Some(url))
        } else {
            value
                .get("download_url")
                .and_then(Value::as_str)
                .and_then(Self::canonical_url)
                .or_else(|| self.raw_public_url(&repository_path).ok())
        };

        Some(StorageEntry {
            name,
            path: self.logical_path(&repository_path),
            is_dir,
            size_bytes: value.get("size").and_then(Value::as_u64),
            public_url,
        })
    }
}

#[async_trait]
impl StorageProvider for GitHubStorage {
    fn provider_key(&self) -> &'static str {
        "github"
    }

    fn listing_page_limit(&self) -> Option<usize> {
        // The Contents API returns at most this many items for one directory and exposes no
        // cursor, so a directory with more entries than this is silently cut off at the head of
        // the alphabetical ordering. `list` above does not paginate - there is nothing to
        // paginate with.
        Some(CONTENTS_PAGE_LIMIT)
    }

    fn capabilities(&self) -> StorageCapabilities {
        StorageCapabilities {
            upload: true,
            download: true,
            delete: true,
            list: true,
            move_object: false,
            public_url: true,
            versioning: true,
            streaming: false,
        }
    }

    async fn test_connection(&self) -> Result<ConnectionReport, StorageError> {
        let repo_response = self
            .auth(self.client.get(self.repo_url()?))
            .send()
            .await
            .map_err(|e| StorageError::Network(e.to_string()))?;
        if !repo_response.status().is_success() {
            return Err(
                Self::response_error(repo_response, "GitHub repository check failed").await,
            );
        }

        let repo: Value = repo_response
            .json()
            .await
            .map_err(|e| StorageError::Provider(e.to_string()))?;
        let is_private = repo
            .get("private")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let can_push = repo
            .pointer("/permissions/push")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        if !can_push {
            return Err(StorageError::Authentication(
                "GitHub Token 可以读取仓库，但没有写权限。Fine-grained Token 请为该仓库授予 Repository permissions → Contents: Read and write。".into(),
            ));
        }

        if is_private
            && self
                .config
                .public_base_url
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_none()
        {
            return Err(StorageError::Provider(
                "GitHub 仓库是私有仓库。若图片需要给别人访问，请改用公开仓库，或配置可以公开提供文件的代理/CDN 域名。".into(),
            ));
        }

        let branch_response = self
            .auth(self.client.get(self.branch_url()?))
            .send()
            .await
            .map_err(|e| StorageError::Network(e.to_string()))?;
        if !branch_response.status().is_success() {
            return Err(Self::response_error(branch_response, "GitHub branch check failed").await);
        }

        let root_note = self.root_status_note().await?;
        Ok(ConnectionReport {
            reachable: true,
            detail: format!(
                "GitHub repository {}/{} · {} is reachable; authenticated write access is available; {root_note}",
                self.config.owner, self.config.repo, self.config.branch
            ),
        })
    }

    async fn upload(&self, request: UploadRequest) -> Result<UploadResult, StorageError> {
        let logical_path = request.path.clone();
        let repository_path = self.repository_path(&logical_path);
        let encoded_content = STANDARD.encode(request.body.as_ref());

        for attempt in 1..=UPLOAD_MAX_ATTEMPTS {
            let existing_sha = self.existing_sha(&repository_path).await?;
            let mut payload = json!({
                "message": format!("chore(assets): publish {}", repository_path),
                "content": &encoded_content,
                "branch": self.config.branch.clone(),
            });
            if let Some(sha) = existing_sha {
                payload["sha"] = Value::String(sha);
            }

            let response = self
                .auth(self.client.put(self.contents_url(&repository_path)?))
                .json(&payload)
                .send()
                .await
                .map_err(|e| StorageError::Network(e.to_string()))?;

            if response.status() == StatusCode::CONFLICT && attempt < UPLOAD_MAX_ATTEMPTS {
                continue;
            }
            if !response.status().is_success() {
                return Err(Self::response_error(response, "GitHub upload failed").await);
            }

            let body: Value = response
                .json()
                .await
                .map_err(|e| StorageError::Provider(e.to_string()))?;
            let sha = body
                .pointer("/content/sha")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
                .ok_or_else(|| {
                    StorageError::Provider(
                        "GitHub 上传响应没有返回已提交文件的 SHA，因此本次上传不会被标记为成功。"
                            .into(),
                    )
                })?;

            // Do not report success until GitHub resolves the committed blob again.
            let verified_sha = self.existing_sha(&repository_path).await?;
            if verified_sha.as_deref() != Some(sha.as_str()) {
                if attempt < UPLOAD_MAX_ATTEMPTS {
                    continue;
                }
                return Err(StorageError::Provider(format!(
                    "GitHub 已接受上传请求，但远端校验未确认 {repository_path} 的最新 SHA。请稍后重试。"
                )));
            }

            let download_url = body
                .pointer("/content/download_url")
                .and_then(Value::as_str)
                .and_then(Self::canonical_url);
            let public_url = if let Some(url) = self.custom_public_url(&repository_path) {
                Self::canonical_url(&url).or(Some(url))
            } else {
                download_url.or_else(|| self.raw_public_url(&repository_path).ok())
            };

            // The read-back above is what makes this a success rather than an accepted request;
            // carry the conclusion forward instead of letting it evaporate into "we returned Ok".
            let verification =
                VerificationOutcome::sha_readback(true, Some(sha.clone()), verified_sha);
            return Ok(UploadResult {
                remote_path: logical_path,
                public_url,
                etag: Some(sha),
                verification: Some(verification),
            });
        }

        Err(StorageError::Provider(
            "GitHub 上传在自动重试后仍未完成。".into(),
        ))
    }

    async fn exists(&self, path: &str) -> Result<bool, StorageError> {
        Ok(self
            .existing_sha(&self.repository_path(path))
            .await?
            .is_some())
    }

    async fn download(&self, path: &str) -> Result<bytes::Bytes, StorageError> {
        let repository_path = self.repository_path(path);
        let response = self
            .auth(self.client.get(self.contents_url(&repository_path)?))
            .query(&[("ref", self.config.branch.as_str())])
            .send()
            .await
            .map_err(|e| StorageError::Network(e.to_string()))?;
        if !response.status().is_success() {
            return Err(Self::response_error(response, "GitHub download failed").await);
        }

        let payload: Value = response
            .json()
            .await
            .map_err(|e| StorageError::Provider(e.to_string()))?;
        if let Some(content) = payload.get("content").and_then(Value::as_str) {
            let compact = content
                .chars()
                .filter(|ch| !ch.is_whitespace())
                .collect::<String>();
            let decoded = STANDARD.decode(compact.as_bytes()).map_err(|e| {
                StorageError::Provider(format!("GitHub content decode failed: {e}"))
            })?;
            return Ok(bytes::Bytes::from(decoded));
        }

        let download_url = payload
            .get("download_url")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                StorageError::Provider("GitHub content response did not include file bytes".into())
            })?;
        let response = self
            .client
            .get(download_url)
            .header(USER_AGENT, "image-hosting-platform")
            .bearer_auth(self.credentials.token.trim())
            .send()
            .await
            .map_err(|e| StorageError::Network(e.to_string()))?;
        if !response.status().is_success() {
            return Err(Self::response_error(response, "GitHub raw download failed").await);
        }
        response
            .bytes()
            .await
            .map_err(|e| StorageError::Network(e.to_string()))
    }

    async fn delete(&self, path: &str) -> Result<(), StorageError> {
        let repository_path = self.repository_path(path);
        let Some(sha) = self.existing_sha(&repository_path).await? else {
            return Ok(());
        };
        let payload = json!({
            "message": format!("chore(assets): delete {}", repository_path),
            "sha": sha,
            "branch": self.config.branch.clone(),
        });
        let response = self
            .auth(self.client.delete(self.contents_url(&repository_path)?))
            .json(&payload)
            .send()
            .await
            .map_err(|e| StorageError::Network(e.to_string()))?;
        if !response.status().is_success() {
            return Err(Self::response_error(response, "GitHub delete failed").await);
        }
        Ok(())
    }

    async fn list(&self, path: &str) -> Result<Vec<StorageEntry>, StorageError> {
        let repository_path = self.repository_path(path);
        let response = self
            .auth(self.client.get(self.contents_url(&repository_path)?))
            .query(&[("ref", self.config.branch.as_str())])
            .send()
            .await
            .map_err(|e| StorageError::Network(e.to_string()))?;

        // GitHub has no empty directory objects. A configured root such as `assets`
        // legitimately returns 404 until the first file is uploaded, so the gallery
        // must treat that state as an empty remote directory instead of a broken connection.
        if response.status() == StatusCode::NOT_FOUND
            && path.trim().is_empty()
            && !self.configured_root().is_empty()
        {
            return Ok(Vec::new());
        }
        if !response.status().is_success() {
            return Err(Self::response_error(response, "GitHub browse failed").await);
        }

        let payload: Value = response
            .json()
            .await
            .map_err(|e| StorageError::Provider(e.to_string()))?;
        let values: Vec<&Value> = match payload.as_array() {
            Some(items) => items.iter().collect(),
            None => vec![&payload],
        };
        let mut entries = values
            .into_iter()
            .filter_map(|value| self.entry_from_value(value))
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| {
            right
                .is_dir
                .cmp(&left.is_dir)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
        Ok(entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn storage() -> GitHubStorage {
        GitHubStorage::new(
            GitHubStorageConfig {
                owner: "alice".into(),
                repo: "images".into(),
                branch: "main".into(),
                root: "assets/blog".into(),
                public_base_url: Some("https://img.example.com".into()),
            },
            GitHubCredentials {
                token: "test".into(),
            },
        )
    }

    #[test]
    fn repository_paths_stay_relative_to_storage_root() {
        let storage = storage();
        assert_eq!(
            storage.repository_path("2026/a.png"),
            "assets/blog/2026/a.png"
        );
        assert_eq!(storage.logical_path("assets/blog/2026/a.png"), "2026/a.png");
        assert_eq!(storage.repository_path(""), "assets/blog");
    }

    #[test]
    fn configured_root_is_normalized() {
        let mut storage = storage();
        storage.config.root = " /assets/blog/ ".into();
        assert_eq!(storage.configured_root(), "assets/blog");
        assert_eq!(storage.repository_path("a.png"), "assets/blog/a.png");
    }

    #[test]
    fn custom_public_url_includes_repository_root() {
        let storage = storage();
        assert_eq!(
            storage.custom_public_url("assets/blog/a.png").as_deref(),
            Some("https://img.example.com/assets/blog/a.png")
        );
    }

    #[test]
    fn raw_public_url_percent_encodes_unicode_path() {
        let mut storage = storage();
        storage.config.owner = "159357yangjun".into();
        storage.config.repo = "PicList".into();
        storage.config.branch = "main".into();
        storage.config.root.clear();
        storage.config.public_base_url = None;
        let url = storage
            .raw_public_url("02_实现层_三维城市沙盘.png")
            .unwrap();
        assert_eq!(
            url,
            "https://raw.githubusercontent.com/159357yangjun/PicList/main/02_%E5%AE%9E%E7%8E%B0%E5%B1%82_%E4%B8%89%E7%BB%B4%E5%9F%8E%E5%B8%82%E6%B2%99%E7%9B%98.png"
        );
    }

    #[test]
    fn canonical_url_encodes_unicode_download_url() {
        let url = GitHubStorage::canonical_url(
            "https://raw.githubusercontent.com/159357yangjun/PicList/main/04_算法层_算法对比.png",
        )
        .unwrap();
        assert_eq!(
            url,
            "https://raw.githubusercontent.com/159357yangjun/PicList/main/04_%E7%AE%97%E6%B3%95%E5%B1%82_%E7%AE%97%E6%B3%95%E5%AF%B9%E6%AF%94.png"
        );
    }
}

/// Whether a 403 is really GitHub's secondary rate limit instead of a permission denial.
///
/// Matched on wording because GitHub uses no distinct status code here. Deliberately narrow: an
/// unrecognised 403 stays `Authentication`, which is both the likelier cause and the safer advice.
fn is_secondary_rate_limit(status: StatusCode, message: &str) -> bool {
    let folded = message.to_ascii_lowercase();
    status == StatusCode::FORBIDDEN
        && (folded.contains("rate limit")
            || folded.contains("secondary rate limit")
            || folded.contains("abuse detection"))
}
