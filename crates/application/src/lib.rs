use std::{collections::HashMap, sync::Arc};

use bytes::Bytes;
use domain::{DeploymentRole, StorageGroupStrategy, StorageId};
use storage_core::{
    StorageEntry, StorageError, StorageProvider, UploadRequest, UploadResult, VerificationOutcome,
};
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
    /// Passed straight through from the adapter. `None` means that path verified nothing, which is
    /// not the same as a failed verification - see `storage_core::VerificationOutcome`.
    pub verification: Option<VerificationOutcome>,
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
    /// The single public-URL pick for any strategy outcome list: the Primary's
    /// URL when the Primary succeeded, otherwise the first successful **Backup**
    /// (outcomes are ordered primary → mirrors → backups-by-priority). A Mirror
    /// never takes over the main URL — replicas are not failover targets.
    pub fn select_public_url(outcomes: &[PublishOutcome]) -> Option<String> {
        if let Some(primary) = outcomes
            .iter()
            .find(|outcome| outcome.role == DeploymentRole::Primary && outcome.error.is_none())
        {
            return primary.public_url.clone();
        }
        outcomes
            .iter()
            .find(|outcome| {
                outcome.role == DeploymentRole::Backup
                    && outcome.error.is_none()
                    && outcome.public_url.is_some()
            })
            .and_then(|outcome| outcome.public_url.clone())
    }

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

                // Mirrors are replicas and Backups are failover targets: neither may
                // gate the other. All three lanes run concurrently; each lane's outcomes
                // are concatenated in its own role order (primary, then mirrors, then
                // backups ascending by priority) so a caller picking "first successful"
                // gets the Backup that took over, never a Mirror that merely copied.
                let mirror_members = members
                    .iter()
                    .filter(|member| member.role == DeploymentRole::Mirror)
                    .cloned()
                    .collect::<Vec<_>>();
                let mut backup_members = members
                    .into_iter()
                    .filter(|member| member.role == DeploymentRole::Backup)
                    .collect::<Vec<_>>();
                backup_members.sort_by_key(|member| member.priority);

                let primary_future = Self::upload_member(
                    primary,
                    bytes.clone(),
                    remote_path.clone(),
                    mime_type.clone(),
                );
                // The backup lane's async block moves its captures, so hand it owned
                // clones; the mirror closures below borrow theirs instead.
                let backup_bytes = bytes.clone();
                let backup_path = remote_path.clone();
                let backup_mime = mime_type.clone();
                let mirror_futures = mirror_members.into_iter().map(|member| {
                    Self::upload_member(
                        member,
                        bytes.clone(),
                        remote_path.clone(),
                        mime_type.clone(),
                    )
                });
                let backup_future = async move {
                    let mut taken = Vec::new();
                    for backup in backup_members {
                        let outcome = Self::upload_member(
                            backup,
                            backup_bytes.clone(),
                            backup_path.clone(),
                            backup_mime.clone(),
                        )
                        .await;
                        let succeeded = outcome.error.is_none();
                        taken.push(outcome);
                        if succeeded {
                            break;
                        }
                    }
                    taken
                };

                let (primary_outcome, mirror_outcomes, backup_outcomes) = futures::future::join3(
                    primary_future,
                    futures::future::join_all(mirror_futures),
                    backup_future,
                )
                .await;
                let mut outcomes = vec![primary_outcome];
                outcomes.extend(mirror_outcomes);
                outcomes.extend(backup_outcomes);

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
                    verification: None,
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
                verification: upload.verification,
            },
            Err(error) => PublishOutcome {
                storage_id: member.storage_id,
                storage_name: member.storage_name,
                role: member.role,
                remote_path,
                public_url: None,
                error: Some(error.to_string()),
                // No verdict without an object to have looked at.
                verification: None,
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
    async fn find_entry(
        provider: &dyn StorageProvider,
        path: &str,
    ) -> Result<Option<StorageEntry>, StorageError> {
        let parent = path
            .rsplit_once('/')
            .map(|(parent, _)| parent)
            .unwrap_or("");
        let entries = provider.list(parent).await?;
        Ok(entries
            .into_iter()
            .find(|entry| entry.path.trim_matches('/') == path.trim_matches('/')))
    }

    pub async fn move_object(
        provider: &dyn StorageProvider,
        source: &str,
        destination: &str,
    ) -> Result<UploadResult, StorageError> {
        if provider.exists(destination).await? {
            if provider.exists(source).await? {
                return Err(StorageError::Provider(format!(
                    "destination already exists: {destination}"
                )));
            }

            // The remote move already landed and only the local index write failed. Rebuild the
            // destination metadata so the caller can finish syncing instead of being locked out.
            let Some(entry) = Self::find_entry(provider, destination).await? else {
                return Err(StorageError::Provider(format!(
                    "{destination} exists remotely but could not be listed to repair the local index; sync the cloud index, then retry"
                )));
            };
            return Ok(UploadResult {
                remote_path: destination.to_string(),
                public_url: entry.public_url,
                etag: None,
                // Listing proved presence only; no identity or size was compared.
                verification: None,
            });
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

#[cfg(test)]
mod tests {
    use super::{PublishOutcome, PublisherCore};
    use domain::{DeploymentRole, StorageId};
    use uuid::Uuid;

    fn outcome(role: DeploymentRole, ok: bool, url: Option<&str>) -> PublishOutcome {
        PublishOutcome {
            storage_id: Uuid::nil(),
            storage_name: "s".into(),
            role,
            remote_path: "p".into(),
            public_url: url.map(str::to_string),
            error: if ok { None } else { Some("boom".into()) },
            verification: None,
        }
    }

    #[test]
    fn mirrors_never_take_over_the_public_url() {
        let backup_url = "https://backup.example/a.png";
        let outcomes = vec![
            outcome(DeploymentRole::Primary, false, None),
            outcome(
                DeploymentRole::Mirror,
                true,
                Some("https://mirror.example/a.png"),
            ),
            outcome(DeploymentRole::Backup, true, Some(backup_url)),
        ];
        assert_eq!(
            PublisherCore::select_public_url(&outcomes).as_deref(),
            Some(backup_url)
        );
    }

    #[test]
    fn primary_wins_when_it_succeeds() {
        let outcomes = vec![
            outcome(
                DeploymentRole::Primary,
                true,
                Some("https://primary.example/a.png"),
            ),
            outcome(
                DeploymentRole::Backup,
                true,
                Some("https://backup.example/a.png"),
            ),
        ];
        assert_eq!(
            PublisherCore::select_public_url(&outcomes).as_deref(),
            Some("https://primary.example/a.png")
        );
    }
}
