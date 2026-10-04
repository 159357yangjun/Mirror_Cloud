from pathlib import Path
import re
import sys

# Failure labels carry Chinese UI strings; the Windows console codepage would mangle them.
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

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

        declared = set(re.findall(r'^\s*DOCS_BASE_URL:\s*(\S+)\s*$', release, re.MULTILINE))
        require(len(declared) == 1, f'release.yml declares exactly one docs candidate (got {sorted(declared)})')
        require(
            docs_base in declared,
            f'release.yml DOCS_BASE_URL must equal {docs_base} so app links resolve',
        )
        hardcoded = re.findall(r'^\s*VITE_DOCS_BASE_URL:\s*\S+', release, re.MULTILINE)
        require(
            not hardcoded,
            f'release.yml must resolve VITE_DOCS_BASE_URL from the probe, never hardcode it ({hardcoded})',
        )
        require(
            'Add-Content -Path $env:GITHUB_ENV -Value "$baked$candidate"' in release,
            'release.yml bakes the probed docs base URL into the bundle environment',
        )
        require(
            '$env:DOCS_BASE_URL' in release,
            'release.yml probes the configured candidate before baking it',
        )
        require(
            re.search(rf'^VITE_DOCS_BASE_URL={re.escape(docs_base)}$', env_example, re.MULTILINE)
            is not None,
            f'.env.example documents the same docs base URL {docs_base}',
        )

APP_SRC_DIR = ROOT / 'apps' / 'desktop' / 'src'
# Third-party consoles the tutorials legitimately point at. Anything else in an
# "enter/click/open **X**" instruction has to be a string the desktop app really renders.
EXTERNAL_UI = {
    'R2 Object Storage', 'Cloudflare', '偏好设置', '图像', 'Typora', 'GitHub', 'Gitee',
    '阿里云 OSS', '腾讯云 COS', 'Bucket', 'Console', '控制台', 'Access Key', '自定义域名',
    'Custom Command / 自定义命令', 'Test Uploader / 验证图片上传选项',
}
INSTRUCTION = re.compile(r'(进入|打开|点击|选择|在)([^\n]{0,12})\*\*([^*\n]{1,40})\*\*')
PROSE = set('。．，,、；;：:!！?？()（）')


def app_source_text() -> str:
    return '\n'.join(
        path.read_text(encoding='utf-8')
        for path in sorted(APP_SRC_DIR.rglob('*'))
        if path.is_file() and path.suffix in ('.ts', '.tsx')
    )


def split_targets(value: str) -> list:
    if any(character in PROSE for character in value):
        return []
    return [segment.strip() for segment in value.split('→') if segment.strip()]


source = app_source_text()
nav_labels = set(re.findall(r"\{ key: '[a-z]+', label: '([^']+)'", text('apps/desktop/src/components/AppShell.tsx')))
require(len(nav_labels) >= 7, f'app navigation is enumerable for tutorial checks (found {sorted(nav_labels)})')

phantom = []
for path in content_files:
    location = path.relative_to(DOCS_DIR).as_posix()
    for verb, gap, value in INSTRUCTION.findall(path.read_text(encoding='utf-8')):
        segments = split_targets(value)
        if not segments:
            continue
        # A substring match in some component is not reachability: 方案 appears in code that no
        # navigation entry can open, so page-level instructions must name a real sidebar item.
        if verb in ('进入', '打开') or '左侧' in gap:
            if segments[0] not in nav_labels and segments[0] not in EXTERNAL_UI:
                phantom.append(f'{location}:{verb} {segments[0]}(不是可达的导航项)')
        for segment in segments:
            if segment in EXTERNAL_UI or segment in nav_labels or segment in source:
                continue
            phantom.append(f'{location}:{segment}')
require(not phantom, f'tutorials only name UI the app renders (phantom: {phantom})')

# Recipes/方案 can only be created from WorkflowsPage, which has no navigation entry, so no
# tutorial may tell the reader to create or install one. Negated sentences are the correct case.
NEGATION = ('不要求', '不需要', '无需', '不必', '不是必须', '不天然')
recipe_line = re.compile(r'(创建|安装)[^\n]{0,12}(方案|Recipe)')
promised = []
for path in content_files:
    for line in path.read_text(encoding='utf-8').splitlines():
        if recipe_line.search(line) and not any(word in line for word in NEGATION):
            promised.append(f'{path.relative_to(DOCS_DIR).as_posix()}:{line.strip()[:40]}')
require(not promised, f'no tutorial asks the reader to create a 方案 that has no reachable UI ({promised})')

failed = [label for ok, label in checks if not ok]
for ok, label in checks:
    print(('OK   ' if ok else 'FAIL ') + label)
if failed:
    raise SystemExit(f'Docs site contract FAILED: {len(failed)} check(s)')
print(f'Docs site contract OK | total checks: {len(checks)}')
