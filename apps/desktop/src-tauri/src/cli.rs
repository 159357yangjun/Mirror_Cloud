use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use application::{PublishMember, PublishOutcome, PublisherCore};
use bytes::Bytes;
use chrono::Utc;
use credential_store::CredentialStore;
use domain::{
    Asset, AssetKind, AssetVariant, Deployment, DeploymentRole, DeploymentStatus, PublishTarget,
    StorageGroupStrategy, Workflow, WorkflowStep,
};
use persistence_sqlite::{
    AssetPluginOutputRecord, AssetRepository, DeploymentWriteRecord, PluginRepository,
    SettingsRepository, StorageGroupRecord, StorageGroupRepository, StorageRecord,
    StorageRepository, TaskRepository, WorkflowRepository,
};
use plugin_runtime::{PluginContext, PluginHook, PluginManifest, PluginPermission};
use storage_core::StorageProvider;
use storage_gitee::{GiteeCredentials, GiteeStorage, GiteeStorageConfig};
use storage_github::{GitHubCredentials, GitHubStorage, GitHubStorageConfig};
use storage_opendal::{
    CosCredentials, CosStorageConfig, OpenDalStorage, OssCredentials, OssStorageConfig,
    S3Credentials, S3StorageConfig, WebDavCredentials, WebDavStorageConfig,
};
use task_engine::TaskEngine;
use uuid::Uuid;
use workflow_engine::prepare_asset;

const DEFAULT_TARGET_KEY: &str = "publish.default_target";
const SYSTEM_PIPELINE_SOURCE: &str = "__system_default__";
const AI_SETTINGS_KEY: &str = "ai.provider";
const AI_CREDENTIAL_KEY: &str = "ai:provider";

fn is_safe_compensation_path(path: &str) -> bool {
    path.split(|character: char| !character.is_ascii_alphanumeric())
        .any(|segment| {
            segment.len() == 33
                && segment.starts_with('u')
                && segment[1..]
                    .chars()
                    .all(|character| character.is_ascii_hexdigit())
        })
}

async fn rollback_successful_uploads(
    context: &CliContext,
    outcomes: &[PublishOutcome],
) -> Vec<String> {
    let mut failures = Vec::new();
    for outcome in outcomes.iter().filter(|outcome| outcome.error.is_none()) {
        if !is_safe_compensation_path(&outcome.remote_path) {
            failures.push(format!(
                "{}: rollback skipped for legacy/non-unique path {}",
                outcome.storage_name, outcome.remote_path
            ));
            continue;
        }
        let storage = match context.storages.get(outcome.storage_id).await {
            Ok(Some(storage)) => storage,
            Ok(None) => {
                failures.push(format!(
                    "{}: storage no longer exists",
                    outcome.storage_name
                ));
                continue;
            }
            Err(error) => {
                failures.push(format!(
                    "{}: cannot reload storage for rollback: {error}",
                    outcome.storage_name
                ));
                continue;
            }
        };
        let provider = match build_provider(context, &storage) {
            Ok(provider) => provider,
            Err(error) => {
                failures.push(format!(
                    "{}: cannot rebuild provider for rollback: {error}",
                    outcome.storage_name
                ));
                continue;
            }
        };
        if let Err(error) = provider.delete(&outcome.remote_path).await {
            failures.push(format!(
                "{}: rollback delete failed: {error}",
                outcome.storage_name
            ));
        }
    }
    failures
}

struct CliContext {
    storages: StorageRepository,
    groups: StorageGroupRepository,
    workflows: WorkflowRepository,
    assets: AssetRepository,
    tasks: TaskEngine,
    plugins: PluginRepository,
    settings: SettingsRepository,
    /// Typora uploads must land in the same journal as desktop uploads; a half-wired log (one
    /// entry point recording, the other silently not) is worse than no log, because the gaps look
    /// like real history.
    journal: persistence_sqlite::journal::SqliteEventJournal,
    credentials: CredentialStore,
}

