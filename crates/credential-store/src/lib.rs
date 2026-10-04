use serde::{Serialize, de::DeserializeOwned};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CredentialError {
    #[error("credential store error: {0}")]
    Keyring(String),
    #[error("credential serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

#[derive(Clone)]
pub struct CredentialStore {
    service: String,
}

impl CredentialStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }

    fn entry(&self, key: &str) -> Result<keyring::Entry, CredentialError> {
        keyring::Entry::new(&self.service, key).map_err(|e| CredentialError::Keyring(e.to_string()))
    }

    pub fn set_json<T: Serialize>(&self, key: &str, value: &T) -> Result<(), CredentialError> {
        let encoded = serde_json::to_string(value)?;
        self.entry(key)?
            .set_password(&encoded)
            .map_err(|e| CredentialError::Keyring(e.to_string()))
    }

    pub fn get_json<T: DeserializeOwned>(&self, key: &str) -> Result<T, CredentialError> {
        let encoded = self
            .entry(key)?
            .get_password()
            .map_err(|e| CredentialError::Keyring(e.to_string()))?;
        Ok(serde_json::from_str(&encoded)?)
    }

    pub fn delete(&self, key: &str) -> Result<(), CredentialError> {
        self.entry(key)?
            .delete_credential()
            .map_err(|e| CredentialError::Keyring(e.to_string()))
    }
}
