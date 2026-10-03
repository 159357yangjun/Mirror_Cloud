use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginPermission {
    ReadAsset,
    Network,
    Secret,
    ExternalWrite,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginKind {
    Template,
    Webhook,
    AiPrompt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginHook {
    BeforeProcess,
    AfterProcess,
    AfterUpload,
    OnPublishFailure,
    OnGalleryDelete,
    ManualTrigger,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub kind: PluginKind,
    #[serde(default)]
    pub permissions: Vec<PluginPermission>,
    #[serde(default)]
    pub hooks: Vec<PluginHook>,
    #[serde(default)]
    pub config_schema: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginContext {
    pub asset_name: String,
    pub public_url: String,
    pub mime_type: String,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginOutput {
    pub text: String,
    pub data: Value,
}

#[derive(thiserror::Error, Debug)]
pub enum PluginError {
    #[error("invalid plugin configuration: {0}")]
    InvalidConfig(String),
    #[error("plugin permission denied: {0}")]
    PermissionDenied(String),
    #[error("plugin network error: {0}")]
    Network(String),
}

fn require_permission(
    manifest: &PluginManifest,
    granted_permissions: &[PluginPermission],
    permission: PluginPermission,
) -> Result<(), PluginError> {
    if !manifest.permissions.contains(&permission) {
        return Err(PluginError::PermissionDenied(format!(
            "{} did not declare {:?}",
            manifest.name, permission
        )));
    }
    if !granted_permissions.contains(&permission) {
        return Err(PluginError::PermissionDenied(format!(
            "{} is not authorized for {:?}",
            manifest.name, permission
        )));
    }
    Ok(())
}

fn http_endpoint<'a>(config: &'a Value, key: &str) -> Result<&'a str, PluginError> {
    let value = config
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| PluginError::InvalidConfig(format!("{key} is required")))?;
    // Credential-bearing outbound calls (webhook secrets, AI bearer keys) must not
    // traverse plain HTTP outside loopback; this is the final gate, not the UI.
    require_https_or_loopback(value).map_err(PluginError::InvalidConfig)?;
    Ok(value)
}

/// HTTPS always passes; plain HTTP only for localhost/127.0.0.1/::1. LAN and public
/// HTTP are refused outright (carriers of API keys, AK/SK, passwords, bearer tokens).
pub fn require_https_or_loopback(url: &str) -> Result<(), String> {
    let parsed =
        reqwest::Url::parse(url).map_err(|_| "endpoint must be a valid URL".to_string())?;
    match parsed.scheme() {
        "https" => Ok(()),
        "http" => {
            let host_ok = match parsed.host_str() {
                Some("localhost") => true,
                Some(host) => host
                    .trim_matches(['[', ']'])
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|address| address.is_loopback()),
                None => false,
            };
            if host_ok {
                Ok(())
            } else {
                Err(format!(
                    "plain HTTP is only allowed for loopback hosts (got {url}); use https://"
                ))
            }
        }
        other => Err(format!("unsupported URL scheme {other}: use https://")),
    }
}

fn ai_request_body(model: &str, prompt: &str, image_url: &str) -> Value {
    json!({
        "model": model,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": image_url, "detail": "auto"}}
            ]
        }]
    })
}

fn supports_hook(manifest: &PluginManifest, hook: PluginHook) -> bool {
    if manifest.hooks.is_empty() {
        return matches!(hook, PluginHook::AfterUpload | PluginHook::ManualTrigger);
    }
    manifest.hooks.contains(&hook)
}

