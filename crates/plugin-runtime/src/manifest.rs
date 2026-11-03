use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{PluginKind, PluginManifest, PluginPermission, require_https_or_loopback};

pub const HOST_API_VERSION: u32 = 1;
pub const MANIFEST_SCHEMA_VERSION: u32 = 1;
pub const MAX_MANIFEST_BYTES: usize = 256 * 1024;
pub type ConfigSchema = BTreeMap<String, ConfigField>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigField {
    #[serde(rename = "type")]
    pub field_type: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default, rename = "default")]
    pub default_value: Option<Value>,
    #[serde(default, rename = "enum")]
    pub enum_values: Option<Vec<String>>,
    #[serde(default)]
    pub min_length: Option<usize>,
    #[serde(default)]
    pub max_length: Option<usize>,
    #[serde(default)]
    pub minimum: Option<f64>,
    #[serde(default)]
    pub maximum: Option<f64>,
}

fn invalid() -> String {
    "插件 Manifest、兼容版本或配置 Schema 无效".into()
}

fn reserved(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "__proto__"
            | "prototype"
            | "constructor"
            | "apikey"
            | "api_key"
            | "password"
            | "token"
            | "secret"
            | "authorization"
    )
}

pub fn schema(manifest: &PluginManifest) -> Result<ConfigSchema, String> {
    let fields: ConfigSchema =
        serde_json::from_value(manifest.config_schema.clone()).map_err(|_| invalid())?;
    if fields.len() > 32 {
        return Err(invalid());
    }
    for (name, field) in &fields {
        if name.is_empty()
            || name.len() > 64
            || reserved(name)
            || !name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
            || !matches!(
                field.field_type.as_str(),
                "string" | "url" | "boolean" | "number" | "integer" | "enum"
            )
            || field
                .title
                .as_ref()
                .is_some_and(|s| s.chars().count() > 100)
            || field
                .description
                .as_ref()
                .is_some_and(|s| s.chars().count() > 500)
            || field.min_length.unwrap_or(0) > field.max_length.unwrap_or(4096)
            || field.max_length.unwrap_or(4096) > 4096
            || field.minimum.is_some_and(|x| !x.is_finite())
            || field.maximum.is_some_and(|x| !x.is_finite())
            || matches!((field.minimum, field.maximum), (Some(a), Some(b)) if a > b)
        {
            return Err(invalid());
        }
        if let Some(values) = &field.enum_values {
            if !matches!(field.field_type.as_str(), "string" | "enum")
                || values.is_empty()
                || values.len() > 100
                || values
                    .iter()
                    .any(|s| s.is_empty() || s.chars().count() > 256)
                || values
                    .iter()
                    .enumerate()
                    .any(|(i, s)| values[..i].contains(s))
            {
                return Err(invalid());
            }
        } else if field.field_type == "enum" {
            return Err(invalid());
        }
        if let Some(value) = &field.default_value {
            validate_field(field, value, false)?;
        }
    }
    Ok(fields)
}

impl PluginManifest {
    pub fn validate_contract(&self, local: bool) -> Result<(), String> {
        if self.api_version != HOST_API_VERSION || self.schema_version != MANIFEST_SCHEMA_VERSION {
            return Err("插件要求的宿主 API 或 Manifest Schema 版本不受支持".into());
        }
        if self.id.is_empty()
            || self.id.len() > 128
            || !self
                .id
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"._-".contains(&c))
            || self.name.trim().is_empty()
            || self.name.chars().count() > 120
            || self.description.chars().count() > 1000
            || self.version.is_empty()
            || self.version.len() > 64
            || self.version.chars().any(char::is_control)
        {
            return Err(invalid());
        }
        if local
            && (self.id == "official"
                || self.id.starts_with("official.")
                || self.hooks.is_empty()
                || !self.permissions.contains(&PluginPermission::ReadAsset))
        {
            return Err("本地插件不能使用官方 ID，且必须声明读取资源权限和触发器".into());
        }
        if self.id.split('.').any(|segment| segment.is_empty())
            || !self.id.as_bytes()[0].is_ascii_alphanumeric()
        {
            return Err(invalid());
        }
        if self
            .permissions
            .iter()
            .enumerate()
            .any(|(i, p)| self.permissions[..i].contains(p))
            || self
                .hooks
                .iter()
                .enumerate()
                .any(|(i, h)| self.hooks[..i].contains(h))
        {
            return Err(invalid());
        }
        schema(self)?;
        Ok(())
    }
}

pub fn parse_local_manifest(bytes: &[u8]) -> Result<PluginManifest, String> {
    if bytes.is_empty() || bytes.len() > MAX_MANIFEST_BYTES {
        return Err("Manifest 必须是非空且不超过 256 KiB 的 UTF-8 JSON 文件".into());
    }
    // Direct typed parsing also rejects duplicate fields. Never echo untrusted file contents.
    let manifest: PluginManifest = serde_json::from_slice(bytes).map_err(|_| invalid())?;
    manifest.validate_contract(true)?;
    Ok(manifest)
}

