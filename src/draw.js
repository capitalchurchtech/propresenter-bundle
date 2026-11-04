// Drawing a slide the way ProPresenter does, as HTML: every box at its real position, in the fonts
// installed on the computer that shows it, over its background media. The rules are in
// docs/RENDERING.md; most were found by drawing real files beside ProPresenter's own pictures of them
// and fixing what differed (a prototype scored against 260 library slides and 50 live captures).
//
// Pure: no file system, no image work, no processes. The caller says where each picture can be had
// (`picture(file, path)` returns a URL, or null when it has none), and lays the result out in a
// browser with draw-layout.js, which does what needs the fonts' real metrics (line heights, shrink to
// fit, tabs, line masks cut at the box). Slides are 1920 x 1080 unless the slide says otherwise.
//
// Checked against ProPresenter's own picture of a test sheet: lists, text shadows, outline patterns,
// feather. UNVERIFIED: a box's drop shadow, and feather on a picture.

const TEXT = (b) => Buffer.from(b).toString("latin1");
const CP1252 = new TextDecoder("windows-1252");

/** File name and relative path of a media URL. */
export function mediaFile(u) {
  const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
  const name = u?.local?.path?.split("/").pop() ?? (decode(u?.absolute_string?.split("/").pop() ?? "") || null);
  return { name, path: u?.local?.path ?? null };
}

// ---------------------------------------------------------------- RTF

/** Remove every {\* ...} group (ignorable destinations: list tables, expanded colours), at any depth. */
function stripIgnorable(body) {
  let out = "";
  for (let i = 0; i < body.length;) {
    if (body.startsWith("{\\*", i)) {
      let depth = 0, j = i;
      for (; j < body.length; j++) {
        const ch = body[j];
        if (ch === "\\") { j++; continue; } // an escaped character, braces included
        if (ch === "{") depth++;
        else if (ch === "}" && --depth === 0) break;
      }
      i = j + 1;
      continue;
    }
    out += body[i++];
  }
  return out;
}

