//! Opt-in real-cloud E2E for Issue #7. Never run with a production or publicly exposed bucket.
//! This compiles during normal CI, but runs only with --ignored and explicit environment flags.
//! NEVER print signed URLs, Cloudflare tokens or raw SDK/network errors.

use std::time::Duration;

use bytes::Bytes;
use reqwest::{Client, redirect::Policy};
use serde_json::Value;
use sha2::{Digest, Sha256};
use storage_core::{StorageProvider, UploadRequest};
use storage_opendal::{ObjectAccessMode, OpenDalStorage, S3Credentials, S3StorageConfig};
use uuid::Uuid;

const EXPIRES_SECONDS: u64 = 600;
const CLOCK_MARGIN_SECONDS: u64 = 30;

fn required_env(name: &str) -> Result<String, String> {
    std::env::var(name)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| format!("Missing required environment variable: {name}"))
}

fn validate_identifiers(account: &str, bucket: &str) -> Result<(), String> {
    if account.len() != 32 || !account.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("R2_E2E_ACCOUNT_ID must be a 32-character hexadecimal account ID".into());
    }
    if bucket.len() < 3
        || bucket.len() > 63
        || !bucket.bytes().all(|b| {
            b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'.'
        })
    {
        return Err("R2_E2E_BUCKET must be a valid lower-case test Bucket name".into());
    }
    Ok(())
}

async fn cloudflare_json(
    client: &Client,
    token: &str,
    account: &str,
    bucket: &str,
    domain_kind: &str,
) -> Result<Value, String> {
    let path = format!(
        "https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/{bucket}/domains/{domain_kind}"
    );
    let response = client
        .get(path)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| format!("Cloudflare {domain_kind} audit request failed"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Cloudflare {domain_kind} audit returned HTTP {} (fail closed)",
            response.status().as_u16()
        ));
    }
    let document: Value = response
        .json()
        .await
        .map_err(|_| format!("Cloudflare {domain_kind} audit JSON was invalid"))?;
    if document.get("success") != Some(&Value::Bool(true)) {
        return Err(format!("Cloudflare {domain_kind} audit was not successful"));
    }
    Ok(document)
}

/// The API check must finish successfully before creating any object. This is not a
/// claim about third-party Workers or a cached/forwarded alternate endpoint.
async fn assert_no_public_r2_domains(
    client: &Client,
    token: &str,
    account: &str,
    bucket: &str,
) -> Result<(), String> {
    let managed = cloudflare_json(client, token, account, bucket, "managed").await?;
    match managed.pointer("/result/enabled").and_then(Value::as_bool) {
        Some(false) => {}
        Some(true) => return Err("r2.dev public URL is enabled: refusing to upload".into()),
        None => return Err("r2.dev public state unknown: refusing to upload".into()),
    }

    let custom = cloudflare_json(client, token, account, bucket, "custom").await?;
    let domains = custom
        .pointer("/result/domains")
        .and_then(Value::as_array)
        .ok_or("Cloudflare custom domain list missing: refusing to upload")?;
    for domain in domains {
        match domain.get("enabled").and_then(Value::as_bool) {
            Some(false) => {}
            Some(true) => return Err("An R2 custom domain is public: refusing to upload".into()),
            None => return Err("R2 custom domain state unknown: refusing to upload".into()),
        }
    }
    println!("PASS domain-audit: r2.dev and all returned custom domains disabled");
    Ok(())
}

async fn anonymous_get_status(client: &Client, url: &str) -> Result<(u16, Vec<u8>), String> {
    // No Authorization/Cookie/default headers; never log this URL (it may be signed).
    let response = client
        .get(url)
        .header(reqwest::header::CACHE_CONTROL, "no-cache")
        .send()
        .await
        .map_err(|_| "Anonymous HTTPS GET failed (no URL logged)")?;
    let status = response.status().as_u16();
    let data = response
        .bytes()
        .await
        .map_err(|_| "Anonymous HTTPS response read failed")?;
    if data.len() > 64 * 1024 {
        return Err("HTTP response exceeded E2E size limit".into());
    }
    Ok((status, data.to_vec()))
}

#[tokio::test]
#[ignore = "real R2 credentials, CF API token, opt-in writes and 10+ minutes required"]
async fn real_r2_private_object_e2e() {
    let result = perform_real_r2_private_e2e().await;
    if let Err(message) = result {
        panic!("R2 live E2E: {message}");
    }
}

