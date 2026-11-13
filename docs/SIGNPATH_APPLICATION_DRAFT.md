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

The release workflow on `main` is being prepared to upload artifacts from GitHub-hosted Windows runners to SignPath. It will wait for the configured SignPath human approval, retrieve the signed artifact, verify its Authenticode status and signer, and only then package, hash, and publish. GitHub Actions CI and Docs Site passed for source `ac49909915c0fb364b1a0ef46060943f87c24321`; the opt-in signing-flow commit `4639d53b8e606c4d220812f9dea9e7ca31fa181e` passed the main CI workflow. No SignPath request has yet been submitted.

One GitHub account currently maintains the source and would also review outside contributions and approve signing requests. Ask SignPath whether this arrangement is permitted and how to enforce those roles for an individual maintainer; do not invent additional team members. GitHub and SignPath MFA must be confirmed directly on the accounts.

## Questions requiring SignPath's determination

1. Is the project eligible when two website-only build-tool lock entries for transitive `mdn-data` declare `CC0-1.0`, which is not on OSI's approved-license list, while the Windows desktop runtime does not declare/use those website packages?
2. Can one individual hold the author, non-committer reviewer, and signing-approver responsibilities for this project, and what review safeguards are required?
3. Does the current policy wording and website/release link placement meet the project's home-page and download/release-page requirement? The next generated GitHub Release is configured to include direct links; the already-published v1.4.16 page still needs a direct link before the application is presented as complete.

## Maintainer-only details to provide in the application form

- Contact name and email, if required.
- Confirmation that the account owner has enabled MFA on GitHub and will enable MFA on SignPath.
- Confirmation that the proposed single-maintainer responsibility model is accurate.
- Any current SignPath account or organization details, if one already exists.

Do not place personal contact details, API tokens, or credentials in this draft or in repository files.
