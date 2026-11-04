// The browser half of draw.js: what needs the fonts' real metrics, done once a drawn slide is in the
// page. Call layoutSlide(root) on the element holding the slide, after its fonts have loaded.
// Browser only; nothing here runs in Node.

// Cocoa keeps each line's glyphs at the bottom of the line, above any extra line spacing; the browser
// centres them in the line box. Shift = (line height - (ascent + descent)) / 2 - extra spacing, with
// the font's own ascent and descent measured here. A line's tag (line mask) moves with its words.
const metricsCache = new Map();
function fontMetrics(family, px, weight, style) {
  const key = `${family}|${weight}|${style}`;
  if (!metricsCache.has(key)) {
    const c = document.createElement("canvas").getContext("2d");
    c.font = `${style} ${weight} 100px ${family}`;
    const m = c.measureText("Hg");
    // The font's line gap (leading): a line at line-height normal is ascent + descent + gap.
    const probe = document.createElement("span");
    probe.style.cssText = `position:absolute;visibility:hidden;font:${style} ${weight} 100px ${family};line-height:normal;white-space:nowrap`;
    probe.textContent = "Hg";
    document.body.appendChild(probe);
    const normal = probe.offsetHeight;
    probe.remove();
    const a0 = m.fontBoundingBoxAscent, d0 = m.fontBoundingBoxDescent;
    metricsCache.set(key, { a: a0 / 100, d: d0 / 100, gap: Math.max(0, normal - a0 - d0) / 100 });
  }
  const { a, d, gap } = metricsCache.get(key);
  return { a: a * px, d: d * px, gap: gap * px };
}

/** Lay out one drawn slide (or anything holding drawn slides). */
export function layoutSlide(root) {
  naturalLines(root);
  layoutTabs(root);
  fitText(root);
  const done = new Set();
  for (const r of root.querySelectorAll("span.r[data-lh]")) {
    const target = r.closest("span.hl") ?? r;
    if (done.has(target)) continue;
    done.add(target);
    const cs = getComputedStyle(r);
    const px = parseFloat(cs.fontSize);
    const L = parseFloat(cs.lineHeight);
    const ls = Number(r.dataset.ls) || 0;
    const { a, d, gap } = fontMetrics(cs.fontFamily, px, cs.fontWeight, cs.fontStyle);
    // Cocoa sets a line as ascent, descent, then the font's line gap at the bottom.
    const shift = (L - (a + d)) / 2 - ls - gap;
    if (Math.abs(shift) < 0.5) continue;
    target.style.position = "relative";
    target.style.top = `${shift}px`;
  }
  clipMasks(root);
}

// A block line mask (styles 0 and 2) is cut at its text box's edges: it grows out from the words by
// its offsets, but never past the box. Drawn as a gradient sized to the visible part, so the words
// inside it are not clipped.
function clipMasks(root) {
  for (const mb of root.querySelectorAll(".mb")) {
    const box = mb.closest(".box");
    if (!box) continue;
    const r = mb.getBoundingClientRect(), b = box.getBoundingClientRect();
    const k = mb.offsetWidth / (r.width || 1);
    const L = Math.max(0, (b.left - r.left) * k), T = Math.max(0, (b.top - r.top) * k);
    const R = Math.min(mb.offsetWidth, (b.right - r.left) * k), B = Math.min(mb.offsetHeight, (b.bottom - r.top) * k);
    if (L < 0.5 && T < 0.5 && R > mb.offsetWidth - 0.5 && B > mb.offsetHeight - 0.5) continue;
    const c = mb.dataset.c;
    mb.style.background = R > L && B > T ? `linear-gradient(${c},${c}) ${L}px ${T}px / ${R - L}px ${B - T}px no-repeat` : "none";
  }
}

// Scale behaviour: 2 shrinks the font until the words fit the box, 3 grows it until they fill it,
// 4 does either. Every size in the box scales by one factor (as ProPresenter's font_scale_factor);
// the factor is found by bisection on the laid-out words, which lands within about 1% of
// ProPresenter's own.
function fitText(root) {
  for (const txt of root.querySelectorAll(".txt[data-fit]")) {
    const mode = Number(txt.dataset.fit);
    const words = txt.querySelector(".words");
    const sized = [...txt.querySelectorAll("[data-fs]")];
    if (!words || !sized.length) continue;
    const apply = (k) => { for (const e of sized) e.style.fontSize = `${Number(e.dataset.fs) * k}px`; naturalLines(txt); layoutTabs(txt); };
    const fits = () => words.offsetHeight <= txt.clientHeight + 0.5 && [...words.querySelectorAll("p")].every((p) => p.scrollWidth <= p.clientWidth + 0.5);
    apply(1);
    const fitsAt1 = fits();
    if (fitsAt1 && mode === 2) continue;
    if (!fitsAt1 && mode === 3) continue;
    let lo = fitsAt1 ? 1 : 0.02, hi = fitsAt1 ? 20 : 1;
    for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; apply(mid); if (fits()) lo = mid; else hi = mid; }
    apply(lo);
    txt.dataset.k = lo.toFixed(4);
  }
}

// Tabs advance to the paragraph's next stop (\tx, measured from the box's left edge), then every
// default interval after the last one. CSS has only one tab width, so each tab is an inline block
// sized here, in order, once the words before it are laid out.
function layoutTabs(root) {
  for (const p of root.querySelectorAll("p")) {
    const tabs = p.querySelectorAll("span.tab");
    if (!tabs.length) continue;
    const stops = (p.dataset.stops ?? "").split(",").filter(Boolean).map(Number).sort((a, b) => a - b);
    const def = Number(p.dataset.deftab) || 84;
    const pr = p.getBoundingClientRect();
    const k = p.offsetWidth / (pr.width || 1);
    for (const t of tabs) {
      t.style.display = "inline-block";
      t.style.width = "0px";
      const x = (t.getBoundingClientRect().left - pr.left) * k;
      const next = stops.find((s) => s > x + 0.5) ?? (Math.floor((x + 0.5) / def) + 1) * def;
      t.style.width = `${next - x}px`;
    }
  }
}

// Cocoa's line height is the font's natural height (ascent + descent + line gap) times the multiple,
// plus any extra spacing; draw.js assumes 1.2 x size, which is right only for some fonts. Lines given
// an exact or minimum height in points are left as they are.
function naturalLines(root) {
  for (const e of root.querySelectorAll("p[data-fs], span.r[data-lh]")) {
    const src = e.matches("p") ? e.querySelector("span.r[data-lh]") : e;
    if (!src) continue;
    if (!e.dataset.lhCss) e.dataset.lhCss = e.style.lineHeight;
    if (!/^calc\(/.test(e.dataset.lhCss)) continue;
    const cs = getComputedStyle(e);
    const px = parseFloat(cs.fontSize);
    const { a, d, gap } = fontMetrics(cs.fontFamily, px, cs.fontWeight, cs.fontStyle);
    const mult = Number(src.dataset.lh) / 1.2, ls = Number(src.dataset.ls) || 0;
    e.style.lineHeight = `${mult * (a + d + gap) + ls}px`;
  }
}