pub async fn upload_with_default_workflow(
    data_dir: &Path,
    paths: &[PathBuf],
) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Err("Typora did not pass any image files".into());
    }
    // Validate the complete local batch before the first upload so an invalid
    // later path cannot leave earlier files uploaded while the command exits
    // before returning their URLs.
    for path in paths {
        if !path.is_file() {
            return Err(format!("Image file does not exist: {}", path.display()));
        }
        let mime = mime_guess::from_path(path)
            .first_or_octet_stream()
            .essence_str()
            .to_string();
        if !mime.starts_with("image/") {
            return Err(format!(
                "Only image files are supported: {}",
                path.display()
            ));
        }
    }

    std::fs::create_dir_all(data_dir).map_err(|error| {
        format!(
            "Cannot create application data directory {}: {error}",
            data_dir.display()
        )
    })?;
    let pool = persistence_sqlite::connect_path(&data_dir.join("publisher.sqlite3"))
        .await
        .map_err(|error| format!("Cannot open Publisher database: {error}"))?;
    persistence_sqlite::migrate(&pool)
        .await
        .map_err(|error| format!("Cannot migrate Publisher database: {error}"))?;

    let task_repo = TaskRepository::new(pool.clone());
    let context = CliContext {
        storages: StorageRepository::new(pool.clone()),
        groups: StorageGroupRepository::new(pool.clone()),
        workflows: WorkflowRepository::new(pool.clone()),
        assets: AssetRepository::new(pool.clone()),
        tasks: TaskEngine::new(task_repo),
        plugins: PluginRepository::new(pool.clone()),
        settings: SettingsRepository::new(pool.clone()),
        journal: persistence_sqlite::journal::SqliteEventJournal::new(pool),
        credentials: CredentialStore::new("com.multicloud.publisher"),
    };

    let workflow_record = ensure_default_workflow(&context).await?;

    preflight_target(&context, &workflow_record.workflow).await?;

    let mut urls = Vec::with_capacity(paths.len());
    for path in paths {
        let task = context
            .tasks
            .create(
                "typora_publish",
                serde_json::json!({
                    "path": path.to_string_lossy(),
                    "workflowId": workflow_record.workflow.id.to_string(),
                    "workflowName": workflow_record.workflow.name.clone(),
                }),
            )
            .await
            .map_err(|error| error.to_string())?;

        context
            .tasks
            .mark_preparing(task.id, 5)
            .await
            .map_err(|error| error.to_string())?;

        match publish_one(&context, &workflow_record.workflow, path, task.id).await {
            Ok((url, warnings)) => {
                if warnings.is_empty() {
                    context
                        .tasks
                        .complete(task.id)
                        .await
                        .map_err(|error| error.to_string())?;
                } else {
                    let note = warnings.join(" | ");
                    context
                        .tasks
                        .complete_with_note(task.id, note.clone())
                        .await
                        .map_err(|error| error.to_string())?;
                    eprintln!("Publisher warning: {note}");
                }
                urls.push(url);
            }
            Err(error) => {
                let asset_name = path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("asset");
                let mime_type = mime_guess::from_path(path)
                    .first_or_octet_stream()
                    .essence_str()
                    .to_string();
                let (_, hook_warnings) = run_enabled_plugins_for_hook(
                    &context,
                    PluginHook::OnPublishFailure,
                    asset_name,
                    None,
                    &mime_type,
                    serde_json::json!({"source":"cli","taskId":task.id.to_string(),"path":path.to_string_lossy(),"error":error.clone()}),
                ).await;
                if !hook_warnings.is_empty() {
                    eprintln!(
                        "Publisher failure-hook warning: {}",
                        hook_warnings.join(" | ")
                    );
                }
                let _ = context.tasks.fail(task.id, error.clone()).await;
                return Err(error);
            }
        }
    }

    Ok(urls)
}

