from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
errors: list[str] = []

for path in ROOT.rglob('*.json'):
    if 'node_modules' in path.parts:
        continue
    try:
        json.loads(path.read_text(encoding='utf-8'))
    except Exception as exc:
        errors.append(f'JSON {path.relative_to(ROOT)}: {exc}')

for path in ROOT.rglob('*.toml'):
    if 'node_modules' in path.parts:
        continue
    try:
        tomllib.loads(path.read_text(encoding='utf-8'))
    except Exception as exc:
        errors.append(f'TOML {path.relative_to(ROOT)}: {exc}')

migrations = sorted((ROOT / 'crates/persistence-sqlite/migrations').glob('*.sql'))
try:
    connection = sqlite3.connect(':memory:')
    connection.execute('PRAGMA foreign_keys=ON')
    for migration in migrations:
        connection.executescript(migration.read_text(encoding='utf-8'))
    table_count = connection.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchone()[0]
finally:
    try:
        connection.close()
    except Exception:
        pass

workspace = tomllib.loads((ROOT / 'Cargo.toml').read_text(encoding='utf-8'))
for member in workspace['workspace']['members']:
    if not (ROOT / member / 'Cargo.toml').exists():
        errors.append(f'Workspace member missing Cargo.toml: {member}')

workspace_version = workspace['workspace']['package']['version']
desktop_package = json.loads((ROOT / 'apps/desktop/package.json').read_text(encoding='utf-8'))
tauri_config = json.loads((ROOT / 'apps/desktop/src-tauri/tauri.conf.json').read_text(encoding='utf-8'))
if desktop_package.get('version') != workspace_version:
    errors.append(
        f"Desktop package version {desktop_package.get('version')} does not match workspace version {workspace_version}"
    )
if tauri_config.get('version') != workspace_version:
    errors.append(
        f"Tauri version {tauri_config.get('version')} does not match workspace version {workspace_version}"
    )
if tauri_config.get('productName') != 'Mirror Cloud':
    errors.append('Tauri productName must remain Mirror Cloud')

github_cargo = tomllib.loads((ROOT / 'crates/storage-github/Cargo.toml').read_text(encoding='utf-8'))
expected_github_lib = 'src/lib_with_queue.rs'
if github_cargo.get('lib', {}).get('path') != expected_github_lib:
    errors.append(
        f'GitHub provider must use {expected_github_lib} so same-branch writes stay serialized'
    )
queue_path = ROOT / 'crates/storage-github' / expected_github_lib
if not queue_path.exists():
    errors.append(f'GitHub write queue wrapper missing: {queue_path.relative_to(ROOT)}')
else:
    queue_source = queue_path.read_text(encoding='utf-8')
    queue_requirements = {
        'BRANCH_WRITE_LOCKS': 'shared owner/repo/branch lock registry',
        'branch_write_key': 'branch-scoped write key',
        'self.write_lock.lock().await': 'async write serialization',
        'self.inner.upload(request).await': 'queued upload delegation',
        'self.inner.delete(path).await': 'queued delete delegation',
    }
    for needle, label in queue_requirements.items():
        if needle not in queue_source:
            errors.append(f'GitHub write queue missing {label}: {needle}')

if errors:
    print('\n'.join(errors), file=sys.stderr)
    raise SystemExit(1)

print(
    f'JSON/TOML: OK | SQLite migrations: {len(migrations)} OK | tables: {table_count} | '
    f'workspace members: OK | version alignment: {workspace_version} | GitHub write queue: OK'
)
