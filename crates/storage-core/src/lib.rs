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

/// What a provider actually proved about the object it just wrote.
///
/// This is the L3 rung of the publish ladder (docs/PUBLISH_DISPATCH_ANALYSIS.md section C): an
/// upload returning Ok means the provider accepted the request, nothing more. Each adapter that
/// re-reads the remote object after writing fills this in so the claim survives into the journal
/// instead of evaporating into a boolean that only decided whether to return Err. The moment of
/// the read-back is stamped by whoever records the event, not here: none of the three adapters
/// carry a clock dependency, and adding chrono to all of them for one field is the wrong trade.
///
/// `None` on `UploadResult::verification` means "this path did not verify" - deliberately distinct
/// from `passed: false`, which means "we looked and it disagreed". Collapsing those two is the
/// same class of error as the old `verified_at` field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct VerificationOutcome {
    pub passed: bool,
    /// The identity or size we expected, when the caller had one to compare against. Gitee can
    /// resolve the remote file even when the write response carried no SHA, so this is optional.
    pub expected: Option<String>,
    /// What the remote actually reported back.
    pub observed: Option<String>,
    /// Which check produced the verdict, as a plain string to keep this crate free of a domain
    /// dependency: storage-core must not know about journals.
    pub method: String,
}

impl VerificationOutcome {
    pub fn sha_readback(passed: bool, expected: Option<String>, observed: Option<String>) -> Self {
        Self {
            passed,
            expected,
            observed,
            method: "sha_readback".to_string(),
        }
    }

    pub fn stat_bytes(expected_len: u64, observed_len: u64) -> Self {
        Self {
            passed: expected_len == observed_len,
            expected: Some(expected_len.to_string()),
            observed: Some(observed_len.to_string()),
            method: "stat_bytes".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadResult {
    pub remote_path: String,
    pub public_url: Option<String>,
    pub etag: Option<String>,
    /// Absent when the provider path performed no read-back. Never faked as `passed: false`.
    #[serde(default)]
    pub verification: Option<VerificationOutcome>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_matching_stat_is_the_only_way_byte_verification_passes() {
        let matched = VerificationOutcome::stat_bytes(1024, 1024);
        assert!(matched.passed);
        assert_eq!(matched.expected.as_deref(), Some("1024"));
        assert_eq!(matched.observed.as_deref(), Some("1024"));
        assert_eq!(matched.method, "stat_bytes");

        let mismatched = VerificationOutcome::stat_bytes(1024, 900);
        assert!(
            !mismatched.passed,
            "a size disagreement must never read as verified"
        );
        assert_eq!(mismatched.observed.as_deref(), Some("900"));
    }

    #[test]
    fn sha_readback_keeps_an_absent_expectation_absent() {
        // Gitee can resolve the remote file even when the write response carried no SHA. A
        // fabricated expectation there would invent a comparison that never happened.
        let without_expected =
            VerificationOutcome::sha_readback(true, None, Some("abc".into()));
        assert!(without_expected.passed);
        assert_eq!(without_expected.expected, None);
        assert_eq!(without_expected.observed.as_deref(), Some("abc"));

        let compared =
            VerificationOutcome::sha_readback(false, Some("abc".into()), Some("def".into()));
        assert!(!compared.passed);
        assert_eq!(compared.method, "sha_readback");
    }
}

