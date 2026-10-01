#!/usr/bin/env node
/**
 * Per-face theme inventory - the generator behind the "逐面主题分类" table in docs/VISUAL_BASELINE.md.
 *
 * Why this is a script and not prose: the table is counts of call sites per face, and a hand-typed
 * table drifts the moment anyone adds a className. `--verify` recomputes it and exits 1 if the
 * numbers in the document no longer match the source.
 *
 * usage:
 *   node scripts/theme_face_inventory.mjs            print the markdown table
 *   node scripts/theme_face_inventory.mjs --verify   compare the table in the doc with reality
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const DOC = `${ROOT}docs/VISUAL_BASELINE.md`
const MARK_BEGIN = '<!-- THEME_FACE_TABLE:BEGIN -->'
const MARK_END = '<!-- THEME_FACE_TABLE:END -->'

// A face is a file that paints pixels the three themes have to reach. Shared components are listed
// apart from pages because a page can pass while the dialog on top of it does not.
const FACES = [
  ['页面 · 发布', 'apps/desktop/src/pages/PublishPage.tsx'],
  ['页面 · 资源', 'apps/desktop/src/pages/AssetsPage.tsx'],
  ['页面 · 云端', 'apps/desktop/src/pages/StoragesPage.tsx'],
  ['页面 · 图库', 'apps/desktop/src/pages/GalleryPage.tsx'],
  ['页面 · 插件', 'apps/desktop/src/pages/PluginsPage.tsx'],
  ['页面 · 任务', 'apps/desktop/src/pages/TasksPage.tsx'],
  ['页面 · 方案', 'apps/desktop/src/pages/WorkflowsPage.tsx'],
  ['页面 · 设置', 'apps/desktop/src/pages/SettingsPage.tsx'],
  ['弹窗 · Confirm', 'apps/desktop/src/components/ConfirmDialog.tsx'],
  ['弹窗 · 帮助中心', 'apps/desktop/src/components/HelpCenterDialog.tsx'],
  ['弹窗 · Provider 选择', 'apps/desktop/src/components/ProviderPickerDialog.tsx'],
  ['弹窗 · 上传', 'apps/desktop/src/components/UploadDialog.tsx'],
  ['弹窗 · 云端浏览', 'apps/desktop/src/components/StorageBrowserDialog.tsx'],
  ['弹窗 · 云端配置', 'apps/desktop/src/components/StorageSetupDialog.tsx'],
  ['弹窗 · 多云组', 'apps/desktop/src/components/StorageGroupDialog.tsx'],
  ['弹窗 · 方案配置', 'apps/desktop/src/components/WorkflowSetupDialog.tsx'],
  ['面板 · 主题', 'apps/desktop/src/components/ThemePanel.tsx'],
  ['壳层 · AppShell', 'apps/desktop/src/components/AppShell.tsx'],
  ['壳层 · PageHeader', 'apps/desktop/src/components/PageHeader.tsx'],
  ['浮层 · Toast', 'apps/desktop/src/components/ToastViewport.tsx'],
  ['浮层 · 索引横幅', 'apps/desktop/src/components/CloudIndexSyncBanner.tsx'],
  ['卡片 · 图库条目', 'apps/desktop/src/components/GalleryMediaCard.tsx'],
]

const count = (src, re) => (src.match(re) || []).length

export function measure() {
  return FACES.map(([label, rel]) => {
    let src
    try {
      src = readFileSync(`${ROOT}${rel}`, 'utf8')
    } catch {
      throw new Error(`theme_face_inventory: face "${label}" points at ${rel}, which is not readable`)
    }
    return {
      label,
      rel,
      // Layer 1 - reached by a theme token. Tailwind v4 compiles every palette utility to
      // var(--color-hue-rung), and var(--token) primitives read a custom property directly, so a
      // change to the token moves these without touching the call site.
      token: count(src, /\b(?:bg|text|border|from|via|to|ring)-(?:slate|red|amber|emerald|blue|indigo|violet|sky|rose|green|orange)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/g)
        + count(src, /\b(?:bg|text)-\[var\(--/g)
        + count(src, /\btheme-(?:surface|glass|accent-bg|accent|muted)\b/g),
      // Layer 2 - a class the ramp cannot reach: white/black fills and the dark-text rungs that are
      // also used as fills, so they are matched by an explicit class rule instead of a variable.
      hard: count(src, /\bbg-white\b/g) + count(src, /\btext-slate-9(?:00|50)\b/g) + count(src, /\bbg-black\b/g),
      // Layer 3 - theme-invariant by design and needing a written reason: the near-black code /
      // command blocks and the primary upload tile.
      invariant: count(src, /\bbg-slate-950\b/g),
      // Two escape hatches that would each mean the theme system was bypassed rather than extended.
      darkPrefix: count(src, /\bdark:/g),
      literal: count(src, /\b(?:bg|text|border)-\[#[0-9a-f]{3,8}\]/gi),
    }
  })
}

export function table() {
  const head = ['面', '令牌可达', '需 class 规则', '设计上不分主题', 'dark: 前缀', '字面色值']
  const rows = measure()
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0)
  return [
    '| ' + head.join(' | ') + ' |',
    '|' + head.map(() => '---').join('|') + '|',
    ...rows.map((r) => `| ${r.label} | ${r.token} | ${r.hard} | ${r.invariant} | ${r.darkPrefix} | ${r.literal} |`),
    `| **合计（${rows.length} 个面）** | **${sum('token')}** | **${sum('hard')}** | **${sum('invariant')}** | **${sum('darkPrefix')}** | **${sum('literal')}** |`,
  ].join('\n')
}

const argv = process.argv.slice(2)

// The comparison, split out so it can be fed a table it did not produce. A verifier that has only
// ever printed mismatch=0 has never been shown a mismatch, and "0 of them" is only evidence if the
// instrument is known to be able to count one.
function compare(have, want) {
  // Normalise line endings here, not at the call site. This repo is checked out with
  // core.autocrlf=true, so the same committed bytes reach this function with LF or CRLF depending on
  // the state of the working copy. Comparing raw lines made the verdict depend on the checkout rather
  // than on the table: on a CRLF working copy it reported all 25 rows as mismatches while the
  // generated table and the documented one were byte-for-byte equal - a gate crying wolf, which costs
  // more than a miss because people stop reading it.
  // The call site's `.replace(/^\n/,'')` cannot do this job on a CRLF working copy: the character
  // after the BEGIN marker is `\r`, so the guard saw a leading empty line and compared every row one
  // slot out of phase. Whitespace at the block edges belongs to the normaliser, not to the caller.
  const norm = (t) => String(t).replace(/\r\n/g, '\n').replace(/[\r\u0085\u2028\u2029]/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '')
  const wantLines = norm(want).split('\n')
  const haveLines = norm(have).split('\n')
  const bad = []
  wantLines.forEach((line, i) => {
    if (haveLines[i] !== line) bad.push({ i, doc: haveLines[i] ?? '(absent)', code: line })
  })
  return { bad, docLines: haveLines.length, checked: wantLines.length - 2 }
}

function selftestResult() {
  const want = table()
  const lines = want.split('\n')
  const cases = []
  const push = (name, got, expect) => cases.push({ name, got, expect, ok: got === expect })
  // Fixture 1: the table it just generated must verify clean. If this fails, the doc round-trip and
  // the generator disagree for a reason unrelated to any edit.
  push('its own output verifies clean', compare(want, want).bad.length, 0)
  // Fixture 2: exactly one digit changed in exactly one cell - the drift class this gate exists to
  // catch - must be reported as exactly one line, at that index. Bumping the first number of the
  // totals row rather than searching for a literal keeps the fixture alive when the counts change;
  // asserting 1 (not ">0") is what stops a comparison that reports every line as wrong from passing
  // as "it caught something".
  const last = lines[lines.length - 1]
  const tampered = [...lines]
  tampered[tampered.length - 1] = last.replace(/\d+/, (m) => String(Number(m) + 1))
  const one = compare(tampered.join('\n'), want)
  push('one changed digit is reported as exactly one line', one.bad.length, 1)
  push('and it names the line that changed', one.bad[0]?.i === lines.length - 1 ? 1 : 0, 1)
  // Fixture 3: a doc whose table was cut short must not read as "the rows that are there all match".
  push('a truncated table is reported', compare(lines.slice(0, 5).join('\n'), want).bad.length, lines.length - 5)
  // Fixture 4 and 5 are the two halves of the line-ending change above, and the second one is the
  // point: normalising CR without this pair would be an unfalsifiable "it is tolerant now" claim. The
  // doc side arrives as CRLF (that is what the working copy on this box holds) while the generated
  // side is LF - the exact combination that produced the false red - and a single tampered digit must
  // STILL be one reported line in that mixed state.
  push('the same table written with CRLF verifies clean', compare(want.replace(/\n/g, '\r\n'), want).bad.length, 0)
  // The exact artefact that made this gate red on a CRLF working copy: the byte after the BEGIN marker
  // is \r, so the edge-stripping at the call site left a leading empty line and every row was read one
  // slot out of phase. Asserted on its own because "CRLF is tolerated" would also be true if only the
  // trailing edge were handled.
  push('a leading blank line verifies clean', compare('\n' + want, want).bad.length, 0)
  push('a changed digit is still reported under mixed endings', compare(tampered.join('\r\n'), want).bad.length, 1)
  return { cases, failed: cases.filter((c) => !c.ok) }
}

if (argv[0] === '--selftest') {
  const st = selftestResult()
  console.log(`THEME_FACE_SELFTEST cases=${st.cases.length} failed=${st.failed.length}`)
  for (const c of st.cases) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: got=${c.got} expect=${c.expect}`)
  if (st.failed.length) {
    console.log('theme_face_inventory: the verifier cannot see the drift it claims to gate, so its mismatch=0 means nothing')
    process.exit(2)
  }
  process.exit(0)
}
if (argv[0] === '--verify') {
  // Self-test before verdict: an instrument that cannot see a planted change cannot license a claim
  // that nothing changed.
  const st = selftestResult()
  console.log(`THEME_FACE_SELFTEST cases=${st.cases.length} failed=${st.failed.length}`)
  for (const c of st.cases) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: got=${c.got} expect=${c.expect}`)
  if (st.failed.length) {
    console.log('theme_face_inventory: the verifier cannot see the drift it claims to gate, so its mismatch=0 means nothing')
    process.exit(2)
  }
  const doc = readFileSync(DOC, 'utf8')
  const b = doc.indexOf(MARK_BEGIN), e = doc.indexOf(MARK_END)
  if (b === -1 || e === -1 || e < b) {
    console.error(`THEME_FACE_VERIFY the markers ${MARK_BEGIN} ... ${MARK_END} are not both present in docs/VISUAL_BASELINE.md`)
    process.exit(1)
  }
  const want = table()
  const have = doc.slice(b + MARK_BEGIN.length, e).replace(/^\n/, '').replace(/\n$/, '')
  const { bad, docLines, checked } = compare(have, want)
  // The label, not the counting: `faces=` has always been "lines compared after the header", which
  // counts the 合计 row as a face (23 = 22 个面 + 合计). Redefining it would move the number
  // verify_all.mjs's count regex captures and the reading already registered in the fingerprint
  // table, while the ambiguity is what actually needs fixing - so the breakdown is printed alongside,
  // and the totals-row test is a test, not a comment: drop that row and the line says so instead of
  // quietly reporting one fewer face.
  const wantRows = String(want).replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n')
  const totalsRow = /^\|\s*\*\*合计/.test(wantRows[wantRows.length - 1] || '')
  const faceRows = wantRows.length - 2 - (totalsRow ? 1 : 0)
  console.log(`THEME_FACE_VERIFY faces=${checked} docLines=${docLines} mismatch=${bad.length} (${totalsRow ? `${faceRows} 个面 + 1 合计行 = ${checked} 行参与比对；faces 字段含合计行，比对定义未改` : `${checked} 行参与比对，未见到合计行，faces 即面数`})`)
  if (bad.length) {
    for (const m of bad.slice(0, 8)) console.log(`  MISMATCH line ${m.i}\n    doc says: ${m.doc.slice(0, 110)}\n    code says: ${m.code.slice(0, 110)}`)
    console.log('theme_face_inventory: the table in VISUAL_BASELINE.md no longer matches the source. Re-run: node scripts/theme_face_inventory.mjs')
    process.exit(1)
  }
  console.log(`theme-face inventory verified: ${faceRows} 个面 + 合计行，every count matches the source`)
  process.exit(0)
}
if (argv[0] === '--json') {
  console.log(JSON.stringify(measure(), null, 2))
  process.exit(0)
}
console.log(table())