fn validate_field(field: &ConfigField, value: &Value, complete: bool) -> Result<(), String> {
    match field.field_type.as_str() {
        "string" | "url" | "enum" => {
            let text = value.as_str().ok_or_else(invalid)?;
            let len = text.chars().count();
            if len > field.max_length.unwrap_or(4096)
                || len < field.min_length.unwrap_or(0)
                || (complete && field.required && text.trim().is_empty())
                || field
                    .enum_values
                    .as_ref()
                    .is_some_and(|values| !values.iter().any(|v| v == text))
            {
                return Err("配置文本长度、必填项或枚举值无效".into());
            }
            if field.field_type == "url" && !text.is_empty() {
                require_https_or_loopback(text)?;
                let url = reqwest::Url::parse(text).map_err(|_| invalid())?;
                if !url.username().is_empty() || url.password().is_some() {
                    return Err("URL 不得内嵌用户名或密码".into());
                }
            }
        }
        "boolean" if value.is_boolean() => {}
        "number" | "integer" => {
            let number = value
                .as_f64()
                .filter(|n| n.is_finite())
                .ok_or_else(invalid)?;
            if (field.field_type == "integer"
                && (number.fract() != 0.0 || number.abs() > 9_007_199_254_740_991.0))
                || field.minimum.is_some_and(|min| number < min)
                || field.maximum.is_some_and(|max| number > max)
            {
                return Err("配置数字不符合范围或整数要求".into());
            }
        }
        _ => return Err("配置值类型不正确".into()),
    }
    Ok(())
}

pub fn validate_config(
    manifest: &PluginManifest,
    config: &Value,
    complete: bool,
) -> Result<(), String> {
    manifest.validate_contract(false)?;
    if config.to_string().len() > 64 * 1024 {
        return Err("插件配置超过大小上限".into());
    }
    let object = config.as_object().ok_or_else(invalid)?;
    let fields = schema(manifest)?;
    for (name, value) in object {
        if let Some(field) = fields.get(name) {
            validate_field(field, value, complete)?;
        } else if matches!(manifest.kind, PluginKind::AiPrompt)
            && matches!(name.as_str(), "baseUrl" | "model")
        {
            let text = value.as_str().ok_or_else(invalid)?;
            if text.len() > 4096 {
                return Err(invalid());
            }
            if name == "baseUrl" && !text.is_empty() {
                require_https_or_loopback(text)?;
            }
        } else {
            return Err("插件配置含未声明字段；密钥请使用系统凭据设置".into());
        }
    }
    if complete
        && fields
            .iter()
            .any(|(name, field)| field.required && !object.contains_key(name))
    {
        return Err("请先填写插件必填配置".into());
    }
    Ok(())
}

pub fn default_config(manifest: &PluginManifest) -> Result<Value, String> {
    let mut object = serde_json::Map::new();
    for (name, field) in schema(manifest)? {
        if let Some(value) = field.default_value {
            object.insert(name, value);
        }
    }
    Ok(Value::Object(object))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn file() -> Value {
        json!({"id":"example.test","name":"Test","version":"1.0.0","description":"",
        "api_version":1,"schema_version":1,"kind":"template","permissions":["read_asset"],
        "hooks":["after_upload","manual_trigger"],"config_schema":{
            "template":{"type":"string","required":true,"default":"{url}"},
            "enabled":{"type":"boolean"},"quality":{"type":"integer","minimum":1,"maximum":100},
            "format":{"type":"enum","enum":["png","webp"]}
        }})
    }

    #[test]
    fn local_manifest_defaults_and_complete_config() {
        let manifest = parse_local_manifest(&serde_json::to_vec(&file()).unwrap()).unwrap();
        assert_eq!(
            default_config(&manifest).unwrap(),
            json!({"template":"{url}"})
        );
        validate_config(
            &manifest,
            &json!({"template":"x","enabled":false,"quality":80,"format":"png"}),
            true,
        )
        .unwrap();
        assert!(validate_config(&manifest, &json!({}), true).is_err());
        validate_config(&manifest, &json!({}), false).unwrap();
        for config in [
            json!({"quality":1.5}),
            json!({"quality":101}),
            json!({"format":"gif"}),
            json!({"enabled":"false"}),
            json!({"apiKey":"never persist"}),
        ] {
            assert!(validate_config(&manifest, &config, false).is_err());
        }
    }

    #[test]
    fn untrusted_manifests_fail_without_echoing_values() {
        let good = file();
        for (field, bad) in [
            ("id", json!("official.fake")),
            ("api_version", json!(2)),
            ("schema_version", json!(2)),
            ("kind", json!("wasm")),
            ("hooks", json!([])),
            ("permissions", json!(["network"])),
            ("unknown", json!("secret-fixture")),
        ] {
            let mut value = good.clone();
            value[field] = bad;
            let error = parse_local_manifest(&serde_json::to_vec(&value).unwrap()).unwrap_err();
            assert!(!error.contains("secret-fixture"));
        }
        let mut missing = good.clone();
        missing.as_object_mut().unwrap().remove("api_version");
        assert!(parse_local_manifest(&serde_json::to_vec(&missing).unwrap()).is_err());
        assert!(parse_local_manifest(&vec![b' '; MAX_MANIFEST_BYTES + 1]).is_err());
        let mut invalid = good;
        invalid["config_schema"]["apiKey"] = json!({"type":"string"});
        assert!(parse_local_manifest(&serde_json::to_vec(&invalid).unwrap()).is_err());
    }
}