/** A box's RTF as paragraphs of styled runs. */
export function parseRtf(rtf) {
  const fonts = {};
  const ft = /\{\\fonttbl(.*?)\}/s.exec(rtf);
  if (ft) for (const m of ft[1].matchAll(/\\f(\d+)(?:\\[a-z]+-?\d*)*\s+([^;]+);/g)) fonts[m[1]] = m[2].trim();
  const colors = [null];
  const ct = /\{\\colortbl;(.*?)\}/s.exec(rtf);
  if (ct) for (const c of ct[1].split(";").filter((x) => x.trim())) {
    const r = /\\red(\d+)/.exec(c)?.[1] ?? 0, g = /\\green(\d+)/.exec(c)?.[1] ?? 0, b = /\\blue(\d+)/.exec(c)?.[1] ?? 0;
    colors.push(`rgb(${r},${g},${b})`);
  }
  // Drop the header groups; walk the rest.
  let body = rtf.replace(/^\{\\rtf1/, "").replace(/\{\\fonttbl.*?\}/s, "").replace(/\{\\colortbl.*?\}/s, "");
  body = stripIgnorable(body);
  const paras = [{ align: null, runs: [] }];
  let st = { f: "0", fs: 24, cf: 0, b: false, i: false, sp: 0, ul: false, up: 0, sw: 0, sc: 0, cb: 0, strike: false };
  const stack = [];
  let sl = null;
  let lead = 0;
  const newPara = (typed) => {
    const q = paras.at(-1);
    paras.push({ align: q.align, sl: q.sl, slMin: q.slMin, slExact: q.slExact, li: q.li, fi: q.fi, ri: q.ri, tabs: q.tabs, runs: [],
      ...(typed ? { typed: true, font: fonts[st.f] ?? null, size: st.fs / 2, color: colors[st.cf] ?? null } : {}) });
  };
  const add = (t) => {
    const p = paras.at(-1);
    const last = p.runs.at(-1);
    const run = { font: fonts[st.f] ?? null, size: st.fs / 2, color: colors[st.cf] ?? null, bold: st.b, italic: st.i, sp: st.sp, ul: st.ul, up: st.up, strike: st.strike,
      // \strokewidthN is Cocoa's stroke width x 20, a percentage of the font size; negative strokes
      // and fills, positive strokes only (hollow letters). \cbN is the colour behind the letters.
      stroke: st.sw ? { pct: st.sw / 20, color: colors[st.sc] ?? "rgb(0,0,0)" } : null, bg: st.cb ? colors[st.cb] ?? null : null };
    const same = last && Object.keys(run).every((k) => JSON.stringify(last[k]) === JSON.stringify(run[k]));
    if (same) last.text += t;
    else p.runs.push({ text: t, ...run });
  };
  for (let i = 0; i < body.length;) {
    const ch = body[i];
    if (ch === "\\") {
      const nx = body[i + 1];
      // Backslash + newline is how Cocoa writes a paragraph break (Return). It starts a new
      // paragraph, which is measured from its own runs, not the previous paragraph's font.
      if (nx === "\n" || nx === "\r") { newPara(true); i += 2; continue; }
      if (nx === "\\" || nx === "{" || nx === "}") { add(nx); i += 2; continue; }
      // \'hh: one byte in the Windows-1252 code page (curly quotes, dashes, accents).
      if (nx === "'") { add(CP1252.decode(Uint8Array.of(parseInt(body.slice(i + 2, i + 4), 16)))); i += 4; continue; }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(body.slice(i, i + 40)); // control words can be mixed case (\CocoaLigature0)
      if (!m) { i++; continue; }
      i += m[0].length;
      const [, w, n] = m;
      const q = paras.at(-1);
      if (w === "f") st.f = n;
      else if (w === "fs") st.fs = Number(n);
      else if (w === "cf") st.cf = Number(n);
      else if (w === "b") st.b = n !== "0";
      else if (w === "i") st.i = n !== "0";
      else if (w === "ul") st.ul = n !== "0";
      else if (w === "ulnone") st.ul = false;
      else if (w === "strike") st.strike = n !== "0";
      else if (w === "up") st.up = Number(n ?? 6) / 2; // half-points up (superscripts, verse numbers)
      else if (w === "dn") st.up = -Number(n ?? 6) / 2;
      else if (w === "strokewidth") st.sw = Number(n ?? 0);
      else if (w === "strokec") st.sc = Number(n ?? 0);
      else if (w === "cb") st.cb = Number(n ?? 0);
      else if (w === "plain") st = { ...st, b: false, i: false, ul: false, up: 0, sw: 0, cb: 0, strike: false, sp: 0 };
      else if (w === "qc") q.align = "center";
      else if (w === "qr") q.align = "right";
      else if (w === "ql") q.align = "left";
      else if (w === "qj") q.align = "justify";
      // Paragraph properties (\sl, alignment) belong to the paragraph and carry into the next one
      // until \pard resets them. \slN alone is a line height of at least N twips (negative: exactly
      // -N); followed by \slmult1 it is the multiple N/240 instead.
      else if (w === "sl") { q.slRaw = Number(n) || 0; q.sl = null; q.slMin = q.slRaw > 0 ? q.slRaw / 20 : null; q.slExact = q.slRaw < 0 ? -q.slRaw / 20 : null; }
      else if (w === "slmult") { if (n === "1" && q.slRaw) { q.sl = q.slRaw; sl ??= q.slRaw; q.slMin = q.slExact = null; } }
      else if (w === "pard") { q.align = null; q.sl = q.slRaw = q.slMin = q.slExact = null; q.li = q.fi = q.ri = 0; q.tabs = []; }
      // Indents and tab stops (twips): \li left, \fi first line (negative: a hanging indent, as
      // lists use), \ri right, \txN a stop. Stops count from the box's left edge.
      else if (w === "li") q.li = Number(n ?? 0) / 20;
      else if (w === "fi") q.fi = Number(n ?? 0) / 20;
      else if (w === "ri") q.ri = Number(n ?? 0) / 20;
      else if (w === "tx") (q.tabs ??= []).push(Number(n ?? 0) / 20);
      else if (w === "slleading") lead = Number(n) / 20;
      // Letter spacing: \expndtwN is in twips (1/20 point); \expnd is the older quarter-point form.
      else if (w === "expndtw") st.sp = Number(n) / 20;
      else if (w === "expnd") { if (!/\\expndtw/.test(body)) st.sp = Number(n) / 4; }
      else if (w === "par") newPara(false);
      else if (w === "line") add("\n");
      else if (w === "tab") add("\t");
      // U+2028 (line separator, Shift-Return) breaks the line inside the paragraph; U+2029 is a
      // paragraph break.
      else if (w === "u") { const c = Number(n) < 0 ? Number(n) + 65536 : Number(n); if (c === 0x2028) add("\n"); else if (c === 0x2029) newPara(true); else add(String.fromCharCode(c)); }
      continue;
    }
    if (ch === "{") { stack.push({ ...st }); i++; continue; }
    if (ch === "}") { st = stack.pop() ?? st; i++; continue; }
    if (ch === "\n" || ch === "\r") { i++; continue; }
    add(ch);
    i++;
  }
  // A typed line break at the very end is an empty last line, and ProPresenter gives it its height.
  for (const p of paras) { const r = p.runs.at(-1); if (r && /\n$/.test(r.text)) r.text += "​"; }
  // An empty typed paragraph (a blank line, or a Return at the very end) still takes a line, in the
  // font and size in force where it was typed.
  for (const p of paras) if (p.typed && !p.runs.some((r) => r.text)) p.runs = [{ text: "​", zw: true, font: p.font, size: p.size, color: p.color, bold: false, italic: false, sp: 0, ul: false }];
  return { paras: paras.filter((p) => p.runs.some((r) => r.text)), sl, lead };
}

/** Words for an RTF body: syntax characters escaped, line breaks as \ + newline, non-ASCII as \uN. */
function rtfText(t) {
  let out = "";
  for (const ch of String(t)) {
    if (ch === "\\" || ch === "{" || ch === "}") out += "\\" + ch;
    else if (ch === "\n") out += "\\\n";
    else if (ch.codePointAt(0) < 0x80) out += ch;
    else for (let i = 0; i < ch.length; i++) { const u = ch.charCodeAt(i); out += `\\uc0\\u${u > 32767 ? u - 65536 : u} `; }
  }
  return out;
}

// ---------------------------------------------------------------- drawing

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// A font name inside a quoted CSS string in a style attribute: only the characters PostScript and family
// names use, so a crafted file can't close the string and add a rule (a url() to a server, say).
const cssName = (s) => String(s).replace(/[^\w .-]/g, "");
const rgba = (c, a = 1) => (c ? `rgba(${Math.round((c.red ?? 0) * 255)},${Math.round((c.green ?? 0) * 255)},${Math.round((c.blue ?? 0) * 255)},${(c.alpha ?? 1) * a})` : null);
const fit = (sb) => (sb === 1 ? "cover" : sb === 2 ? "fill" : "contain");
const ALIGN = { 0: "left", 1: "right", 2: "center", 3: "justify", 4: "left" };
const hasWords = (x) => !!x.text?.rtf_data && parseRtf(TEXT(x.text.rtf_data)).paras.some((p) => p.runs.some((r) => r.text.trim()));
// The line mask's vertical_offset moves the tag (not the words) by that many points, positive down
// (measured: a lyric set at -10 has its tag riding high).
const DY = 1;

/** The PostScript name of a regular face's bold / italic / bold italic sibling, or null. */
function styledFace(font, bold, italic) {
  if (!bold && !italic) return null;
  if (/Bold|Black|Heavy|Italic|Oblique/.test(font)) return null;
  const base = font.replace(/-(Regular|Roman|Book|Medium|Light)$/, "");
  return `${base}-${bold ? "Bold" : ""}${italic ? "Italic" : ""}`;
}

/** Split runs at the capitalised ranges' edges and mark the runs inside them (run.caps). */
function capsRanges(paras, ranges) {
  if (!ranges.length) return;
  let pos = 0;
  for (const p of paras) {
    const out = [];
    for (const r of p.runs) {
      if (r.zw) { out.push(r); continue; }
      const cuts = new Set([0, r.text.length]);
      for (const [s, e] of ranges) for (const x of [s - pos, e - pos]) if (x > 0 && x < r.text.length) cuts.add(x);
      const xs = [...cuts].sort((a, b) => a - b);
      for (let i = 0; i < xs.length - 1; i++) {
        const at = pos + xs[i];
        out.push({ ...r, text: r.text.slice(xs[i], xs[i + 1]), caps: ranges.some(([s, e]) => at >= s && at < e) });
      }
      pos += r.text.length;
    }
    p.runs = out;
    pos += 1; // the paragraph break
  }
}

/**
 * A picture in a box, as ProPresenter places it. The crop insets are in the picture's own pixels and
 * cut it first; then: 0 fit (contain), 1 fill (cover), 2 stretch, 3 custom (the cropped picture
 * stretched into custom_image_bounds, a rectangle relative to the box).
 */
function placedImage(url, d, W, H) {
  const nw = d.natural_size?.width || 0, nh = d.natural_size?.height || 0;
  const ci = d.crop_enable ? d.crop_insets ?? {} : {};
  const l = ci.left ?? 0, r = ci.right ?? 0, t = ci.top ?? 0, b = ci.bottom ?? 0;
  const cw = nw - l - r, ch = nh - t - b;
  if (!nw || !nh || cw <= 0 || ch <= 0) return `<img src="${esc(url)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:${fit(d.scale_behavior ?? 0)}">`;
  let tx = 0, ty = 0, tw = W, th = H;
  const sb = d.scale_behavior ?? 0;
  if (sb === 3) {
    const cb = d.custom_image_bounds ?? {};
    tx = cb.origin?.x ?? 0; ty = cb.origin?.y ?? 0; tw = cb.size?.width || W; th = cb.size?.height || H;
  } else if (sb === 0 || sb === 1) {
    const k = sb === 0 ? Math.min(W / cw, H / ch) : Math.max(W / cw, H / ch);
    tw = cw * k; th = ch * k; tx = (W - tw) / 2; ty = (H - th) / 2;
  }
  const sx = tw / cw, sy = th / ch;
  return `<div style="position:absolute;left:${tx}px;top:${ty}px;width:${tw}px;height:${th}px;overflow:hidden"><img src="${esc(url)}" style="position:absolute;left:${-l * sx}px;top:${-t * sy}px;width:${nw * sx}px;height:${nh * sy}px;max-width:none"></div>`;
}

// A shadow as ProPresenter stores one (angle in degrees, 315 down and to the right; offset and
// radius in points; colour and opacity), as a CSS offset, blur and colour.
const shadowCss = (sh) => {
  const a = ((sh.angle ?? 315) * Math.PI) / 180, o = sh.offset ?? 0;
  return `${(o * Math.cos(a)).toFixed(1)}px ${(-o * Math.sin(a)).toFixed(1)}px ${sh.radius ?? 0}px ${rgba(sh.color ?? { red: 0, green: 0, blue: 0 }, sh.opacity ?? 1)}`;
};

/** Words that replace a box's own: the RTF's last run keeps its font and colour and takes `words`. */
function withWords(x, words) {
  const r = TEXT(x.text.rtf_data);
  const cut = r.lastIndexOf("\\cf");
  const m = cut >= 0 ? /^\\cf\d+ /.exec(r.slice(cut)) : null;
  return m ? { ...x, text: { ...x.text, rtf_data: Buffer.from(r.slice(0, cut) + m[0] + words + "}", "latin1") } } : x;
}

function elementHtml(el, ctx, used) {
  let x = el.element ?? {};
  if (x.hidden) return "";
  // Text tied to the slide's label shows the label, whatever words the file still holds.
  if (el.data_links?.some?.((l) => l.slide_Label_Text) && x.text?.rtf_data && ctx.label != null) x = withWords(x, rtfText(String(ctx.label).trim()));
  const timer = el.data_links?.find?.((l) => l.timer_text)?.timer_text;
  if (timer && x.text?.rtf_data) {
    const secs = ctx.timerSeconds?.[timer.timer_name] ?? 0;
    x = withWords(x, `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, "0")}`);
  }
  // A text box with no words draws nothing, its fill included.
  if (((el.info ?? 0) & 2) && !x.fill?.media && !hasWords(x)) return "";
  const b = x.bounds ?? {}, o = b.origin ?? {}, s = b.size ?? {};
  const W = s.width ?? 0, H = s.height ?? 0;
  const style = [`left:${o.x ?? 0}px`, `top:${o.y ?? 0}px`, `width:${W}px`, `height:${H}px`];
  if (x.rotation) style.push(`transform:rotate(${x.rotation}deg)`);
  if (x.opacity != null && x.opacity < 1) style.push(`opacity:${x.opacity}`);
  // An outline: 0 solid (drawn inside the box); 1 square dots, 2 dashes, 3 long dashes, each a
  // multiple of its width (measured on ProPresenter's own picture of a test sheet).
  const sw = x.stroke?.enable && x.stroke.width ? x.stroke.width : 0;
  const dash = { 1: [1, 1], 2: [2, 2], 3: [4, 2] }[x.stroke?.style ?? 0];
  if (sw && !dash) style.push(`outline:${sw}px solid ${rgba(x.stroke.color)};outline-offset:-${sw}px`);
  if (x.shadow?.enable) style.push(`filter:drop-shadow(${shadowCss(x.shadow)})`);
  // FEATHER fades the box's fill, not its words, inward from every edge, over about 2.2 x the radius
  // x the box's shorter side; where the fades meet the fill thins to a glow. Fitted to ProPresenter's
  // own picture of ten strengths on one box height: close up to a radius of about 0.35; above that
  // ProPresenter's glow is not even monotonic (fainter at 0.4-0.6 than at 0.8), so this is within
  // about a quarter of its strength there.
  const feather = x.feather?.enable && x.feather.radius > 0 ? 2.2 * x.feather.radius * Math.min(W, H) : 0;
  const fade = (len) => {
    const f = Math.min(feather, len);
    if (2 * f <= len) return `transparent 0px,#000 ${f.toFixed(1)}px,#000 ${(len - f).toFixed(1)}px,transparent ${len}px`;
    return `transparent 0px,rgba(0,0,0,${(len / (2 * f)).toFixed(3)}) ${len / 2}px,transparent ${len}px`;
  };
  const featherCss = feather ? `-webkit-mask-image:linear-gradient(to right,${fade(W)}),linear-gradient(to bottom,${fade(H)});-webkit-mask-composite:source-in;mask-image:linear-gradient(to right,${fade(W)}),linear-gradient(to bottom,${fade(H)});mask-composite:intersect;` : "";
  let inner = "";
  if (x.fill?.enable) {
    if (x.fill.media) {
      const f = mediaFile(x.fill.media.url);
      const url = f.name ? ctx.picture(f.name, f.path) : null;
      if (f.name) used.pictures.add(f.name);
      const d = x.fill.media.image?.drawing ?? {};
      style.push("overflow:hidden"); // the picture is clipped to its box (and to an ellipse or custom shape)
      const pictureHtml = url ? placedImage(url, d, W, H) : `<div class="missing">${esc(f.name ?? "picture")}</div>`;
      inner += featherCss ? `<div class="full" style="${featherCss}">${pictureHtml}</div>` : pictureHtml;
    } else if (x.fill.color && !(x.text_line_mask?.enabled && hasWords(x))) {
      if (featherCss) inner += `<div class="full" style="background:${rgba(x.fill.color)};${featherCss}"></div>`;
      else style.push(`background:${rgba(x.fill.color)}`);
    }
  }
  // THE LINE MASK: with it on, the box's fill is drawn behind the words instead of the whole box.
  // Styles: 0 full width (each line spans the box), 1 each line's own width, 2 the widest line's width.
  const mask = x.text_line_mask?.enabled && x.fill?.enable && !x.fill.media && x.fill.color && hasWords(x) ? { color: rgba(x.fill.color), style: x.text_line_mask.mask_style ?? 0, w: x.text_line_mask.width_offset ?? 0, h: x.text_line_mask.height_offset ?? 0, dy: x.text_line_mask.vertical_offset ?? 0 } : null;
  const textFill = mask?.style === 1 ? mask.color : null;
  if (x.path?.shape?.type === 2) style.push("border-radius:50%");
  // Every shape stores its outline as points (Bézier handles q0/q1), triangles, stars and arrows
  // included; only the rectangle (the box) and the ellipse (rounded corners) need no path.
  if (![undefined, 0, 1, 2].includes(x.path?.shape?.type) && (x.path.points?.length ?? 0) > 2) {
    const P = x.path.points;
    const pt = (q) => `${((q?.x ?? 0) * W).toFixed(1)} ${((q?.y ?? 0) * H).toFixed(1)}`;
    let d = `M ${pt(P[0].point)}`;
    for (let i = 1; i <= P.length; i++) { const a = P[i - 1], c = P[i % P.length]; if (i === P.length && !x.path.closed) break; d += ` C ${pt(a.q1 ?? a.point)} ${pt(c.q0 ?? c.point)} ${pt(c.point)}`; }
    style.push(`clip-path:path('${d} Z')`);
  }
  if (x.text?.rtf_data) inner += textHtml(x, mask, textFill, used);
  if (sw && dash) {
    const shape = x.path?.shape?.type === 2 ? `<ellipse cx="${W / 2}" cy="${H / 2}" rx="${Math.max(0, (W - sw) / 2)}" ry="${Math.max(0, (H - sw) / 2)}"` : `<rect x="${sw / 2}" y="${sw / 2}" width="${Math.max(0, W - sw)}" height="${Math.max(0, H - sw)}"`;
    inner += `<svg class="full" width="${W}" height="${H}">${shape} fill="none" stroke="${rgba(x.stroke.color)}" stroke-width="${sw}" stroke-dasharray="${dash[0] * sw} ${dash[1] * sw}"/></svg>`;
  }
  return `<div class="box" data-n="${esc(x.name ?? "")}" data-id="${esc(x.uuid?.string ?? "")}" style="${style.join(";")}">${inner}</div>`;
}

function textHtml(x, mask, textFill, used) {
  const t = x.text;
  const { paras, sl, lead } = parseRtf(TEXT(t.rtf_data));
  if (!paras.length) return "";
  const a = t.attributes ?? {};
  const ps = a.paragraph_style ?? {};
  const family = cssName(a.font?.family ?? "Helvetica Neue");
  // Capitalisation is the box's (all of it) or a character range's (custom_attributes, UTF-16
  // offsets into the plain text, end exclusive, a paragraph break counting as one character).
  const caps = a.capitalization === 1;
  capsRanges(paras, (a.custom_attributes ?? []).filter((c) => c.capitalization === 1).map((c) => [c.range?.start ?? 0, c.range?.end ?? Infinity]));
  // Line spacing is per paragraph when the RTF sets it (\slN\slmult1 is N/240, a paragraph
  // without one is 1); a box whose RTF never sets it uses its paragraph style's multiple.
  const lhOf = (p) => 1.2 * (sl ? (p?.sl ? p.sl / 240 : 1) : ps.line_height_multiple || 1);
  const lh = lhOf(paras[0]);
  // Extra space below every line, on top of the multiple.
  const ls = ps.line_spacing ?? lead ?? 0;
  // The line height as CSS: the multiple plus the extra spacing, held to the paragraph's minimum
  // or exact height when its RTF gives one.
  const lineCss = (p, h) => (p?.slExact ? `${p.slExact}px` : p?.slMin ? `max(calc(${h}em + ${ls}px), ${p.slMin}px)` : `calc(${h}em + ${ls}px)`);
  const va = t.vertical_alignment === 1 ? "center" : t.vertical_alignment === 2 ? "flex-end" : "flex-start";
  const m = t.margins ?? {};
  const pad = `${m.top ?? 0}px ${5 + (m.right ?? 0)}px ${m.bottom ?? 0}px ${5 + (m.left ?? 0)}px`;
  const baseColor = rgba(a.text_solid_fill) ?? "#fff";
  const size0 = paras[0]?.runs[0]?.size || a.font?.size || 40;
  const font0 = paras[0]?.runs[0]?.font ?? a.font?.name ?? "HelveticaNeue";
  // A line's tag is the font's own height plus the mask's height offset, and moves with its words.
  const hl = (h) => (textFill ? `<span class="hl" data-fs="${size0}" style="font-family:'ps-${cssName(font0)}','${family}',sans-serif;font-size:${size0}px;line-height:calc(${lh}em + ${ls}px);background:${textFill};-webkit-box-decoration-break:clone;box-decoration-break:clone;padding:${Math.max(0, mask.h / 2 - DY * mask.dy)}px ${mask.w / 2}px ${Math.max(0, mask.h / 2 + DY * mask.dy)}px">${h}</span>` : h);
  // The paragraph's own font and size set its strut: a browser line is never shorter than the
  // paragraph's font, so a default 14px strut, baseline-aligned against a 225px run set at 0.1,
  // would make the line taller than the run's own. Cocoa measures lines from their runs.
  const pFont = (p) => p.runs[0]?.font ?? font0, pSize = (p) => p.runs[0]?.size || a.font?.size || 40;
  used.fonts.add(font0);
  const html = paras.map((p) => {
    const plh = lhOf(p);
    used.fonts.add(pFont(p));
    return `<p data-fs="${pSize(p)}"${p.tabs?.length ? ` data-stops="${p.tabs.join(",")}"` : ""} data-deftab="${ps.default_tab_interval || 84}" style="${p.li || p.fi ? `padding-left:${p.li || 0}px;text-indent:${p.fi || 0}px;` : ""}${p.ri ? `padding-right:${p.ri}px;` : ""}text-align:${p.align ?? ALIGN[ps.alignment ?? 0]};line-height:${lineCss(p, plh)};font-family:'ps-${cssName(pFont(p))}','${family}',sans-serif;font-size:${pSize(p)}px">${hl(p.runs.map((r) => {
      const font = r.font ?? a.font?.name ?? "HelveticaNeue";
      used.fonts.add(font);
      const sys = /^\.(AppleSystem|SF)/.test(font) ? "system-ui," : "";
      // Bold or italic on a regular face takes the family's own bold or italic face, as Cocoa does
      // (HelveticaNeue + \b is HelveticaNeue-Bold); the regular face, emboldened, is the fallback.
      const styled = styledFace(font, r.bold, r.italic);
      if (styled) used.fonts.add(styled);
      const size = r.size || a.font?.size || 40;
      return `<span class="r" data-fs="${size}" data-lh="${plh}" data-ls="${ls}" style="line-height:${lineCss(p, plh)};font-family:${sys}${styled ? `'ps-${cssName(styled)}',` : ""}'ps-${cssName(font)}','${family}',sans-serif;font-size:${size}px;color:${r.color && r.color !== "rgb(255,255,255)" ? r.color : baseColor};${r.bold && !/Bold|Black|Heavy/.test(font) ? "font-weight:700;" : ""}${r.italic ? "font-style:italic;" : ""}${r.sp ? `letter-spacing:${r.sp}px;` : ""}${r.ul || r.strike ? `text-decoration:${[r.ul && "underline", r.strike && "line-through"].filter(Boolean).join(" ")};` : ""}${r.up ? `vertical-align:${r.up}px;` : ""}${r.stroke ? `-webkit-text-stroke:${(Math.abs(r.stroke.pct) / 100) * size}px ${r.stroke.color};${r.stroke.pct > 0 ? "-webkit-text-fill-color:transparent;" : ""}` : ""}${r.bg ? `background:${r.bg};` : ""}${r.caps ? "text-transform:uppercase;" : ""}">${esc(r.text).replace(/\n/g, "<br>").replace(/\t/g, '<span class="tab"></span>')}</span>`;
    }).join(""))}</p>`;
  }).join("");
  const firstAlign = paras[0]?.align ?? ALIGN[ps.alignment ?? 0];
  const extraFirst = lh < 1.2 ? (1.2 - lh) * size0 : 0;
  const firstPad = extraFirst ? (t.vertical_alignment === 2 ? 0 : t.vertical_alignment === 1 ? extraFirst / 2 : extraFirst) : 0;
  const self = firstAlign === "center" ? "center" : firstAlign === "right" ? "flex-end" : firstAlign === "justify" ? "stretch" : "flex-start";
  // Styles 0 and 2 draw one block: the box's width, or the widest line's. The margins place the
  // words; the mask hugs them, grown by its own offsets (half each side), and is cut at the box's
  // edges once laid out. It covers the first line's full height too (a spacing under 1 packs only
  // the lines after the first), so that room goes inside the tag; a spacing over 1 adds room above
  // each line, and above the first line that room is outside the tag.
  const blockMask = mask && mask.style !== 1;
  const overTop = blockMask && lh > 1.2 ? (lh - 1.2) * size0 : 0;
  const body = blockMask ? `<div class="mb" data-c="${mask.color}" style="background:${mask.color};padding:${mask.h / 2 + extraFirst}px ${mask.w / 2}px ${mask.h / 2}px;${mask.dy ? `position:relative;top:${DY * mask.dy}px;` : ""}${mask.style === 0 ? "" : "display:inline-block;vertical-align:top;"}">${mask.dy || overTop ? `<div style="position:relative;top:${-DY * mask.dy}px;${overTop ? `margin-top:${-overTop}px;` : ""}">${html}</div>` : html}</div>` : html;
  // Scale behaviour 2 / 3 / 4 shrinks / grows / both the font until the words fill the box (done
  // once laid out); 1, adjust the container's height, draws as 0.
  const fitMode = [2, 3, 4].includes(t.scale_behavior) ? t.scale_behavior : 0;
  const shadow = t.shadow?.enable ? `text-shadow:${shadowCss(t.shadow)};` : "";
  return `<div class="txt"${fitMode ? ` data-fit="${fitMode}"` : ""} style="justify-content:${va};tab-size:${ps.default_tab_interval || 84}px;${shadow}${caps ? "text-transform:uppercase;" : ""}"><div class="words" style="padding:${pad};${firstPad && !blockMask ? `margin-top:${firstPad}px;` : ""}${mask ? `margin-left:${-mask.w / 2}px;margin-right:${-mask.w / 2}px;max-width:calc(100% + ${mask.w}px);` : ""}align-self:${blockMask && mask.style === 0 ? "stretch" : self}">${body}</div></div>`;
}

// A background is placed like a picture in a box, the box being the whole slide. A missing
// scale_behavior is 0, fit (the file stores no default); is_blurred fills the bars fit leaves.
function mediaActionHtml(a, W, H, ctx, used) {
  const el = a.media?.element;
  const f = mediaFile(el?.url);
  if (f.name) used.pictures.add(f.name);
  const url = f.name ? ctx.picture(f.name, f.path) : null;
  const d = el?.image?.drawing ?? {};
  if (!url) return `<div class="full missing">${esc(f.name ?? "media")}</div>`;
  const blur = d.is_blurred ? `<img src="${esc(url)}" class="blurfill">` : "";
  return `<div class="full">${blur}${placedImage(url, d, W, H)}</div>`;
}

const noPictures = () => null;

/**
 * One slide as HTML. `actions` are the cue's actions, with the media playing under it (see
 * drawPresentation, which carries background media from slide to slide as ProPresenter does).
 * @param {any} baseSlide
 * @param {any[]} actions
 * @param {{ picture?: (file: string, path: string | null) => string | null, label?: string, timerSeconds?: Record<string, number>, props?: Map<string, any> }} [ctx]
 * @returns {{ html: string, width: number, height: number, pictures: string[], fonts: string[] }}
 */
export function drawSlide(baseSlide, actions, ctx = {}) {
  const c = { picture: noPictures, ...ctx };
  const used = { pictures: new Set(), fonts: new Set() };
  const els = baseSlide?.elements ?? [];
  const parts = [];
  const w = baseSlide?.size?.width ?? 1920, h = baseSlide?.size?.height ?? 1080;
  for (const a of actions ?? []) if (a.media && a.isEnabled !== false) parts.push(mediaActionHtml(a, w, h, c, used));
  for (const el of [...els].reverse()) parts.push(elementHtml(el, c, used)); // first in the list is the front
  // A prop the slide fires is drawn on top.
  for (const a of actions ?? []) {
    const prop = a.prop && c.props?.get(a.prop.identification?.parameter_uuid?.string);
    if (!prop) continue;
    for (const pa of prop.actions ?? []) {
      if (pa.media) parts.push(mediaActionHtml(pa, w, h, c, used));
      for (const el of [...(pa.slide?.presentation?.base_slide?.elements ?? [])].reverse()) parts.push(elementHtml(el, c, used));
    }
  }
  // The slide's own background colour, when it draws one, sits behind everything else.
  if (baseSlide?.draws_background_color && baseSlide.background_color) parts.unshift(`<div class="full" style="background:${rgba(baseSlide.background_color)}"></div>`);
  const opaque = (baseSlide?.draws_background_color && (baseSlide.background_color?.alpha ?? 1) >= 1)
    || (actions ?? []).some((a) => a.media && a.isEnabled !== false && !/\.png$/i.test(mediaFile(a.media.element?.url).name ?? ""));
  return { html: `<div class="slide${opaque ? "" : " clear"}" style="width:${w}px;height:${h}px">${parts.join("")}</div>`, width: w, height: h, pictures: [...used.pictures], fonts: [...used.fonts] };
}

// THE MEDIA LAYER (measured live): there is one. New media replaces what is playing, whatever
// layer_type it names. Media marked background (layer_type 0) carries over to the slides after it;
// media marked foreground (1) ends when the next slide comes up. A clear of all layers or of the
// background (target 0 or 2) empties it. A slide's clears, its macros' included, take effect before
// its media starts, whatever order they are listed in.
function runLayer(acts, layer, macros, depth = 0) {
  const list = (acts ?? []).filter((a) => a.isEnabled !== false);
  const ordered = depth === 0 ? [...list.filter((a) => !a.media), ...list.filter((a) => a.media)] : list;
  for (const a of ordered) {
    if (a.media && (a.media.element?.image || a.media.element?.video || a.media.element?.url)) layer = { action: a, fg: (a.media.layer_type ?? 0) === 1 };
    else if (a.clear && [0, 2].includes(a.clear.target_layer ?? 0)) layer = null;
    else if (a.macro && depth < 3) layer = runLayer(macros?.get(a.macro.identification?.parameter_uuid?.string)?.actions, layer, macros, depth + 1);
  }
  return layer;
}

/**
 * Every slide of a presentation, in the order ProPresenter lists them (by group, then any slide in
 * no group), each drawn with the media playing under it when the slides are played in that order.
 * `macros` (id to macro, from the workspace) lets a slide's macros clear or start media.
 * @param {any} doc a decoded presentation
 * @param {{ picture?: (file: string, path: string | null) => string | null, props?: Map<string, any>, macros?: Map<string, any>, timerSeconds?: Record<string, number> }} [ctx]
 */
export function drawPresentation(doc, ctx = {}) {
  const cues = new Map((doc.cues ?? []).map((c) => [c.uuid?.string, c]));
  const order = [];
  const placed = new Set();
  for (const g of doc.cue_groups ?? []) for (const id of g.cue_identifiers ?? []) {
    const c = cues.get(id.string);
    if (c) { order.push({ cue: c, group: g.group?.name ?? "" }); placed.add(c); }
  }
  for (const c of doc.cues ?? []) if (!placed.has(c)) order.push({ cue: c, group: null });
  let layer = null;
  return order.map(({ cue, group }) => {
    if (layer?.fg) layer = null; // foreground media ends when the next slide comes up
    layer = runLayer(cue.actions, layer, ctx.macros);
    const sa = (cue.actions ?? []).find((a) => a.slide);
    const base = sa?.slide?.presentation?.base_slide;
    const actions = [...(layer ? [layer.action] : []), ...(cue.actions ?? []).filter((a) => !a.media)];
    const label = sa?.label?.text ?? "";
    return { id: cue.uuid?.string ?? null, group, label, enabled: cue.isEnabled !== false, ...drawSlide(base, actions, { ...ctx, label }) };
  });
}

/**
 * @font-face rules naming each installed face by its PostScript name, with the weight and style the
 * name says, so asking for bold finds a real bold face and only falls back to emboldening when the
 * family has none. They belong in the page's own stylesheet: a shadow root's @font-face is ignored.
 * @param {Iterable<string>} names
 */
export function fontFaces(names) {
  return [...new Set(names)].filter((f) => /^[\w .-]+$/.test(f)).map((f) => `@font-face{font-family:"ps-${f}";src:local("${f}");${/Bold|Black|Heavy/.test(f) ? "font-weight:700;" : ""}${/Italic|Oblique/.test(f) ? "font-style:italic;" : ""}}`).join("\n");
}

/** The stylesheet a drawn slide needs, scoped to the slide. */
export const DRAW_CSS = `.slide{position:absolute;top:0;left:0;transform-origin:0 0;overflow:hidden;background:#000}
.slide.clear{background:repeating-conic-gradient(#222 0 25%,#0a0a0a 0 50%) 0 0/32px 32px}
.box{position:absolute;box-sizing:border-box}
.box img,.full img{position:absolute;inset:0;width:100%;height:100%}
.full{position:absolute;inset:0;overflow:hidden}
.blurfill{object-fit:cover!important;filter:blur(40px);transform:scale(1.1)}
.txt{position:absolute;inset:0;display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden;white-space:pre-wrap;word-wrap:break-word}
.txt p{margin:0}.words{max-width:100%;box-sizing:border-box}
.missing{position:absolute;inset:0;background:repeating-linear-gradient(45deg,#2a2232 0 24px,#221D2B 24px 48px);color:#CBB4F0;font:600 28px monospace;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px;box-sizing:border-box}
.rough .box{outline:3px solid rgba(203,180,240,.9)!important;outline-offset:-3px}
.rough .box::after{content:attr(data-n);position:absolute;left:0;top:0;font:600 24px monospace;background:rgba(12,10,17,.85);color:#CBB4F0;padding:3px 6px;white-space:nowrap}`;
