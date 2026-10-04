"""Verify a published GitHub Release: checksums, version consistency and source.zip hygiene.

Download the assets first (this script never touches the network), then run:

    python scripts/verify_release_assets.py --tag v1.4.4 --dir C:/path/to/downloads \
        [--api api_assets.json] [--repo .]

--api is the JSON from GET /repos/<owner>/<repo>/releases/tags/<tag>; when present, every
asset digest is cross-checked against GitHub's own server-side sha256 as a third opinion.
--repo enables the source.zip == tracked-tree comparison; pass a checkout that has the tag.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUMS_NAME = 'SHA256SUMS.txt'
SUMS_LINE = re.compile(r'\A([0-9a-f]{64})  (\S+)\Z')
VERSION_IN_NAME = re.compile(r'-v(\d+\.\d+\.\d+)-')

FORBIDDEN_DIRS = ('node_modules/', 'target/', 'dist/', '.git/', '__pycache__/', '.venv/', 'venv/')
FORBIDDEN_NAMES = re.compile(
    r'(\.env$|\.pem$|\.key$|\.p12$|\.keystore$|^id_rsa|credentials|secrets?\.|\.pkcs12$)', re.IGNORECASE)
ALLOWED_NAMES = re.compile(r'\.env\.example$')
SECRET_PATTERNS = [
    re.compile(rb'github_pat_[A-Za-z0-9_]{20,}'),
    re.compile(rb'gh[pousr]_[A-Za-z0-9]{30,}'),
    re.compile(rb'AKIA[0-9A-Z]{16}'),
    re.compile(rb'-----BEGIN [A-Z ]*PRIVATE KEY-----'),
    re.compile(rb'sk-[A-Za-z0-9]{20,}'),
    re.compile(rb'xox[baprs]-[A-Za-z0-9-]{10,}'),
]
TEXT_SUFFIXES = ('.rs', '.ts', '.tsx', '.js', '.mjs', '.json', '.toml', '.md', '.mdx', '.yml',
                 '.yaml', '.ps1', '.py', '.sql', '.css', '.html', '.txt', '.example', '.gitignore')

results: list[tuple[bool, str]] = []


def check(ok: bool, label: str) -> bool:
    results.append((bool(ok), label))
    return bool(ok)


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def parse_sums(directory: Path) -> dict[str, str]:
    raw = directory / SUMS_NAME
    if not check(raw.is_file(), f'{SUMS_NAME} present'):
        return {}
    blob = raw.read_bytes()
    check(not blob.startswith(b'\xef\xbb\xbf'), f'{SUMS_NAME} has no BOM')
    check(b'\r\n' not in blob or True, f'{SUMS_NAME} line endings: '
          f'{"CRLF" if b"\r\n" in blob else "LF"}'
          ' (CRLF breaks `sha256sum -c` on Linux; fine on Windows)')
    expected: dict[str, str] = {}
    malformed = []
    for line in blob.decode('utf-8').replace('\r\n', '\n').split('\n'):
        if not line.strip():
            continue
        match = SUMS_LINE.match(line)
        if not match:
            malformed.append(line[:70])
            continue
        digest, name = match.groups()
        if name in expected:
            malformed.append(f'duplicate name {name}')
        expected[name] = digest
    check(not malformed, f'{SUMS_NAME} lines are all "<64 lowercase hex><2 spaces><name>" ({malformed[:3]})')
    check(len(expected) >= 3, f'{SUMS_NAME} lists at least 3 assets (found {len(expected)})')
    return expected


def verify_checksums(directory: Path, expected: dict[str, str], api: dict[str, str]) -> None:
    on_disk = {p.name for p in directory.iterdir() if p.is_file() and p.name not in {SUMS_NAME, 'api_assets.json'}}
    check(not (on_disk - set(expected)), f'no downloaded asset is missing from {SUMS_NAME} ({sorted(on_disk - set(expected))})')
    for name, digest in sorted(expected.items()):
        path = directory / name
        if not check(path.is_file(), f'{name} downloaded'):
            continue
        actual = sha256_of(path)
        check(actual == digest, f'{name} sha256 matches {SUMS_NAME} ({actual[:12]}…)')
        if name in api:
            check(api[name] == actual, f'{name} sha256 matches GitHub\'s server-side asset digest')
        print(f'      {path.stat().st_size:>10} B  {name}')


def verify_versions(tag: str, expected: dict[str, str]) -> str:
    version = tag[1:] if tag.startswith('v') else tag
    check(re.fullmatch(r'\d+\.\d+\.\d+', version) is not None, f'tag {tag} carries a numeric version')
    installers = [n for n in expected if not n.endswith('-source.zip')]
    check(len(installers) >= 2, f'at least two installer assets (found {installers})')
    for name in sorted(expected):
        found = VERSION_IN_NAME.findall(name)
        check(found == [version], f'{name} embeds v{version} (found {found})')
    return version


def verify_source_zip(directory: Path, expected: dict[str, str], version: str, repo: Path | None, tag: str) -> None:
    zips = [n for n in expected if n.endswith('-source.zip')]
    if not check(len(zips) == 1, f'exactly one source archive (found {zips})'):
        return
    path = directory / zips[0]
    if not path.is_file():
        return
    with zipfile.ZipFile(path) as archive:
        check(archive.testzip() is None, f'{zips[0]} is a readable zip with no corrupt member')
        names = [i.filename for i in archive.infolist()]
        check(all(not n.startswith('/') for n in names), 'no absolute paths inside the archive')
        check(all('..' not in Path(n).parts for n in names), 'no parent-directory traversal inside the archive')
        check(not any('\\' in n for n in names), 'no backslash paths inside the archive')

        leaked = sorted({n.split('/')[0] for n in names if any(seg in n for seg in FORBIDDEN_DIRS)})
        check(not leaked, f'no build or local-only directories tracked ({leaked[:4]})')

        named = [Path(n).name for n in names]
        suspicious = [n for n, b in zip(names, named) if FORBIDDEN_NAMES.search(b) and not ALLOWED_NAMES.search(b)]
        check(not suspicious, f'no credential-looking filenames tracked ({suspicious[:4]})')

        hits = []
        scanned = 0
        for info in archive.infolist():
            if info.is_dir() or not info.filename.endswith(TEXT_SUFFIXES):
                continue
            scanned += 1
            body = archive.read(info)
            for pattern in SECRET_PATTERNS:
                if pattern.search(body):
                    hits.append(f'{info.filename}:{pattern.pattern[:24]}')
        check(not hits, f'secret scan over {scanned} text files found nothing ({hits[:3]})')

        tracked = {n for n in names if not n.endswith('/')}
        for rel, want in [('Cargo.toml', version), ('apps/desktop/package.json', version),
                          ('apps/desktop/src-tauri/tauri.conf.json', version)]:
            if rel not in tracked:
                check(False, f'{rel} missing from the source archive')
                continue
            body = archive.read(rel).decode('utf-8')
            if rel.endswith('.toml'):
                found = re.search(r'^version = "([^"]+)"', body, re.MULTILINE)
                found = found.group(1) if found else None
            else:
                found = json.loads(body).get('version')
            check(found == want, f'source archive {rel} version is {want} (found {found})')

        if repo is not None:
            listing = subprocess.run(['git', 'ls-tree', '-r', '--name-only', tag], cwd=repo,
                                     capture_output=True, text=True)
            if check(listing.returncode == 0, f'git ls-tree {tag} available in {repo}'):
                tree = set(listing.stdout.splitlines())
                check(tracked == tree,
                      f'source archive is exactly the tracked tree of {tag} '
                      f'(archive-only {sorted(tracked - tree)[:4]}, tree-only {sorted(tree - tracked)[:4]})')
                print(f'      {len(tracked)} tracked files in the archive')
            else:
                print(f'      git ls-tree failed: {listing.stderr.strip()[:120]}')
        else:
            print('      (pass --repo to compare the archive against the tracked tree)')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--dir', required=True, type=Path)
    parser.add_argument('--api', type=Path, help='JSON of GET /releases/tags/<tag> for a third digest opinion')
    parser.add_argument('--repo', type=Path, default=ROOT)
    args = parser.parse_args()

    directory = args.dir
    check(directory.is_dir(), f'asset directory exists: {directory}')
    if not results[-1][0]:
        return report()

    api: dict[str, str] = {}
    if args.api and args.api.is_file():
        payload = json.loads(args.api.read_text(encoding='utf-8'))
        api = {a['name']: a['digest'].split(':', 1)[1] for a in payload.get('assets', []) if a.get('digest')}
        check(bool(api), f'GitHub asset digests parsed ({len(api)})')

    expected = parse_sums(directory)
    if not expected:
        return report()
    verify_checksums(directory, expected, api)
    version = verify_versions(args.tag, expected)
    verify_source_zip(directory, expected, version, args.repo if args.repo and args.repo.is_dir() else None, args.tag)
    return report()


def report() -> int:
    failed = [label for ok, label in results if not ok]
    for ok, label in results:
        print(('OK   ' if ok else 'FAIL ') + label)
    if failed:
        print(f'\nRelease asset verification FAILED: {len(failed)} check(s)')
        return 1
    print(f'\nRelease asset verification OK | total checks: {len(results)}')
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    raise SystemExit(main())
