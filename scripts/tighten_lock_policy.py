from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCKS = [
    ROOT / "Cargo.lock",
    ROOT / "apps/desktop/package-lock.json",
    ROOT / "website/package-lock.json",
]

for lock in LOCKS:
    if not lock.exists():
        raise SystemExit(f"missing committed dependency lock: {lock.relative_to(ROOT)}")


def replace_once(rel: str, old: str, new: str) -> None:
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"expected block not found in {rel}; concurrent edit requires reconciliation")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    ".github/workflows/ci.yml",
    """      - name: Generate dependency locks
        shell: pwsh
        run: |
          cargo generate-lockfile
          Push-Location apps/desktop
          npm install --package-lock-only --ignore-scripts
          Pop-Location
          Push-Location website
          npm install --package-lock-only --ignore-scripts
          Pop-Location
""",
    """      - name: Verify committed dependency locks
        shell: pwsh
        run: |
          $locks = @('Cargo.lock', 'apps/desktop/package-lock.json', 'website/package-lock.json')
          foreach ($lock in $locks) {
            if (-not (Test-Path $lock)) { throw \"Missing committed dependency lock: $lock\" }
          }
""",
)
replace_once(
    ".github/workflows/ci.yml",
    "      - name: Upload resolved dependency locks\n",
    "      - name: Upload committed dependency locks\n",
)

replace_once(
    ".github/workflows/release.yml",
    """      - name: Resolve and freeze dependency graph for this release run
        shell: pwsh
        run: |
          cargo generate-lockfile
          Push-Location apps/desktop
          npm install --package-lock-only --ignore-scripts
          Pop-Location
          Push-Location website
          npm install --package-lock-only --ignore-scripts
          Pop-Location

""",
    """      - name: Verify committed dependency locks
        shell: pwsh
        run: |
          $locks = @('Cargo.lock', 'apps/desktop/package-lock.json', 'website/package-lock.json')
          foreach ($lock in $locks) {
            if (-not (Test-Path $lock)) { throw \"Missing committed dependency lock: $lock\" }
          }

""",
)
replace_once(
    ".github/workflows/release.yml",
    """      - name: Resolve docs lock
        working-directory: website
        run: npm install --package-lock-only --ignore-scripts
""",
    "",
)

replace_once(
    "scripts/release.ps1",
    """Write-Host \"[2/10] Resolve dependency locks\"
cargo generate-lockfile
Push-Location apps/desktop
npm install --package-lock-only --ignore-scripts
Pop-Location
Push-Location website
npm install --package-lock-only --ignore-scripts
Pop-Location

""",
    """Write-Host \"[2/9] Verify committed dependency locks\"
$LockFiles = @(\"Cargo.lock\", \"apps/desktop/package-lock.json\", \"website/package-lock.json\")
foreach ($LockFile in $LockFiles) {
    if (-not (Test-Path $LockFile)) {
        throw \"Missing committed dependency lock: $LockFile\"
    }
}

""",
)
release_script = ROOT / "scripts/release.ps1"
release_text = release_script.read_text(encoding="utf-8")
for old, new in [
    ("[1/10]", "[1/9]"),
    ("[3/10]", "[3/9]"),
    ("[4/10]", "[4/9]"),
    ("[5/10]", "[5/9]"),
    ("[6/10]", "[6/9]"),
    ("[7/10]", "[7/9]"),
    ("[8/10]", "[8/9]"),
    ("[9/10]", "[9/9]"),
    ("[10/10] Release summary", "Release summary"),
]:
    release_text = release_text.replace(old, new)
release_text = release_text.replace(
    'Write-Host "Commit Cargo.lock and both package-lock.json files after the first successful networked build."',
    'Write-Host "Dependency locks are committed and consumed as-is; update them only in an explicit dependency-update change."',
)
release_script.write_text(release_text, encoding="utf-8")

check_flow = ROOT / "scripts/check_user_flow.py"
flow_text = check_flow.read_text(encoding="utf-8")
old_ci = "require('cargo generate-lockfile' in ci and 'npm ci' in ci and '--locked' in ci, 'CI freezes dependency graph before locked builds')"
new_ci = "require('cargo generate-lockfile' not in ci and 'npm ci' in ci and '--locked' in ci and all((ROOT / rel).exists() for rel in ('Cargo.lock', 'apps/desktop/package-lock.json', 'website/package-lock.json')), 'CI consumes committed dependency locks without regenerating them')"
old_release = "require('cargo generate-lockfile' in release and release.count('npm ci') >= 2 and '--locked' in release, 'release build uses generated dependency locks')"
new_release = "require('cargo generate-lockfile' not in release and release.count('npm ci') >= 2 and '--locked' in release, 'release build consumes committed dependency locks without regenerating them')"
if old_ci not in flow_text or old_release not in flow_text:
    raise SystemExit("dependency lock contract markers changed concurrently")
check_flow.write_text(flow_text.replace(old_ci, new_ci, 1).replace(old_release, new_release, 1), encoding="utf-8")

(ROOT / "docs/DEPENDENCY_LOCKS.md").write_text(
    """# Dependency lock policy

The repository commits the exact dependency graphs used by CI and release builds:

- `Cargo.lock`
- `apps/desktop/package-lock.json`
- `website/package-lock.json`

Normal CI and release jobs **must not regenerate these files**. They consume them directly with:

```text
cargo check --workspace --locked
cargo test --workspace --locked
npm ci
```

This makes a given source revision resolve to the same dependency graph across developer machines, CI and release builds.

When dependencies intentionally change, update the relevant manifest and lockfile together in the same reviewed commit. A missing or stale Cargo lock causes `--locked` to fail; a stale npm lock causes `npm ci` to fail.

The one-time workflows used to bootstrap these lockfiles are removed after this transition.
""",
    encoding="utf-8",
)

print("Committed dependency-lock policy patched successfully.")
