# Unified image management: Gallery + Storage Browser + Assets

**Status:** product code implemented in a stacked Draft PR. Real R2/Windows
end-to-end acceptance is intentionally deferred until the user finishes the
remaining project features. A green CI result is not proof of remote privacy.

## User-facing behavior

- **Assets (资源):** uploaded private R2 assets have an explicit authenticated
  preview, Save Original, and 10-minute/1-hour/24-hour Temporary Share.
- **Gallery (图库):** browsing the actual remote bucket, independent of an
  asset's local publish record, allows the same authenticated private preview,
  download, rename, move and delete. A private R2 dropdown configures the
  temporary read-only share expiry and the card/list viewer can copy a new link.
- **Storage browser (云端文件浏览器):** private R2 PNG/JPEG/GIF/WebP/AVIF files
  without a public URL can also be opened and saved. Its existing limited-time
  sharing UI remains available.
- **Public image URLs:** public cards retain ordinary thumbnails, URL copy,
  external browser launch and preview. No new authentication network call is
  made to preview public images.

## Scope and safety

- Only `enabled + providerKey=r2 + accessMode=private_requested` enables
  credentialed preview of objects lacking a public URL. Other providers do not
  silently acquire private-preview features.
- **No background thumbnail requests.** The user clicks to request one image.
  Rust performs OpenDAL remote stat/read and restricts the returned image to
  5 MiB and an allowlisted image signature.
- `useCloudImagePreview` is shared between the Gallery and Storage Browser,
  creates a local Blob URL for private data, revokes it when closing/replacing
  or unmounting, and ignores stale replies after navigation.
- File extensions are a UX hint only; the Rust file-signature check remains the
  actual content-type boundary.
- Private-requested R2 takes priority over any historical `publicUrl` field from
  legacy records: the viewer uses the authenticated read, and gallery/storage
  browser hide the public URL copy/open buttons and network thumbnails.
- No public URL is fabricated for a private object. No S3 signed URL is inserted
  into the DOM for preview. Only clicking Temporary Share creates a signed URL,
  and it is written to the clipboard rather than persisted.
- Do not display raw OpenDAL/SDK errors in private download/delete/share
  warnings: they may include endpoints, tokens or URL signatures.
- `private_requested` is not proof of privacy. Bucket ACL, public domains,
  Workers and alternate paths remain unverified until final cloud acceptance.

## Deferred manual acceptance matrix

1. Gallery grid/list and Storage Browser, on private R2 images (supported
   format, missing public URL), successfully open and close the viewer.
2. Switching bucket/path while a preview is loading must not revive the old
   image; closed Blob URLs must be revoked.
3. Unknown/public providers and non-image files must not trigger an implicit
   credentialed read.
4. A 6 MiB file must not be previewed and can be downloaded instead; unknown
   content or BMP without a public URL are refused.
5. Public images retain preview, copy URL, browser-open and local download.
6. Private image preview/Save Original/10m-1h-24h sharing and remote
   rename/delete are checked with actual cloud credentials.
7. Real R2 unsigned access, signed read and expired signature are checked
   during the final project E2E, not in this product slice.