async fn ensure_default_workflow(
    context: &CliContext,
) -> Result<persistence_sqlite::WorkflowRecord, String> {
    let rows = context
        .workflows
        .list()
        .await
        .map_err(|e| format!("Cannot load workflows: {e}"))?;
    let mut target: Option<PublishTarget> = None;
    if let Some(setting) = context
        .settings
        .get(DEFAULT_TARGET_KEY)
        .await
        .map_err(|e| e.to_string())?
    {
        let kind = setting
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        let id = setting
            .get("id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        if let Ok(uuid) = Uuid::parse_str(id) {
            target = match kind {
                "storage" => Some(PublishTarget::Storage { storage_id: uuid }),
                "group" => Some(PublishTarget::StorageGroup {
                    storage_group_id: uuid,
                }),
                _ => None,
            };
        }
    }
    if target.is_none() {
        target = rows.iter().find(|r| r.is_default).and_then(|r| {
            r.workflow.steps.iter().find_map(|step| match step {
                WorkflowStep::Publish { target } => Some(target.clone()),
                _ => None,
            })
        });
    }
    if target.is_none() {
        if let Some(storage) = context
            .storages
            .list()
            .await
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|s| s.enabled)
        {
            target = Some(PublishTarget::Storage {
                storage_id: storage.id,
            });
        }
    }
    let target = target.ok_or_else(|| {
        "No upload target is configured. Open Publisher and connect one cloud storage first."
            .to_string()
    })?;
    match &target {
        PublishTarget::Storage { storage_id } => {
            context
                .storages
                .get(*storage_id)
                .await
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Default storage no longer exists".to_string())?;
        }
        PublishTarget::StorageGroup { storage_group_id } => {
            context
                .groups
                .get(*storage_group_id)
                .await
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Default storage group no longer exists".to_string())?;
        }
    }
    let setting = match &target {
        PublishTarget::Storage { storage_id } => {
            serde_json::json!({"kind":"storage","id":storage_id.to_string()})
        }
        PublishTarget::StorageGroup { storage_group_id } => {
            serde_json::json!({"kind":"group","id":storage_group_id.to_string()})
        }
    };
    context
        .settings
        .set(DEFAULT_TARGET_KEY, &setting)
        .await
        .map_err(|e| e.to_string())?;
    let chain_image_format =
        crate::commands::integrations::default_chain_image_format(&context.settings).await;
    let workflow = Workflow {
        id: Uuid::new_v4(),
        name: "自动上传链".into(),
        steps: vec![
            WorkflowStep::Resize {
                max_width: 1920,
                max_height: 1920,
            },
            WorkflowStep::Convert {
                format: chain_image_format,
                quality: 90,
            },
            WorkflowStep::Rename {
                template: "uploads/{year}/{month}/{hash:12}-u{uuid}-{stem}.{ext}".into(),
            },
            WorkflowStep::Publish { target },
            WorkflowStep::Output {
                template: "{url}".into(),
            },
        ],
    };
    context
        .workflows
        .upsert_system_default(
            &workflow,
            "由 Publisher 自动维护；用户只需要选择默认云端并开关插件。",
            SYSTEM_PIPELINE_SOURCE,
        )
        .await
        .map_err(|e| e.to_string())?;
    context
        .workflows
        .list()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|r| r.is_default)
        .ok_or_else(|| "Cannot create default upload pipeline".to_string())
}

async fn load_ai_settings(context: &CliContext) -> serde_json::Value {
    let mut settings = context
        .settings
        .get(AI_SETTINGS_KEY)
        .await
        .ok()
        .flatten()
        .unwrap_or(serde_json::json!({"baseUrl":"https://api.openai.com/v1","model":""}));
    let legacy = settings
        .get("apiKey")
        .and_then(serde_json::Value::as_str)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    if let Some(legacy) = legacy {
        let _ = context.credentials.set_json(AI_CREDENTIAL_KEY, &legacy);
        if let Some(obj) = settings.as_object_mut() {
            obj.remove("apiKey");
        }
        let _ = context.settings.set(AI_SETTINGS_KEY, &settings).await;
    }
    let key = context
        .credentials
        .get_json::<String>(AI_CREDENTIAL_KEY)
        .unwrap_or_default();
    if let Some(obj) = settings.as_object_mut() {
        obj.insert("apiKey".into(), serde_json::Value::String(key));
    }
    settings
}

