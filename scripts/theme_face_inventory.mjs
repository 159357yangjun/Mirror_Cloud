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
if (argv[0] === '--verify') {
  const doc = readFileSync(DOC, 'utf8')
  const b = doc.indexOf(MARK_BEGIN), e = doc.indexOf(MARK_END)
  if (b === -1 || e === -1 || e < b) {
    console.error(`THEME_FACE_VERIFY the markers ${MARK_BEGIN} ... ${MARK_END} are not both present in docs/VISUAL_BASELINE.md`)
    process.exit(1)
  }
  const want = table()
  const have = doc.slice(b + MARK_BEGIN.length, e).replace(/^\n/, '').replace(/\n$/, '')
  const checked = want.split('\n').length - 2
  const mismatch = want.split('\n').filter((line, i) => {
    const other = have.split('\n')[i]
    return other !== line
  })
  console.log(`THEME_FACE_VERIFY faces=${checked} docLines=${have.split('\n').length} mismatch=${mismatch.length}`)
  if (mismatch.length) {
    for (const m of mismatch.slice(0, 8)) console.log(`  doc says: ${(have.split('\n')[want.split('\n').indexOf(m)] || '(absent)').slice(0, 110)}`)
    for (const m of mismatch.slice(0, 8)) console.log(`  code says: ${m.slice(0, 110)}`)
    console.log('theme_face_inventory: the table in VISUAL_BASELINE.md no longer matches the source. Re-run: node scripts/theme_face_inventory.mjs')
    process.exit(1)
  }
  console.log(`theme-face inventory verified: ${checked} faces, every count matches the source`)
  process.exit(0)
}
if (argv[0] === '--json') {
  console.log(JSON.stringify(measure(), null, 2))
  process.exit(0)
}
console.log(table())
