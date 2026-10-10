use async_trait::async_trait;
use bytes::Bytes;
use domain::{StorageCapabilities, StorageErrorKind};
use serde::{Deserialize, Serialize};
pub mod rollback;
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
    /// The addressed object does not exist. Kept apart from `Provider` so a missing repository is
    /// not sorted into the same bucket as an arbitrary upstream 5xx.
    #[error("target object was not found: {0}")]
    MissingObject(String),
    /// A concurrent write invalidated ours. Transient: retrying can succeed with no config change.
    #[error("write conflicted with a concurrent change: {0}")]
    Conflict(String),
}

impl StorageError {
    /// The failure's category, named by what the user should do next.
    ///
    /// Three of the five variants map straight through. `Provider` does not: it is what every
    /// adapter falls back to, so it holds both "the repository does not exist" (fix your settings)
    /// and "you are sending too fast" (wait). Splitting those here reads status text the adapter
    /// already embedded in the message, which is a heuristic and says so below. The real
    /// fix lives at the adapters, where the status code is still an integer; this mapping exists
    /// so that a mis-classified provider error degrades to `rejected`, not to a wrong guess.
    pub fn kind(&self) -> domain::StorageErrorKind {
        use domain::StorageErrorKind;
        match self {
            StorageError::Authentication(_) => StorageErrorKind::Authentication,
            StorageError::Network(_) => StorageErrorKind::Network,
            StorageError::Unsupported => StorageErrorKind::Unsupported,
            StorageError::NotImplemented => StorageErrorKind::NotImplemented,
            StorageError::MissingObject(_) => StorageErrorKind::NotFound,
            StorageError::Conflict(_) => StorageErrorKind::Conflict,
            StorageError::Provider(message) => classify_provider_message(message),
        }
    }
}

/// Best-effort sort of the catch-all variant from the status text an adapter included.
///
/// Deliberately narrow: it only recognises forms this repository's own adapters produce, and every
/// unrecognised string lands on `rejected`. A false `not_found` would tell someone to edit config
/// that is fine; a false `rejected` tells them to read the message, which is always correct.
fn classify_provider_message(message: &str) -> domain::StorageErrorKind {
    use domain::StorageErrorKind;
    let folded = message.to_ascii_lowercase();
    let throttled = folded.contains("429")
        || folded.contains("rate limit")
        || folded.contains("too many requests");
    if throttled {
        return StorageErrorKind::RateLimited;
    }
    if folded.contains("409") || folded.contains("conflict") {
        return StorageErrorKind::Conflict;
    }
    if folded.contains("404") || folded.contains("not found") {
        return StorageErrorKind::NotFound;
    }
    StorageErrorKind::Rejected
}

