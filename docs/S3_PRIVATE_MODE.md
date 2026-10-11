# S3-compatible private image targets (product feature slice)

Status: **Draft**. Real cloud / Windows acceptance intentionally deferred until
the user completes the product feature set. A green CI cannot prove a
provider's Bucket ACL, endpoint behavior or expiring signatures.

## Product workflow

1. Add storage → **S3 Compatible** → choose **Private storage target**.
2. Enter Endpoint (HTTPS, or HTTP loopback for a local S3-compatible server),
   Region, Bucket and credentials. **Do not provide a public image URL**.
3. Upload images; the resource index must report successful uploads even though
   their permanent public URL is absent.
4. Open a private image from Assets, Gallery or Storage Browser; the image
   is read on demand using configured credentials and stays in a temporary
   viewer Blob URL, with the existing 5 MiB cap and image-signature checks.
5. Save the original or explicitly generate a 10-minute / 1-hour / 24-hour
   read-only presigned URL to share. The URL is a bearer secret; never log or
   persist it.

## Compatibility and safety boundaries

- S3 private mode uses the **same OpenDAL S3 adapter** as existing public S3;
  it does not imply support for arbitrary non-S3 providers.
- Private intent is a configuration request, **not a remote privacy verdict**.
  No Bucket ACL, endpoint exposure, custom domain, CDN, proxy or anonymous
  GET is changed or checked by switching this mode.
- Only **enabled R2/S3 storages** with `private_requested` can use credentialed
  on-demand preview for files with no public URL. The private setting also
  hides historical public URL copy/open shortcuts in gallery/browser.
- Groups containing a private R2/S3 storage may contain **only other private
  R2/S3 storages**, including when restored member references are missing.
  Mixed public/private replication is refused rather than silently leaking.
- Old R2 and generic S3 records lacking `access_mode` default to public at
  deserialization; no SQLite migration and no reclassification of existing
  public S3 images is performed.
- OpenDAL can create a presigned read URL, but a compatible provider may
  reject its dialect, canonical host, headers or expiry. Actual browser-open
  success and expiry require a final provider-specific E2E.
- Aliyun OSS, Tencent COS, GitHub/Gitee and WebDAV are unchanged. Their
  provider-specific private handling, if desired, needs a separate audited
  implementation; they are **not** treated as generic S3.

## Deferred acceptance matrix

- Old S3 public create/upload/gallery retains permanent URL behavior.
- Private S3 setup refuses nonempty publicBaseUrl, accepts trusted HTTPS
  endpoint and local loopback during development.
- Private S3 upload, authenticated preview/save, absence of public URL,
  signed GET link and expiry against a known S3-compatible real Bucket.
- Mixing private and public storage-group members is refused, independent
  of member order.
- Missing credentials/objects/oversize/unsupported images surface redacted
  errors without exposing raw signed URLs or access keys.
- Repeat for each supported S3-compatible provider to document limitations.
