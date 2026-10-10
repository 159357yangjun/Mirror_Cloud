"""Fail-closed static contract for the manual, privileged R2 cloud test workflow.

This does NOT test R2 itself and must never access cloud credentials. The goal is
to prevent the manual workflow from accidentally acquiring automatic PR/push
triggers, unscoped permissions, missing environment approval or unsafe artifacts.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
workflow = (ROOT / ".github/workflows/r2-private-live-e2e.yml").read_text(encoding="utf-8")
runner = (ROOT / "scripts/ci_r2_private_e2e.ps1").read_text(encoding="utf-8")
rust_test = (
    ROOT / "apps/desktop/src-tauri/src/commands/r2_private_live_e2e.rs"
).read_text(encoding="utf-8")

checks = {
    "workflow_dispatch only": (
        workflow.startswith("# Privileged real-cloud test")
        and "\non:\n  workflow_dispatch:\n" in workflow
        and "  push:" not in workflow.split("\npermissions:", 1)[0]
        and "  pull_request:" not in workflow.split("\npermissions:", 1)[0]
        and "  workflow_run:" not in workflow.split("\npermissions:", 1)[0]
    ),
    "read-only GitHub token": "\npermissions:\n  contents: read\n" in workflow,
    "non-preemptive manual run": "cancel-in-progress: false" in workflow,
    "protected environment and manual confirmation": all(
        token in workflow
        for token in (
            "environment:\n      name: r2-private-e2e",
            "inputs.confirmation == 'RUN_DISPOSABLE_R2_E2E'",
            "github.event_name == 'workflow_dispatch'",
            "github.repository == '159357yangjun/Mirror_Cloud'",
            "github.ref == 'refs/heads/feature/r2-private-publish-v1'",
        )
    ),
    "no persisted checkout token": "persist-credentials: false" in workflow,
    "secret scope only in live step": (
        workflow.index("secrets.R2_E2E_ACCESS_KEY_ID")
        > workflow.index("name: Real R2 private object E2E")
        and "R2_E2E_CLOUDFLARE_API_TOKEN: ${{ secrets.R2_E2E_CLOUDFLARE_API_TOKEN }}" in workflow
    ),
    "one exact ignored production OpenDAL integration test": all(
        token in workflow
        for token in (
            "-- --list",
            "commands::r2_private_live_e2e::real_r2_private_object_e2e",
        )
    )
    and all(
        token in runner
        for token in (
            "-- --ignored --exact --nocapture",
            "test result: ok",
            "1 passed; 0 failed;",
        )
    ),
    "only sanitized evidence uploaded": (
        "run: ./scripts/ci_r2_private_e2e.ps1" in workflow
        and "r2-private-e2e-sanitized.txt" in workflow
        and "if: always()" in workflow
        and "retention-days: 7" in workflow
        and "rustcheck.log" not in workflow
        and "cargo test" not in workflow.split("name: Real R2 private object E2E", 1)[1]
    ),
    "test uses production provider and checks four outcomes": all(
        token in rust_test
        for token in (
            'OpenDalStorage::s3("r2",',
            "storage.upload(",
            "is_anonymous_read_denied(status)",
            "storage.temporary_read_url(",
            "signed_status != 200",
            "is_expired_signature_rejected(expired_status)",
            "storage.delete(&path).await",
            "#[ignore = ",
        )
    ),
    "runner refuses missing secrets or zero-test success": all(
        token in runner
        for token in (
            "Missing protected R2 E2E configuration",
            "if ($missing.Count -gt 0)",
            "$exactOnePassed",
            "$allStagesPassed",
            "GITHUB_STEP_SUMMARY",
        )
    ),
}

if __name__ == "__main__":
    for label, ok in checks.items():
        print(f"{'PASS' if ok else 'FAIL'}: {label}")
    if not all(checks.values()):
        raise SystemExit("Manual R2 E2E security contract failed")
    print(f"All {len(checks)} manual R2 E2E static checks passed; live cloud E2E is NOT executed.")
