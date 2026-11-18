//! `workflow` 内置插件：发布工作流的创建、列出、默认与删除。
//!
//! 迁移自 `apps/desktop/src-tauri/src/commands.rs` 的
//! `list_recipes` / `create_workflow_from_recipe` / `create_custom_workflow` /
//! `list_workflows` / `set_default_workflow` / `delete_workflow`；
//! 组合逻辑（`workflow_from_fields` 与 `workflow_view` 映射）随命令一并搬入本 crate，
//! 迁移期 `src-tauri` 命令保留为薄包装，委托这里的单一实现。

use domain::{PublishTarget, Workflow, WorkflowStep};
use kernel_api::{
    BuiltinPlugin, Contribution, ContributionPoint, InvokeErrorCode, PluginFailure, PluginId,
    PluginKind, PluginManifestV2,
};
use persistence_sqlite::{StorageGroupRepository, StorageRepository, WorkflowRepository};
use serde_json::{Value, json};
use uuid::Uuid;

/// 插件 id（与 `crates/kernel/src/builtin.rs` 装配表一致）。
pub const PLUGIN_ID: &str = "workflow";

/// 创建工作流时内置配方的固定参数。
#[derive(Debug, Clone)]
struct RecipeDefinition {
    key: &'static str,
    name: &'static str,
    description: &'static str,
    badge: &'static str,
    format: &'static str,
    quality: u8,
    max_width: Option<u32>,
    max_height: Option<u32>,
    rename_template: &'static str,
    recommended: bool,
}

/// 内置配方（与原 `builtin_recipes()` 完全一致）。
fn builtin_recipes() -> Vec<RecipeDefinition> {
    vec![
        RecipeDefinition {
            key: "blog_balanced",
            name: "博客 · WebP 均衡",
            description: "限制长边到 2560px，WebP 82%，适合博客、Markdown 与日常图片。",
            badge: "推荐",
            format: "webp",
            quality: 82,
            max_width: Some(2560),
            max_height: Some(2560),
            rename_template: "images/{year}/{month}/{hash:12}-u{uuid}-{stem}.{ext}",
            recommended: true,
        },
        RecipeDefinition {
            key: "docs_crisp",
            name: "文档 · 清晰优先",
            description: "限制到 1920px，WebP 90%，更适合截图、教程和项目文档。",
            badge: "文档",
            format: "webp",
            quality: 90,
            max_width: Some(1920),
            max_height: Some(1920),
            rename_template: "docs/{year}/{month}/{hash:12}-u{uuid}.{ext}",
            recommended: false,
        },
        RecipeDefinition {
            key: "small_fast",
            name: "分享 · 小体积",
            description: "限制到 1600px，WebP 72%，优先减少上传时间和公网流量。",
            badge: "极速",
            format: "webp",
            quality: 72,
            max_width: Some(1600),
            max_height: Some(1600),
            rename_template: "share/{year}/{month}/{hash:12}-u{uuid}.{ext}",
            recommended: false,
        },
        RecipeDefinition {
            key: "original_keep",
            name: "原图 · 不转换",
            description: "不改变图片内容，仅统一远端命名；适合需要保留原始编码的资源。",
            badge: "原图",
            format: "original",
            quality: 100,
            max_width: None,
            max_height: None,
            rename_template: "original/{year}/{month}/{hash:12}-u{uuid}-{stem}.{ext}",
            recommended: false,
        },
    ]
}

pub fn manifest() -> PluginManifestV2 {
    PluginManifestV2 {
        api_version: kernel_api::MANIFEST_API_VERSION,
        schema_version: kernel_api::MANIFEST_SCHEMA_VERSION,
        id: PluginId::new(PLUGIN_ID).expect("workflow is a valid plugin id"),
        name: "工作流".to_string(),
        version: "2.0.0-dev.1".to_string(),
        description: "线性 Step 的润色、压缩、水印与路径模板。".to_string(),
        kind: PluginKind::Native,
        permissions: vec![kernel_api::Capability::ReadAsset],
        default_enabled: true,
        contributes: vec![Contribution {
            point: ContributionPoint::Page,
            id: "page.workflows".to_string(),
            label: Some("工作流".to_string()),
            description: None,
        }],
        settings_schema: None,
    }
}