async fn preflight_target(context: &CliContext, workflow: &Workflow) -> Result<(), String> {
    let target = workflow
        .steps
        .iter()
        .find_map(|step| match step {
            domain::WorkflowStep::Publish { target } => Some(target.clone()),
            _ => None,
        })
        .ok_or_else(|| "The default workflow has no publishing target".to_string())?;

    match target {
        PublishTarget::Storage { storage_id } => {
            let record = context
                .storages
                .get(storage_id)
                .await
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    "The default workflow points to a storage that no longer exists".to_string()
                })?;
            let _ = build_provider(context, &record)?;
        }
        PublishTarget::StorageGroup { storage_group_id } => {
            let group = context
                .groups
                .get(storage_group_id)
                .await
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    "The default workflow points to a storage group that no longer exists"
                        .to_string()
                })?;
            let mut viable = 0usize;
            for member in &group.members {
                let Some(record) = context
                    .storages
                    .get(member.storage_id)
                    .await
                    .map_err(|e| e.to_string())?
                else {
                    continue;
                };
                if build_provider(context, &record).is_ok() {
                    viable += 1;
                }
            }
            if viable == 0 {
                return Err("The storage group has no locally configured publish target".into());
            }
        }
    }
    Ok(())
}

async fn publish_one(
    context: &CliContext,
    workflow: &Workflow,
    path: &Path,
    task_id: Uuid,
) -> Result<(String, Vec<String>), String> {
    if !path.is_file() {
        return Err(format!("Image file does not exist: {}", path.display()));
    }
    let raw_bytes = tokio::fs::read(path)
        .await
        .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("image.png")
        .to_string();
    let mime_type = mime_guess::from_path(path)
        .first_or_octet_stream()
        .essence_str()
        .to_string();
    if !mime_type.starts_with("image/") {
        return Err(format!("Only image files are supported: {file_name}"));
    }

    context
        .tasks
        .mark_running(task_id, 20)
        .await
        .map_err(|error| error.to_string())?;
    let (_, before_process_warnings) = run_enabled_plugins_for_hook(
        context,
        PluginHook::BeforeProcess,
        &file_name,
        None,
        &mime_type,
        serde_json::json!({"source":"cli","taskId":task_id.to_string(),"path":path.to_string_lossy()}),
    ).await;
    let processing_workflow = workflow.clone();
    let processing_file_name = file_name.clone();
    let processing_mime_type = mime_type.clone();
    let prepared = tokio::task::spawn_blocking(move || {
        prepare_asset(
            &processing_workflow,
            &raw_bytes,
            &processing_file_name,
            &processing_mime_type,
        )
    })
    .await
    .map_err(|error| format!("Image worker failed: {error}"))?
    .map_err(|error| format!("Workflow processing failed: {error}"))?;
    context
        .tasks
        .mark_running(task_id, 45)
        .await
        .map_err(|error| error.to_string())?;
    let (_, after_process_warnings) = run_enabled_plugins_for_hook(
        context,
        PluginHook::AfterProcess,
        &file_name,
        None,
        &prepared.mime_type,
        serde_json::json!({
            "source":"cli",
            "taskId":task_id.to_string(),
            "remotePath":prepared.remote_path.clone(),
            "variantLabel":prepared.variant_label.clone(),
            "width":prepared.width,
            "height":prepared.height,
            "sizeBytes":prepared.body.len()
        }),
    )
    .await;

    let outcomes = match prepared.target.clone() {
        PublishTarget::Storage { storage_id } => {
            let storage = context
                .storages
                .get(storage_id)
                .await
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "Workflow storage no longer exists".to_string())?;
            let provider = build_provider(context, &storage)?;
            PublisherCore::publish_group(
                StorageGroupStrategy::MirrorAll,
                vec![PublishMember {
                    storage_id: storage.id,
                    storage_name: storage.name,
                    role: DeploymentRole::Primary,
                    priority: 0,
                    provider: Ok(provider),
                }],
                prepared.body.clone(),
                prepared.remote_path.clone(),
                prepared.mime_type.clone(),
            )
            .await
            .map_err(|error| error.to_string())?
        }
        PublishTarget::StorageGroup { storage_group_id } => {
            let group = context
                .groups
                .get(storage_group_id)
                .await
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "Workflow storage group no longer exists".to_string())?;
            upload_group(
                context,
                &group,
                prepared.body.clone(),
                prepared.remote_path.clone(),
                prepared.mime_type.clone(),
            )
            .await?
        }
    };

    context
        .tasks
        .mark_running(task_id, 85)
        .await
        .map_err(|error| error.to_string())?;

    if outcomes.iter().all(|outcome| outcome.error.is_some()) {
        let details = outcomes
            .iter()
            .filter_map(|outcome| outcome.error.as_deref())
            .collect::<Vec<_>>()
            .join(" | ");
        return Err(format!("Upload failed: {details}"));
    }

    let now = Utc::now();
    let asset = Asset {
        id: Uuid::new_v4(),
        name: file_name,
        kind: AssetKind::Image,
        created_at: now,
        updated_at: now,
    };
    let variant = AssetVariant {
        id: Uuid::new_v4(),
        asset_id: asset.id,
        label: prepared.variant_label,
        mime_type: prepared.mime_type,
        size_bytes: prepared.body.len() as u64,
        width: prepared.width,
        height: prepared.height,
        content_hash: prepared.content_hash,
        created_at: now,
    };
    let deployments = outcomes
        .iter()
        .map(|outcome| DeploymentWriteRecord {
            deployment: Deployment {
                id: Uuid::new_v4(),
                variant_id: variant.id,
                storage_id: outcome.storage_id,
                role: outcome.role.clone(),
                remote_path: outcome.remote_path.clone(),
                public_url: outcome.public_url.clone(),
                status: if outcome.error.is_none() {
                    DeploymentStatus::Online
                } else {
                    DeploymentStatus::Failed
                },
                deployed_at: Some(now),
                recorded_at: Some(now),
            },
            last_error: outcome.error.clone(),
        })
        .collect::<Vec<_>>();
    let public_url = match PublisherCore::select_public_url(&outcomes) {
        Some(public_url) => public_url,
        None => {
            let rollback_failures = rollback_successful_uploads(context, &outcomes).await;
            let suffix = if rollback_failures.is_empty() {
                "; uploaded files were rolled back".to_string()
            } else {
                format!(
                    "; rollback was incomplete and orphan files may remain: {}",
                    rollback_failures.join(" | ")
                )
            };
            return Err(format!(
                "Upload succeeded but the provider did not return a public URL{suffix}"
            ));
        }
    };

    if let Err(error) = context
        .assets
        .insert_published_many(&asset, &variant, &deployments)
        .await
    {
        let rollback_failures = rollback_successful_uploads(context, &outcomes).await;
        let suffix = if rollback_failures.is_empty() {
            "; uploaded files were rolled back".to_string()
        } else {
            format!(
                "; rollback was incomplete and orphan files may remain: {}",
                rollback_failures.join(" | ")
            )
        };
        return Err(format!("Cannot record uploaded asset: {error}{suffix}"));
    }

    persistence_sqlite::journal::record_publish_events(
        &context.journal,
        asset.id,
        variant.id,
        &deployments,
        Some(public_url.as_str()),
    )
    .await;

    persistence_sqlite::journal::record_upload_attempts(&context.journal, variant.id, &deployments)
        .await;

    let mut warnings = before_process_warnings
        .into_iter()
        .chain(after_process_warnings.into_iter())
        .map(|warning| format!("plugin: {warning}"))
        .collect::<Vec<_>>();
    warnings.extend(
        outcomes
            .iter()
            .filter_map(|outcome| {
                outcome
                    .error
                    .as_ref()
                    .map(|error| format!("{} ({:?}): {error}", outcome.storage_name, outcome.role))
            })
            .collect::<Vec<_>>(),
    );
    let (outputs, plugin_warnings) = run_enabled_plugins_for_hook(
        context,
        PluginHook::AfterUpload,
        &asset.name,
        Some(&public_url),
        &variant.mime_type,
        serde_json::json!({"source":"cli","taskId":task_id.to_string()}),
    )
    .await;
    warnings.extend(
        plugin_warnings
            .into_iter()
            .map(|warning| format!("plugin: {warning}")),
    );
    if let Err(error) = context
        .assets
        .replace_plugin_outputs(asset.id, &outputs)
        .await
    {
        warnings.push(format!("cannot record plugin outputs: {error}"));
    }
    Ok((public_url, warnings))
}

