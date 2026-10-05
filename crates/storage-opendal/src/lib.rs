use async_trait::async_trait;
use domain::StorageCapabilities;
use opendal::{Operator, services};
use serde::{Deserialize, Serialize};
use storage_core::{
    ConnectionReport, StorageEntry, StorageError, StorageProvider, UploadRequest, UploadResult,
};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct S3StorageConfig {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    #[serde(default)]
    pub root: String,
    pub public_base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct S3Credentials {
    pub access_key_id: String,
    pub secret_access_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OssStorageConfig {
    pub endpoint: String,
    pub bucket: String,
    #[serde(default)]
    pub root: String,
    pub public_base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OssCredentials {
    pub access_key_id: String,
    pub access_key_secret: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CosStorageConfig {
    pub endpoint: String,
    pub bucket: String,
    #[serde(default)]
    pub root: String,
    pub public_base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CosCredentials {
    pub secret_id: String,
    pub secret_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebDavStorageConfig {
    pub endpoint: String,
    #[serde(default)]
    pub root: String,
    pub public_base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebDavCredentials {
    pub username: String,
    pub password: String,
}

pub struct OpenDalStorage {
    operator: Operator,
    provider_key: &'static str,
    capabilities: StorageCapabilities,
    public_base_url: Option<String>,
    public_prefix: String,
}

impl OpenDalStorage {
    pub fn new(
        operator: Operator,
        provider_key: &'static str,
        capabilities: StorageCapabilities,
        public_base_url: Option<String>,
        public_prefix: String,
    ) -> Self {
        Self {
            operator,
            provider_key,
            capabilities,
            public_base_url,
            public_prefix,
        }
    }

    pub fn s3(
        provider_key: &'static str,
        config: &S3StorageConfig,
        credentials: &S3Credentials,
    ) -> Result<Self, StorageError> {
        let mut builder = services::S3::default()
            .bucket(&config.bucket)
            .region(&config.region)
            .endpoint(&config.endpoint)
            .access_key_id(&credentials.access_key_id)
            .secret_access_key(&credentials.secret_access_key);
        let root = normalized_root(&config.root);
        if !root.is_empty() {
            builder = builder.root(&format!("/{root}"));
        }
        let operator = Operator::new(builder).map_err(map_error)?;
        Ok(Self::new(
            operator,
            provider_key,
            standard_capabilities(config.public_base_url.is_some()),
            config.public_base_url.clone(),
            root,
        ))
    }

    pub fn oss(
        config: &OssStorageConfig,
        credentials: &OssCredentials,
    ) -> Result<Self, StorageError> {
        let mut builder = services::Oss::default()
            .bucket(&config.bucket)
            .endpoint(&config.endpoint)
            .access_key_id(&credentials.access_key_id)
            .access_key_secret(&credentials.access_key_secret);
        let root = normalized_root(&config.root);
        if !root.is_empty() {
            builder = builder.root(&format!("/{root}"));
        }
        let operator = Operator::new(builder).map_err(map_error)?;
        Ok(Self::new(
            operator,
            "oss",
            standard_capabilities(config.public_base_url.is_some()),
            config.public_base_url.clone(),
            root,
        ))
    }

    pub fn cos(
        config: &CosStorageConfig,
        credentials: &CosCredentials,
    ) -> Result<Self, StorageError> {
        let mut builder = services::Cos::default()
            .bucket(&config.bucket)
            .endpoint(&config.endpoint)
            .secret_id(&credentials.secret_id)
            .secret_key(&credentials.secret_key);
        let root = normalized_root(&config.root);
        if !root.is_empty() {
            builder = builder.root(&format!("/{root}"));
        }
        let operator = Operator::new(builder).map_err(map_error)?;
        Ok(Self::new(
            operator,
            "cos",
            standard_capabilities(config.public_base_url.is_some()),
            config.public_base_url.clone(),
            root,
        ))
    }

    pub fn webdav(
        config: &WebDavStorageConfig,
        credentials: &WebDavCredentials,
    ) -> Result<Self, StorageError> {
        let mut builder = services::Webdav::default()
            .endpoint(&config.endpoint)
            .username(&credentials.username)
            .password(&credentials.password);
        let root = normalized_root(&config.root);
        if !root.is_empty() {
            builder = builder.root(&format!("/{root}"));
        }
        let operator = Operator::new(builder).map_err(map_error)?;
        Ok(Self::new(
            operator,
            "webdav",
            standard_capabilities(config.public_base_url.is_some()),
            config.public_base_url.clone(),
            root,
        ))
    }

    fn public_url_for(&self, path: &str) -> Option<String> {
        self.public_base_url.as_ref().map(|base| {
            let path = path.trim_start_matches('/');
            if self.public_prefix.is_empty() {
                format!("{}/{}", base.trim_end_matches('/'), path)
            } else {
                format!(
                    "{}/{}/{}",
                    base.trim_end_matches('/'),
                    self.public_prefix,
                    path
                )
            }
        })
    }
}

fn standard_capabilities(public_url: bool) -> StorageCapabilities {
    StorageCapabilities {
        upload: true,
        download: true,
        delete: true,
        list: true,
        move_object: true,
        public_url,
        versioning: false,
        streaming: true,
    }
}

fn normalized_root(root: &str) -> String {
    root.trim().trim_matches('/').to_string()
}

fn map_error(error: opendal::Error) -> StorageError {
    let message = error.to_string();
    match error.kind() {
        opendal::ErrorKind::PermissionDenied => StorageError::Authentication(message),
        opendal::ErrorKind::Unsupported => StorageError::Unsupported,
        _ => StorageError::Provider(message),
    }
}

#[async_trait]
impl StorageProvider for OpenDalStorage {
    fn provider_key(&self) -> &'static str {
        self.provider_key
    }

    fn capabilities(&self) -> StorageCapabilities {
        self.capabilities.clone()
    }

    async fn test_connection(&self) -> Result<ConnectionReport, StorageError> {
        self.operator.check().await.map_err(map_error)?;

        // A read/list-style health check is not sufficient for a publisher.
        // Verify the exact capabilities the application needs with a unique,
        // short-lived object at the configured root: write -> stat -> delete.
        let probe_path = format!(
            ".multicloud-publisher-connection-test-u{}.tmp",
            Uuid::new_v4().simple()
        );
        let probe_body = bytes::Bytes::from_static(b"ok");
        self.operator
            .write(&probe_path, probe_body)
            .await
            .map_err(|error| {
                StorageError::Provider(format!(
                    "write permission check failed: {}",
                    map_error(error)
                ))
            })?;

        let verified = match self.operator.stat(&probe_path).await {
            Ok(metadata) => metadata,
            Err(error) => {
                let _ = self.operator.delete(&probe_path).await;
                return Err(StorageError::Provider(format!(
                    "write succeeded but verification failed: {}",
                    map_error(error)
                )));
            }
        };
        if verified.content_length() != 2 {
            let _ = self.operator.delete(&probe_path).await;
            return Err(StorageError::Provider(format!(
                "write verification returned unexpected size for probe object: {}",
                verified.content_length()
            )));
        }
        self.operator.delete(&probe_path).await.map_err(|error| {
            StorageError::Provider(format!(
                "delete permission check failed: {}",
                map_error(error)
            ))
        })?;

        Ok(ConnectionReport {
            reachable: true,
            detail: "Storage endpoint reachable; write, verify and delete permissions confirmed"
                .into(),
        })
    }

    async fn upload(&self, request: UploadRequest) -> Result<UploadResult, StorageError> {
        let remote_path = request.path.clone();
        let expected_len = request.body.len() as u64;
        let meta = if let Some(content_type) = request.content_type.as_deref() {
            self.operator
                .write_with(&remote_path, request.body)
                .content_type(content_type)
                .await
                .map_err(map_error)?
        } else {
            self.operator
                .write(&remote_path, request.body)
                .await
                .map_err(map_error)?
        };

        // Verify the object is visible after the write. A successful SDK call is
        // not enough for the UI to claim the remote file exists.
        let verified = self.operator.stat(&remote_path).await.map_err(map_error)?;
        if verified.content_length() != expected_len {
            return Err(StorageError::Provider(format!(
                "remote verification failed for {remote_path}: expected {expected_len} bytes, got {}",
                verified.content_length()
            )));
        }

        Ok(UploadResult {
            remote_path: remote_path.clone(),
            public_url: self.public_url_for(&remote_path),
            etag: meta.etag().map(ToOwned::to_owned),
        })
    }

    async fn download(&self, path: &str) -> Result<bytes::Bytes, StorageError> {
        let buffer = self.operator.read(path).await.map_err(map_error)?;
        Ok(buffer.to_bytes())
    }

    /// Exact-path lookup instead of the trait default's directory listing.
    ///
    /// The default implementation calls `list(parent)` and scans for a name match. Object stores
    /// do not truncate listings the way repository contents APIs do, but a prefix can still hold
    /// tens of thousands of keys, so the default is both slow here and - once a listing is capped
    /// anywhere in the chain - capable of reporting a present object as absent. For a reconciler
    /// that is the worst possible failure direction: a false "absent" reads as deleted user
    /// content.
    ///
    /// Three outcomes are kept distinct on purpose:
    ///   Ok(true)  / Ok(false) only come from a completed stat;
    ///   Err(_)    covers every other failure (auth, network, rate limit), which callers must
    ///             treat as "unknown", never as absence. NotFound maps to Ok(false); anything
    ///             else propagates.
    async fn exists(&self, path: &str) -> Result<bool, StorageError> {
        match self.operator.stat(path).await {
            Ok(metadata) => Ok(metadata.is_file()),
            Err(error) if error.kind() == opendal::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(map_error(error)),
        }
    }

    async fn delete(&self, path: &str) -> Result<(), StorageError> {
        self.operator.delete(path).await.map_err(map_error)
    }

    async fn move_object(&self, from: &str, to: &str) -> Result<UploadResult, StorageError> {
        self.operator.rename(from, to).await.map_err(map_error)?;
        let metadata = self.operator.stat(to).await.map_err(map_error)?;
        Ok(UploadResult {
            remote_path: to.to_string(),
            public_url: self.public_url_for(to),
            etag: metadata.etag().map(ToOwned::to_owned),
        })
    }

    async fn create_dir(&self, path: &str) -> Result<(), StorageError> {
        let normalized = path.trim().trim_matches('/');
        if normalized.is_empty() {
            return Ok(());
        }
        self.operator
            .create_dir(&format!("{normalized}/"))
            .await
            .map_err(map_error)
    }

    async fn list(&self, path: &str) -> Result<Vec<StorageEntry>, StorageError> {
        let normalized = path.trim_matches('/');
        let directory = if normalized.is_empty() {
            String::new()
        } else {
            format!("{normalized}/")
        };
        let entries = self
            .operator
            .list_with(&directory)
            .await
            .map_err(map_error)?;
        let mut out = entries
            .into_iter()
            .map(|entry| {
                let is_dir = entry.metadata().is_dir();
                let entry_path = entry.path().trim_end_matches('/').to_string();
                StorageEntry {
                    name: entry.name().trim_end_matches('/').to_string(),
                    path: entry_path.clone(),
                    is_dir,
                    size_bytes: if is_dir {
                        None
                    } else {
                        Some(entry.metadata().content_length())
                    },
                    public_url: if is_dir {
                        None
                    } else {
                        self.public_url_for(&entry_path)
                    },
                }
            })
            .collect::<Vec<_>>();
        out.sort_by(|left, right| {
            right
                .is_dir
                .cmp(&left.is_dir)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
        Ok(out)
    }
}
