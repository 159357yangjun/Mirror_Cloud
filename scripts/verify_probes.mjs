/**
 * Page-side probe sources for the CDP measurement harness.
 *
 * These are strings evaluated inside the browser, not Node code. They live here rather than
 * inline so the harness file reads as control flow: which mode runs, what it asserts, what it
 * exits with. Nothing in this file executes - it only exports text.
 *
 * Invariants that keep the extraction honest:
 *   - each export is a template literal, so the browser-side regexes must keep their doubled
 *     backslashes (\s, \d). A single backslash is consumed by Node before the page sees it.
 *   - none of these bodies may contain a backtick or a dollar-brace: either would terminate or
 *     be interpolated by the template literal here. verify_dialog_interactions.mjs enforces the
 *     same rule on its own comments for the same reason.
 *
 * Used only by scripts/verify_dialog_interactions.mjs. No third-party imports.
 */

/// Interaction helpers installed before any mode runs: locator by visible text, element boxes,
/// the confirm-dialog overlay accessors the confirm/ab/red-demo modes drive.
export const HELPERS = `
window.__H = {
  dialog() { return document.querySelector('[role=dialog][aria-modal="true"]'); },
  overlay() { const d = window.__H.dialog(); return d ? d.parentElement : null; },
  buttons() { const d = window.__H.dialog(); return d ? Array.from(d.querySelectorAll('button')) : []; },
  byText(sel, txt) { return Array.from(document.querySelectorAll(sel)).find(x => (x.textContent||'').trim() === txt); },
  box(el) { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width/2, cy: r.y + r.height/2 }; },
  state() {
    const d = window.__H.dialog();
    if (!d) return { present: false };
    const bs = window.__H.buttons();
    const p = d.querySelector('p');
    const sec = d;
    const o = window.__H.overlay();
    const cs = getComputedStyle(o);
    return {
      present: true,
      overlayZ: cs.zIndex, overlayPosition: cs.position,
      title: d.querySelector('h2') ? d.querySelector('h2').textContent : null,
      detail: p ? p.textContent : null,
      labels: bs.map(b => (b.textContent||'').trim() || b.getAttribute('aria-label')),
      activeText: (document.activeElement.textContent||'').trim() || document.activeElement.getAttribute('aria-label'),
      focusIsCancel: document.activeElement === bs[bs.length-2],
      focusIsConfirm: document.activeElement === bs[bs.length-1],
      focusIsClose: document.activeElement === bs[0],
      focusTag: document.activeElement.tagName,
      dialogBox: window.__H.box(sec),
      pOverflowX: p ? (p.scrollWidth - p.clientWidth) : null,
      pClientWidth: p ? p.clientWidth : null,
      pScrollWidth: p ? p.scrollWidth : null,
      pWhiteSpace: p ? getComputedStyle(p).whiteSpace : null,
      pWordBreak: p ? getComputedStyle(p).wordBreak : null,
      pLineCount: p ? Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)) : null,
      sectionWidth: Math.round(sec.getBoundingClientRect().width),
      sectionMaxWidth: getComputedStyle(sec).maxWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
      viewport: [window.innerWidth, window.innerHeight],
      actionError: (function(){ const e = window.__H.byText('main div', '错误'); return null; })(),
    };
  },
  stackingChain(sel) {
    let el = document.querySelector(sel); if (!el) return null;
    const chain = [];
    while (el && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      const creates = (cs.position !== 'static' && cs.zIndex !== 'auto') ||
        cs.transform !== 'none' || cs.filter !== 'none' || cs.backdropFilter !== 'none' ||
        cs.opacity !== '1' || cs.willChange.includes('transform') || cs.isolation === 'isolate' || cs.mixBlendMode !== 'normal';
      chain.push({ tag: el.tagName, cls: (el.className||'').toString().slice(0,60), z: cs.zIndex, pos: cs.position,
        transform: cs.transform !== 'none', filter: cs.filter !== 'none', backdrop: cs.backdropFilter !== 'none', opacity: cs.opacity, creates });
      el = el.parentElement;
    }
    return chain;
  },
};
true`