async fn run_enabled_plugins_for_hook(
    context: &CliContext,
    hook: PluginHook,
    asset_name: &str,
    public_url: Option<&str>,
    mime_type: &str,
    metadata: serde_json::Value,
) -> (Vec<AssetPluginOutputRecord>, Vec<String>) {
    let rows = match context.plugins.list().await {
        Ok(rows) => rows,
        Err(error) => {
            return (
                Vec::new(),
                vec![format!("cannot load plugin list: {error}")],
            );
        }
    };
    let ai_settings = load_ai_settings(context).await;
    let mut failures = Vec::new();
    let mut outputs = Vec::new();
    for row in rows.into_iter().filter(|row| row.enabled) {
        let manifest: PluginManifest = match serde_json::from_value(row.manifest_json.clone()) {
            Ok(manifest) => manifest,
            Err(error) => {
                failures.push(format!("{}: invalid manifest ({error})", row.name));
                continue;
            }
        };
        let enabled_hooks: Vec<PluginHook> = serde_json::from_value(row.enabled_hooks_json.clone())
            .unwrap_or_else(|_| vec![PluginHook::AfterUpload]);
        if !enabled_hooks.contains(&hook) {
            continue;
        }
        let granted_permissions: Vec<PluginPermission> =
            serde_json::from_value(row.granted_permissions_json.clone()).unwrap_or_default();
        let mut config = row.config_json.clone();
        if matches!(manifest.kind, plugin_runtime::PluginKind::AiPrompt) {
            if let Some(obj) = config.as_object_mut() {
                for key in ["baseUrl", "model", "apiKey"] {
                    if obj
                        .get(key)
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("")
                        .is_empty()
                    {
                        if let Some(value) = ai_settings.get(key) {
                            obj.insert(key.into(), value.clone());
                        }
                    }
                }
            }
        }
        let plugin_context = PluginContext {
            asset_name: asset_name.to_string(),
            public_url: public_url.unwrap_or_default().to_string(),
            mime_type: mime_type.to_string(),
            metadata: metadata.clone(),
        };
        let started = std::time::Instant::now();
        let hook_name = serde_json::to_value(hook)
            .ok()
            .and_then(|value| value.as_str().map(str::to_string))
            .unwrap_or_else(|| format!("{hook:?}").to_lowercase());
        match plugin_runtime::execute_for_hook(
            &manifest,
            &granted_permissions,
            &config,
            &plugin_context,
            hook,
        )
        .await
        {
            Ok(output) => {
                let duration_ms = started.elapsed().as_millis().min(i64::MAX as u128) as i64;
                let _ = context
                    .plugins
                    .record_execution(
                        &manifest.id,
                        &manifest.name,
                        &hook_name,
                        "success",
                        duration_ms,
                        None,
                    )
                    .await;
                outputs.push(AssetPluginOutputRecord {
                    plugin_id: manifest.id.clone(),
                    plugin_name: manifest.name.clone(),
                    plugin_kind: format!("{:?}", manifest.kind).to_lowercase(),
                    text: output.text,
                    data_json: output.data,
                    created_at: Utc::now(),
                });
            }
            Err(error) => {
                let message = error.to_string();
                let audit: String = message.chars().take(1200).collect();
                let duration_ms = started.elapsed().as_millis().min(i64::MAX as u128) as i64;
                let _ = context
                    .plugins
                    .record_execution(
                        &manifest.id,
                        &manifest.name,
                        &hook_name,
                        "failed",
                        duration_ms,
                        Some(&audit),
                    )
                    .await;
                failures.push(format!("{}: {message}", manifest.name));
            }
        }
    }
    (outputs, failures)
}

