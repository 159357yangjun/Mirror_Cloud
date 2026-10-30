use std::sync::Arc;

use credential_store::CredentialStore;
use persistence_sqlite::StorageRecord;
use serde::de::DeserializeOwned;
use storage_core::StorageProvider;
use storage_gitee::{GiteeCredentials, GiteeStorage, GiteeStorageConfig};
use storage_github::{GitHubCredentials, GitHubStorage, GitHubStorageConfig};
use storage_opendal::{
    CosCredentials, CosStorageConfig, OpenDalStorage, OssCredentials, OssStorageConfig,
    S3Credentials, S3StorageConfig, WebDavCredentials, WebDavStorageConfig,
};

// Keep typed credential errors and lookup order identical for the desktop and CLI.
// This port also lets offline tests avoid the user's operating-system keyring.
pub(crate) trait CredentialReader {
    fn read_json<T: DeserializeOwned>(&self, reference: &str) -> Result<T, String>;
}

impl CredentialReader for CredentialStore {
    fn read_json<T: DeserializeOwned>(&self, reference: &str) -> Result<T, String> {
        self.get_json(reference).map_err(|error| error.to_string())
    }
}

pub(crate) fn build_provider(
    credentials: &impl CredentialReader,
    record: &StorageRecord,
    unsupported: impl FnOnce(&str) -> String,
) -> Result<Arc<dyn StorageProvider>, String> {
    let credential_ref = record
        .credential_ref
        .as_deref()
        .ok_or("Storage credential reference missing")?;
    match record.provider_key.as_str() {
        "r2" | "s3" => {
            let config: S3StorageConfig = serde_json::from_value(record.config_json.clone())
                .map_err(|error| error.to_string())?;
            let credentials: S3Credentials = credentials.read_json(credential_ref)?;
            let provider_key = if record.provider_key == "r2" {
                "r2"
            } else {
                "s3"
            };
            Ok(Arc::new(
                OpenDalStorage::s3(provider_key, &config, &credentials)
                    .map_err(|error| error.to_string())?,
            ))
        }
        "oss" => {
            let config: OssStorageConfig = serde_json::from_value(record.config_json.clone())
                .map_err(|error| error.to_string())?;
            let credentials: OssCredentials = credentials.read_json(credential_ref)?;
            Ok(Arc::new(
                OpenDalStorage::oss(&config, &credentials).map_err(|error| error.to_string())?,
            ))
        }
        "cos" => {
            let config: CosStorageConfig = serde_json::from_value(record.config_json.clone())
                .map_err(|error| error.to_string())?;
            let credentials: CosCredentials = credentials.read_json(credential_ref)?;
            Ok(Arc::new(
                OpenDalStorage::cos(&config, &credentials).map_err(|error| error.to_string())?,
            ))
        }
        "webdav" => {
            let config: WebDavStorageConfig = serde_json::from_value(record.config_json.clone())
                .map_err(|error| error.to_string())?;
            let credentials: WebDavCredentials = credentials.read_json(credential_ref)?;
            Ok(Arc::new(
                OpenDalStorage::webdav(&config, &credentials).map_err(|error| error.to_string())?,
            ))
        }
        "github" => {
            let config: GitHubStorageConfig = serde_json::from_value(record.config_json.clone())
                .map_err(|error| error.to_string())?;
            let credentials: GitHubCredentials = credentials.read_json(credential_ref)?;
            Ok(Arc::new(GitHubStorage::new(config, credentials)))
        }
        "gitee" => {
            let config: GiteeStorageConfig = serde_json::from_value(record.config_json.clone())
                .map_err(|error| error.to_string())?;
            let credentials: GiteeCredentials = credentials.read_json(credential_ref)?;
            Ok(Arc::new(GiteeStorage::new(config, credentials)))
        }
        _ => Err(unsupported(&record.provider_key)),
    }
}

#[cfg(test)]
mod tests;