/// 工作流插件：工作流仓储 + 存储与多云组仓储（用于解析目标名称）。
pub struct WorkflowPlugin {
    workflows: WorkflowRepository,
    storages: StorageRepository,
    groups: StorageGroupRepository,
    manifest: PluginManifestV2,
}

impl WorkflowPlugin {
    pub fn new(
        workflows: WorkflowRepository,
        storages: StorageRepository,
        groups: StorageGroupRepository,
    ) -> Self {
        Self {
            workflows,
            storages,
            groups,
            manifest: manifest(),
        }
    }

    fn recipes(&self) -> Vec<Value> {
        builtin_recipes()
            .into_iter()
            .map(|recipe| {
                json!({
                    "key": recipe.key,
                    "name": recipe.name,
                    "description": recipe.description,
                    "badge": recipe.badge,
                    "format": recipe.format,
                    "quality": recipe.quality,
                    "maxWidth": recipe.max_width,
                    "maxHeight": recipe.max_height,
                    "renameTemplate": recipe.rename_template,
                    "recommended": recipe.recommended,
                })
            })
            .collect()
    }

    async fn validate_publish_target(
        &self,
        target_kind: &str,
        target_id: &str,
    ) -> Result<PublishTarget, PluginFailure> {
        let id =
            Uuid::parse_str(target_id).map_err(|error| invalid(&format!("target id: {error}")))?;
        match target_kind {
            "storage" => {
                let storage = self
                    .storages
                    .get(id)
                    .await
                    .map_err(|error| internal(error.to_string()))?
                    .ok_or_else(|| invalid("Storage not found"))?;
                if !storage.enabled {
                    return Err(invalid("Storage is disabled"));
                }
                Ok(PublishTarget::Storage { storage_id: id })
            }
            "group" => {
                self.groups
                    .get(id)
                    .await
                    .map_err(|error| internal(error.to_string()))?
                    .ok_or_else(|| invalid("Storage Group not found"))?;
                Ok(PublishTarget::StorageGroup {
                    storage_group_id: id,
                })
            }
            _ => Err(invalid("Publish target must be storage or group")),
        }
    }

    async fn insert_and_reload(
        &self,
        workflow: &Workflow,
        description: &str,
        source_recipe: Option<&str>,
        set_default: bool,
    ) -> Result<Value, PluginFailure> {
        self.workflows
            .insert(workflow, description, source_recipe, set_default)
            .await
            .map_err(|error| internal(error.to_string()))?;
        let record = self
            .workflows
            .get(workflow.id)
            .await
            .map_err(|error| internal(error.to_string()))?
            .ok_or_else(|| internal("Workflow was created but could not be reloaded"))?;
        self.workflow_view(record).await
    }

    async fn workflow_view(
        &self,
        record: persistence_sqlite::WorkflowRecord,
    ) -> Result<Value, PluginFailure> {
        let mut format = "original".to_string();
        let mut quality = 100u8;
        let mut max_width = None;
        let mut max_height = None;
        let mut rename_template =
            "uploads/{year}/{month}/{hash:12}-u{uuid}-{stem}.{ext}".to_string();
        let mut target_kind = String::new();
        let mut target_id = String::new();
        let mut target_name = String::new();

        for step in &record.workflow.steps {
            match step {
                WorkflowStep::Resize {
                    max_width: width,
                    max_height: height,
                } => {
                    max_width = (*width != u32::MAX).then_some(*width);
                    max_height = (*height != u32::MAX).then_some(*height);
                }
                WorkflowStep::Convert {
                    format: target_format,
                    quality: target_quality,
                } => {
                    format = target_format.clone();
                    quality = *target_quality;
                }
                WorkflowStep::Rename { template } => rename_template = template.clone(),
                WorkflowStep::Publish { target } => match target {
                    PublishTarget::Storage { storage_id } => {
                        target_kind = "storage".into();
                        target_id = storage_id.to_string();
                        target_name = self
                            .storages
                            .get(*storage_id)
                            .await
                            .map_err(|error| internal(error.to_string()))?
                            .map(|storage| storage.name)
                            .unwrap_or_else(|| "已删除的存储".into());
                    }
                    PublishTarget::StorageGroup { storage_group_id } => {
                        target_kind = "group".into();
                        target_id = storage_group_id.to_string();
                        target_name = self
                            .groups
                            .get(*storage_group_id)
                            .await
                            .map_err(|error| internal(error.to_string()))?
                            .map(|group| group.name)
                            .unwrap_or_else(|| "已删除的多云组".into());
                    }
                },
                WorkflowStep::Output { template } => {
                    let _ = template;
                }
            }
        }

        Ok(json!({
            "id": record.workflow.id.to_string(),
            "name": record.workflow.name,
            "description": record.description,
            "sourceRecipe": record.source_recipe,
            "isDefault": record.is_default,
            "format": format,
            "quality": quality,
            "maxWidth": max_width,
            "maxHeight": max_height,
            "renameTemplate": rename_template,
            "targetKind": target_kind,
            "targetId": target_id,
            "targetName": target_name,
        }))
    }
}

