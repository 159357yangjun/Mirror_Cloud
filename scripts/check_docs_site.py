from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
checks = []


def text(rel: str) -> str:
    return (ROOT / rel).read_text(encoding='utf-8')


def require(ok: bool, label: str):
    checks.append((ok, label))


DOCS_DIR = ROOT / 'website' / 'src' / 'content' / 'docs'
astro = text('website/astro.config.mjs')
release = text('.github/workflows/release.yml')
env_example = text('apps/desktop/.env.example')

sidebar_slugs = re.findall(r"slug:\s*'([^']+)'", astro)
content_files = sorted(
    path for path in DOCS_DIR.rglob('*') if path.is_file() and path.suffix in ('.mdx', '.md')
)
content_slugs = []
for path in content_files:
    slug = re.sub(r'\.(mdx|md)$', '', path.relative_to(DOCS_DIR).as_posix())
    content_slugs.append(slug[: -len('/index')] if slug.endswith('/index') else slug)

missing_files = [slug for slug in sidebar_slugs if slug not in content_slugs]
orphan_files = [slug for slug in content_slugs if slug not in sidebar_slugs]
require(not missing_files, f'every sidebar slug resolves to a docs file (broken: {missing_files})')
require(not orphan_files, f'every docs file is reachable from the sidebar (orphans: {orphan_files})')


def frontmatter(path: Path) -> str:
    body = path.read_text(encoding='utf-8')
    if not body.startswith('---\n'):
        return ''
    end = body.find('\n---\n', len('---\n'))
    return '' if end == -1 else body[len('---\n'):end]


untitled = [path.relative_to(ROOT).as_posix() for path in content_files if 'title:' not in frontmatter(path)]
require(not untitled, f'every docs page has frontmatter with a title (missing: {untitled})')

site_match = re.search(r"^\s*site:\s*'([^']+)'", astro, re.MULTILINE)
base_match = re.search(r"^\s*base:\s*'([^']+)'", astro, re.MULTILINE)
require(site_match is not None, 'astro config declares an explicit site')
require(base_match is not None, 'astro config declares an explicit base for the Pages subpath')

if site_match and base_match:
    site = site_match.group(1)
    base = base_match.group(1)
    origin_match = re.match(r'(https?://[^/]+)', site)
    require(origin_match is not None, f'astro site starts with an http(s) origin (got {site})')
    if origin_match:
        docs_base = origin_match.group(1) + base.rstrip('/')
        require(site == f'{docs_base}/', f'astro site {site} equals origin + base {docs_base}/')

        declared = set(re.findall(r'^\s*VITE_DOCS_BASE_URL:\s*(\S+)\s*$', release, re.MULTILINE))
        require(len(declared) == 1, f'release.yml pins exactly one docs base URL (got {sorted(declared)})')
        require(
            docs_base in declared,
            f'release.yml VITE_DOCS_BASE_URL must equal {docs_base} so app links resolve',
        )
        require(
            re.search(rf'^VITE_DOCS_BASE_URL={re.escape(docs_base)}$', env_example, re.MULTILINE)
            is not None,
            f'.env.example documents the same docs base URL {docs_base}',
        )

failed = [label for ok, label in checks if not ok]
for ok, label in checks:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    raise SystemExit(f'Docs site contract FAILED: {len(failed)} check(s)')
print(f'Docs site contract OK | total checks: {len(checks)}')
