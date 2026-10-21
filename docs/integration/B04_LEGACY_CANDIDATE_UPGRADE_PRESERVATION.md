# B04 · Offline candidate identity and legacy upgrade/rollback code preservation

- Base for this main-only integration: `72e9c2df4e6f8e0cbcc6c8c281430589b94cf77a`.
- New `.github/workflows/main-candidate-identity.yml` reuses the semantics of old `ci/ux-candidate-identity-v2-20261011`, but computes source identity from the actual main `GITHUB_SHA`; verifies release-default build lacks the label, explicit SHA appears, semantic package/Tauri version stays consistent, and invalid SHA is rejected. Read-only CI; no Tag/Release.
- New `docs/archive/legacy_ci/ux34_candidate_upgrade_and_rollback.ps1` preserves the mature old `ci/ux34-offline-rollback-20261011` test (original blob `b3839b1ad6ae707de8cabacccf3062706ce84822`) behind an unconditional abort. Old hard-coded CI artifact and version are not safe to run against current main. Future B05 may adapt it with fresh verified installer inputs and disposable Windows profile.
- New `docs/integration/LEGACY_BRANCH_INDEPENDENT_ASSETS_2026-10-21.md` lists all 52 remote branch HEADs, open PR dependencies, independent paths and preservation decisions. Deletion awaits per-PR completion and same-SHA CI.
- No production Rust/TS changes, no SQLite DDL, no live R2, no version changes, no tag, no branch creation. New workflow and docs have yet to pass post-commit CI at time of authoring.