pub async fn execute_for_hook(
    manifest: &PluginManifest,
    granted_permissions: &[PluginPermission],
    config: &Value,
    ctx: &PluginContext,
    hook: PluginHook,
) -> Result<PluginOutput, PluginError> {
    if !supports_hook(manifest, hook) {
        return Err(PluginError::InvalidConfig(format!(
            "{} does not support hook {:?}",
            manifest.name, hook
        )));
    }
    require_permission(manifest, granted_permissions, PluginPermission::ReadAsset)?;

    match manifest.kind {
        PluginKind::Template => {
            let template = config
                .get("template")
                .and_then(Value::as_str)
                .unwrap_or("[{name}]({url})");
            let text = template
                .replace("{name}", &ctx.asset_name)
                .replace("{url}", &ctx.public_url)
                .replace("{mime}", &ctx.mime_type);
            Ok(PluginOutput {
                text: text.clone(),
                data: json!({"text": text}),
            })
        }
        PluginKind::Webhook => {
            require_permission(manifest, granted_permissions, PluginPermission::Network)?;
            require_permission(
                manifest,
                granted_permissions,
                PluginPermission::ExternalWrite,
            )?;
            let endpoint = http_endpoint(config, "endpoint")?;
            let response = reqwest::Client::new()
                .post(endpoint)
                .json(&json!({
                    "event": serde_json::to_value(hook).unwrap_or(Value::String("unknown".into())),
                    "name": ctx.asset_name,
                    "url": ctx.public_url,
                    "mimeType": ctx.mime_type,
                    "metadata": ctx.metadata.clone()
                }))
                .send()
                .await
                .map_err(|e| PluginError::Network(e.to_string()))?;
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            if !status.is_success() {
                return Err(PluginError::Network(format!("HTTP {status}: {body}")));
            }
            Ok(PluginOutput {
                text: body.clone(),
                data: json!({"status": status.as_u16(), "body": body}),
            })
        }
        PluginKind::AiPrompt => {
            require_permission(manifest, granted_permissions, PluginPermission::Network)?;
            let base_url = http_endpoint(config, "baseUrl")?;
            let model = config
                .get("model")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| PluginError::InvalidConfig("model is required".into()))?;
            let prompt = config
                .get("prompt")
                .and_then(Value::as_str)
                .unwrap_or("Write concise, accessible alt text for this image.")
                .replace("{name}", &ctx.asset_name)
                .replace("{url}", &ctx.public_url);

            let mut request = reqwest::Client::new()
                .post(format!(
                    "{}/chat/completions",
                    base_url.trim_end_matches('/')
                ))
                .json(&ai_request_body(model, &prompt, &ctx.public_url));
            if let Some(key) = config
                .get("apiKey")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                require_permission(manifest, granted_permissions, PluginPermission::Secret)?;
                request = request.bearer_auth(key);
            }
            let value: Value = request
                .send()
                .await
                .map_err(|e| PluginError::Network(e.to_string()))?
                .error_for_status()
                .map_err(|e| PluginError::Network(e.to_string()))?
                .json()
                .await
                .map_err(|e| PluginError::Network(e.to_string()))?;
            let text = value
                .pointer("/choices/0/message/content")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            Ok(PluginOutput { text, data: value })
        }
    }
}

pub async fn execute(
    manifest: &PluginManifest,
    granted_permissions: &[PluginPermission],
    config: &Value,
    ctx: &PluginContext,
) -> Result<PluginOutput, PluginError> {
    execute_for_hook(
        manifest,
        granted_permissions,
        config,
        ctx,
        PluginHook::AfterUpload,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_and_loopback_http_pass_lan_and_public_http_fail() {
        let accepted = [
            "https://example.com",
            "http://localhost:11434",
            "http://127.0.0.1:9000",
            "http://[::1]:11434",
        ];
        for url in accepted {
            require_https_or_loopback(url)
                .unwrap_or_else(|error| panic!("{url} rejected: {error}"));
        }
        let refused = [
            "http://example.com",
            "http://192.168.1.10",
            "http://10.0.0.2",
            "http://172.16.5.4",
            "ftp://example.com",
        ];
        for url in refused {
            assert!(
                require_https_or_loopback(url).is_err(),
                "{url} must be refused"
            );
        }
    }

    #[test]
    fn ai_payload_contains_visual_input() {
        let payload = ai_request_body(
            "vision-model",
            "Describe this image",
            "https://example.com/image.png",
        );
        assert_eq!(
            payload
                .pointer("/messages/0/content/1/type")
                .and_then(Value::as_str),
            Some("image_url")
        );
        assert_eq!(
            payload
                .pointer("/messages/0/content/1/image_url/url")
                .and_then(Value::as_str),
            Some("https://example.com/image.png")
        );
    }

    #[tokio::test]
    async fn template_requires_read_asset_permission() {
        let manifest = PluginManifest {
            id: "test.template".into(),
            name: "Template".into(),
            version: "1.0.0".into(),
            description: String::new(),
            kind: PluginKind::Template,
            permissions: vec![],
            hooks: vec![PluginHook::AfterUpload],
            config_schema: json!({}),
        };
        let error = execute(
            &manifest,
            &[],
            &json!({"template":"{url}"}),
            &PluginContext {
                asset_name: "a.png".into(),
                public_url: "https://example.com/a.png".into(),
                mime_type: "image/png".into(),
                metadata: json!({}),
            },
        )
        .await
        .expect_err("permission should be required");
        assert!(matches!(error, PluginError::PermissionDenied(_)));
    }

    #[tokio::test]
    async fn declared_permission_still_requires_user_grant() {
        let manifest = PluginManifest {
            id: "test.template.grant".into(),
            name: "Template Grant".into(),
            version: "1.0.0".into(),
            description: String::new(),
            kind: PluginKind::Template,
            permissions: vec![PluginPermission::ReadAsset],
            hooks: vec![PluginHook::AfterUpload],
            config_schema: json!({}),
        };
        let error = execute(
            &manifest,
            &[],
            &json!({"template":"{url}"}),
            &PluginContext {
                asset_name: "a.png".into(),
                public_url: "https://example.com/a.png".into(),
                mime_type: "image/png".into(),
                metadata: json!({}),
            },
        )
        .await
        .expect_err("declared permission must not imply authorization");
        assert!(matches!(error, PluginError::PermissionDenied(_)));
    }
}
