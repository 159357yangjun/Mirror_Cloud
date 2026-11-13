# Code Signing Policy — Draft

> Internal application draft. Do not publish as an active SignPath policy until SignPath Foundation has accepted the project and the role assignments below have been confirmed. The currently published v1.4.16 Windows installers are not represented here as Authenticode-signed.

## Project

- Project: Mirror Cloud
- Repository: https://github.com/159357yangjun/Mirror_Cloud
- License: MIT (the full dependency and bundled-component review is still pending)
- Signing scope after approval: Mirror Cloud's own Windows executable and NSIS/MSI installers, subject to the final SignPath artifact configuration. Third-party upstream binaries will not be submitted as Mirror Cloud-owned artifacts.

## Intended signing provider

If accepted into the SignPath Foundation open-source program, the public policy must include the exact attribution:

> Free code signing provided by SignPath.io, certificate by SignPath Foundation

Until acceptance and first successful signing request, the installers remain unsigned with Windows Authenticode. The existing Ed25519 signature on the update manifest is a separate application-update integrity mechanism and is not a Windows publisher signature.

## Intended responsibilities

| Responsibility | Proposed owner | Confirmation needed |
| --- | --- | --- |
| Author and repository maintainer | GitHub account `159357yangjun` | Confirm account ownership and MFA |
| Review non-committer pull requests, including build scripts and CI changes | GitHub account `159357yangjun` | Confirm review policy and how it is enforced |
| Approve each release-signing request | GitHub account `159357yangjun` | Ask SignPath whether one person may hold both author and approver roles |

No additional reviewer or approver is listed until a real maintainer is assigned and agrees to the role. All team members must enable MFA on GitHub and SignPath before using the signing service.

## Privacy

See the public-facing [Privacy and Data Handling](../website/src/content/docs/use/privacy.mdx) draft. Before publication, verify its descriptions against the release binary and ensure the page is linked from the project home page, download page, and release page.

## Release controls to configure

- Build from a tagged repository commit on GitHub-hosted runners, with locked dependencies and no reuse of prior `target/release` outputs.
- Require trusted-build-system and positive origin verification for release signing.
- Require a human approval for every release-signing request.
- Sign the app executable first, then build the NSIS/MSI packages from that signed executable, then sign the outer installers. The checked-in MSI artifact configuration draft verifies the embedded application executable before signing the MSI; its internal path is based on the public v1.4.16 MSI sample and remains subject to review against a new candidate build.
- Generate SHA-256 sums and the signed update manifest only after Authenticode signing has completed.
- Generate GitHub artifact provenance attestations for the final staged release files, then retain the attestation URL and independently verify each published installer against the expected repository and workflow identity.
- Publish only the returned signed artifacts and retain the source commit, workflow run, SignPath request, signer identity, and verification evidence.

The release workflow now contains this opt-in sequence. A candidate run selects `sign_with_signpath`; after acceptance, tagged releases use the repository variable `SIGNPATH_ENABLED=true`. The integration expects the GitHub secret `SIGNPATH_API_TOKEN` and repository variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_SIGNING_POLICY_SLUG`, `SIGNPATH_APP_ARTIFACT_CONFIGURATION_SLUG`, and `SIGNPATH_INSTALLERS_ARTIFACT_CONFIGURATION_SLUG`. The project and both artifact configurations must be created and sample-validated in SignPath before enabling it. Each submission waits for SignPath's configured human approval, checks the returned signatures, and only then stages hashes and the Ed25519 update manifest.

## Application review checklist

- [ ] SignPath confirms the project qualifies and accepts the application.
- [ ] SignPath confirms the proposed single-maintainer role arrangement.
- [ ] All included dependency and bundled-component licenses have been reviewed; SignPath has determined whether website-only `mdn-data` CC0-1.0 build dependencies affect eligibility.
- [ ] Privacy behavior and installer disclosure requirements have been confirmed.
- [ ] Public homepage, download page, and release page contain the active policy and current release links.
- [ ] SignPath project, GitHub trusted build system, artifact configurations, signing policies, and approval permissions are configured.
- [ ] GitHub artifact attestations are generated for final signed installers and verified independently against the release workflow identity.
- [ ] Candidate Authenticode signing is exercised end to end using the opt-in release workflow, including verification of the installed app executable and final EXE/MSI signatures.
- [ ] A candidate EXE/MSI has a valid Authenticode signature and passes install, update-manifest, checksum, and launch checks.