/// Visual baseline probe: type scale, radii and gaps, dead space, ordinal sequences,
/// size-utility drift, colour contrast and font presence, all computed in the page.
export const VISUAL_PROBE = `
window.__V = (function () {
  // Any CSS colour -> sRGB, using the canvas the browser already parses with. A regex over rgb()
  // strings silently returns null for oklab()/color-mix() values, which made several buttons report
  // a contrast of exactly 1.00 - an artefact of the reader, not of the UI.
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const parse = (c) => {
    if (!c || c === 'transparent' || c === 'none') return null
    // Prime with a colour no CSS input can produce, so "the browser rejected this value" is
    // distinguishable from "this colour happens to be black". Priming with #000 made every
    // unsupported value parse as black, and two blacks cancelled out into a contrast of 1.00.
    ctx.fillStyle = '#010203'
    ctx.fillStyle = c
    const norm = String(ctx.fillStyle)
    if (norm === '#010203' || norm === 'rgb(1, 2, 3)') return null
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = norm
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }
  }
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) })
  const lum = (c) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }
  const bgOf = (el) => {
    // The app shell paints a linear-gradient; treating "has a gradient" as "background unknown" made
    // every contrast inside a dialog return null, so the failing close icon was never flagged. Fall
    // back to the page's own base colour, which is what that gradient averages over here.
    const base = parse(getComputedStyle(document.querySelector('.app-shell-root') || document.body).backgroundColor) || { r: 246, g: 247, b: 251, a: 1 }
    let n = el
    const stack = []
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n)
      const c = parse(cs.backgroundColor)
      if (c && c.a > 0) { stack.push(c); if (c.a === 1) break }
      else if (cs.backgroundImage && cs.backgroundImage !== 'none') { return { gradient: true, rgb: base } }
      n = n.parentElement
    }
    if (!stack.length) return { rgb: { r: 255, g: 255, b: 255 } }
    let acc = stack[stack.length - 1]
    for (let i = stack.length - 2; i >= 0; i--) acc = over(stack[i], acc)
    return { rgb: acc }
  }
  const ratio = (el) => {
    const cs = getComputedStyle(el)
    const fg = parse(cs.color)
    const bg = bgOf(el)
    if (!fg) return null
    if (bg.gradient) return null // painted gradient: no single background colour exists to compare against
    const fgc = over(fg, bg.rgb)
    const l1 = Math.max(lum(fgc), lum(bg.rgb)), l2 = Math.min(lum(fgc), lum(bg.rgb))
    return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100
  }
  const text = (el) => (el.textContent || '').trim().slice(0, 34)
  const leaf = (root) => Array.from(root.querySelectorAll('*')).filter((e) => e.children.length === 0 && text(e))
  const fontProbe = (family) => {
    const cv = document.createElement('canvas'); const ctx = cv.getContext('2d')
    const s = 'Handgloves 0123456789 Il10O'
    ctx.font = '48px ' + family; const a = ctx.measureText(s).width
    ctx.font = '48px sans-serif'; const b = ctx.measureText(s).width
    ctx.font = '48px serif'; const c = ctx.measureText(s).width
    return { sameAsSansSerif: Math.abs(a - b) < 0.5, sameAsSerif: Math.abs(a - c) < 0.5, width: Math.round(a) }
  }
  return {
    ratio, text, leaf,
    fonts: () => ({ inter: fontProbe('Inter'), segoe: fontProbe('"Segoe UI"'), yahei: fontProbe('"Microsoft YaHei"') }),
    scale: (root) => {
      const set = new Map()
      for (const e of leaf(root)) {
        const cs = getComputedStyle(e)
        const k = cs.fontSize + '/' + cs.fontWeight
        if (!set.has(k)) set.set(k, { fontSize: cs.fontSize, fontWeight: cs.fontWeight, sample: text(e), n: 0, contrast: ratio(e) })
        set.get(k).n++
      }
      return Array.from(set.values()).sort((a, b) => parseFloat(b.fontSize) - parseFloat(a.fontSize))
    },
    shapes: (root) => {
      const radii = new Map(), gaps = new Map(), muted = []
      for (const e of [root, ...root.querySelectorAll('*')]) {
        const cs = getComputedStyle(e)
        if (cs.borderRadius !== '0px') radii.set(cs.borderRadius, (radii.get(cs.borderRadius) || 0) + 1)
        if (cs.gap && cs.gap !== 'normal' && cs.gap !== '0px') gaps.set(cs.gap, (gaps.get(cs.gap) || 0) + 1)
      }
      const unresolved = []
      for (const e of leaf(root)) {
        const r = ratio(e)
        if (r === null) { if (unresolved.length < 8) unresolved.push({ sample: text(e), fontSize: getComputedStyle(e).fontSize, why: 'gradient or unparsable background' }); continue }
        if (r < 4.5) muted.push({ sample: text(e), fontSize: getComputedStyle(e).fontSize, color: getComputedStyle(e).color, contrast: r, cls: (e.className || '').toString().slice(0, 40) })
      }
      return { radii: Object.fromEntries(radii), gaps: Object.fromEntries(gaps), belowAA: muted, contrastUnresolved: unresolved }
    },
    deadSpace: (root, cardSel) => Array.from(root.querySelectorAll(cardSel)).slice(0, 8).map((card) => {
      const kids = Array.from(card.children).filter((c) => c.offsetHeight > 0)
      if (!kids.length) return null
      const cr = card.getBoundingClientRect()
      const lastBottom = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom)) - cr.top
      const trail = cr.height - lastBottom
      // emptyPct alone overstates the complaint: a card's own padding-bottom is intended whitespace.
      // stretchPct is what an equal-height grid actually added below the last element.
      const pad = parseFloat(getComputedStyle(card).paddingBottom) || 0
      const stretch = Math.max(0, trail - pad)
      return { sample: text(card).slice(0, 18), cardH: Math.round(cr.height), contentBottom: Math.round(lastBottom), padBottom: Math.round(pad), emptyPct: Math.round((trail / cr.height) * 100), stretchPct: Math.round((stretch / cr.height) * 100), stretchPx: Math.round(stretch) }
    }).filter(Boolean),
    // A sequence is a run of >=3 sibling-ish items whose text opens with an ordinal. The first
    // version of this matched /^\\d+$/ on a childless element, which counted 0 chips in the help
    // dialog even with five on screen - the chip's visible text is "1.连接 GitHub" and it wraps a
    // <span>, so both conditions failed. Anchoring on the leading ordinal is what actually bites.
    // Does the class that says "12px" actually produce 12px on this element? The probe is a span
    // carrying the identical class in the identical parent: if the span reads one size and the
    // real element another, the utility is being out-cascaded by an element selector, not by the
    // author's own class.
    utilityDrift: (root) => {
      // Backslashes are doubled because this source is embedded in a Node template literal: a
      // single "\s" arrives at the page as "s", which silently matches nothing.
      const re = /(?:^|\\s)(text-(?:xs|sm|base|lg|xl|2xl|[a-z]{0,3}\\[[0-9.]+(?:rem|px)\\]))(?=\\s|$)/
      const out = {}
      let checked = 0, matched = 0
      const examples = []
      for (const e of leaf(root)) {
        const cls = (e.className || '').toString()
        const m = re.exec(cls)
        checked++
        if (!m || !e.parentElement) continue
        matched++
        const probe = document.createElement('span')
        probe.className = cls
        probe.textContent = 'X'
        probe.style.cssText = 'position:absolute;visibility:hidden'
        e.parentElement.appendChild(probe)
        const ps = getComputedStyle(probe), es = getComputedStyle(e)
        const want = { size: ps.fontSize, weight: ps.fontWeight }
        probe.remove()
        if (examples.length < 4) examples.push(e.tagName.toLowerCase() + ' [' + m[1] + '] probe=' + want.size + '/' + want.weight + ' actual=' + es.fontSize + '/' + es.fontWeight + ' "' + text(e).slice(0, 12) + '"')
        if (want.size !== es.fontSize || want.weight !== es.fontWeight) {
          // Plain concatenation: this body is inside a Node template literal, so a nested backtick
          // or a dollar-brace here would be evaluated by Node instead of reaching the page.
          const k = e.tagName.toLowerCase() + '.' + m[1] + ' probe=' + want.size + '/' + want.weight + ' actual=' + es.fontSize + '/' + es.fontWeight
          out[k] = (out[k] || 0) + 1
        }
      }
      // checked/matched are reported so an empty drift map can be told apart from a probe that
      // never matched anything - "no drift" and "no data" must not print the same.
      return { drift: out, checked, matched, examples }
    },
    // Settles "is Tailwind's slate-400 the same grey as the --text-muted token" with the browser's
    // own colour engine rather than a palette-conversion claim in prose.
    palette: () => {
      const cv = document.createElement('canvas'); const c = cv.getContext('2d')
      const norm = (v) => { c.fillStyle = '#010203'; c.fillStyle = v; const n = String(c.fillStyle); c.clearRect(0, 0, 1, 1); c.fillStyle = n; c.fillRect(0, 0, 1, 1); const d = c.getImageData(0, 0, 1, 1).data; return { input: v, normalized: n, rgb: d[0] + ',' + d[1] + ',' + d[2] } }
      const a = norm('oklch(70.4% 0.04 256.788)')
      const b = norm('#94a3b8')
      return { slate400: a, textMuted: b, identical: a.rgb === b.rgb }
    },
    sequences: (root) => {
      const items = Array.from(root.querySelectorAll('*'))
        .filter((e) => e.children.length <= 1 && !e.closest('button'))
        .map((e) => ({ e, t: text(e) }))
        .filter((x) => x.t.length > 0 && x.t.length <= 28 && /^\\d+\\s*[.、)]/.test(x.t))
        .map((x) => x.t)
      const steps = Array.from(root.querySelectorAll('*')).filter((e) => e.children.length === 0 && /^STEP\\s*\\d+$/i.test(text(e))).length
      // Drop the bare "1." spans: the chip's own text already contains them, and counting both
      // doubles the total.
      const ordinals = items.filter((t) => !/^\\d+\\s*[.、)]$/.test(t))
      return { steps, numberedItems: ordinals.length, stepLabels: Array.from(root.querySelectorAll('*')).filter((e) => e.children.length === 0 && /^STEP\\s*\\d+$/i.test(text(e))).map((e) => text(e.closest('article') || e.parentElement).slice(0, 30)).slice(0, 8), ordinals: ordinals.slice(0, 8) }
    },
    // Deepest matches only. An ancestor whose textContent is also "STEP 1" reports the inherited
    // font-variant-numeric, so mixing ancestors into this list makes "set" and "not set" appear
    // in the same array and the value becomes uninterpretable.
    numeric: (root) => Array.from(root.querySelectorAll('*')).filter((e) => /^STEP\\s*\\d+$/i.test(text(e))).filter((e) => !Array.from(e.children).some((c) => /^STEP\\s*\\d+$/i.test(text(c)))).map((e) => ({ variant: getComputedStyle(e).fontVariantNumeric, size: getComputedStyle(e).fontSize, weight: getComputedStyle(e).fontWeight, family: getComputedStyle(e).fontFamily.slice(0, 40) })),
  }
})()`

