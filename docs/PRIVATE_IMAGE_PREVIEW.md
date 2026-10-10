# Private R2 image preview and Save Original (Issue #7 UI slice)

This is a desktop-product feature, stacked after the private R2 publishing
work in PR #8. The **real-cloud E2E and Windows GUI acceptance are deferred**;
neither GitHub compilation nor this feature proves that the remote Bucket is private.

## User flow

1. In the desktop app, upload an image to a private-requested R2 storage target.
2. Open **Assets (资源)**. Images with no permanent public URL remain listed as
   successfully uploaded, but clearly labelled `private_requested` / **privacy
   not verified**. They never receive a fabricated `publicUrl`.
3. On an uploaded private R2 image, click **Preview (预览)**. The app reads the object
   with the configured credentials and displays a temporary, in-memory image
   URL in a viewer. No signed HTTP share URL is created to render this preview.
4. Click **Save Original (保存原图)** to choose a destination on your computer and
   download the original via the existing authenticated download command.
5. **Temporary Share (临时分享)** remains the separate 10m/1h/24h capability.

## Scope and technical constraints

- Preview intentionally runs only on demand. It does not auto-download
  thumbnails for 200+ items and does not store object bytes in SQLite.
- The backend verifies enabled R2 storage marked `private_requested`, checks
  remote path safety, checks remote file size **before downloading**, and then
  rechecks the returned byte length against a **5 MiB** cap.
- Supported browser-viewable formats are PNG/JPEG/GIF/WebP/AVIF, detected from
  file signatures rather than a user-supplied extension or MIME string.
  Unsupported or oversized images have a Save Original option instead.
- Preview data is passed from Rust through a Tauri command to a temporary local
  Blob URL. It is revoked on close, replacement, or leaving the resource page.
  The renderer does not receive bucket access keys or presigned S3 URLs.
- `download_preview` is an optional `StorageProvider` capability, with
  an Unsupported default to preserve other providers. Only OpenDAL implements
  the bounded read path; the UI currently exposes it only for private R2.
- The size check uses an OpenDAL stat followed by a read; a concurrent remote
  object mutation can increase transient memory use. The response is still
  rejected if oversized. Preview is intended for trusted storage configured
  by the local user, not arbitrary adversarial endpoints.
- The user must still configure the R2 Bucket itself to deny public access.
  `private_requested` represents **intent, not verified privacy**.

## Remaining acceptance at the final test stage

- Windows desktop: private upload → asset list → preview → close/reopen → save
  original → temporary share; confirm old public upload remains unchanged.
- Real private R2: unsigned GET denied, signed GET matches image, expired link
  denied, preview works with production credentials.
- Test oversized, unsupported, missing and disabled remote objects.
- Reconcile with locally unpublished EPIC-R code before merging into `dev`.

Nothing in this UI slice requires merging PR #9 or provisioning CI cloud
secrets. Keep the feature PR in Draft until integration gates are complete.
