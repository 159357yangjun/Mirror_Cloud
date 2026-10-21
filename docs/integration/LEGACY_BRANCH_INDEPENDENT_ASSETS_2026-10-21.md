# Legacy branches: independent-code preservation & deletion preflight

> Date: 2026-10-21, main-only cleanup inventory. **This is NOT authorization to bulk-delete remote branches.** Original HEADs below are immutable observation anchors, not proof that all behavioral differences are included in main. Check live refs again immediately before deletion.

## Method and baseline

- Main before this archive phase: `72e9c2df4e6f8e0cbcc6c8c281430589b94cf77a`; the original baseline `bb8808a75111a65e0f1df3d4e793acd6023c0470` passed CI/TaskUI/Pages.
- Compared the recursive trees of all **52 non-main** branches with current main, identifying paths completely absent in main and recording different blobs separately. A matching filename **does not prove behavior equality**: older feature/fix branches still differ in content from current main.
- PR dependencies: `32` open PRs; all branches referenced as a PR head or base must be kept until each dependent PR is safely closed/merged and its work reviewed.
- Historical production feature/fix branches have no paths wholly absent from main; their functionality largely flowed through PR #43 and was extended by PR #40/#41/#42. This is filename/blob-history evidence, **not full behavioral acceptance**.

## Independent source-path disposition

| Source path absent in original main | Integration outcome | Why |
| --- | --- | --- |
| `docs/RELEASE_READINESS_2026-10-11.md` | B01 archived to `docs/archive/RELEASE_READINESS_2026-10-11.md` | Historical Windows upgrade/rollback evidence, explicitly no current release approval |
| `.github/scripts/ux_keyboard_smoke.mjs` | B02 ported to `scripts/ux_keyboard_smoke.mjs` | Real Edge CDP Tab/Escape, plus seven-page DPR emulation tests |
| `.github/workflows/ux-browser-smoke.yml` | B02 reworked main `taskui-ui-windows-acceptance.yml` | Old branch-specific workflow not copied |
| `.github/workflows/taskui-dpi-check.yml` | B02 DPR tests in `scripts/ux_keyboard_smoke.mjs` | Old `--dpr` does not work in current main harness; new checks assert observed DPR |
| `.github/workflows/full-ux-00-baseline.yml` | Current main UI acceptance tests pages/layout | Existing `verify_dialog_interactions.mjs` supersedes old frozen workflow |
| `.github/workflows/taskui-pr39-browser-acceptance.yml` | Current main UI acceptance tests pages/confirm/layout | Legacy frozen #39/#34 snapshots no longer current test scope |
| `.github/scripts/native_tauri_acceptance.ps1` | B03 ported to `.github/scripts/native_tauri_acceptance.ps1` | Native Windows window handles and SQLite restart evidence |
| `.github/scripts/test_candidate_upgrade.ps1` | Historical source archived under `docs/archive/legacy_ci/ux34_candidate_upgrade_and_rollback.ps1` with fail-closed guard | Useful upgrade/rollback experiment, but hardcoded old checksum, run-id, same-version candidate; **not active current release test** |
| `.github/workflows/ux-upgrade-compat.yml` | NOT copied as runnable main workflow | Legacy #34 fixed SHA/install artifact would produce stale or unsafe claims; redesign remains P1 |
| `.github/workflows/ux-candidate-identity-smoke.yml` | Ported to `.github/workflows/main-candidate-identity.yml` | Main current SHA default/opt-in build label and malformed SHA rejection |

## Special exclusions and deletion hazards

- `chore/r2-live-e2e-default-activation` / PR #9: DO NOT delete while protected Environment E2E activation remains draft. No live R2 credentials or writes were enabled by this integration.
- `release/prepare-v1.4.10-20261011` / PR #37: DO NOT merge version bumps or delete before release-version decision and PR closure.
- `dev`, `integration/*`, `feature/*`, `fix/*`, and other draft PR-linked branches: no mass deletion until cross-PR chain is closed, content compared, and the latest main CI passes.
- The content of test files can be preserved without treating their old outcome as a current PASS. B03 native, candidate identity, and any archive-related CI must be checked for their own exact new Commit SHA.
- Duplicate test script variants on ci branches differed by historical markers/frozen SHA and test sophistication; use the final offline rollback reference, not all obsolete variants as live workflows.
- `AGENTS.md` main-only remains authoritative. Never make branches, force-push, reset, rewrite SQLite migrations, or create a release tag in cleanup.

## Branch refs and open PR references (snapshot)