fn workflow_from_fields(
    name: String,
    format: &str,
    quality: u8,
    max_width: Option<u32>,
    max_height: Option<u32>,
    rename_template: &str,
    target: PublishTarget,
) -> Result<Workflow, PluginFailure> {
    let mut steps = Vec::new();
    if max_width.is_some() || max_height.is_some() {
        steps.push(WorkflowStep::Resize {
            max_width: max_width.unwrap_or(u32::MAX),
            max_height: max_height.unwrap_or(u32::MAX),
        });
    }
    steps.push(WorkflowStep::Convert {
        format: format.into(),
        quality,
    });
    steps.push(WorkflowStep::Rename {
        template: rename_template.into(),
    });
    steps.push(WorkflowStep::Publish { target });
    steps.push(WorkflowStep::Output {
        template: "{url}".into(),
    });
    Ok(Workflow {
        id: Uuid::new_v4(),
        name,
        steps,
    })
}

fn invalid(message: &str) -> PluginFailure {
    PluginFailure::new(InvokeErrorCode::InvalidPayload, message.to_string())
}

fn internal(message: impl Into<String>) -> PluginFailure {
    PluginFailure::new(InvokeErrorCode::Internal, message)
}

#[async_trait::async_trait]
impl BuiltinPlugin for WorkflowPlugin {
    fn manifest(&self) -> PluginManifestV2 {
        self.manifest.clone()
    }