/// What a failed existence probe should be reported as, in the words §18B asks for.
///
/// `Ok(false)` is NOT a failure: the object was looked for and not found, which belongs to drift,
/// not to this taxonomy - so it gets None here and callers must not invent a kind for it. The one
/// case with no provider error at all (no usable provider) maps to `unavailable`, because "we could
/// not even try" must stay distinguishable from "we tried and the answer refused to come".
pub fn probe_kind(outcome: &Result<bool, StorageError>) -> Option<domain::ProbeFailureKind> {
    use domain::ProbeFailureKind;
    match outcome {
        Ok(_) => None,
        Err(error) => Some(ProbeFailureKind::classify(error.kind(), &error.to_string())),
    }
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
    /// On-demand preview of a small private object. None means the object is too large.
    /// Adapters must check its remote size BEFORE downloading and check returned bytes again.
    /// Never return a permanent public URL or cache the result in the asset database.
    async fn download_preview(
        &self,
        _path: &str,
        _max_bytes: u64,
    ) -> Result<Option<Bytes>, StorageError> {
        Err(StorageError::Unsupported)
    }
    /// Sign a temporary, read-only, browser-ready URL without exposing storage credentials.
    ///
    /// Implementations must reject URLs that require non-Host headers, since recipients receive
    /// only a URL. The caller must never persist or log the returned bearer URL.
    async fn temporary_read_url(
        &self,
        _path: &str,
        _expires: std::time::Duration,
    ) -> Result<String, StorageError> {
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
    /// The largest number of entries one `list(path)` call can return before the provider starts
    /// leaving things out, or None when the provider paginates internally and returns everything.
    ///
    /// A constant rather than a post-call query on purpose. A `list_truncated(&self, path)` method
    /// would have to remember what the last call returned, which needs mutable shared state on a
    /// provider that is `Clone + Send + Sync` and listed concurrently - two directories walked at
    /// once would then read each other's flag. Reporting the ceiling lets the caller judge from
    /// the count it already holds, with no state anywhere.
    ///
    /// Leaving this None is not neutral: it tells the scanner "trust a short listing as
    /// complete", so an adapter with a known hard cap that does not override it is asserting a
    /// coverage it never observed.
    fn listing_page_limit(&self) -> Option<usize> {
        None
    }
}

/// Whether a remote path names an object this build created uniquely.
///
/// Compensating a partial publish deletes remote objects, and the deletable set is narrower than
/// "everything we just uploaded": legacy configured paths carry no unique segment and collide with
/// files that predate this build, so deleting one destroys data the publisher never wrote. The
/// test is a whitelist - a 33-character segment starting with 'u' then 32 hex digits - so an
/// unrecognised shape fails toward leaving the object alone.
///
/// Both publish entry points used to keep their own copy of this predicate. They now share it, and
/// the shared filter lives in `rollback::safe_rollback_points`.
pub fn is_safe_compensation_path(path: &str) -> bool {
    path.split(|character: char| !character.is_ascii_alphanumeric())
        .any(|segment| {
            segment.len() == 33
                && segment.starts_with('u')
                && segment[1..]
                    .chars()
                    .all(|character| character.is_ascii_hexdigit())
        })
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
        let without_expected = VerificationOutcome::sha_readback(true, None, Some("abc".into()));
        assert!(without_expected.passed);
        assert_eq!(without_expected.expected, None);
        assert_eq!(without_expected.observed.as_deref(), Some("abc"));

        let compared =
            VerificationOutcome::sha_readback(false, Some("abc".into()), Some("def".into()));
        assert!(!compared.passed);
        assert_eq!(compared.method, "sha_readback");
    }

    #[test]
    fn three_variants_map_straight_through_to_their_kind() {
        use domain::StorageErrorKind;
        assert_eq!(
            StorageError::Authentication("bad token".into()).kind(),
            StorageErrorKind::Authentication
        );
        assert_eq!(
            StorageError::Network("timeout".into()).kind(),
            StorageErrorKind::Network
        );
        assert_eq!(
            StorageError::Unsupported.kind(),
            StorageErrorKind::Unsupported
        );
        assert_eq!(
            StorageError::NotImplemented.kind(),
            StorageErrorKind::NotImplemented
        );
    }

    #[test]
    fn the_catch_all_variant_splits_on_status_text_it_was_given() {
        use domain::StorageErrorKind;
        assert_eq!(
            StorageError::Provider("upload (404 Not Found): nope".into()).kind(),
            StorageErrorKind::NotFound
        );
        assert_eq!(
            StorageError::Provider("branch moved (409 Conflict)".into()).kind(),
            StorageErrorKind::Conflict
        );
        assert_eq!(
            StorageError::Provider("(429 Too Many Requests)".into()).kind(),
            StorageErrorKind::RateLimited
        );
    }

    #[test]
    fn an_unrecognised_provider_rejection_stays_rejected_and_guards_nothing() {
        use domain::StorageErrorKind;
        // Silence about the category is safe; a wrong category is not.
        for message in ["quota exceeded", "", "weird upstream 500 detail"] {
            let kind = StorageError::Provider(message.into()).kind();
            assert_eq!(kind, StorageErrorKind::Rejected, "{message:?}");
            assert!(!kind.is_retryable());
            assert!(!kind.is_config_actionable());
        }
    }

    #[test]
    fn a_successful_probe_has_no_failure_kind_at_all() {
        // Ok(false) is an answer ("looked, not there"), not a failure: inventing a kind for it
        // would put drift findings in the failure column.
        assert_eq!(probe_kind(&Ok(true)), None);
        assert_eq!(probe_kind(&Ok(false)), None);
    }

    #[test]
    fn probe_kinds_sort_by_what_the_user_should_do_next() {
        use domain::ProbeFailureKind;
        assert_eq!(
            probe_kind(&Err(StorageError::Network("timeout".into()))),
            Some(ProbeFailureKind::NetworkTimeout)
        );
        assert_eq!(
            probe_kind(&Err(StorageError::Authentication("401".into()))),
            Some(ProbeFailureKind::AuthFailed)
        );
        assert_eq!(
            probe_kind(&Err(StorageError::Unsupported)),
            Some(ProbeFailureKind::Unavailable)
        );
        assert_eq!(
            probe_kind(&Err(StorageError::Provider("server said no".into()))),
            Some(ProbeFailureKind::Rejected)
        );
    }
}
