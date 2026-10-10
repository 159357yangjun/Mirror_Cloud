//! Explicit, non-secret relationship migration. No workflow JSON, credentials or assets.
use std::{
    collections::{HashMap, HashSet},
    io::Write,
    path::Path,
};

use chrono::Utc;
use domain::{PublishTarget, Workflow, WorkflowStep};
use persistence_sqlite::{NewStorageGroupMember, StorageRecord};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use super::{CmdResult, PortableStorageIdMapping};
use crate::AppState;

const FORMAT_VERSION: u32 = 2;
const LEGACY_VERSION: u32 = 1;
const MAX_BYTES: u64 = 1024 * 1024;
const MAX_ITEMS: usize = 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableReferenceMember {
    pub source_storage_id: String,
    pub role: String,
    pub priority: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableReferenceGroup {
    pub source_group_id: String,
    pub name: String,
    pub strategy: String,
    pub members: Vec<PortableReferenceMember>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableReferenceWorkflow {
    pub source_workflow_id: String,
    pub name: String,
    pub target_kind: String,
    pub source_target_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spec: Option<PortableWorkflowSpec>,
}

/// Only the known-safe, generated processing sequence can be exported.
/// Arbitrary user-defined paths and output templates are never copied.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableWorkflowSpec {
    pub format: String,
    pub quality: u8,
    pub max_width: Option<u32>,
    pub max_height: Option<u32>,
    pub rename_template: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableGroupIdMapping {
    pub old_group_id: String,
    pub new_group_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableGroupMappingReceipt {
    pub schema_version: u32,
    pub source_manifest_exported_at: String,
    pub mappings: Vec<PortableGroupIdMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableReferenceManifest {
    pub schema_version: u32,
    pub exported_at: String,
    pub groups: Vec<PortableReferenceGroup>,
    pub workflows: Vec<PortableReferenceWorkflow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableGroupPreview {
    pub source_group_id: String,
    pub name: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableWorkflowPreview {
    pub source_workflow_id: String,
    pub name: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableReferencePreview {
    pub groups: Vec<PortableGroupPreview>,
    pub workflows: Vec<PortableWorkflowPreview>,
}

const SAFE_RENAME_TEMPLATES: &[&str] = &[
    "images/{year}/{month}/{hash:12}-u{uuid}-{stem}.{ext}",
    "docs/{year}/{month}/{hash:12}-u{uuid}.{ext}",
    "share/{year}/{month}/{hash:12}-u{uuid}.{ext}",
    "original/{year}/{month}/{hash:12}-u{uuid}-{stem}.{ext}",
];

fn valid_workflow_spec(spec: &PortableWorkflowSpec) -> bool {
    matches!(spec.format.as_str(), "original" | "jpeg" | "png" | "webp")
        && (1..=100).contains(&spec.quality)
        && spec.max_width.is_none_or(|n| (1..=16384).contains(&n))
        && spec.max_height.is_none_or(|n| (1..=16384).contains(&n))
        && SAFE_RENAME_TEMPLATES.contains(&spec.rename_template.as_str())
}

fn safe_spec(steps: &[WorkflowStep]) -> Option<PortableWorkflowSpec> {
    let (max_width, max_height, rest) = match steps.first()? {
        WorkflowStep::Resize { max_width, max_height } => (
            (*max_width != u32::MAX).then_some(*max_width),
            (*max_height != u32::MAX).then_some(*max_height),
            &steps[1..],
        ),
        _ => (None, None, steps),
    };
    let [
        WorkflowStep::Convert { format, quality },
        WorkflowStep::Rename { template },
        WorkflowStep::Publish { .. },
        WorkflowStep::Output { template: output },
    ] = rest else {
        return None;
    };
    if output != "{url}" { return None; }
    let spec = PortableWorkflowSpec {
        format: format.clone(),
        quality: *quality,
        max_width,
        max_height,
        rename_template: template.clone(),
    };
    valid_workflow_spec(&spec).then_some(spec)
}

fn build_workflow(name: &str, spec: &PortableWorkflowSpec, target: PublishTarget) -> Workflow {
    let mut steps = Vec::new();
    if spec.max_width.is_some() || spec.max_height.is_some() {
        steps.push(WorkflowStep::Resize {
            max_width: spec.max_width.unwrap_or(u32::MAX),
            max_height: spec.max_height.unwrap_or(u32::MAX),
        });
    }
    steps.push(WorkflowStep::Convert {
        format: spec.format.clone(),
        quality: spec.quality,
    });
    steps.push(WorkflowStep::Rename { template: spec.rename_template.clone() });
    steps.push(WorkflowStep::Publish { target });
    steps.push(WorkflowStep::Output { template: "{url}".into() });
    Workflow { id: Uuid::new_v4(), name: name.to_string(), steps }
}

fn parse_id(value: &str) -> CmdResult<Uuid> {
    Uuid::parse_str(value).map_err(|_| "无效的引用 UUID".into())
}

fn validate_manifest(manifest: &PortableReferenceManifest) -> CmdResult<()> {
    if !matches!(manifest.schema_version, LEGACY_VERSION | FORMAT_VERSION)
        || chrono::DateTime::parse_from_rfc3339(&manifest.exported_at).is_err()
        || manifest.groups.len() + manifest.workflows.len() > MAX_ITEMS
    {
        return Err("不支持的关系清单版本、时间或数量".into());
    }
    let mut group_ids = HashSet::new();
    for group in &manifest.groups {
        let id = parse_id(&group.source_group_id)?;
        if !group_ids.insert(id)
            || group.name.trim().is_empty()
            || group.name.len() > 256
            || !matches!(
                group.strategy.as_str(),
                "mirror_all" | "primary_with_backups"
            )
            || !(2..=100).contains(&group.members.len())
        {
            return Err("关系清单包含无效或重复的多云组".into());
        }
        let mut members = HashSet::new();
        let mut primary = 0;
        for member in &group.members {
            if !members.insert(parse_id(&member.source_storage_id)?)
                || !matches!(member.role.as_str(), "primary" | "mirror" | "backup")
                || !(0..=1_000_000).contains(&member.priority)
            {
                return Err("关系清单包含无效的多云组成员".into());
            }
            if member.role == "primary" {
                primary += 1;
            }
        }
        if primary != 1 {
            return Err("多云组必须且只能有一个主目标".into());
        }
    }
    let mut workflow_ids = HashSet::new();
    for workflow in &manifest.workflows {
        if !workflow_ids.insert(parse_id(&workflow.source_workflow_id)?)
            || workflow.name.trim().is_empty()
            || workflow.name.len() > 256
            || !matches!(
                workflow.target_kind.as_str(),
                "storage" | "group" | "unsupported"
            )
        {
            return Err("关系清单包含无效工作流引用".into());
        }
        if workflow.target_kind != "unsupported" {
            parse_id(&workflow.source_target_id)?;
        } else if !workflow.source_target_id.is_empty() {
            return Err("未支持工作流不得伪造目标 UUID".into());
        }
        if manifest.schema_version == LEGACY_VERSION && workflow.spec.is_some() {
            return Err("v1 关系清单不允许处理步骤".into());
        }
        if let Some(spec) = &workflow.spec {
            if workflow.target_kind == "unsupported" || !valid_workflow_spec(spec) {
                return Err("工作流处理配置超出安全白名单".into());
            }
        }
    }
    Ok(())
}

fn json_path(path: &str) -> CmdResult<&Path> {
    let file = Path::new(path.trim());
    if !file.is_absolute() || file.extension().and_then(|x| x.to_str()) != Some("json") {
        return Err("请选择绝对路径的 JSON 文件".into());
    }
    Ok(file)
}

fn write_new_json<T: Serialize>(path: &str, value: &T) -> CmdResult<()> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|_| "无法序列化关系清单")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("关系清单超过 1 MB".into());
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(json_path(path)?)
        .map_err(|_| "无法创建文件；禁止覆盖同名文件")?;
    file.write_all(&bytes)
        .map_err(|_| "写入关系清单失败".into())
}

#[tauri::command]
pub async fn export_portable_reference_manifest(
    state: State<'_, AppState>,
    destination_path: String,
) -> CmdResult<usize> {
    let groups = state.groups.list().await.map_err(|_| "无法读取多云组")?;
    let workflow_records = state.workflows.list().await.map_err(|_| "无法读取工作流")?;
    let mut workflows = Vec::new();
    for record in workflow_records {
        // This is regenerated from the new machine's default target.
        if record.source_recipe.as_deref() == Some("__system_default__") {
            continue;
        }
        let targets: Vec<_> = record
            .workflow
            .steps
            .iter()
            .filter_map(|step| match step {
                WorkflowStep::Publish { target } => Some(target),
                _ => None,
            })
            .collect();
        let (kind, id) = match targets.as_slice() {
            [PublishTarget::Storage { storage_id }] => ("storage", storage_id.to_string()),
            [PublishTarget::StorageGroup { storage_group_id }] => {
                ("group", storage_group_id.to_string())
            }
            _ => ("unsupported", String::new()),
        };
        workflows.push(PortableReferenceWorkflow {
            source_workflow_id: record.workflow.id.to_string(),
            name: record.workflow.name,
            target_kind: kind.into(),
            source_target_id: id,
            spec: if kind == "unsupported" { None } else { safe_spec(&record.workflow.steps) },
        });
    }
    let manifest = PortableReferenceManifest {
        schema_version: FORMAT_VERSION,
        exported_at: Utc::now().to_rfc3339(),
        groups: groups
            .into_iter()
            .map(|group| PortableReferenceGroup {
                source_group_id: group.id.to_string(),
                name: group.name,
                strategy: group.strategy,
                members: group
                    .members
                    .into_iter()
                    .map(|member| PortableReferenceMember {
                        source_storage_id: member.storage_id.to_string(),
                        role: member.role,
                        priority: member.priority,
                    })
                    .collect(),
            })
            .collect(),
        workflows,
    };
    validate_manifest(&manifest)?;
    write_new_json(&destination_path, &manifest)?;
    Ok(manifest.groups.len() + manifest.workflows.len())
}

#[tauri::command]
pub fn inspect_portable_reference_manifest(
    source_path: String,
) -> CmdResult<PortableReferenceManifest> {
    let path = json_path(&source_path)?;
    let meta = std::fs::metadata(path).map_err(|_| "无法读取关系清单")?;
    if !meta.is_file() || meta.len() > MAX_BYTES {
        return Err("关系清单不是文件或超过 1 MB".into());
    }
    let bytes = std::fs::read(path).map_err(|_| "无法读取关系清单")?;
    let manifest: PortableReferenceManifest =
        serde_json::from_slice(&bytes).map_err(|_| "关系清单格式无效或包含额外字段")?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

async fn checked_mapping(
    state: &AppState,
    mappings: &[PortableStorageIdMapping],
) -> CmdResult<HashMap<Uuid, StorageRecord>> {
    if mappings.len() > MAX_ITEMS {
        return Err("映射数量超限".into());
    }
    let mut old = HashMap::new();
    let mut new_ids = HashSet::new();
    for mapping in mappings {
        let old_id = parse_id(&mapping.old_storage_id)?;
        let new_id = parse_id(&mapping.new_storage_id)?;
        if old_id == new_id || !new_ids.insert(new_id) || old.contains_key(&old_id) {
            return Err("重复的映射或新旧 ID 相同".into());
        }
        let record = state
            .storages
            .get(new_id)
            .await
            .map_err(|_| "无法检查本机存储")?
            .ok_or("映射的新存储已不存在")?;
        if record.provider_key != mapping.provider_key || !record.enabled {
            return Err("映射 Provider 不一致或存储已禁用".into());
        }
        old.insert(old_id, record);
    }
    Ok(old)
}

fn private_intent(storage: &StorageRecord) -> bool {
    matches!(storage.provider_key.as_str(), "r2" | "s3")
        && storage
            .config_json
            .get("access_mode")
            .and_then(serde_json::Value::as_str)
            == Some("private_requested")
}

fn checked_group_mapping(
    manifest: &PortableReferenceManifest,
    mapped: &HashMap<Uuid, StorageRecord>,
    local_groups: &[persistence_sqlite::StorageGroupRecord],
    groups: &[PortableGroupIdMapping],
) -> CmdResult<HashMap<Uuid, Uuid>> {
    let mut result = HashMap::new();
    let mut destination_ids = HashSet::new();
    if groups.len() > MAX_ITEMS { return Err("组映射数量超限".into()); }
    for item in groups {
        let source = parse_id(&item.old_group_id)?;
        let destination = parse_id(&item.new_group_id)?;
        if source == destination || result.contains_key(&source) || !destination_ids.insert(destination) {
            return Err("组映射包含重复 ID 或复用了旧 ID".into());
        }
        let original = manifest.groups.iter()
            .find(|g| parse_id(&g.source_group_id).ok() == Some(source))
            .ok_or("旧 Group ID 不在关系清单中")?;
        let existing = local_groups.iter().find(|g| g.id == destination)
            .ok_or("组映射目标已经不存在")?;
        if original.name.trim() != existing.name || original.strategy != existing.strategy
            || original.members.len() != existing.members.len() {
            return Err("组映射目标名称、策略或成员数不符".into());
        }
        for member in &original.members {
            let source_id = parse_id(&member.source_storage_id)?;
            let target = mapped.get(&source_id).ok_or("组映射缺少对应存储映射")?;
            if !existing.members.iter().any(|m|
                m.storage_id == target.id && m.role == member.role && m.priority == member.priority
            ) {
                return Err("组映射目标成员不符合原清单".into());
            }
        }
        result.insert(source, destination);
    }
    Ok(result)
}

fn workflow_status(
    workflow: &PortableReferenceWorkflow,
    mapped: &HashMap<Uuid, StorageRecord>,
    group_mapping: &HashMap<Uuid, Uuid>,
    workflow_names: &HashSet<String>,
) -> (String, String) {
    if workflow_names.contains(&workflow.name.trim().to_lowercase()) {
        return ("conflict".into(), "本机已有同名工作流，不能覆盖".into());
    }
    if workflow.spec.is_none() {
        return ("manual".into(), "旧版或自定义处理步骤未被安全导出，必须人工重建".into());
    }
    let Ok(source) = parse_id(&workflow.source_target_id) else {
        return ("unsupported".into(), "发布目标不是可恢复 UUID".into());
    };
    match workflow.target_kind.as_str() {
        "storage" if mapped.contains_key(&source) => (
            "ready".into(),
            "目标存储已映射，预设处理步骤可恢复；新建后不会自动启用为默认工作流".into(),
        ),
        "group" if group_mapping.contains_key(&source) => (
            "ready".into(),
            "多云组已映射，预设处理步骤可恢复；新建后不会自动启用为默认工作流".into(),
        ),
        _ => ("missing_mapping".into(), "目标尚未建立受验证的新 ID 映射".into()),
    }
}

fn group_status(
    group: &PortableReferenceGroup,
    mapped: &HashMap<Uuid, StorageRecord>,
    existing_names: &HashSet<String>,
) -> (String, String) {
    if existing_names.contains(&group.name.trim().to_lowercase()) {
        return ("conflict".into(), "本机已有同名多云组，禁止覆盖".into());
    }
    let mut records = Vec::new();
    for member in &group.members {
        let Ok(id) = parse_id(&member.source_storage_id) else {
            return ("invalid".into(), "原存储 UUID 无效".into());
        };
        let Some(record) = mapped.get(&id) else {
            return (
                "missing_mapping".into(),
                "至少一个成员尚未重连并建立 ID 映射".into(),
            );
        };
        records.push(record);
    }
    if records.iter().any(|record| private_intent(record))
        && records.iter().any(|record| !private_intent(record))
    {
        return (
            "private_mix".into(),
            "私有 R2/S3 目标不能与公开或未知目标混合".into(),
        );
    }
    (
        "ready".into(),
        "所有成员映射有效；可手动确认新建（云端权限尚未实测）".into(),
    )
}

#[tauri::command]
pub async fn preview_portable_reference_restore(
    state: State<'_, AppState>,
    manifest: PortableReferenceManifest,
    mappings: Vec<PortableStorageIdMapping>,
    group_mappings: Vec<PortableGroupIdMapping>,
) -> CmdResult<PortableReferencePreview> {
    validate_manifest(&manifest)?;
    let mapped = checked_mapping(state.inner(), &mappings).await?;
    let existing = state
        .groups
        .list()
        .await
        .map_err(|_| "无法读取本机多云组")?;
    let names: HashSet<String> = existing
        .iter()
        .map(|group| group.name.trim().to_lowercase())
        .collect();
    let groups = manifest
        .groups
        .iter()
        .map(|group| {
            let (status, detail) = group_status(group, &mapped, &names);
            PortableGroupPreview {
                source_group_id: group.source_group_id.clone(),
                name: group.name.clone(),
                status,
                detail,
            }
        })
        .collect();
    let verified_groups = checked_group_mapping(&manifest, &mapped, &existing, &group_mappings)?;
    let local_workflows = state.workflows.list().await.map_err(|_| "无法读取现有工作流")?;
    let workflow_names: HashSet<String> = local_workflows.iter()
        .map(|w| w.workflow.name.trim().to_lowercase()).collect();
    let workflows = manifest.workflows.iter().map(|workflow| {
        let (status, detail) = workflow_status(workflow, &mapped, &verified_groups, &workflow_names);
        PortableWorkflowPreview {
            source_workflow_id: workflow.source_workflow_id.clone(),
            name: workflow.name.clone(), status, detail,
        }
    }).collect();
    Ok(PortableReferencePreview { groups, workflows })
}

#[tauri::command]
pub async fn restore_portable_storage_group(
    state: State<'_, AppState>,
    manifest: PortableReferenceManifest,
    mappings: Vec<PortableStorageIdMapping>,
    source_group_id: String,
) -> CmdResult<String> {
    validate_manifest(&manifest)?;
    let source = parse_id(&source_group_id)?;
    let group = manifest
        .groups
        .iter()
        .find(|group| parse_id(&group.source_group_id).ok() == Some(source))
        .ok_or("未找到旧多云组")?;
    let mapped = checked_mapping(state.inner(), &mappings).await?;
    let existing = state
        .groups
        .list()
        .await
        .map_err(|_| "无法读取本机多云组")?;
    let names: HashSet<String> = existing
        .iter()
        .map(|value| value.name.trim().to_lowercase())
        .collect();
    let (status, _) = group_status(group, &mapped, &names);
    if status != "ready" {
        return Err("恢复前检查未通过：成员映射、隐私隔离或目标重名冲突".into());
    }
    let members = group
        .members
        .iter()
        .map(|member| {
            let source_id = parse_id(&member.source_storage_id)?;
            let storage = mapped.get(&source_id).ok_or("缺少成员映射")?;
            Ok(NewStorageGroupMember {
                storage_id: storage.id,
                role: member.role.clone(),
                priority: member.priority,
            })
        })
        .collect::<CmdResult<Vec<_>>>()?;
    let new_id = Uuid::new_v4();
    let inserted = state
        .groups
        .insert_restored_if_name_free(new_id, group.name.trim(), &group.strategy, &members)
        .await
        .map_err(|_| "多云组恢复写入失败；未提交部分成员")?;
    if !inserted {
        return Err("RESTORE_CONFLICT: 本机刚刚新增同名多云组".into());
    }
    Ok(new_id.to_string())
}

/// Export a durable user-selected group mapping receipt; never modifies database rows.
#[tauri::command]
pub async fn export_portable_group_mapping(
    state: State<'_, AppState>,
    destination_path: String,
    manifest: PortableReferenceManifest,
    mappings: Vec<PortableStorageIdMapping>,
    group_mappings: Vec<PortableGroupIdMapping>,
) -> CmdResult<usize> {
    validate_manifest(&manifest)?;
    let mapped = checked_mapping(state.inner(), &mappings).await?;
    let local = state.groups.list().await.map_err(|_| "无法检查多云组")?;
    let checked = checked_group_mapping(&manifest, &mapped, &local, &group_mappings)?;
    if checked.is_empty() { return Err("没有可导出的组映射".into()); }
    let receipt = PortableGroupMappingReceipt {
        schema_version: 1,
        source_manifest_exported_at: manifest.exported_at,
        mappings: group_mappings,
    };
    write_new_json(&destination_path, &receipt)?;
    Ok(checked.len())
}

/// Import only a strict mapping receipt for this exact relationship snapshot.
#[tauri::command]
pub fn inspect_portable_group_mapping(
    source_path: String,
    expected_manifest_exported_at: String,
) -> CmdResult<Vec<PortableGroupIdMapping>> {
    let path = json_path(&source_path)?;
    let metadata = std::fs::metadata(path).map_err(|_| "无法读取组映射")?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES { return Err("无效的组映射文件".into()); }
    let bytes = std::fs::read(path).map_err(|_| "无法读取组映射")?;
    let receipt: PortableGroupMappingReceipt = serde_json::from_slice(&bytes)
        .map_err(|_| "组映射文件包含不支持的字段")?;
    if receipt.schema_version != 1 || receipt.source_manifest_exported_at != expected_manifest_exported_at {
        return Err("组映射文件和当前关系清单不匹配".into());
    }
    if receipt.mappings.is_empty() || receipt.mappings.len() > MAX_ITEMS {
        return Err("无有效组映射".into());
    }
    Ok(receipt.mappings)
}

/// Reconstruct exactly the supported generated workflow steps, on a new UUID.
/// No default workflow, settings, source recipe, group or asset is overwritten.
#[tauri::command]
pub async fn restore_portable_workflow(
    state: State<'_, AppState>,
    manifest: PortableReferenceManifest,
    mappings: Vec<PortableStorageIdMapping>,
    group_mappings: Vec<PortableGroupIdMapping>,
    source_workflow_id: String,
) -> CmdResult<String> {
    validate_manifest(&manifest)?;
    let source = parse_id(&source_workflow_id)?;
    let entry = manifest.workflows.iter()
        .find(|w| parse_id(&w.source_workflow_id).ok() == Some(source))
        .ok_or("工作流不在来源清单中")?;
    let mapped = checked_mapping(state.inner(), &mappings).await?;
    let groups = state.groups.list().await.map_err(|_| "无法核查本机多云组")?;
    let group_map = checked_group_mapping(&manifest, &mapped, &groups, &group_mappings)?;
    let current = state.workflows.list().await.map_err(|_| "无法读取工作流")?;
    let names: HashSet<String> = current.iter()
        .map(|w| w.workflow.name.trim().to_lowercase()).collect();
    let (status, _) = workflow_status(entry, &mapped, &group_map, &names);
    if status != "ready" { return Err("工作流恢复被拒绝：冲突、未映射或非安全预设".into()); }
    let spec = entry.spec.as_ref().ok_or("缺少安全工作流配置")?;
    let old_target = parse_id(&entry.source_target_id)?;
    let target = match entry.target_kind.as_str() {
        "storage" => PublishTarget::Storage {
            storage_id: mapped.get(&old_target).ok_or("目标存储未映射")?.id,
        },
        "group" => PublishTarget::StorageGroup {
            storage_group_id: *group_map.get(&old_target).ok_or("多云组未映射")?,
        },
        _ => return Err("无效的目标类型".into()),
    };
    let workflow = build_workflow(entry.name.trim(), spec, target);
    let inserted = state.workflows.insert_restored_if_name_free(&workflow).await
        .map_err(|_| "工作流插入失败；未更改默认工作流")?;
    if !inserted { return Err("RESTORE_CONFLICT: 同名工作流刚刚创建".into()); }
    Ok(workflow.id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> PortableReferenceManifest {
        PortableReferenceManifest {
            schema_version: 1,
            exported_at: "2026-10-10T00:00:00Z".into(),
            groups: vec![PortableReferenceGroup {
                source_group_id: Uuid::new_v4().to_string(),
                name: "Example group".into(),
                strategy: "mirror_all".into(),
                members: vec![
                    PortableReferenceMember {
                        source_storage_id: Uuid::new_v4().to_string(),
                        role: "primary".into(),
                        priority: 0,
                    },
                    PortableReferenceMember {
                        source_storage_id: Uuid::new_v4().to_string(),
                        role: "backup".into(),
                        priority: 1,
                    },
                ],
            }],
            workflows: vec![],
        }
    }

    #[test]
    fn validates_group_cardinality_and_unique_members() {
        let mut plan = sample();
        assert!(validate_manifest(&plan).is_ok());
        plan.groups[0].members[1].source_storage_id =
            plan.groups[0].members[0].source_storage_id.clone();
        assert!(validate_manifest(&plan).is_err());
        plan = sample();
        plan.groups[0].members[1].role = "primary".into();
        assert!(validate_manifest(&plan).is_err());
    }

    #[test]
    fn rejects_sensitive_or_unknown_extra_fields() {
        let mut json = serde_json::to_value(sample()).unwrap();
        json["groups"][0]["token"] = serde_json::json!("never export");
        assert!(serde_json::from_value::<PortableReferenceManifest>(json).is_err());
    }
    #[test]
    fn preset_spec_is_strict_and_round_trips() {
        let target = PublishTarget::Storage { storage_id: Uuid::new_v4() };
        let spec = PortableWorkflowSpec {
            format: "webp".into(), quality: 82,
            max_width: Some(2560), max_height: Some(2560),
            rename_template: SAFE_RENAME_TEMPLATES[0].into(),
        };
        let workflow = build_workflow("blog", &spec, target);
        let recovered = safe_spec(&workflow.steps).expect("canonical steps");
        assert_eq!(recovered.rename_template, spec.rename_template);
        assert_eq!(recovered.max_width, Some(2560));
        assert_eq!(recovered.quality, 82);
        let mut unsafe_spec = recovered;
        unsafe_spec.rename_template = "https://signed.example/?token=secret".into();
        assert!(!valid_workflow_spec(&unsafe_spec));
    }

    #[test]
    fn accepts_v1_without_spec_and_rejects_v1_with_spec() {
        let mut plan = sample();
        plan.schema_version = LEGACY_VERSION;
        plan.workflows.push(PortableReferenceWorkflow {
            source_workflow_id: Uuid::new_v4().to_string(),
            name: "legacy".into(), target_kind: "unsupported".into(),
            source_target_id: String::new(), spec: None,
        });
        assert!(validate_manifest(&plan).is_ok());
        plan.workflows[0].spec = Some(PortableWorkflowSpec {
            format: "webp".into(), quality: 90, max_width: None, max_height: None,
            rename_template: SAFE_RENAME_TEMPLATES[0].into(),
        });
        assert!(validate_manifest(&plan).is_err());
    }

}