    async fn invoke(&self, method: &str, payload: &Value) -> Result<Value, PluginFailure> {
        match method {
            "workflow.list_recipes" => Ok(Value::Array(self.recipes())),
            "workflow.list_workflows" => {
                let records = self
                    .workflows
                    .list()
                    .await
                    .map_err(|error| internal(error.to_string()))?;
                let mut views = Vec::with_capacity(records.len());
                for record in records {
                    views.push(self.workflow_view(record).await?);
                }
                Ok(Value::Array(views))
            }
            "workflow.create_from_recipe" => {
                let recipe_key = payload
                    .get("recipeKey")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("recipeKey missing"))?;
                let target_kind = payload
                    .get("targetKind")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("targetKind missing"))?;
                let target_id = payload
                    .get("targetId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("targetId missing"))?;
                let recipe = builtin_recipes()
                    .into_iter()
                    .find(|recipe| recipe.key == recipe_key)
                    .ok_or_else(|| invalid(&format!("Unknown recipe: {recipe_key}")))?;
                let target = self.validate_publish_target(target_kind, target_id).await?;
                let name = payload
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(recipe.name)
                    .to_string();
                let workflow = workflow_from_fields(
                    name,
                    recipe.format,
                    recipe.quality,
                    recipe.max_width,
                    recipe.max_height,
                    recipe.rename_template,
                    target,
                )?;
                let set_default = payload
                    .get("setDefault")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                self.insert_and_reload(&workflow, recipe.description, Some(recipe.key), set_default)
                    .await
            }
            "workflow.create_custom_workflow" => {
                let name = payload
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("name missing"))?;
                if name.trim().is_empty() {
                    return Err(invalid("Workflow name cannot be empty"));
                }
                let quality = payload
                    .get("quality")
                    .and_then(Value::as_u64)
                    .map(|value| value.min(255) as u8)
                    .ok_or_else(|| invalid("quality missing"))?;
                if !(1..=100).contains(&quality) {
                    return Err(invalid("Quality must be between 1 and 100"));
                }
                let format = payload
                    .get("format")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("format missing"))?;
                if !matches!(format, "original" | "jpeg" | "png" | "webp") {
                    return Err(invalid("Unsupported image output format"));
                }
                let rename_template = payload
                    .get("renameTemplate")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("renameTemplate missing"))?;
                if rename_template.trim().is_empty() {
                    return Err(invalid("Rename template cannot be empty"));
                }
                let target_kind = payload
                    .get("targetKind")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("targetKind missing"))?;
                let target_id = payload
                    .get("targetId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("targetId missing"))?;
                let target = self.validate_publish_target(target_kind, target_id).await?;
                let workflow = workflow_from_fields(
                    name.trim().to_string(),
                    format,
                    quality,
                    payload
                        .get("maxWidth")
                        .and_then(Value::as_u64)
                        .and_then(|value| if value > 0 { Some(value as u32) } else { None }),
                    payload
                        .get("maxHeight")
                        .and_then(Value::as_u64)
                        .and_then(|value| if value > 0 { Some(value as u32) } else { None }),
                    rename_template.trim(),
                    target,
                )?;
                let description = payload
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                let set_default = payload
                    .get("setDefault")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                self.insert_and_reload(&workflow, &description, None, set_default)
                    .await
            }
            "workflow.set_default_workflow" => {
                let workflow_id = payload
                    .get("workflowId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("workflowId missing"))?;
                let id = Uuid::parse_str(workflow_id)
                    .map_err(|error| invalid(&format!("workflow id: {error}")))?;
                if self
                    .workflows
                    .get(id)
                    .await
                    .map_err(|error| internal(error.to_string()))?
                    .is_none()
                {
                    return Err(invalid("Workflow not found"));
                }
                self.workflows
                    .set_default(id)
                    .await
                    .map_err(|error| internal(error.to_string()))?;
                Ok(json!({ "ok": true }))
            }
            "workflow.delete_workflow" => {
                let workflow_id = payload
                    .get("workflowId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("workflowId missing"))?;
                let id = Uuid::parse_str(workflow_id)
                    .map_err(|error| invalid(&format!("workflow id: {error}")))?;
                self.workflows
                    .delete(id)
                    .await
                    .map_err(|error| internal(error.to_string()))?;
                Ok(json!({ "ok": true }))
            }
            _ => Err(PluginFailure::new(
                InvokeErrorCode::UnknownMethod,
                format!("unknown workflow method {method}"),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_is_valid_and_matches_kernel_id() {
        let item = manifest();
        item.validate().expect("workflow manifest must validate");
        assert_eq!(item.id.as_str(), PLUGIN_ID);
        assert!(item.default_enabled);
        assert_eq!(item.kind, PluginKind::Native);
        assert_eq!(item.contributes.len(), 1);
    }

    #[test]
    fn builtin_recipes_cover_the_original_catalog() {
        let keys: Vec<&str> = builtin_recipes().into_iter().map(|r| r.key).collect();
        assert_eq!(
            keys,
            vec!["blog_balanced", "docs_crisp", "small_fast", "original_keep"]
        );
    }

    #[test]
    fn workflow_from_fields_builds_linear_steps() {
        let workflow = workflow_from_fields(
            "t".to_string(),
            "webp",
            82,
            Some(1920),
            None,
            "a/{stem}",
            PublishTarget::Storage {
                storage_id: Uuid::new_v4(),
            },
        )
        .expect("workflow should build");
        assert_eq!(workflow.name, "t");
        assert_eq!(workflow.steps.len(), 5);
        assert!(matches!(workflow.steps[0], WorkflowStep::Resize { .. }));
        assert!(matches!(workflow.steps[1], WorkflowStep::Convert { .. }));
        assert!(matches!(workflow.steps[2], WorkflowStep::Rename { .. }));
        assert!(matches!(workflow.steps[3], WorkflowStep::Publish { .. }));
        assert!(matches!(workflow.steps[4], WorkflowStep::Output { .. }));
    }

    #[test]
    fn workflow_from_fields_omits_resize_when_no_size() {
        let workflow = workflow_from_fields(
            "t".to_string(),
            "original",
            100,
            None,
            None,
            "a/{stem}",
            PublishTarget::Storage {
                storage_id: Uuid::new_v4(),
            },
        )
        .expect("workflow should build");
        assert_eq!(workflow.steps.len(), 4);
    }
}
