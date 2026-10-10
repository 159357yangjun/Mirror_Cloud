# Issue #7 — Real Cloudflare R2 private-object E2E

**Status: runner committed; real R2 execution NOT yet verified.** This is an opt-in ignored Rust integration test, not a normal CI success claim.

## What it actually exercises

- Production OpenDAL R2 provider: upload, stat, download, temporary_read_url, delete.
- Before any write, the Cloudflare management API must confirm r2.dev public access disabled AND every configured custom domain disabled. Unavailable or ambiguous data fails closed. The API token needs account-scoped Workers R2 Storage Read permission.
- Writes only a unique small generated text object to a disposable **non-production private** R2 Bucket. No real user images.
- Authorized readback digest must match, while direct anonymous S3 API GET must be denied.
- The exact production OpenDAL GET presign method must generate a URL that an unauthenticated HTTP client can fetch, with SHA256 matching.
- 600 seconds plus 30 seconds after signing, the original URL must fail with an explicit signature/auth rejection.
- Every upload attempt is followed by deletion and an existence check; cleanup uncertainty is failure.
- Never log secrets, signed URLs, object keys, or raw HTTP errors.

Cloudflare API endpoints used: GET /accounts/{account_id}/r2/buckets/{bucket_name}/domains/managed and /domains/custom. This covers Cloudflare R2 public-domain settings only. It **cannot prove the absence of Worker bindings, alternative proxies, public caches, or unauthorized secondary copies.** They require separate operator review.

## Windows local execution

Use a safe separate Git worktree containing the Issue #7 branch; do not overwrite the unknown D: drive EPIC-R work. Install Rust/Cargo and run this PowerShell command from the repository root:

    .\scripts\run_r2_private_e2e.ps1 -AccountId '<32-hex-account-id>' -Bucket 'mirror-private-e2e'

The launcher uses hidden prompts for a test-specific R2 Access Key ID, R2 Secret Access Key and Cloudflare management API token. Enter YES_TEST_BUCKET to explicitly allow creating the test object. The environment variables are restored afterward. Never paste these credentials in a chat, issue, log or transcript.

For already protected environment variables, execute:

    cargo test --locked -p image-hosting-platform-desktop --lib real_r2_private_object_e2e -- --ignored --nocapture

Environment variable names: R2_E2E_ACCOUNT_ID, R2_E2E_BUCKET, R2_E2E_ACCESS_KEY_ID, R2_E2E_SECRET_ACCESS_KEY, R2_E2E_CLOUDFLARE_API_TOKEN and R2_E2E_ALLOW_TEST_WRITES=YES_TEST_BUCKET.

This runner currently targets the **default R2 account endpoint** only; EU/US/FedRAMP jurisdiction-specific Bucket endpoints are not yet supported. The run takes at least 10 minutes because it checks real expiry. No Cloudflare credentials are bundled in the repository or supplied by ordinary GitHub PR CI.

## Required sanitized evidence

- Commit SHA / application build: ...
- Real R2 Bucket: separate disposable test Bucket (name redacted)
- Cloudflare r2.dev state: disabled / failure / unverified
- Cloudflare custom public domains: all disabled / failure / unverified
- Production OpenDAL write, stat, authorized readback: pass / fail / unverified
- Direct anonymous GET: HTTP ... / unverified
- Production-method presigned GET: HTTP 200, SHA256 match / failure / unverified
- Expired original URL (after at least 630 seconds): HTTP ... / unverified
- Test object cleanup: pass / fail / unverified
- Windows UI clipboard flow using PR #6 script: pass / fail / not run
- Worker and other public path audit: reviewed / not reviewed

**Do not mark the entire PR or Issue #7 E2E complete solely because this test compiles in ordinary CI.** The existing Windows desktop clipboard checker in scripts/e2e_private_share.ps1 and docs/PRIVATE_SHARE_E2E.md remains a separate required validation.

References: https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains/ and https://developers.cloudflare.com/r2/api/s3/presigned-urls/ and https://developers.cloudflare.com/r2/api/tokens/


## GitHub Actions: manual, approval-gated real R2 E2E

The new workflow is `.github/workflows/r2-private-live-e2e.yml`. It has **only**
`workflow_dispatch`: never run it from push, PR, or automatically on arbitrary code.
It invokes the existing ignored production-OpenDAL Rust E2E, via
`scripts/ci_r2_private_e2e.ps1`. Normal CI runs
`scripts/check_r2_live_workflow.py` and PowerShell syntax parsing only.

**Before any cloud execution, the repository owner must configure GitHub Settings →
Environments → `r2-private-e2e`.** This requires access to environment settings:

1. Enable required reviewer approval (including prevention of self-approval, where supported).
   Restrict deployments to approved trusted refs; initially
   `feature/r2-private-publish-v1` and/or a reviewed default-branch commit.
   Do not allow arbitrary PR branches, forks or unreviewed branch heads.
2. Put these **Environment variables** (NOT secrets) in this environment:
   `R2_E2E_ACCOUNT_ID`, `R2_E2E_BUCKET`. The Bucket must be disposable,
   non-production, and in default R2 jurisdiction for this test implementation.
3. Put these **Environment secrets**, not ordinary repository-wide secrets, in it:
   `R2_E2E_ACCESS_KEY_ID`, `R2_E2E_SECRET_ACCESS_KEY`,
   `R2_E2E_CLOUDFLARE_API_TOKEN`. Prefer an object credential restricted to only
   the disposable Bucket. The Cloudflare token must allow reading R2 managed/custom
   domain state. Do not post these credentials anywhere.
4. After environment protection is reviewed, select **Actions → R2 Private Live E2E →
   Run workflow**, choose the reviewed ref, and type
   `RUN_DISPOSABLE_R2_E2E`. The job must require the configured approval.
   The workflow aborts without contacting R2 if the required variables/secrets are absent.

**Important GitHub limitation:** `workflow_dispatch` must be registered by a workflow
file on the repository **default branch** before the Actions UI/API can trigger it.
At this checkpoint the new file exists only on the feature branch, because neither
`main` nor `dev` may be overwritten before the unpublished local EPIC-R history
is reconciled. Thus *manual GitHub cloud execution remains blocked* until the owner
safely integrates/reviews this workflow into the default branch, or uses the
existing local runner in an isolated worktree. Do not merge private-resource
product changes simply to activate a test.

The authorized run takes at least 630 seconds after signing. It emits only the
allowed stage **PASS / UNVERIFIED** indicators and an aggregate PASS/FAIL verdict,
with the reviewed commit SHA and Actions run ID, in the Job Summary. A seven-day
`r2-private-e2e-sanitized` artifact contains only those safe fields. No signed
URL, S3 key, Cloudflare token, raw SDK exception or object key goes into the report.
A missing credential, policy audit error, unexpected HTTP status, hash mismatch,
zero-test filter match, expiry error or cleanup error must NOT be reported as PASS.

This tests Cloudflare R2's managed/custom public-domain settings plus anonymous S3
API access; it does not certify privacy of unrelated Workers, external proxies or
copies. It also does not replace the actual Windows desktop UI clipboard E2E.

**Status until a real authorized run:** implementation/ordinary CI may be green;
actual R2 cloud E2E remains **NOT RUN / UNVERIFIED**.