async fn upload_group_member(
    context: &CliContext,
    member: &persistence_sqlite::StorageGroupMemberRecord,
) -> Result<PublishMember, String> {
    let role = role_from_str(&member.role)?;
    let provider = match context.storages.get(member.storage_id).await {
        Ok(Some(storage)) => build_provider(context, &storage)
            .map_err(|error| format!("Cannot initialize {}: {error}", member.storage_name)),
        Ok(None) => Err(format!("Storage {} no longer exists", member.storage_name)),
        Err(error) => Err(error.to_string()),
    };
    Ok(PublishMember {
        storage_id: member.storage_id,
        storage_name: member.storage_name.clone(),
        role,
        priority: member.priority,
        provider,
    })
}

async fn upload_group(
    context: &CliContext,
    group: &StorageGroupRecord,
    body: Bytes,
    remote_path: String,
    mime_type: String,
) -> Result<Vec<PublishOutcome>, String> {
    let strategy = match group.strategy.as_str() {
        "mirror_all" => StorageGroupStrategy::MirrorAll,
        "primary_with_backups" => StorageGroupStrategy::PrimaryWithBackups,
        other => return Err(format!("Unsupported Storage Group strategy: {other}")),
    };

    let mut members = Vec::with_capacity(group.members.len());
    for member in &group.members {
        members.push(upload_group_member(context, member).await?);
    }

    PublisherCore::publish_group(strategy, members, body, remote_path, mime_type)
        .await
        .map_err(|error| error.to_string())
}

