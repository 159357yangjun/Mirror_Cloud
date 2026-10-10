//! Explicit, non-secret relationship migration. No workflow JSON, credentials or assets.
use std::{collections::{HashMap, HashSet}, io::Write, path::Path};

use chrono::Utc;
use persistence_sqlite::{NewStorageGroupMember, StorageRecord};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;
use domain::{PublishTarget, WorkflowStep};

use super::{CmdResult, PortableStorageIdMapping};
use crate::AppState;

const FORMAT_VERSION: u32 = 1;
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

fn parse_id(value: &str) -> CmdResult<Uuid> {
    Uuid::parse_str(value).map_err(|_| "无效的引用 UUID".into())
}

fn validate_manifest(manifest: &PortableReferenceManifest) -> CmdResult<()> {
    if manifest.schema_version != FORMAT_VERSION
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
            || !matches!(group.strategy.as_str(), "mirror_all" | "primary_with_backups")
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
            || !matches!(workflow.target_kind.as_str(), "storage" | "group" | "unsupported")
        {
            return Err("关系清单包含无效工作流引用".into());
        }
        if workflow.target_kind != "unsupported" {
            parse_id(&workflow.source_target_id)?;
        } else if !workflow.source_target_id.is_empty() {
            return Err("未支持工作流不得伪造目标 UUID".into());
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
    file.write_all(&bytes).map_err(|_| "写入关系清单失败".into())
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
        let targets: Vec<_> = record.workflow.steps.iter().filter_map(|step| {
            match step {
                WorkflowStep::Publish { target } => Some(target),
                _ => None,
            }
        }).collect();
        let (kind, id) = match targets.as_slice() {
            [PublishTarget::Storage { storage_id }] => ("storage", storage_id.to_string()),
            [PublishTarget::StorageGroup { storage_group_id }] => ("group", storage_group_id.to_string()),
            _ => ("unsupported", String::new()),
        };
        workflows.push(PortableReferenceWorkflow {
            source_workflow_id: record.workflow.id.to_string(),
            name: record.workflow.name,
            target_kind: kind.into(),
            source_target_id: id,
        });
    }
    let manifest = PortableReferenceManifest {
        schema_version: FORMAT_VERSION,
        exported_at: Utc::now().to_rfc3339(),
        groups: groups.into_iter().map(|group| PortableReferenceGroup {
            source_group_id: group.id.to_string(),
            name: group.name,
            strategy: group.strategy,
            members: group.members.into_iter().map(|member| PortableReferenceMember {
                source_storage_id: member.storage_id.to_string(),
                role: member.role,
                priority: member.priority,
            }).collect(),
        }).collect(),
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
        let record = state.storages.get(new_id).await.map_err(|_| "无法检查本机存储")?
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
        && storage.config_json.get("access_mode").and_then(serde_json::Value::as_str)
            == Some("private_requested")
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
            return ("missing_mapping".into(), "至少一个成员尚未重连并建立 ID 映射".into());
        };
        records.push(record);
    }
    if records.iter().any(|record| private_intent(record))
        && records.iter().any(|record| !private_intent(record))
    {
        return ("private_mix".into(), "私有 R2/S3 目标不能与公开或未知目标混合".into());
    }
    ("ready".into(), "所有成员映射有效；可手动确认新建（云端权限尚未实测）".into())
}

#[tauri::command]
pub async fn preview_portable_reference_restore(
    state: State<'_, AppState>,
    manifest: PortableReferenceManifest,
    mappings: Vec<PortableStorageIdMapping>,
) -> CmdResult<PortableReferencePreview> {
    validate_manifest(&manifest)?;
    let mapped = checked_mapping(state.inner(), &mappings).await?;
    let existing = state.groups.list().await.map_err(|_| "无法读取本机多云组")?;
    let names: HashSet<String> = existing.iter()
        .map(|group| group.name.trim().to_lowercase()).collect();
    let groups = manifest.groups.iter().map(|group| {
        let (status, detail) = group_status(group, &mapped, &names);
        PortableGroupPreview {
            source_group_id: group.source_group_id.clone(),
            name: group.name.clone(),
            status,
            detail,
        }
    }).collect();
    let workflows = manifest.workflows.iter().map(|workflow| {
        let (status, detail) = match workflow.target_kind.as_str() {
            "storage" if parse_id(&workflow.source_target_id).ok().is_some_and(|id| mapped.contains_key(&id)) =>
                ("manual", "目标存储已映射；处理步骤未导出，必须人工重新建立工作流"),
            "storage" => ("missing_mapping", "目标存储尚未映射"),
            "group" => ("manual", "目标是旧多云组，待恢复组后人工重新建立工作流"),
            _ => ("unsupported", "原工作流发布目标不唯一或无法安全识别"),
        };
        PortableWorkflowPreview {
            name: workflow.name.clone(), status: status.into(), detail: detail.into()
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
    let group = manifest.groups.iter()
        .find(|group| parse_id(&group.source_group_id).ok() == Some(source))
        .ok_or("未找到旧多云组")?;
    let mapped = checked_mapping(state.inner(), &mappings).await?;
    let existing = state.groups.list().await.map_err(|_| "无法读取本机多云组")?;
    let names: HashSet<String> = existing.iter()
        .map(|value| value.name.trim().to_lowercase()).collect();
    let (status, _) = group_status(group, &mapped, &names);
    if status != "ready" {
        return Err("恢复前检查未通过：成员映射、隐私隔离或目标重名冲突".into());
    }
    let members = group.members.iter().map(|member| {
        let source_id = parse_id(&member.source_storage_id)?;
        let storage = mapped.get(&source_id).ok_or("缺少成员映射")?;
        Ok(NewStorageGroupMember {
            storage_id: storage.id,
            role: member.role.clone(),
            priority: member.priority,
        })
    }).collect::<CmdResult<Vec<_>>>()?;
    let new_id = Uuid::new_v4();
    let inserted = state.groups.insert_restored_if_name_free(
        new_id, group.name.trim(), &group.strategy, &members,
    ).await.map_err(|_| "多云组恢复写入失败；未提交部分成员")?;
    if !inserted {
        return Err("RESTORE_CONFLICT: 本机刚刚新增同名多云组".into());
    }
    Ok(new_id.to_string())
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
                    PortableReferenceMember { source_storage_id: Uuid::new_v4().to_string(), role: "primary".into(), priority: 0 },
                    PortableReferenceMember { source_storage_id: Uuid::new_v4().to_string(), role: "backup".into(), priority: 1 },
                ],
            }],
            workflows: vec![],
        }
    }

    #[test]
    fn validates_group_cardinality_and_unique_members() {
        let mut plan = sample();
        assert!(validate_manifest(&plan).is_ok());
        plan.groups[0].members[1].source_storage_id = plan.groups[0].members[0].source_storage_id.clone();
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
}
