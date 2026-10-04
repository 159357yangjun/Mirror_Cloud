use async_trait::async_trait;
use bytes::Bytes;
use domain::StorageCapabilities;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("authentication failed: {0}")]
    Authentication(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("provider rejected request: {0}")]
    Provider(String),
    #[error("operation is not supported by this provider")]
    Unsupported,
    #[error("operation has not been implemented yet")]
    NotImplemented,
}

#[derive(Debug, Clone)]
pub struct UploadRequest {
    pub path: String,
    pub content_type: Option<String>,
    pub body: Bytes,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadResult {
    pub remote_path: String,
    pub public_url: Option<String>,
    pub etag: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size_bytes: Option<u64>,
    pub public_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionReport {
    pub reachable: bool,
    pub detail: String,
}

#[async_trait]
pub trait StorageProvider: Send + Sync {
    fn provider_key(&self) -> &'static str;
    fn capabilities(&self) -> StorageCapabilities;
    async fn test_connection(&self) -> Result<ConnectionReport, StorageError>;
    async fn upload(&self, request: UploadRequest) -> Result<UploadResult, StorageError>;
    async fn download(&self, _path: &str) -> Result<Bytes, StorageError> {
        Err(StorageError::Unsupported)
    }
    /// Existence probe for one object path. The default walks the parent listing, which is only
    /// safe when that listing is complete; repository contents APIs truncate directories, so
    /// GitHub and Gitee override this with an exact-path lookup.
    async fn exists(&self, path: &str) -> Result<bool, StorageError> {
        let parent = path
            .rsplit_once('/')
            .map(|(parent, _)| parent)
            .unwrap_or("");
        let entries = self.list(parent).await?;
        Ok(entries
            .iter()
            .any(|entry| entry.path.trim_matches('/') == path.trim_matches('/')))
    }
    async fn delete(&self, path: &str) -> Result<(), StorageError>;
    async fn move_object(&self, _from: &str, _to: &str) -> Result<UploadResult, StorageError> {
        Err(StorageError::Unsupported)
    }
    async fn create_dir(&self, _path: &str) -> Result<(), StorageError> {
        Err(StorageError::Unsupported)
    }
    async fn list(&self, _path: &str) -> Result<Vec<StorageEntry>, StorageError> {
        Err(StorageError::Unsupported)
    }
}
