use std::cell::RefCell;

use chrono::Utc;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use uuid::Uuid;

use super::{CredentialReader, build_provider};
use persistence_sqlite::StorageRecord;

const PROVIDERS: [&str; 7] = ["r2", "s3", "oss", "cos", "webdav", "github", "gitee"];

struct MemoryCredentials {
    value: Result<Value, String>,
    reads: RefCell<Vec<String>>,
}

impl CredentialReader for MemoryCredentials {
    fn read_json<T: DeserializeOwned>(&self, reference: &str) -> Result<T, String> {
        self.reads.borrow_mut().push(reference.to_owned());
        serde_json::from_value(self.value.clone()?).map_err(|error| error.to_string())
    }
}

fn fixture(key: &str) -> (StorageRecord, MemoryCredentials) {
    let config = match key {
        "r2" | "s3" => json!({
            "endpoint": "https://s3.us-east-1.amazonaws.com", "region": "us-east-1",
            "bucket": "offline-images", "public_base_url": "https://images.example.com"
        }),
        "oss" => {
            json!({"endpoint": "https://oss-cn-hangzhou.aliyuncs.com", "bucket": "offline-images"})
        }
        "cos" => {
            json!({"endpoint": "https://cos.ap-guangzhou.myqcloud.com", "bucket": "offline-1250000000"})
        }
        "webdav" => json!({"endpoint": "https://dav.example.com"}),
        _ => json!({"owner": "offline", "repo": "images", "branch": "main"}),
    };
    let credentials = match key {
        "r2" | "s3" => {
            json!({"access_key_id": "offline-id", "secret_access_key": "offline-secret"})
        }
        "oss" => json!({"access_key_id": "offline-id", "access_key_secret": "offline-secret"}),
        "cos" => json!({"secret_id": "offline-id", "secret_key": "offline-secret"}),
        "webdav" => json!({"username": "offline", "password": "offline-password"}),
        _ => json!({"token": "offline-token"}),
    };
    (
        StorageRecord {
            id: Uuid::nil(),
            name: "offline fixture".into(),
            provider_key: key.into(),
            category: "test".into(),
            credential_ref: Some("test-reference".into()),
            config_json: config,
            capabilities_json: json!({}),
            enabled: true,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        },
        MemoryCredentials {
            value: Ok(credentials),
            reads: RefCell::new(Vec::new()),
        },
    )
}

#[tokio::test]
async fn all_seven_providers_construct_offline_with_one_typed_credential_read() {
    // Constructing an adapter must not test the connection or perform an upload.
    for key in PROVIDERS {
        let (record, credentials) = fixture(key);
        let provider = build_provider(&credentials, &record, |_| panic!("supported provider"))
            .unwrap_or_else(|error| panic!("{key}: {error}"));
        assert_eq!(provider.provider_key(), key);
        assert_eq!(*credentials.reads.borrow(), ["test-reference"]);
    }
}

#[test]
fn missing_reference_is_rejected_before_config_or_keyring_access() {
    for key in PROVIDERS {
        let (mut record, credentials) = fixture(key);
        record.credential_ref = None;
        record.config_json = json!({});
        let result = build_provider(&credentials, &record, |_| panic!("supported provider"));
        assert_eq!(
            result.err().as_deref(),
            Some("Storage credential reference missing")
        );
        assert!(credentials.reads.borrow().is_empty());
    }
}

#[test]
fn malformed_config_is_rejected_before_credentials_are_read() {
    for key in PROVIDERS {
        let (mut record, credentials) = fixture(key);
        record.config_json = json!({});
        let result = build_provider(&credentials, &record, |_| panic!("supported provider"));
        assert!(
            result
                .err()
                .is_some_and(|error| error.contains("missing field"))
        );
        assert!(credentials.reads.borrow().is_empty());
    }
}

#[test]
fn credential_lookup_failure_is_preserved_without_retry() {
    for key in PROVIDERS {
        let (record, mut credentials) = fixture(key);
        credentials.value = Err("offline lookup refused".into());
        let result = build_provider(&credentials, &record, |_| panic!("supported provider"));
        assert_eq!(result.err().as_deref(), Some("offline lookup refused"));
        assert_eq!(*credentials.reads.borrow(), ["test-reference"]);
    }
}

#[test]
fn typed_credential_validation_is_preserved() {
    for key in PROVIDERS {
        let (record, mut credentials) = fixture(key);
        credentials.value = Ok(json!({}));
        let result = build_provider(&credentials, &record, |_| panic!("supported provider"));
        assert!(
            result
                .err()
                .is_some_and(|error| error.contains("missing field"))
        );
        assert_eq!(*credentials.reads.borrow(), ["test-reference"]);
    }
}

#[test]
fn unsupported_provider_keeps_the_callers_message_without_keyring_access() {
    let (record, credentials) = fixture("unsupported");
    for suffix in [
        "is not wired in this build",
        "is not supported by the Typora bridge",
    ] {
        let result = build_provider(&credentials, &record, |key| {
            format!("Provider {key} {suffix}")
        });
        assert_eq!(result.err(), Some(format!("Provider unsupported {suffix}")));
    }
    assert!(credentials.reads.borrow().is_empty());
}

#[tokio::test]
async fn private_s3_with_public_url_still_fails_in_the_provider_constructor() {
    for key in ["r2", "s3"] {
        let (mut record, credentials) = fixture(key);
        record.config_json["access_mode"] = json!("private_requested");
        let result = build_provider(&credentials, &record, |_| panic!("supported provider"));
        assert!(
            result
                .err()
                .is_some_and(|error| error.contains("must not have a configured public URL"))
        );
    }
}
