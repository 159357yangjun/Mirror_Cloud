use std::{collections::HashMap, sync::Arc};

use bytes::Bytes;
use domain::{DeploymentRole, StorageGroupStrategy, StorageId};
use storage_core::{StorageError, StorageProvider, UploadRequest, UploadResult};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ApplicationError {
    #[error("storage {0} is not registered")]
    StorageNotFound(StorageId),
    #[error("storage group has no primary member")]
    MissingPrimary,
}

#[derive(Default)]
pub struct ProviderRegistry {
    providers: HashMap<StorageId, Arc<dyn StorageProvider>>,
}

impl ProviderRegistry {
    pub fn register(&mut self, id: StorageId, provider: Arc<dyn StorageProvider>) {
        self.providers.insert(id, provider);
    }

    pub fn get(&self, id: &StorageId) -> Result<Arc<dyn StorageProvider>, ApplicationError> {
        self.providers
            .get(id)
            .cloned()
            .ok_or(ApplicationError::StorageNotFound(*id))
    }
}

/// A provider-bound publish target. UI, Tauri, CLI and future local HTTP APIs can
/// all build these descriptors, while the publish semantics stay in one place.
#[derive(Clone)]
pub struct PublishMember {
    pub storage_id: StorageId,
    pub storage_name: String,
    pub role: DeploymentRole,
    pub priority: i32,
    pub provider: Result<Arc<dyn StorageProvider>, String>,
}

#[derive(Debug, Clone)]
pub struct PublishOutcome {
    pub storage_id: StorageId,
    pub storage_name: String,
    pub role: DeploymentRole,
    pub remote_path: String,
    pub public_url: Option<String>,
    pub error: Option<String>,
}

/// Core publish orchestration shared by every entry point.
///
/// It deliberately owns *strategy* semantics but not persistence or UI events:
/// - `mirror_all`: every configured member is attempted.
/// - `primary_with_backups`: Primary first, Mirrors always, Backups lazily in
///   priority order only when Primary fails; the first successful Backup stops
///   the failover chain.
///
/// This keeps the multi-cloud business rule out of Tauri commands and makes it
/// reusable by Typora, the desktop UI and a future local HTTP API.
pub struct PublisherCore;

impl PublisherCore {
    pub async fn publish_group(
        strategy: StorageGroupStrategy,
        members: Vec<PublishMember>,
        bytes: Bytes,
        remote_path: String,
        mime_type: String,
    ) -> Result<Vec<PublishOutcome>, ApplicationError> {
        match strategy {
            StorageGroupStrategy::MirrorAll => {
                let uploads = members.into_iter().map(|member| {
                    Self::upload_member(
                        member,
                        bytes.clone(),
                        remote_path.clone(),
                        mime_type.clone(),
                    )
                });
                Ok(futures::future::join_all(uploads).await)
            }
            StorageGroupStrategy::PrimaryWithBackups => {
                let primary = members
                    .iter()
                    .find(|member| member.role == DeploymentRole::Primary)
                    .cloned()
                    .ok_or(ApplicationError::MissingPrimary)?;

                let primary_outcome = Self::upload_member(
                    primary,
                    bytes.clone(),
                    remote_path.clone(),
                    mime_type.clone(),
                )
                .await;
                let primary_succeeded = primary_outcome.error.is_none();
                let mut outcomes = vec![primary_outcome];

                // Mirrors are replicas, not failover targets, so they always run.
                let mirror_uploads = members
                    .iter()
                    .filter(|member| member.role == DeploymentRole::Mirror)
                    .cloned()
                    .map(|member| {
                        Self::upload_member(
                            member,
                            bytes.clone(),
                            remote_path.clone(),
                            mime_type.clone(),
                        )
                    });
                outcomes.extend(futures::future::join_all(mirror_uploads).await);

                if !primary_succeeded {
                    let mut backups = members
                        .into_iter()
                        .filter(|member| member.role == DeploymentRole::Backup)
                        .collect::<Vec<_>>();
                    backups.sort_by_key(|member| member.priority);
                    for backup in backups {
                        let outcome = Self::upload_member(
                            backup,
                            bytes.clone(),
                            remote_path.clone(),
                            mime_type.clone(),
                        )
                        .await;
                        let succeeded = outcome.error.is_none();
                        outcomes.push(outcome);
                        if succeeded {
                            break;
                        }
                    }
                }

                Ok(outcomes)
            }
        }
    }