fn role_from_str(value: &str) -> Result<DeploymentRole, String> {
    match value {
        "primary" => Ok(DeploymentRole::Primary),
        "mirror" => Ok(DeploymentRole::Mirror),
        "backup" => Ok(DeploymentRole::Backup),
        _ => Err(format!("Unsupported storage group role: {value}")),
    }
}

fn build_provider(
    context: &CliContext,
    record: &StorageRecord,
) -> Result<Arc<dyn StorageProvider>, String> {
    let credential_ref = record
        .credential_ref
        .as_deref()
        .ok_or_else(|| "Storage credential reference missing".to_string())?;
    match record.provider_key.as_str() {
        "r2" | "s3" => {
            let config: S3StorageConfig = serde_json::from_value(record.config_json.clone())
                .map_err(|error| error.to_string())?;
            let credentials: S3Credentials = context
                .credentials
                .get_json(credential_ref)
                .map_err(|error| error.to_string())?;
            Ok(Arc::new(
                OpenDalStorage::s3(
                    if record.provider_key == "r2" {
                        "r2"
                    } else {
                        "s3"
                    },
                    &config,
                    &credentials,
                )
                .map_err(|error| error.to_string())?,
            ))
        }
        "oss" => {
            let config: OssStorageConfig = serde_json::from_value(record.config_json.clone())
                .map_err(|error| error.to_string())?;
            let credentials: OssCredentials = context
                .credentials
                .get_json(credential_ref)
                .map_err(|error| error.to_string())?;
            Ok(Arc::new(
                OpenDalStorage::oss(&config, &credentials).map_err(|error| error.to_string())?,
            ))
        }
        "cos" => {
            let config: CosStorageConfig = serde_json::from_value(record.config_json.clone())
                .map_err(|error| error.to_string())?;
            let credentials: CosCredentials = context
                .credentials
                .get_json(credential_ref)
                .map_err(|error| error.to_string())?;
            Ok(Arc::new(
                OpenDalStorage::cos(&config, &credentials).map_err(|error| error.to_string())?,
            ))
        }
        "webdav" => {
            let config: WebDavStorageConfig = serde_json::from_value(record.config_json.clone())
                .map_err(|error| error.to_string())?;
            let credentials: WebDavCredentials = context
                .credentials
                .get_json(credential_ref)
                .map_err(|error| error.to_string())?;
            Ok(Arc::new(
                OpenDalStorage::webdav(&config, &credentials).map_err(|error| error.to_string())?,
            ))
        }
        "github" => {
            let config: GitHubStorageConfig = serde_json::from_value(record.config_json.clone())
                .map_err(|error| error.to_string())?;
            let credentials: GitHubCredentials = context
                .credentials
                .get_json(credential_ref)
                .map_err(|error| error.to_string())?;
            Ok(Arc::new(GitHubStorage::new(config, credentials)))
        }
        "gitee" => {
            let config: GiteeStorageConfig = serde_json::from_value(record.config_json.clone())
                .map_err(|error| error.to_string())?;
            let credentials: GiteeCredentials = context
                .credentials
                .get_json(credential_ref)
                .map_err(|error| error.to_string())?;
            Ok(Arc::new(GiteeStorage::new(config, credentials)))
        }
        _ => Err(format!(
            "Provider {} is not supported by the Typora bridge",
            record.provider_key
        )),
    }
}
