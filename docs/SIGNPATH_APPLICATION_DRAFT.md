# SignPath Foundation application — prepared answers

Internal draft only. Do not submit until the maintainer has supplied any required contact details and SignPath has clarified the license and single-maintainer questions below.

## Public project details

- Project name: Mirror Cloud
- Repository: https://github.com/159357yangjun/Mirror_Cloud
- Project homepage: https://159357yangjun.github.io/Mirror_Cloud/
- Windows download page: https://159357yangjun.github.io/Mirror_Cloud/use/download/
- Current release: https://github.com/159357yangjun/Mirror_Cloud/releases/tag/v1.4.16
- Declared project license: MIT
- Public signing-status policy: https://159357yangjun.github.io/Mirror_Cloud/use/signing/
- Privacy and data handling: https://159357yangjun.github.io/Mirror_Cloud/use/privacy/

## Suggested project description

Mirror Cloud is an open-source Windows desktop application for uploading and managing images across user-configured cloud-storage providers. It supports multi-provider uploads and backups, image processing, plugin integrations, and editor workflows such as Typora. It has a public MIT-licensed source repository and published Windows EXE/MSI releases; the current v1.4.16 release is not Authenticode-signed. The project uses GitHub Actions hosted Windows runners, locked Rust/npm dependencies, automated installer smoke checks, SHA256 release assets, and a separately Ed25519-signed in-app update manifest.

## Proposed code-signing scope

- Sign the project's own Windows application executable first.
- Build the NSIS and MSI installers from that signed executable.
- Sign the outer NSIS EXE and MSI packages.
- Do not claim third-party binaries as Mirror Cloud-owned signing artifacts. For the MSI, verify the embedded application executable before signing the MSI; generate/review its exact nested-file configuration from a real project build sample.
- Keep SHA256 manifests and the Ed25519 update-manifest signature downstream of Authenticode signing so they describe the final signed installer bytes.
- Require human approval for every SignPath request and retain request, workflow, source commit, signer identity and verification records.

## Proposed build and review process

The release workflow on `main` has an opt-in SignPath path: it signs the application executable, builds NSIS/MSI installers from that executable, submits the installers for SignPath approval and signing, verifies Authenticode status and signer, and only then computes final hashes and publishes. CI passed through source `f2f84bc8011c72f5065be669b3ef90ae1c6b3e22`. This workflow has not yet submitted a SignPath request or produced a signed candidate, and MSI nested-file signing still depends on a generated and reviewed artifact configuration from a real build sample. No SignPath request has been submitted.

One GitHub account currently maintains the source and would also review outside contributions and approve signing requests. Ask SignPath whether this arrangement is permitted and how to enforce those roles for an individual maintainer; do not invent additional team members. GitHub and SignPath MFA must be confirmed directly on the accounts.

## Questions requiring SignPath's determination

1. Is the project eligible with the exact locked dependency declarations below, given the rule that all components must use OSI-approved licenses?
   - `tiny-keccak 2.0.2` declares only `CC0-1.0` and is reachable through the explicitly enabled `storage-opendal` / OpenDAL OSS-service dependency chain via a proc-macro build dependency. Does SignPath include build-time-only source dependencies in its all-components rule?
   - Two website build-tool entries for `mdn-data` declare `CC0-1.0`.
   - `webpki-root-certs 1.0.9` declares `CDLA-Permissive-2.0` but the exact `rustls-platform-verifier 0.7.1` manifest scopes it to `wasm32` and dev dependencies; does SignPath require OSI approval for target-specific/dev-only dependencies absent from the Windows package?
   - `dunce 1.0.5` declares `CC0-1.0 OR MIT-0 OR Apache-2.0`; the metadata offers OSI-approved alternatives.
   See `docs/CODE_SIGNING_LICENSE_INVENTORY.md` for the exact lockfile scan and remaining package-content review.
2. Can one individual hold the author, non-committer reviewer, and signing-approver responsibilities for this project, and what review safeguards are required?
3. Does the current public policy wording and placement meet the terms? The website policy exists, but the existing v1.4.16 GitHub Release body does not yet contain a direct policy link. Future releases from the current workflow include policy and privacy links.

## Maintainer-only details to provide in the application form

- Contact name and email, if required.
- Confirmation that the account owner has enabled MFA on GitHub and will enable MFA on SignPath.
- Confirmation that the proposed single-maintainer responsibility model is accurate.
- Any current SignPath account or organization details, if one already exists.

Do not place personal contact details, API tokens, or credentials in this draft or in repository files.