    async fn upload_member(
        member: PublishMember,
        bytes: Bytes,
        remote_path: String,
        mime_type: String,
    ) -> PublishOutcome {
        let provider = match member.provider {
            Ok(provider) => provider,
            Err(error) => {
                return PublishOutcome {
                    storage_id: member.storage_id,
                    storage_name: member.storage_name,
                    role: member.role,
                    remote_path,
                    public_url: None,
                    error: Some(error),
                };
            }
        };
        let result = provider
            .upload(UploadRequest {
                path: remote_path.clone(),
                content_type: Some(mime_type),
                body: bytes,
            })
            .await;

        match result {
            Ok(upload) => PublishOutcome {
                storage_id: member.storage_id,
                storage_name: member.storage_name,
                role: member.role,
                remote_path: upload.remote_path,
                public_url: upload.public_url,
                error: None,
            },
            Err(error) => PublishOutcome {
                storage_id: member.storage_id,
                storage_name: member.storage_name,
                role: member.role,
                remote_path,
                public_url: None,
                error: Some(error.to_string()),
            },
        }
    }
}

/// Provider-agnostic cloud file mutation orchestration.
///
/// Tauri/UI code owns persistence and confirmation, while this core owns
/// overwrite prevention plus native-move/fallback-copy semantics so future
/// CLI/HTTP entry points do not reimplement cloud mutation rules.
pub struct CloudMutationCore;

impl CloudMutationCore {
    pub async fn path_exists(
        provider: &dyn StorageProvider,
        path: &str,
    ) -> Result<bool, StorageError> {
        let parent = path
            .rsplit_once('/')
            .map(|(parent, _)| parent)
            .unwrap_or("");
        let entries = provider.list(parent).await?;
        Ok(entries
            .iter()
            .any(|entry| entry.path.trim_matches('/') == path.trim_matches('/')))
    }

    pub async fn move_object(
        provider: &dyn StorageProvider,
        source: &str,
        destination: &str,
    ) -> Result<UploadResult, StorageError> {
        if Self::path_exists(provider, destination).await? {
            return Err(StorageError::Provider(format!(
                "destination already exists: {destination}"
            )));
        }

        if provider.capabilities().move_object {
            match provider.move_object(source, destination).await {
                Ok(result) => return Ok(result),
                Err(StorageError::Unsupported | StorageError::NotImplemented) => {}
                Err(error) => return Err(error),
            }
        }

        let capabilities = provider.capabilities();
        if !(capabilities.download && capabilities.upload && capabilities.delete) {
            return Err(StorageError::Unsupported);
        }

        let body = provider.download(source).await?;
        let uploaded = provider
            .upload(UploadRequest {
                path: destination.to_string(),
                content_type: mime_guess::from_path(destination)
                    .first()
                    .map(|mime| mime.essence_str().to_string()),
                body,
            })
            .await?;

        if let Err(delete_error) = provider.delete(source).await {
            let rollback = provider.delete(destination).await;
            return Err(StorageError::Provider(match rollback {
                Ok(()) => format!(
                    "destination uploaded, source delete failed, destination rolled back: {delete_error}"
                ),
                Err(rollback_error) => format!(
                    "destination uploaded, source delete failed, rollback failed: source={delete_error}; rollback={rollback_error}"
                ),
            }));
        }

        Ok(uploaded)
    }
}
