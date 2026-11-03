//! Signed update protocol. The trust key is compiled in, never supplied by IPC or a release.
use ring::signature::{ED25519, UnparsedPublicKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const TARGET: &str = "windows-x86_64";
pub const MAX_SETUP_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_MANIFEST_BYTES: usize = 16 * 1024;
pub const MANIFEST_NAME: &str = "update-manifest.json";
pub const SIGNATURE_NAME: &str = "update-manifest.json.sig";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateManifest {
    pub schema_version: u32,
    pub version: String,
    pub target: String,
    pub asset_name: String,
    pub bytes: u64,
    pub sha256: String,
}

pub fn parse_version(raw: &str) -> Option<[u64; 3]> {
    let parts: Vec<_> = raw.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let mut version = [0; 3];
    for (i, part) in parts.into_iter().enumerate() {
        if part.is_empty()
            || !part.bytes().all(|b| b.is_ascii_digit())
            || (part.len() > 1 && part.starts_with('0'))
        {
            return None;
        }
        version[i] = part.parse().ok()?;
    }
    Some(version)
}

pub fn trusted_key() -> Result<Vec<u8>, String> {
    let key = include_str!("../update-public-key.hex").trim();
    let bytes = hex::decode(key).map_err(|_| "更新公钥配置无效")?;
    if bytes.len() != 32 || bytes.iter().all(|b| *b == 0) {
        return Err("此构建未配置发布签名公钥，请从官方 Release 手动升级".into());
    }
    Ok(bytes)
}

pub fn verify_manifest(
    raw: &[u8],
    signature_hex: &str,
    public_key: &[u8],
) -> Result<UpdateManifest, String> {
    if raw.is_empty() || raw.len() > MAX_MANIFEST_BYTES || public_key.len() != 32 {
        return Err("更新清单或公钥大小无效".into());
    }
    if signature_hex.trim().len() != 128 {
        return Err("更新签名长度无效".into());
    }
    let signature = hex::decode(signature_hex.trim()).map_err(|_| "更新签名格式无效")?;
    if signature.len() != 64 {
        return Err("更新签名长度无效".into());
    }
    UnparsedPublicKey::new(&ED25519, public_key)
        .verify(raw, &signature)
        .map_err(|_| "更新签名验证失败，已拒绝下载或安装")?;
    // Verify the exact downloaded bytes BEFORE parsing. JSON serialization order is irrelevant.
    let manifest: UpdateManifest = serde_json::from_slice(raw).map_err(|_| "更新清单格式无效")?;
    manifest.validate()?;
    Ok(manifest)
}

impl UpdateManifest {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1
            || parse_version(&self.version).is_none()
            || self.target != TARGET
            || self.asset_name
                != format!(
                    "image-hosting-platform-v{}-windows-x64-setup.exe",
                    self.version
                )
            || self.bytes == 0
            || self.bytes > MAX_SETUP_BYTES
            || self.sha256.len() != 64
            || !self
                .sha256
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            return Err("更新清单的版本、平台、文件名、大小或哈希无效".into());
        }
        Ok(())
    }

    pub fn require_newer(&self, current: &str) -> Result<(), String> {
        match (parse_version(current), parse_version(&self.version)) {
            (Some(old), Some(new)) if new > old => Ok(()),
            _ => Err("更新版本必须高于当前版本，已拒绝降级或重复安装".into()),
        }
    }

    pub fn verify_body(&self, body: &[u8]) -> Result<(), String> {
        if body.len() as u64 != self.bytes {
            return Err("安装包大小与签名清单不符".into());
        }
        if format!("{:x}", Sha256::digest(body)) != self.sha256 {
            return Err("sha256 校验不一致，已拒绝安装".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    #[test]
    fn independent_python_signature_vector_verifies_in_rust() {
        let vector: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../scripts/fixtures/update-signature-vector.json"
        ))
        .unwrap();
        let raw = hex::decode(vector["manifestHex"].as_str().unwrap()).unwrap();
        let key = hex::decode(vector["publicKey"].as_str().unwrap()).unwrap();
        let manifest = verify_manifest(&raw, vector["signature"].as_str().unwrap(), &key).unwrap();
        assert_eq!(manifest.version, "2.0.0");
    }

    fn fixture() -> (Ed25519KeyPair, UpdateManifest, Vec<u8>) {
        let key = Ed25519KeyPair::from_seed_unchecked(&[7; 32]).unwrap();
        let body = b"fixture installer, never executable".to_vec();
        let manifest = UpdateManifest {
            schema_version: 1,
            version: "2.0.0".into(),
            target: TARGET.into(),
            asset_name: "image-hosting-platform-v2.0.0-windows-x64-setup.exe".into(),
            bytes: body.len() as u64,
            sha256: format!("{:x}", Sha256::digest(&body)),
        };
        (key, manifest, body)
    }

    #[test]
    fn signed_release_round_trip_and_preinstall_reverification() {
        let (key, manifest, body) = fixture();
        let raw = serde_json::to_vec(&manifest).unwrap();
        let signature = hex::encode(key.sign(&raw));
        let verified = verify_manifest(&raw, &signature, key.public_key().as_ref()).unwrap();
        verified.require_newer("1.4.11").unwrap();
        verified.verify_body(&body).unwrap();
        let mut disk = body.clone();
        disk[0] ^= 1;
        assert!(verified.verify_body(&disk).is_err());
        assert!(verified.verify_body(&body[..body.len() - 1]).is_err());
    }

    #[test]
    fn tampered_manifest_wrong_key_missing_and_malformed_signatures_are_refused() {
        let (key, manifest, _) = fixture();
        let mut raw = serde_json::to_vec(&manifest).unwrap();
        let signature = hex::encode(key.sign(&raw));
        let other = Ed25519KeyPair::from_seed_unchecked(&[8; 32]).unwrap();
        assert!(verify_manifest(&raw, &signature, other.public_key().as_ref()).is_err());
        for bad in ["", "zz", &"00".repeat(64)] {
            assert!(verify_manifest(&raw, bad, key.public_key().as_ref()).is_err());
        }
        raw[0] ^= 1;
        assert!(verify_manifest(&raw, &signature, key.public_key().as_ref()).is_err());
    }

    #[test]
    fn even_valid_signatures_cannot_authorize_wrong_platform_path_or_protocol() {
        let (key, manifest, _) = fixture();
        let mut invalid = Vec::new();
        let mut m = manifest.clone();
        m.target = "linux-x86_64".into();
        invalid.push(m);
        let mut m = manifest.clone();
        m.asset_name = "../setup.exe".into();
        invalid.push(m);
        let mut m = manifest.clone();
        m.schema_version = 2;
        invalid.push(m);
        for size in [0, MAX_SETUP_BYTES + 1] {
            let mut m = manifest.clone();
            m.bytes = size;
            invalid.push(m);
        }
        for m in invalid {
            let raw = serde_json::to_vec(&m).unwrap();
            assert!(
                verify_manifest(
                    &raw,
                    &hex::encode(key.sign(&raw)),
                    key.public_key().as_ref()
                )
                .is_err()
            );
        }
        assert!(manifest.require_newer("2.0.0").is_err());
        assert!(manifest.require_newer("3.0.0").is_err());
        assert!(manifest.require_newer("invalid").is_err());
    }

    #[test]
    fn strict_versions_and_bounded_metadata() {
        for bad in ["v1.2.3", "1.02.3", "+1.2.3", "1.2", "1.2.3-rc1", "../1.2.3"] {
            assert!(parse_version(bad).is_none());
        }
        let (key, _, _) = fixture();
        assert!(
            verify_manifest(
                &vec![0; MAX_MANIFEST_BYTES + 1],
                "",
                key.public_key().as_ref()
            )
            .is_err()
        );
    }
}