| Branch | Original HEAD | Open PRs (head/base) | Preliminary action |
| --- | --- | --- | --- |
| `chore/r2-live-e2e-default-activation` | `94ebfe161ef2b9adb51fa0c28f1d6c4ae0f1d9c2` | #9 | HOLD: live R2 |
| `ci/mvp-installer-smoke-20261010` | `958153002a073487a401c72921eb4fb57184845d` | — | 待无依赖/版本差异复核 |
| `ci/release-v1.4.10-native-draft-20261011` | `66ececdaa699f229229ce3e9d8c7b7fefedb6908` | — | 待无依赖/版本差异复核 |
| `ci/update-feedback-installer-smoke-20261010` | `c9009174b8ab280f24b8c265ca4f8af1a1b0a5f9` | — | 待无依赖/版本差异复核 |
| `ci/ux34-native-smoke-20261011` | `ee6e2ebc96aea9a8af580734f94b373115599afe` | — | 待无依赖/版本差异复核 |
| `ci/ux34-offline-rollback-20261011` | `19e923034556c2879c367041aa51b076fd69f6fa` | — | 待无依赖/版本差异复核 |
| `ci/ux34-upgrade-compat-20261011` | `9d3182436b0f478255976233fc17973f5028d692` | — | 待无依赖/版本差异复核 |
| `ci/ux-browser-smoke-20261011` | `17743992695b11a03759f0d1a42ed48f5a282a6a` | — | 待无依赖/版本差异复核 |
| `ci/ux-candidate-identity-smoke-20261011` | `50f733e2d4d69232cd27005111170561e0ed6b11` | — | 待无依赖/版本差异复核 |
| `ci/ux-candidate-identity-v2-20261011` | `0868cbd70a41d47eea9ee00e149a0573ddabaac7` | — | 待无依赖/版本差异复核 |
| `ci/ux-native-smoke-20261011` | `1fd384924403840ee8141baeddfc1e3119b21d0f` | — | 待无依赖/版本差异复核 |
| `ci/ux-upgrade-compat-20261011` | `fb2d357cf3026278b24cf021c7d7d8b81d935889` | — | 待无依赖/版本差异复核 |
| `dependabot/github_actions/dev/workflow-actions-c673fd7efc` | `e486200d35278bf9fa4d23fb6f3ad9dfa1fa0233` | #38 | 待 PR 成果收口 |
| `dev` | `e634ced12a9531ffde63e751dbf24b03d875252e` | #38, #35, #31, #6 | 待 PR 成果收口 |
| `docs/ux34-release-readiness-20261011` | `0fa477affbe75e15e6a2c8a46c61ee9210b6684d` | #36 | 待 PR 成果收口 |
| `feature/first-upload-journey-v1` | `1271a4c70c38b0f01765b5604215bbc9617d3d66` | #30, #29 | 待 PR 成果收口 |
| `feature/gallery-private-preview-v1` | `272415ec36b55df98926603fc469c908a554cd62` | #12, #11 | 待 PR 成果收口 |
| `feature/portable-assets-activation-gate-v1` | `90b90ebe6f430f93f1f3411a1404c9f5c6e6412c` | #24, #23 | 待 PR 成果收口 |
| `feature/portable-assets-batch-review-v1` | `98b946adb4ccc0f4f97cce118e0c8675b67a7f2c` | #26, #25, #24 | 待 PR 成果收口 |
| `feature/portable-assets-item-review-v1` | `7de1ac16ba1e96fabc787f5f933f0480b862d4f2` | #23, #22 | 待 PR 成果收口 |
| `feature/portable-assets-preview-v1` | `cfb80a0ba7e4a4b7f8061ac6eb014bfb614b9a9c` | #21, #20 | 待 PR 成果收口 |
| `feature/portable-assets-staging-v1` | `533c6e8abdfe79a1643bf854e01b45ed95c6edd3` | #22, #21 | 待 PR 成果收口 |
| `feature/portable-reconnect-id-mapping-v2` | `442d91bfea74c2995a3294572136c5cbcd8ecea3` | #18, #17 | 待 PR 成果收口 |
| `feature/portable-references-group-restore-v1` | `285e2535564d7d11d1d79c80050ac86ab913d4dc` | #19, #18 | 待 PR 成果收口 |
| `feature/portable-storage-manifest-v1` | `213dc18bc5eecc4f11cda09c8d582c2f9eb4a5e9` | #14, #13 | 待 PR 成果收口 |
| `feature/portable-storage-reconnect-v1` | `86c82ad592d511ffb23157823d530f892b0f0ce8` | #15, #14 | 待 PR 成果收口 |
| `feature/portable-workflow-restore-v2` | `27c33ae380c6b2dc8a6134abe662266670472c4d` | #20, #19 | 待 PR 成果收口 |
| `feature/private-asset-preview-v1` | `82a41bd7face619c1936dd491bec6b775e99967c` | #11, #10 | 待 PR 成果收口 |
| `feature/private-share-link-v1` | `53e9b33ae4060407a989c067e4fac2e7dfc1c57a` | #8, #6 | 待 PR 成果收口 |
| `feature/r2-private-publish-v1` | `4cf2dd51199962dac90e2ef6821dd37a11506757` | #10, #8 | 待 PR 成果收口 |
| `feature/s3-private-publish-v1` | `3388cbd7a614be859222d2ba3cbb30b620dcee04` | #13, #12 | 待 PR 成果收口 |
| `feature/upload-retry-safety-v1` | `c171c09f3445315522706c2980a4fcb13118a9c3` | #26 | 待 PR 成果收口 |
| `fix/portable-reconnect-atomic-insert-v1` | `4cf5cea64e03c99c185fd8f1818bc9f3a7e8838a` | #17, #16 | 待 PR 成果收口 |
| `fix/portable-reconnect-submit-guard-v1` | `2406c3d5cf14624a2ba977879988d259852210b0` | #16, #15 | 待 PR 成果收口 |
| `fix/update-check-feedback-v1` | `5d72662cb8a6c810e96522befe1ebe00537b3c04` | #33, #32 | 待 PR 成果收口 |
| `fix/upload-atomic-task-batch-v1` | `5ab256a7260dd316dec56a5bd3c0197693ce41f9` | #29, #28 | 待 PR 成果收口 |
| `fix/upload-dialog-batch-feedback-v1` | `b6568acea19c96a4bddf0fe8338dfcee295a4abf` | #30 | 待 PR 成果收口 |
| `fix/upload-failed-only-republish` | `b894143bb921431c41483d89a994f8a9ff136779` | #27, #25 | 待 PR 成果收口 |
| `fix/upload-retry-interaction-guard-v1` | `4be5e088794d7816049edb120bd40f13df624e20` | #28, #27 | 待 PR 成果收口 |
| `integration/mirror-cloud-taskui-postfreeze-20261018` | `15f81067224245ba78bee849b29ddfdc2482d29a` | — | 待无依赖/版本差异复核 |
| `integration/mirror-cloud-ux34-frozen-20261011` | `e6c2e0e4e78d6677bbcd3bc98c6aba2ceb7e25df` | #37, #36, #35 | 待 PR 成果收口 |
| `integration/mvp-candidate-20261010` | `b6568acea19c96a4bddf0fe8338dfcee295a4abf` | #32, #31 | 待 PR 成果收口 |
| `qa/full-ux-00-baseline-20261019` | `a72e6665aa3e00fd19d6b8498c48cc230e1d3e76` | — | 待无依赖/版本差异复核 |
| `qa/taskui-dpi-125-150-20261018` | `65ef9b388d77635abca011a4b5c62b9cfd6bdd87` | — | 待无依赖/版本差异复核 |
| `qa/taskui-pr39-windows-browser-20261018` | `3faa9a0e0b4833a55ff03fdf22b3f939c6e6a08d` | — | 待无依赖/版本差异复核 |
| `release/prepare-v1.4.10-20261011` | `33f1930bb4486826d819d51d5a9abbbae7d71a47` | #37 | HOLD: release |
| `ui/full-ux-00-audit` | `c10c4a3fc7dc643c48c91bc06f09acfbe822e14c` | — | 待无依赖/版本差异复核 |
| `ui/full-ux-01-system` | `3f7cd6aaf8c149481bd12dca80ac4f957adb5730` | — | 待无依赖/版本差异复核 |
| `ui/taskui-publish-first-pass-20261018` | `6ee670e6975ac06babeb60f841c5b95073eae341` | — | 待无依赖/版本差异复核 |
| `ui/taskui-r2-guided-diagnostics-20261018` | `5da886812bab5d7d3bc300bd34056d314332b1ba` | — | 待无依赖/版本差异复核 |
| `ux/candidate-build-identity-20261011` | `e6c2e0e4e78d6677bbcd3bc98c6aba2ceb7e25df` | #34 | 待 PR 成果收口 |
| `ux/clear-copy-and-interaction-20261011` | `0f7ac930860c46c3553f76d83429aae842fa35a9` | #34, #33 | 待 PR 成果收口 |

## Retained obligations

1. Observe latest main CI on each new merge Commit and address any failures with separate fix Commit; no success claim before status completed.
2. Close or supersede each obsolete Draft PR after checking its exact incremental behavior, review threads and security constraints; leaving PR #9 gated while still needed.
3. Re-run actual Windows OS DPI 100/125/150%, Native Tauri G3 and live Provider E2E under their own approval; Edge DPR emulation does not substitute.
4. Only after above and remote-SHA recheck may the user delete no-longer-needed branches, with a deletion ledger.
