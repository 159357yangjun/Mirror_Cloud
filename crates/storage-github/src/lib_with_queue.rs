#[path = "lib.rs"]
mod inner;

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
};

use async_trait::async_trait;
use domain::StorageCapabilities;
use storage_core::{
    ConnectionReport, StorageEntry, StorageError, StorageProvider, UploadRequest, UploadResult,
};
use tokio::sync::Mutex as AsyncMutex;

pub use inner::{GitHubCredentials, GitHubStorageConfig};

static BRANCH_WRITE_LOCKS: OnceLock<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>> = OnceLock::new();

fn branch_write_key(config: &GitHubStorageConfig) -> String {
    format!(
        "{}/{}#{}",
        config.owner.trim().to_ascii_lowercase(),
        config.repo.trim().to_ascii_lowercase(),
        config.branch.trim()
    )
}

fn branch_write_lock(config: &GitHubStorageConfig) -> Arc<AsyncMutex<()>> {
    let registry = BRANCH_WRITE_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut locks = registry
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Arc::clone(
        locks
            .entry(branch_write_key(config))
            .or_insert_with(|| Arc::new(AsyncMutex::new(()))),
    )
}

/// Compatibility wrapper around the existing GitHub provider.
///
/// GitHub's Contents API creates one commit per write. Two concurrent writes to the
/// same repository branch can race on the branch head and return 409 Conflict even
/// when the files are different. Instances targeting the same owner/repo/branch
/// therefore share one async write lock inside this process. The inner provider's
/// bounded retry remains active for conflicts caused by external writers.
pub struct GitHubStorage {
    inner: inner::GitHubStorage,
    write_lock: Arc<AsyncMutex<()>>,
}

impl GitHubStorage {
    pub fn new(config: GitHubStorageConfig, credentials: GitHubCredentials) -> Self {
        let write_lock = branch_write_lock(&config);
        Self {
            inner: inner::GitHubStorage::new(config, credentials),
            write_lock,
        }
    }
}

#[async_trait]
impl StorageProvider for GitHubStorage {
    fn provider_key(&self) -> &'static str {
        self.inner.provider_key()
    }

    fn capabilities(&self) -> StorageCapabilities {
        self.inner.capabilities()
    }

    async fn test_connection(&self) -> Result<ConnectionReport, StorageError> {
        self.inner.test_connection().await
    }

    async fn upload(&self, request: UploadRequest) -> Result<UploadResult, StorageError> {
        let _guard = self.write_lock.lock().await;
        self.inner.upload(request).await
    }

    async fn download(&self, path: &str) -> Result<bytes::Bytes, StorageError> {
        self.inner.download(path).await
    }

    async fn delete(&self, path: &str) -> Result<(), StorageError> {
        let _guard = self.write_lock.lock().await;
        self.inner.delete(path).await
    }

    async fn move_object(&self, from: &str, to: &str) -> Result<UploadResult, StorageError> {
        let _guard = self.write_lock.lock().await;
        self.inner.move_object(from, to).await
    }

    async fn create_dir(&self, path: &str) -> Result<(), StorageError> {
        let _guard = self.write_lock.lock().await;
        self.inner.create_dir(path).await
    }

    async fn list(&self, path: &str) -> Result<Vec<StorageEntry>, StorageError> {
        self.inner.list(path).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(branch: &str) -> GitHubStorageConfig {
        GitHubStorageConfig {
            owner: "Alice".into(),
            repo: "Images".into(),
            branch: branch.into(),
            root: "assets".into(),
            public_base_url: None,
        }
    }

    #[test]
    fn same_repository_branch_shares_write_lock() {
        let first = branch_write_lock(&config("main"));
        let second = branch_write_lock(&GitHubStorageConfig {
            owner: "alice".into(),
            repo: "images".into(),
            ..config("main")
        });
        assert!(Arc::ptr_eq(&first, &second));
    }

    #[test]
    fn different_branch_uses_different_write_lock() {
        let main = branch_write_lock(&config("main"));
        let dev = branch_write_lock(&config("dev"));
        assert!(!Arc::ptr_eq(&main, &dev));
    }
}
