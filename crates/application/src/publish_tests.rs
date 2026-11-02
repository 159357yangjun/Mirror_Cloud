//! Call-level policy tests: all providers are memory-only, with no filesystem or network I/O.
use std::{
    future::Future,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    task::Context,
};

use async_trait::async_trait;
use bytes::Bytes;
use domain::{DeploymentRole, StorageCapabilities, StorageGroupStrategy};
use futures::{channel::oneshot, executor::block_on, task::noop_waker_ref};
use storage_core::{ConnectionReport, StorageError, StorageProvider, UploadRequest, UploadResult};
use uuid::Uuid;

use super::{ApplicationError, PublishMember, PublishOutcome, PublisherCore};

#[derive(Clone, Copy)]
enum Reply {
    Public,
    Private,
    Fail,
}

struct MemoryProvider {
    name: &'static str,
    reply: Reply,
    uploads: AtomicUsize,
    gate: Mutex<Option<oneshot::Receiver<()>>>,
}

impl MemoryProvider {
    fn calls(&self) -> usize {
        self.uploads.load(Ordering::SeqCst)
    }
}

#[async_trait]
impl StorageProvider for MemoryProvider {
    fn provider_key(&self) -> &'static str {
        "memory-policy-test"
    }

    fn capabilities(&self) -> StorageCapabilities {
        StorageCapabilities {
            upload: true,
            public_url: matches!(self.reply, Reply::Public),
            ..Default::default()
        }
    }

    async fn test_connection(&self) -> Result<ConnectionReport, StorageError> {
        Ok(ConnectionReport {
            reachable: true,
            detail: "memory only".into(),
        })
    }

    async fn upload(&self, request: UploadRequest) -> Result<UploadResult, StorageError> {
        self.uploads.fetch_add(1, Ordering::SeqCst);
        let gate = self.gate.lock().expect("test gate lock").take();
        if let Some(gate) = gate {
            gate.await.expect("test releases the provider gate");
        }
        if matches!(self.reply, Reply::Fail) {
            return Err(StorageError::Network(format!("{} unavailable", self.name)));
        }
        Ok(UploadResult {
            public_url: matches!(self.reply, Reply::Public)
                .then(|| format!("https://{}.example/{}", self.name, request.path)),
            remote_path: request.path,
            etag: None,
            verification: None,
        })
    }

    async fn delete(&self, _path: &str) -> Result<(), StorageError> {
        Err(StorageError::Unsupported)
    }
}

fn gated_member(
    name: &'static str,
    role: DeploymentRole,
    priority: i32,
    reply: Reply,
    gate: Option<oneshot::Receiver<()>>,
) -> (PublishMember, Arc<MemoryProvider>) {
    let provider = Arc::new(MemoryProvider {
        name,
        reply,
        uploads: AtomicUsize::new(0),
        gate: Mutex::new(gate),
    });
    let erased: Arc<dyn StorageProvider> = provider.clone();
    (
        PublishMember {
            storage_id: Uuid::new_v4(),
            storage_name: name.into(),
            role,
            priority,
            provider: Ok(erased),
        },
        provider,
    )
}

fn member(
    name: &'static str,
    role: DeploymentRole,
    priority: i32,
    reply: Reply,
) -> (PublishMember, Arc<MemoryProvider>) {
    gated_member(name, role, priority, reply, None)
}

async fn publish(
    strategy: StorageGroupStrategy,
    members: Vec<PublishMember>,
) -> Result<Vec<PublishOutcome>, ApplicationError> {
    PublisherCore::publish_group(
        strategy,
        members,
        Bytes::from_static(b"memory image"),
        "images/test.png".into(),
        "image/png".into(),
    )
    .await
}

fn names(outcomes: &[PublishOutcome]) -> Vec<&str> {
    outcomes
        .iter()
        .map(|outcome| outcome.storage_name.as_str())
        .collect()
}

#[test]
fn primary_success_never_uploads_backups_even_if_a_mirror_fails() {
    let (primary, p) = member("primary", DeploymentRole::Primary, 0, Reply::Public);
    let (mirror, m) = member("mirror", DeploymentRole::Mirror, 0, Reply::Fail);
    let (backup1, b1) = member("backup1", DeploymentRole::Backup, 10, Reply::Fail);
    let (backup2, b2) = member("backup2", DeploymentRole::Backup, 20, Reply::Public);
    let outcomes = block_on(publish(
        StorageGroupStrategy::PrimaryWithBackups,
        vec![primary, mirror, backup1, backup2],
    ))
    .unwrap();

    assert_eq!(p.calls(), 1);
    assert_eq!(m.calls(), 1, "mirrors always run");
    assert_eq!(b1.calls(), 0, "a failed mirror must not activate a backup");
    assert_eq!(b2.calls(), 0);
    assert_eq!(names(&outcomes), vec!["primary", "mirror"]);
}

#[test]
fn private_primary_success_is_not_a_reason_to_activate_backup() {
    let (primary, p) = member("private", DeploymentRole::Primary, 0, Reply::Private);
    let (mirror, m) = member("mirror", DeploymentRole::Mirror, 0, Reply::Public);
    let (backup, b) = member("backup", DeploymentRole::Backup, 0, Reply::Public);
    let outcomes = block_on(publish(
        StorageGroupStrategy::PrimaryWithBackups,
        vec![primary, mirror, backup],
    ))
    .unwrap();

    assert_eq!((p.calls(), m.calls(), b.calls()), (1, 1, 0));
    assert_eq!(names(&outcomes), vec!["private", "mirror"]);
    assert_eq!(PublisherCore::select_public_url(&outcomes), None);
}

