//! `ai-assistant` 内置插件：AI 设置读写与工作流规划。
//!
//! 迁移自 `commands/plugins.rs` 的 `get_ai_settings` / `save_ai_settings` /
//! `ai_plan_workflow`，凭据仍走 OS 凭据库（`credential-store`），设置仍在 SQLite。

use kernel_api::{
    BuiltinPlugin, Contribution, ContributionPoint, InvokeErrorCode, PluginFailure, PluginId,
    PluginKind, PluginManifestV2,
};
use persistence_sqlite::{PluginRepository, SettingsRepository};
use serde_json::{Value, json};

/// 插件 id（与 `crates/kernel/src/builtin.rs` 装配表一致）。
pub const PLUGIN_ID: &str = "ai-assistant";

const AI_SETTINGS_KEY: &str = "ai.provider";
const AI_CREDENTIAL_KEY: &str = "ai:provider";

pub fn manifest() -> PluginManifestV2 {
    PluginManifestV2 {
        api_version: kernel_api::MANIFEST_API_VERSION,
        schema_version: kernel_api::MANIFEST_SCHEMA_VERSION,
        id: PluginId::new(PLUGIN_ID).expect("ai-assistant is a valid plugin id"),
        name: "AI 助手".to_string(),
        version: "2.0.0-dev.1".to_string(),
        description: "AI 设置与发布工作流规划。".to_string(),
        kind: PluginKind::Native,
        permissions: Vec::new(),
        default_enabled: true,
        contributes: vec![Contribution {
            point: ContributionPoint::Settings,
            id: "ai".to_string(),
            label: Some("AI".to_string()),
            description: Some("AI 模型与凭据设置。".to_string()),
        }],
        settings_schema: None,
    }
}

/// AI 助手插件：设置仓储 + 凭据库注入，不接收 context 参数。
pub struct AiAssistantPlugin {
    settings: SettingsRepository,
    plugins: PluginRepository,
    credentials: credential_store::CredentialStore,
    manifest: PluginManifestV2,
}

impl AiAssistantPlugin {
    pub fn new(
        settings: SettingsRepository,
        plugins: PluginRepository,
        credentials: credential_store::CredentialStore,
    ) -> Self {
        Self {
            settings,
            plugins,
            credentials,
            manifest: manifest(),
        }
    }

    /// 读取 AI 设置；`apiKey` 从 OS 凭据库补齐，并做一次历史明文迁移。
    async fn get_settings(&self) -> Result<Value, PluginFailure> {
        let mut settings = self
            .settings
            .get(AI_SETTINGS_KEY)
            .await
            .map_err(|error| internal(error.to_string()))?
            .unwrap_or(json!({"baseUrl":"https://api.openai.com/v1","model":""}));

        let legacy_key = settings
            .get("apiKey")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        if let Some(legacy_key) = legacy_key {
            self.credentials
                .set_json(AI_CREDENTIAL_KEY, &legacy_key)
                .map_err(|error| internal(error.to_string()))?;
            if let Some(object) = settings.as_object_mut() {
                object.remove("apiKey");
            }
            self.settings
                .set(AI_SETTINGS_KEY, &settings)
                .await
                .map_err(|error| internal(error.to_string()))?;
        }

        let key = self
            .credentials
            .get_json::<String>(AI_CREDENTIAL_KEY)
            .unwrap_or_default();
        if let Some(object) = settings.as_object_mut() {
            object.insert("apiKey".into(), Value::String(key));
        }
        Ok(settings)
    }

    /// 保存 AI 设置：`apiKey` 只进凭据库，不落 SQLite。
    async fn save_settings(&self, mut settings: Value) -> Result<Value, PluginFailure> {
        let key = settings
            .get("apiKey")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if key.is_empty() {
            let _ = self.credentials.delete(AI_CREDENTIAL_KEY);
        } else {
            self.credentials
                .set_json(AI_CREDENTIAL_KEY, &key)
                .map_err(|error| internal(error.to_string()))?;
        }
        if let Some(object) = settings.as_object_mut() {
            object.remove("apiKey");
        }
        self.settings
            .set(AI_SETTINGS_KEY, &settings)
            .await
            .map_err(|error| internal(error.to_string()))?;
        self.get_settings().await
    }

    /// 规划工作流：把已启用插件清单与用户请求交给 OpenAI 兼容接口，返回严格 JSON。
    async fn plan_workflow(&self, request: &str) -> Result<Value, PluginFailure> {
        let settings = self.get_settings().await?;
        let base = settings
            .get("baseUrl")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("baseUrl missing"))?;
        let model = settings
            .get("model")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| invalid("model missing"))?;
        let plugins = self
            .plugins
            .list()
            .await
            .map_err(|error| internal(error.to_string()))?
            .into_iter()
            .filter(|plugin| plugin.enabled)
            .map(|plugin| json!({"id": plugin.id, "name": plugin.name}))
            .collect::<Vec<_>>();
        let prompt = format!(
            "You are a workflow planner for an image publishing app. User request: {request}. Installed plugins: {}. Return strict JSON with keys name, steps, suggestedPlugins, explanation. Never claim an action was executed.",
            serde_json::to_string(&plugins).unwrap_or_default()
        );
        let mut request = reqwest::Client::new()
            .post(format!("{}/chat/completions", base.trim_end_matches('/')))
            .json(&json!({
                "model": model,
                "response_format": {"type": "json_object"},
                "messages": [{"role": "user", "content": prompt}]
            }));
        if let Some(key) = settings
            .get("apiKey")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            request = request.bearer_auth(key);
        }
        let response: Value = request
            .send()
            .await
            .map_err(|error| internal(error.to_string()))?
            .error_for_status()
            .map_err(|error| internal(error.to_string()))?
            .json()
            .await
            .map_err(|error| internal(error.to_string()))?;
        let text = response
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("AI returned no content"))?;
        serde_json::from_str(text).map_err(|error| {
            PluginFailure::new(
                InvokeErrorCode::InvalidPayload,
                format!("AI returned invalid JSON: {error}"),
            )
        })
    }
}

fn internal(message: String) -> PluginFailure {
    PluginFailure::new(InvokeErrorCode::Internal, message)
}

fn invalid(message: &str) -> PluginFailure {
    PluginFailure::new(InvokeErrorCode::InvalidPayload, message)
}

#[async_trait::async_trait]
impl BuiltinPlugin for AiAssistantPlugin {
    fn manifest(&self) -> PluginManifestV2 {
        self.manifest.clone()
    }

    async fn invoke(&self, method: &str, payload: &Value) -> Result<Value, PluginFailure> {
        match method {
            "ai.get_settings" => self.get_settings().await,
            "ai.save_settings" => self.save_settings(payload.clone()).await,
            "ai.plan_workflow" => {
                let request = payload
                    .get("request")
                    .and_then(Value::as_str)
                    .ok_or_else(|| invalid("request missing"))?;
                self.plan_workflow(request).await
            }
            _ => Err(PluginFailure::new(
                InvokeErrorCode::UnknownMethod,
                format!("unknown ai-assistant method {method}"),
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
        item.validate()
            .expect("ai-assistant manifest must validate");
        assert_eq!(item.id.as_str(), PLUGIN_ID);
        assert!(item.default_enabled);
        assert_eq!(item.kind, PluginKind::Native);
        assert_eq!(item.contributes.len(), 1);
    }
}