/// Geometry probe: per-axis clipping against the nearest effective clipper, self-clip via the
/// text ink rect, touch targets, focus differentials and broken images.
export const LAYOUT_PROBE = `
window.__L = (function () {
  const txt = (e) => (e.textContent || '').trim().slice(0, 46)
  const cls = (e) => (e.className || '').toString()
  const sel = (e) => {
    const parts = []
    let n = e
    for (let i = 0; i < 3 && n && n.nodeType === 1; i++) {
      let s = n.tagName.toLowerCase()
      if (n.id) s += '#' + n.id
      else {
        const c = cls(n).trim().split(/\\s+/).filter((x) => x && !/[~:\\/\\[\\]()%.,]/.test(x)).slice(0, 2)
        if (c.length) s += '.' + c.join('.')
      }
      parts.unshift(s)
      n = n.parentElement
    }
    return parts.join('>')
  }
  const vis = (e) => {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e)
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05
  }
  const nameOf = (e) => {
    const direct = (e.getAttribute('aria-label') || txt(e) || e.getAttribute('alt') || e.getAttribute('title') || e.getAttribute('placeholder') || e.getAttribute('value') || '').trim()
    if (direct) return direct
    // A control wrapped in a <label>, or pointed at one by aria-labelledby, does have an accessible
    // name even though it carries no attribute of its own - counting those as unnamed is a probe
    // bug, not an app bug.
    const labelledBy = e.getAttribute('aria-labelledby')
    if (labelledBy) {
      const ref = document.getElementById(labelledBy.trim().split(/\\s+/)[0])
      if (ref && txt(ref)) return txt(ref)
    }
    const wrapping = e.closest('label')
    if (wrapping) { const t = txt(wrapping).replace(txt(e), '').trim(); if (t) return t }
    if (e.id) {
      const forLabel = document.querySelector('label[for="' + e.id + '"]')
      if (forLabel && txt(forLabel)) return txt(forLabel)
    }
    return ''
  }
  const styleOf = (e) => {
    const cs = getComputedStyle(e)
    return { outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, shadow: cs.boxShadow, border: cs.borderTopColor + '/' + cs.borderTopWidth, bg: cs.backgroundColor }
  }
  const hasOwnText = (e) => Array.from(e.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0)
  // Tailwind's sr-only (and anything like it) is a 1px box with clipped overflow holding text meant
  // for a screen reader only. Flagging those as "cut off" is a probe bug.
  const isVisualHiding = (e, cs) => /rect\\(\\s*0/.test(cs.clip || '') || /inset\\(\\s*50%/.test(cs.clipPath || '') || (e.offsetWidth <= 1 && e.offsetHeight <= 1 && cs.overflow !== 'visible')
  // The first ancestor that cuts, with its PADDING box. Overflow clips at the padding edge, so
  // comparing against the border box would let content hide under the border.
  //
  // The chain STOPS here rather than intersecting every clipper: if this first one scrolls
  // (auto/scroll), the content is reachable by scrolling it, and testing the clippers above it
  // would flag ordinary page content as cut. .app-main is overflow-y:auto, so a walk that continued
  // past rails reported 22 below-the-fold buttons at 1440x900 that a user reaches by scrolling.
  // A rail that is itself cut is caught when the rail is evaluated as its own subject.
  // PROVENANCE OF THESE TWO LINES (stop-at-first + per-axis): 顺手, not 故意. The version that
  // shipped first walked the whole chain (a "求交 everything" guess) and then excused the element
  // on a SINGLE boolean over both overflow properties; neither shape was designed, and both were
  // wrong - the first invented 22 findings, the second let a vertical rail vouch for horizontal
  // cuts. Both halves became deliberate only under challenge from outside, and CONTROL-F is what
  // keeps them deliberate now: it fails the gate if either axis stops being walked on its own.
  // PER AXIS, and that is a deliberate choice, not a side effect of how the code fell out: overflow
  // is two independent properties and Chrome resolves them independently (a visible axis paired with
  // a non-visible one computes to auto). A single boolean that stops the whole chain when EITHER axis
  // scrolls lets .app-main - overflow-y:auto, overflow-x:hidden - excuse horizontal cuts, because a
  // vertical rail vouches for the horizontal axis. Each axis walks on its own and stops on its own.
  // The cost of choosing this way is measured, not assumed, and the two halves of the choice have
  // different evidence. Stopping a chain at a rail that scrolls: at 1440x900, a walk that continued
  // PAST the rails reported 22 below-the-fold buttons as "cut" that a user reaches by scrolling -
  // ordinary page content flagged as a defect, so that stop is what the rule is for. Splitting the
  // stop per axis: .app-main (overflow-y:auto, overflow-x:hidden) is exactly the shape where a single
  // boolean lets the vertical rail vouch for the horizontal axis, and that half rests on how Chrome
  // resolves the two properties rather than on a count I have taken.
  const clipperForAxis = (e, axis) => {
    const prop = axis === 'x' ? 'overflowX' : 'overflowY'
    let n = e.parentElement
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n)
      const v = cs[prop]
      if (v !== 'visible') {
        const r = n.getBoundingClientRect()
        return {
          node: n, v, axis,
          rail: v === 'auto' || v === 'scroll' || v === 'overlay',
          box: {
            left: r.left + (parseFloat(cs.borderLeftWidth) || 0),
            top: r.top + (parseFloat(cs.borderTopWidth) || 0),
            right: r.right - (parseFloat(cs.borderRightWidth) || 0),
            bottom: r.bottom - (parseFloat(cs.borderBottomWidth) || 0),
          },
        }
      }
      if (n === document.body || n === document.documentElement) return null
      n = n.parentElement
    }
    return null
  }
  const intersectLoss = (r, box) => {
    const w = Math.max(0, Math.min(r.right, box.right) - Math.max(r.left, box.left))
    const h = Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top))
    return { lostX: Math.round((r.width - w) * 10) / 10, lostY: Math.round((r.height - h) * 10) / 10 }
  }
  return {
    geometry: (touchMin) => {
      const iw = innerWidth
      const doc = document.documentElement
      const all = Array.from(doc.querySelectorAll('*'))
      const out = {
        innerWidth: iw,
        // Self-reporting counts. A sweep that examined nothing and a sweep that found nothing
        // clean must never print the same way.
        nodes: all.length, visibleNodes: 0, textLeaves: 0, measuredLeaves: 0,
        skipSrOnly: 0, skipEllipsis: 0, skipTitle: 0, skipScrollRail: 0, skipFixed: 0, railX: 0, railY: 0,
        docScrollWidth: doc.scrollWidth,
        bodyScrollWidth: document.body ? document.body.scrollWidth : 0,
        // Criterion DOC: does the document's own content box extend past the viewport? This is the
        // one that stays silent when an ancestor clips the overflow away.
        docOverflowPx: doc.scrollWidth - iw,
        // Criterion VIEWPORT: per-element rect past the viewport edge.
        viewportOverflowPx: 0,
        offenders: [], clipped: [], clippedByAncestor: [], controlsCut: [], containersCut: [], smallTargets: [], brokenImages: [], focusables: 0,
        railProof: { proven: 0, rails: 0, unreachable: [] },
      }
      const railCandidates = []
      for (const e of all) {
        if (!vis(e)) continue
        out.visibleNodes++
        const r = e.getBoundingClientRect()
        if (r.right > iw + 1) {
          out.offenders.push({ sel: sel(e), over: Math.round(r.right - iw), w: Math.round(r.width), text: txt(e) })
          out.viewportOverflowPx = Math.max(out.viewportOverflowPx, Math.round(r.right - iw))
        }
        const cs = getComputedStyle(e)
        if (cs.position === 'fixed') { out.skipFixed++; continue }
        const cx = clipperForAxis(e, 'x')
        const cy = clipperForAxis(e, 'y')
        if (cx && cx.rail) { out.railX++; if (r.right > innerWidth + 1) railCandidates.push({ e, rail: cx.node, axis: 'x' }) }
        if (cy && cy.rail) { out.railY++; if (r.bottom > innerHeight + 1) railCandidates.push({ e, rail: cy.node, axis: 'y' }) }
        let lostX = 0, lostY = 0, byX = null, byY = null
        if (cx && !cx.rail) { const l = intersectLoss(r, cx.box); lostX = l.lostX; byX = cx }
        if (cy && !cy.rail) { const l = intersectLoss(r, cy.box); lostY = l.lostY; byY = cy }
        const px = Math.max(lostX, lostY)
        if (px > 1) {
          const cutter = lostX >= lostY ? byX : byY
          const rec = { sel: sel(e), by: cutter ? sel(cutter.node) : 'unknown', excess: px, axis: lostX >= lostY ? 'x' : 'y', lostX, lostY, overflow: (cx ? cx.v : '-') + '/' + (cy ? cy.v : '-'), text: txt(e).slice(0, 30) }
          const isText = hasOwnText(e) && !!txt(e)
          const tag = e.tagName.toLowerCase()
          if (isText && (isVisualHiding(e, cs) || cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') || e.title || e.closest('[title]'))) {
            // intended truncation
          } else if (isText) out.clippedByAncestor.push(rec)
          else if (/^(button|a|input|select|textarea)$/.test(tag) || e.getAttribute('role')) out.controlsCut.push(rec)
          else out.containersCut.push(rec)
        }
      }
      out.offenders.sort((a, b) => b.over - a.over)
      // A rail stops the clipping chain because "reachable by scrolling" is a real exemption - but
      // the rail existing is not the same fact as the content being reachable, so every rail-stopped
      // candidate is proven the only way that settles it: scroll the rail, re-measure, restore.
      // Two things this had to get right, both learned by watching the first version fire 686 times
      // on a page with nothing wrong with it: the test is whether the element becomes VISIBLE, not
      // whether its whole box fits inside the viewport (a tall section can never fit, and calling
      // that unreachable is the gate blaming the page for the shape of its own criterion); and the
      // scroll happens once per rail, not once per descendant, or one overflowing subtree asks the
      // same question hundreds of times and the run cost is meaningless.
      const byRail = new Map()
      for (const c of railCandidates) {
        const key = c.axis + '|' + sel(c.rail)
        if (!byRail.has(key)) byRail.set(key, { rail: c.rail, axis: c.axis, items: [] })
        byRail.get(key).items.push(c)
      }
      for (const { rail, axis, items } of byRail.values()) {
        const view = axis === 'y' ? innerHeight : innerWidth
        const before = axis === 'y' ? rail.scrollTop : rail.scrollLeft
        const past = items.filter((c) => { const r0 = c.e.getBoundingClientRect(); return (axis === 'y' ? r0.bottom : r0.right) > view + 1 })
        if (!past.length) { out.railProof.proven += items.length; continue }
        // Scroll the ELEMENT into view, not the rail to its extreme. The first version set
        // scrollTop = scrollHeight, which brings the bottom of the content up and thereby pushes
        // everything above it out of the viewport - so 301 perfectly reachable elements were
        // reported unreachable because the one position the test tried happened to be the wrong end.
        for (const c of past) {
          try { c.e.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }) } catch (e) { c.e.scrollIntoView() }
          const rect = c.e.getBoundingClientRect()
          const visible = axis === 'y' ? (rect.top < view - 8 && rect.bottom > 8) : (rect.left < view - 8 && rect.right > 8)
          const moved = (axis === 'y' ? rail.scrollTop : rail.scrollLeft) !== before
          if (visible) out.railProof.proven++
          else out.railProof.unreachable.push({ sel: sel(c.e), rail: sel(rail), axis, moved, visible, scrollSize: axis === 'y' ? rail.scrollHeight : rail.scrollWidth, clientSize: axis === 'y' ? rail.clientHeight : rail.clientWidth, text: txt(c.e).slice(0, 24) })
        }
        out.railProof.rails++
        try { rail.scrollTo({ [axis === 'y' ? 'top' : 'left']: before, behavior: 'instant' }) } catch (e) { if (axis === 'y') rail.scrollTop = before; else rail.scrollLeft = before }
      }
      out.offenders = out.offenders.slice(0, 6)
      for (const key of ['clippedByAncestor', 'controlsCut', 'containersCut']) {
        out[key].sort((a, b) => b.excess - a.excess)
        out[key + 'Total'] = out[key].length
        out[key] = out[key].slice(0, 8)
      }
      for (const e of all) {
        if (!hasOwnText(e) || !txt(e) || !vis(e)) continue
        out.textLeaves++
        const cs = getComputedStyle(e)
        if (isVisualHiding(e, cs)) { out.skipSrOnly++; continue }
        const clamped = cs.webkitLineClamp && cs.webkitLineClamp !== 'none'
        if (cs.textOverflow === 'ellipsis' || clamped) { out.skipEllipsis++; continue }
        if (e.title || e.closest('[title]')) { out.skipTitle++; continue }
        if (/auto|scroll/.test(cs.overflowX)) { out.skipScrollRail++; continue }
        out.measuredLeaves++
        // SELF-CLIP. Horizontal uses scrollWidth-clientWidth. Vertical must NOT: scrollHeight
        // counts line-height descender slack, which reports a 2-13px "cut" on ordinary headings.
        // The text's own ink rect against the element's content box is what actually answers
        // "did a glyph get eaten".
        const r2 = e.getBoundingClientRect()
        const hDelta = Math.max(0, e.scrollWidth - e.clientWidth)
        let vDelta = 0
        try {
          const rg = document.createRange(); rg.selectNodeContents(e)
          const ink = rg.getBoundingClientRect()
          const top = r2.top + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0)
          const bottom = r2.bottom - (parseFloat(cs.borderBottomWidth) || 0) - (parseFloat(cs.paddingBottom) || 0)
          vDelta = Math.max(0, Math.round(Math.max(top - ink.top, ink.bottom - bottom)))
        } catch (err) { vDelta = 0 }
        if (hDelta > 1 || vDelta > 1) {
          out.clipped.push({ sel: sel(e), text: txt(e), delta: Math.max(hDelta, vDelta), hDelta, vDelta, overflowX: cs.overflowX })
        }
      }
      out.clipped.sort((a, b) => b.delta - a.delta)
      const clippedTotal = out.clipped.length
      out.clipped = out.clipped.slice(0, 8)
      out.clippedTotal = clippedTotal
      if (touchMin) {
        const nodes = Array.from(doc.querySelectorAll('button, a[href], input:not([type=hidden]), select, [role=button], [role=tab]'))
        out.focusables = nodes.filter((e) => vis(e)).length
        for (const e of nodes) {
          if (!vis(e)) continue
          const r = e.getBoundingClientRect()
          if (r.width + 0.5 < touchMin || r.height + 0.5 < touchMin) {
            out.smallTargets.push({ sel: sel(e), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, text: txt(e) || nameOf(e) })
          }
        }
        out.smallTotal = out.smallTargets.length
        out.smallTargets.sort((a, b) => (a.w * a.h) - (b.w * b.h))
        out.smallTargets = out.smallTargets.slice(0, 8)
      }
      for (const im of doc.querySelectorAll('img')) {
        if (im.complete && im.naturalWidth === 0 && (im.getAttribute('src') || '')) out.brokenImages.push({ sel: sel(im), src: (im.getAttribute('src') || '').slice(0, 70) })
      }
      return out
    },
    // Read the focus ring straight after a real Tab: what matters is whether a keyboard user can
    // see where they are, so outline:none with no box-shadow substitute is a failure even when the
    // element is technically focusable.
    // Snapshot the resting style of every focusable so a Tab stop can be compared against its own
    // unfocused state. "outline: none" alone is not an invisible focus ring if the element changes
    // border colour or background on focus - only a differential can tell those apart.
    // Freeze the page before any rect is read. finish() alone is not enough: it throws
    // InvalidStateError on an infinite animation, which is exactly the case that leaves a rect
    // parked on frame one. Anything that cannot be finished is paused, and only a paused
    // animation that moves geometry invalidates the measurement.
    settle: () => {
      const GEOM = ['width', 'height', 'margin', 'padding', 'top', 'left', 'right', 'bottom', 'inset', 'transform', 'flex-basis', 'gap', 'line-height', 'font-size']
      const anims = document.getAnimations()
      let finished = 0, paused = 0
      const geomRunning = []
      for (const a of anims) {
        let done = false
        try { a.finish(); done = true; finished++ } catch (e) { /* infinite duration */ }
        if (done) continue
        try { a.pause(); paused++ } catch (e) { continue }
        const target = a.effect && a.effect.target
        const label = String(a.transitionProperty || a.animationName || 'anonymous')
        let props = [label]
        try {
          if (a.effect && a.effect.getKeyframes) {
            const ks = a.effect.getKeyframes()
            for (const k of ks) for (const p of Object.keys(k)) if (p !== 'offset' && p !== 'computedOffset' && p !== 'easing' && p !== 'composite') props.push(p)
          }
        } catch (e) { /* getKeyframes can throw on scroll-timeline effects */ }
        const hits = props.filter((p) => GEOM.some((g) => p === g || p.indexOf(g) !== -1))
        // A rotating or otherwise transformed icon moves no layout box: getBoundingClientRect grows
        // with the rotation but nothing around it reflows. Text or controls inside it would be a
        // different story, so the exemption is only granted to a leaf with no content of its own.
        const contentFree = !target || (!txt(target) && !target.querySelector('button,a[href],input,select,[role=button]'))
        const transformOnly = hits.length > 0 && hits.every((p) => p === 'transform')
        if (hits.length && !(transformOnly && contentFree)) geomRunning.push({ anim: label.slice(0, 34), hits: Array.from(new Set(hits)).slice(0, 4), sel: target ? sel(target) : 'unknown' })
      }
      return { total: anims.length, finished, paused, geomCount: geomRunning.length, geomRunning: geomRunning.slice(0, 4) }
    },
    markFocusables: () => {
      window.__LBASE = {}
      const nodes = Array.from(document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [tabindex]:not([tabindex="-1"])'))
      let i = 0
      for (const e of nodes) {
        if (!vis(e)) continue
        e.setAttribute('data-lidx', String(i))
        // Component libraries paint the focus ring on a wrapper rather than on the element that
        // actually receives focus, so the resting style is captured for the element and its
        // ancestors and the comparison is made against all of them.
        const chain = []
        let n = e
        for (let d = 0; d < 4 && n && n.nodeType === 1; d++) { chain.push(styleOf(n)); n = n.parentElement }
        window.__LBASE[i] = { chain, sel: sel(e), name: nameOf(e).slice(0, 30), tag: e.tagName.toLowerCase(), own: styleOf(e) }
        i++
      }
      return i
    },
    focusNow: () => {
      const e = document.activeElement
      if (!e || e === document.body || e === document.documentElement) return { tag: 'body', left: true }
      const idx = e.getAttribute('data-lidx')
      const base = idx !== null && window.__LBASE ? window.__LBASE[idx] : null
      const chain = []
      let n = e
      for (let d = 0; d < 4 && n && n.nodeType === 1; d++) { chain.push(styleOf(n)); n = n.parentElement }
      const own = styleOf(e)
      let changed = null
      if (base) {
        changed = chain.some((s, i) => {
          const b = base.chain[i]
          return b && (s.outline !== b.outline || s.shadow !== b.shadow || s.border !== b.border || s.bg !== b.bg)
        })
      }
      let viaFocusVisible = null
      try { viaFocusVisible = e.matches(':focus-visible') } catch (err) { viaFocusVisible = null }
      const ringLevel = base ? chain.findIndex((s, i) => base.chain[i] && (s.outline !== base.chain[i].outline || s.shadow !== base.chain[i].shadow)) : -1
      return {
        tag: e.tagName.toLowerCase(), sel: base ? base.sel : sel(e), name: base ? base.name : nameOf(e).slice(0, 30), unmarked: idx === null,
        outline: own.outline, shadow: own.shadow, changed, ringLevel, viaFocusVisible,
        visible: changed === null ? !!(own.outline.split(' ')[0] !== 'none' && parseFloat(own.outline.split(' ')[1]) > 0) : changed,
      }
    },
  }
})()
true`