#[test]
fn primary_failure_tries_backups_in_priority_order_and_stops_after_success() {
    let (primary, p) = member("primary", DeploymentRole::Primary, 0, Reply::Fail);
    let (mirror, m) = member("mirror", DeploymentRole::Mirror, 0, Reply::Public);
    let (late, late_calls) = member("late", DeploymentRole::Backup, 30, Reply::Public);
    let (first, first_calls) = member("first", DeploymentRole::Backup, 10, Reply::Fail);
    let (winner, winner_calls) = member("winner", DeploymentRole::Backup, 20, Reply::Public);
    let outcomes = block_on(publish(
        StorageGroupStrategy::PrimaryWithBackups,
        vec![primary, late, mirror, winner, first],
    ))
    .unwrap();

    assert_eq!(
        (
            p.calls(),
            m.calls(),
            first_calls.calls(),
            winner_calls.calls(),
            late_calls.calls()
        ),
        (1, 1, 1, 1, 0)
    );
    assert_eq!(
        names(&outcomes),
        vec!["primary", "mirror", "first", "winner"]
    );
    assert_eq!(
        PublisherCore::select_public_url(&outcomes).as_deref(),
        Some("https://winner.example/images/test.png")
    );
}

#[test]
fn backup_waits_until_the_primary_failure_is_known() {
    let (release, gate) = oneshot::channel();
    let (primary, p) = gated_member(
        "primary",
        DeploymentRole::Primary,
        0,
        Reply::Fail,
        Some(gate),
    );
    let (mirror, m) = member("mirror", DeploymentRole::Mirror, 0, Reply::Public);
    let (backup, b) = member("backup", DeploymentRole::Backup, 0, Reply::Public);
    let mut pending = Box::pin(publish(
        StorageGroupStrategy::PrimaryWithBackups,
        vec![primary, mirror, backup],
    ));
    let mut context = Context::from_waker(noop_waker_ref());

    assert!(pending.as_mut().poll(&mut context).is_pending());
    assert_eq!((p.calls(), m.calls(), b.calls()), (1, 1, 0));
    release.send(()).unwrap();
    let outcomes = block_on(pending).unwrap();
    assert_eq!(b.calls(), 1);
    assert_eq!(
        PublisherCore::select_public_url(&outcomes).as_deref(),
        Some("https://backup.example/images/test.png")
    );
}

#[test]
fn a_slow_mirror_does_not_delay_backup_after_primary_failure() {
    let (release, gate) = oneshot::channel();
    let (primary, p) = member("primary", DeploymentRole::Primary, 0, Reply::Fail);
    let (mirror, m) = gated_member(
        "mirror",
        DeploymentRole::Mirror,
        0,
        Reply::Public,
        Some(gate),
    );
    let (backup, b) = member("backup", DeploymentRole::Backup, 0, Reply::Public);
    let mut pending = Box::pin(publish(
        StorageGroupStrategy::PrimaryWithBackups,
        vec![primary, mirror, backup],
    ));
    let mut context = Context::from_waker(noop_waker_ref());

    assert!(pending.as_mut().poll(&mut context).is_pending());
    assert_eq!((p.calls(), m.calls(), b.calls()), (1, 1, 1));
    release.send(()).unwrap();
    let outcomes = block_on(pending).unwrap();
    assert_eq!(names(&outcomes), vec!["primary", "mirror", "backup"]);
    assert_eq!(
        PublisherCore::select_public_url(&outcomes).as_deref(),
        Some("https://backup.example/images/test.png")
    );
}

#[test]
fn mirror_all_still_attempts_every_member() {
    let (primary, p) = member("primary", DeploymentRole::Primary, 0, Reply::Public);
    let (mirror, m) = member("mirror", DeploymentRole::Mirror, 0, Reply::Public);
    let (backup, b) = member("backup", DeploymentRole::Backup, 0, Reply::Fail);
    let outcomes = block_on(publish(
        StorageGroupStrategy::MirrorAll,
        vec![primary, mirror, backup],
    ))
    .unwrap();

    assert_eq!((p.calls(), m.calls(), b.calls()), (1, 1, 1));
    assert_eq!(names(&outcomes), vec!["primary", "mirror", "backup"]);
    assert!(outcomes[2].error.is_some());
}

#[test]
fn all_backups_failing_does_not_make_a_mirror_the_main_url() {
    let (primary, _) = member("primary", DeploymentRole::Primary, 0, Reply::Fail);
    let (mirror, m) = member("mirror", DeploymentRole::Mirror, 0, Reply::Public);
    let (backup1, b1) = member("backup1", DeploymentRole::Backup, 10, Reply::Fail);
    let (backup2, b2) = member("backup2", DeploymentRole::Backup, 20, Reply::Fail);
    let outcomes = block_on(publish(
        StorageGroupStrategy::PrimaryWithBackups,
        vec![primary, mirror, backup2, backup1],
    ))
    .unwrap();

    assert_eq!((m.calls(), b1.calls(), b2.calls()), (1, 1, 1));
    assert_eq!(
        names(&outcomes),
        vec!["primary", "mirror", "backup1", "backup2"]
    );
    assert_eq!(PublisherCore::select_public_url(&outcomes), None);
}

#[test]
fn a_missing_primary_is_rejected_before_any_upload() {
    let (mirror, m) = member("mirror", DeploymentRole::Mirror, 0, Reply::Public);
    let (backup, b) = member("backup", DeploymentRole::Backup, 0, Reply::Public);
    let result = block_on(publish(
        StorageGroupStrategy::PrimaryWithBackups,
        vec![mirror, backup],
    ));

    assert!(matches!(result, Err(ApplicationError::MissingPrimary)));
    assert_eq!((m.calls(), b.calls()), (0, 0));
}