async fn perform_real_r2_private_e2e() -> Result<(), String> {
    if required_env("R2_E2E_ALLOW_TEST_WRITES")? != "YES_TEST_BUCKET" {
        return Err("Set R2_E2E_ALLOW_TEST_WRITES=YES_TEST_BUCKET to opt in".into());
    }
    let account = required_env("R2_E2E_ACCOUNT_ID")?;
    let bucket = required_env("R2_E2E_BUCKET")?;
    validate_identifiers(&account, &bucket)?;
    let access_key = required_env("R2_E2E_ACCESS_KEY_ID")?;
    let secret = required_env("R2_E2E_SECRET_ACCESS_KEY")?;
    let cf_token = required_env("R2_E2E_CLOUDFLARE_API_TOKEN")?;

    let unsigned_client = Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "Failed to initialize HTTP client")?;

    // Fail before uploading if the R2 settings API cannot PROVE both public switches off.
    assert_no_public_r2_domains(&unsigned_client, &cf_token, &account, &bucket).await?;

    let endpoint = format!("https://{account}.r2.cloudflarestorage.com");
    let config = S3StorageConfig {
        endpoint: endpoint.clone(),
        region: "auto".into(),
        bucket: bucket.clone(),
        root: String::new(),
        public_base_url: None,
        access_mode: ObjectAccessMode::PrivateRequested,
    };
    let credentials = S3Credentials {
        access_key_id: access_key,
        secret_access_key: secret,
    };
    let storage = OpenDalStorage::s3("r2", &config, &credentials)
        .map_err(|_| "Unable to construct production OpenDAL R2 provider")?;

    // Unique generated test bytes only. No user images, no production object overwritten.
    let id = Uuid::new_v4().simple().to_string();
    let path = format!("mirror-private-e2e/{id}.txt");
    let body = Bytes::from(format!("mirror-private-e2e-test-payload-{id}"));
    let expected_hash = Sha256::digest(&body);

    let test_result: Result<(), String> = async {
        // Even a failed upload can have written bytes before the subsequent stat failed.
        // Keep every cloud write inside this scope so the cleanup below always runs.
        let upload = storage
            .upload(UploadRequest {
                path: path.clone(),
                content_type: Some("text/plain".into()),
                body: body.clone(),
            })
            .await
            .map_err(|_| "Test object upload failed; check Bucket write permissions")?;
        if upload.public_url.is_some() {
            return Err("Private-requested R2 returned a public URL".into());
        }

        if !storage.exists(&path).await.map_err(|_| "R2 HEAD/stat failed")? {
            return Err("Uploaded object missing despite successful upload".into());
        }
        let readback = storage
            .download(&path)
            .await
            .map_err(|_| "Authorized R2 readback failed")?;
        if Sha256::digest(&readback) != expected_hash {
            return Err("Authenticated R2 readback content mismatch".into());
        }
        println!("PASS upload: production OpenDAL write/readback works; no public URL");

        let unsigned_url = format!("{endpoint}/{bucket}/{path}");
        let (status, _) = anonymous_get_status(&unsigned_client, &unsigned_url).await?;
        if !matches!(status, 401 | 403 | 404) {
            return Err(format!("R2 API unsigned object GET returned HTTP {status}"));
        }
        println!("PASS unsigned-read: object exists, unsigned S3 API GET denied ({status})");

        let signed_url = storage
            .temporary_read_url(&path, Duration::from_secs(EXPIRES_SECONDS))
            .await
            .map_err(|_| "Production OpenDAL could not issue GET presigned URL")?;
        let parsed = reqwest::Url::parse(&signed_url)
            .map_err(|_| "Signed URL could not be parsed")?;
        if parsed.scheme() != "https"
            || parsed.host_str() != Some(format!("{account}.r2.cloudflarestorage.com").as_str())
            || parsed.username() != ""
            || parsed.password().is_some()
            || !parsed.query_pairs().any(|(key, _)| key == "X-Amz-Signature")
        {
            return Err("Presigned link is not a browser-ready R2 HTTPS GET URL".into());
        }

        let (signed_status, signed_body) =
            anonymous_get_status(&unsigned_client, &signed_url).await?;
        if signed_status != 200 || Sha256::digest(&signed_body) != expected_hash {
            return Err(format!(
                "Unsigned-client presigned GET failed digest/status verification (HTTP {signed_status})"
            ));
        }
        println!("PASS presigned-read: anonymous client HTTP 200, SHA256 matches");

        tokio::time::sleep(Duration::from_secs(
            EXPIRES_SECONDS + CLOCK_MARGIN_SECONDS,
        ))
        .await;
        let (expired_status, _) =
            anonymous_get_status(&unsigned_client, &signed_url).await?;
        if !matches!(expired_status, 400 | 401 | 403) {
            return Err(format!(
                "Expired GET returned unexpected status {expired_status}; privacy not proven"
            ));
        }
        println!("PASS expiry: original signed URL rejected (HTTP {expired_status})");
        Ok(())
    }
    .await;

    // A cleanup failure is never hidden by a green test. Deleting an absent
    // object is idempotent on R2, so even an incomplete upload is cleaned up.
    let cleanup = storage.delete(&path).await;
    if cleanup.is_err() {
        return Err("Cleanup failed: manually inspect the dedicated test Bucket".into());
    }
    if storage.exists(&path).await.unwrap_or(true) {
        return Err("Cleanup not confirmed: test object may remain".into());
    }
    test_result?;
    println!("PASS cleanup: test object deleted and absence confirmed");
    println!("PASS LIVE R2 E2E: all scoped checks succeeded; Workers/other proxies still require audit");
    Ok(())
}
