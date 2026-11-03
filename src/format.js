import { readRangeFont, writeRangeFont, boldOf, escape, readableText, listRtf } from "./rtf.js";
import { freshCopy } from "./elements.js";

// What ProPresenter's slide editor changes on a box, written the way ProPresenter writes it. Where it keeps a
// setting in two places (a text box's colour is in its RTF colour table AND its text fill; its alignment in
// the RTF AND its paragraph style), both are written, so the two never disagree.
//
// UNVERIFIED IN PROPRESENTER unless a test says otherwise: each is checked against how ProPresenter 21 wrote
// real files, and re-read through the schema, not yet by importing the result and looking at it.

/** "#rrggbb" to a ProPresenter colour, or null for "none". */
export function parseColor(hex) {
  if (hex === "none" || hex === null) return null;
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex ?? ""));
  if (!m) throw new Error(`A colour is #rrggbb (or "none"), not ${hex}.`);
  return { red: parseInt(m[1], 16) / 255, green: parseInt(m[2], 16) / 255, blue: parseInt(m[3], 16) / 255, alpha: 1 };
}

const rtfOf = (t) => Buffer.from(t.rtf_data).toString("latin1");
const setRtf = (t, s) => { t.rtf_data = Buffer.from(s, "latin1"); };
const byte = (v) => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255);
const textOfBox = (el) => {
  const t = el.element?.text;
  if (!t?.rtf_data) throw new Error(`The box "${el.element?.name || el.element?.uuid?.string}" holds no text.`);
  t.attributes ??= {};
  return t;
};

/** The colour of a text box's words: its RTF colour table (both forms) and its text fill. */
export function setTextColor(el, hex) {
  const c = parseColor(hex);
  if (!c) throw new Error("Words need a colour; to hide a box, hide it.");
  const t = textOfBox(el);
  const [r, g, b] = [byte(c.red), byte(c.green), byte(c.blue)];
  const per = (v) => Math.round((v / 255) * 100000);
  let rtf = rtfOf(t);
  const table = `{\\colortbl;\\red255\\green255\\blue255;\\red${r}\\green${g}\\blue${b};}`;
  const expanded = `{\\*\\expandedcolortbl;;\\csgenericrgb\\c${per(r)}\\c${per(g)}\\c${per(b)};}`;
  rtf = /\{\\colortbl[^}]*\}/.test(rtf) ? rtf.replace(/\{\\colortbl[^}]*\}/, table) : rtf.replace(/(\{\\fonttbl[^}]*\})/, `$1\n${table}`);
  rtf = /\{\\\*\\expandedcolortbl[^}]*\}/.test(rtf) ? rtf.replace(/\{\\\*\\expandedcolortbl[^}]*\}/, expanded) : rtf.replace(table, `${table}\n${expanded}`);
  // Every run in the colour just set; a run with no colour of its own gets it after its size.
  rtf = /\\cf\d+/.test(rtf) ? rtf.replace(/\\cf\d+/g, "\\cf2") : rtf.replace(/(\\fs\d+)/g, "$1 \\cf2");
  setRtf(t, rtf);
  t.attributes.text_solid_fill = c;
}

const ALIGN = { left: [0, "\\ql"], right: [1, "\\qr"], center: [2, "\\qc"], justify: [3, "\\qj"] };

/** Left, center, right or justify: in the paragraph style and on every RTF paragraph. */
export function setAlignment(el, align) {
  const a = ALIGN[align];
  if (!a) throw new Error(`Alignment is left, center, right or justify, not ${align}.`);
  const t = textOfBox(el);
  // Left is the RTF default, so ProPresenter writes no \ql: neither is written here.
  setRtf(t, rtfOf(t).replace(/\\q[lcrj](?![a-z])/g, "").replace(/\\pard(?![a-z])/g, align === "left" ? "\\pard" : `\\pard${a[1]}`));
  t.attributes.paragraph_style = { ...(t.attributes.paragraph_style ?? {}), alignment: a[0] };
}

const VERTICAL = { top: 0, middle: 1, bottom: 2 };
/** Where the words sit in the box, top to bottom. */
export function setVerticalAlignment(el, where) {
  if (!(where in VERTICAL)) throw new Error(`Vertical alignment is top, middle or bottom, not ${where}.`);
  textOfBox(el).vertical_alignment = VERTICAL[where];
}

const FIT = { none: 0, grow_box: 1, shrink_text: 2, grow_text: 3, fit_text: 4 };
/** What happens when the words don't fit: nothing, the box grows, or the words shrink, grow or both. */
export function setTextFit(el, fit) {
  if (!(fit in FIT)) throw new Error(`Fit is ${Object.keys(FIT).join(", ")}, not ${fit}.`);
  textOfBox(el).scale_behavior = FIT[fit];
}

const CAPS = { none: 0, all: 1, small: 2, title: 3, start: 4 };
/** Capitals over all the box's words: none, all, small, title or start case. */
export function setCapitals(el, caps) {
  if (!(caps in CAPS)) throw new Error(`Capitals are ${Object.keys(CAPS).join(", ")}, not ${caps}.`);
  const t = textOfBox(el);
  const ranges = (t.attributes.custom_attributes ?? []).filter((c) => !c.capitalization);
  const length = ranges.reduce((n, c) => Math.max(n, c.range?.end ?? 0), 0);
  t.attributes.custom_attributes = [...(CAPS[caps] && length ? [{ range: { end: length }, capitalization: CAPS[caps] }] : []), ...ranges];
  delete t.attributes.capitalization;
}

/**
 * The box's typeface: `name` the font's PostScript name (HelveticaNeue-Medium), `family` its family
 * (Helvetica Neue). Bold runs take the family's bold. Size and words are kept.
 */
export function setFont(el, { name, family }) {
  if (!name || !family) throw new Error("A font needs its name (as ProPresenter shows it, e.g. HelveticaNeue-Medium) and its family (Helvetica Neue).");
  const t = textOfBox(el);
  setRtf(t, rtfOf(t).replace(/\{\\fonttbl[^}]*\}/, `{\\fonttbl\\f0\\fnil\\fcharset0 ${name};\\f1\\fnil\\fcharset0 ${boldOf(name)};}`));
  for (const c of t.attributes.custom_attributes ?? []) {
    if (!c._unknown_12?.length) continue;
    c._unknown_12 = c._unknown_12.map((raw) => {
      const f = readRangeFont(raw);
      return writeRangeFont({ ...f, name: f.bold ? boldOf(name) : name, family });
    });
  }
  t.attributes.font = { ...(t.attributes.font ?? {}), name, family };
}

/** A box's own look: fill colour, outline, shadow, turn, see-through, hidden, locked. */
export function setBoxStyle(el, style) {
  const x = el.element;
  if (style.fill !== undefined) {
    if (x.fill?.media) throw new Error(`The box "${x.name || x.uuid?.string}" is filled with a picture; change the picture instead.`);
    const c = parseColor(style.fill);
    x.fill = c ? { ...(x.fill ?? {}), enable: true, color: c } : { ...(x.fill ?? {}), enable: false };
  }
  if (style.outline !== undefined || style.outline_width !== undefined) {
    const c = style.outline === undefined ? x.stroke?.color : parseColor(style.outline);
    const width = style.outline_width ?? x.stroke?.width ?? 2;
    if (!(width >= 0 && width <= 200)) throw new Error("outline_width is 0 to 200.");
    x.stroke = c && width > 0 ? { ...(x.stroke ?? {}), enable: true, width, color: c } : { ...(x.stroke ?? {}), enable: false };
  }
  if (style.shadow !== undefined) {
    x.shadow = { style: 0, angle: 315, offset: 5, radius: 5, color: { red: 0, green: 0, blue: 0, alpha: 1 }, opacity: 0.75, ...(x.shadow ?? {}), enable: Boolean(style.shadow) };
  }
  if (style.rotation !== undefined) {
    if (!Number.isFinite(style.rotation)) throw new Error("rotation is degrees.");
    x.rotation = ((style.rotation % 360) + 360) % 360;
  }
  if (style.opacity !== undefined) {
    if (!(style.opacity >= 0 && style.opacity <= 1)) throw new Error("opacity is 0 (clear) to 1 (solid).");
    x.opacity = style.opacity;
  }
  if (style.hidden !== undefined) x.hidden = Boolean(style.hidden);
  if (style.locked !== undefined) x.locked = Boolean(style.locked);
}

/**
 * Arrange, remove or copy a box within its slide. `elements` is the slide's list (first in front) and
 * `buildOrder` its element_build_order, kept in step. Returns the copy's id for "duplicate".
 */
export function arrangeBox(slide, el, op) {
  const list = slide.elements;
  const at = list.indexOf(el);
  if (at < 0) throw new Error("That box is not on this slide.");
  const id = el.element?.uuid?.string;
  if (op === "delete") {
    list.splice(at, 1);
    if (slide.element_build_order) slide.element_build_order = slide.element_build_order.filter((u) => u.string !== id);
    return null;
  }
  if (op === "duplicate") {
    const copy = freshCopy(el);
    copy.element.name = `${el.element.name || "Box"} copy`;
    list.splice(at, 0, copy);
    return copy.element.uuid.string;
  }
  // The first element is drawn in front.
  const to = op === "front" ? 0 : op === "back" ? list.length - 1 : op === "forward" ? Math.max(0, at - 1) : op === "backward" ? Math.min(list.length - 1, at + 1) : null;
  if (to === null) throw new Error(`Arrange is front, back, forward, backward, duplicate or delete, not ${op}.`);
  list.splice(at, 1);
  list.splice(to, 0, el);
  return null;
}

/**
 * Line spacing, as a multiple of the font's own (1 is single). ProPresenter writes it twice: \sl (in
 * twentieths of a point, 240 to a line) with \slmult1 on every RTF paragraph, and the paragraph style's
 * line_height_multiple; at 1 it writes no \sl at all. Checked against ProPresenter 21's own files.
 */
export function setLineSpacing(el, multiple) {
  if (!(typeof multiple === "number" && multiple >= 0.1 && multiple <= 5)) throw new Error("Line spacing is a multiple from 0.1 to 5 (1 is single).");
  const t = textOfBox(el);
  let rtf = rtfOf(t).replace(/\\sl-?\d+(\\slmult\d)?/g, "");
  if (Math.abs(multiple - 1) > 1e-9) rtf = rtf.replace(/\\pard(?![a-z])(\\pardeftab\d+)?/g, (m) => `${m}\\sl${Math.round(240 * multiple)}\\slmult1`);
  setRtf(t, rtf);
  t.attributes.paragraph_style = { ...(t.attributes.paragraph_style ?? {}), line_height_multiple: multiple };
}

// A slide's notes, as ProPresenter writes them: Helvetica Neue 48 on white.
const NOTES_HEAD = "{\\rtf1\\ansi\\ansicpg1252\\cocoartf2868\n\\cocoatextscaling0\\cocoaplatform0{\\fonttbl\\f0\\fnil\\fcharset0 HelveticaNeue;}\n" +
  "{\\colortbl;\\red255\\green255\\blue255;\\red255\\green255\\blue255;}\n{\\*\\expandedcolortbl;;\\csgray\\c100000;}\n" +
  "\\deftab1300\n\\pard\\pardeftab1300\\pardirnatural\\partightenfactor0\n\n\\f0\\fs48 \\cf2 ";

/** A slide's notes as plain text ("" for none). `action` is the slide's own action (the one with `slide`). */
export function notesOf(action) {
  const n = action?.slide?.presentation?.notes;
  return n?.rtf_data ? readableText(Buffer.from(n.rtf_data).toString("latin1")).trim() : "";
}

/** New notes on a slide, or none for "". Line breaks are kept. */
export function setNotes(action, text) {
  const p = action?.slide?.presentation;
  if (!p) throw new Error("Only a presentation slide has notes.");
  if (typeof text !== "string") throw new Error("Notes are text.");
  if (!text.trim()) { delete p.notes; return; }
  p.notes = { rtf_data: Buffer.from(`${NOTES_HEAD}${escape(text)}}`, "latin1"), attributes: {} };
}

/** A run's outline, as ProPresenter writes it after the run's colour. */
export const OUTLINE = /\\outl0\\strokewidth-?\d+ ?\\strokec\d+ ?/g;

/** The colour table's entries, so one can be added and pointed at by number (\\cf2, \\strokec3). */
function colorTable(rtf) {
  const m = /\{\\colortbl;([^}]*)\}/.exec(rtf);
  return m ? m[1].split(";").filter((e) => e.trim()) : [];
}

/**
 * An outline round the letters (not the box): its width, as ProPresenter's editor shows it (a percent of the font
 * size, per docs/RENDERING.md), and colour, or "none". ProPresenter writes
 * it twice: the attributes' stroke_width (negative: outline and fill both) and stroke_color, and on every run
 * \\outl0\\strokewidth{-20 x width}\\strokec{n}, n its entry in the RTF colour table (added to both forms).
 */
export function setTextOutline(el, outline) {
  const t = textOfBox(el);
  let rtf = rtfOf(t).replace(OUTLINE, "");
  if (outline === "none" || outline === null) {
    setRtf(t, rtf);
    t.attributes.stroke_width = 0;
    delete t.attributes.stroke_color;
    return;
  }
  const c = parseColor(outline?.color ?? "#000000");
  const width = outline?.width ?? 2;
  if (!c) throw new Error("An outline needs a colour.");
  if (!(width > 0 && width <= 50)) throw new Error("An outline's width is above 0 and at most 50 (a percent of the type size, as ProPresenter shows it).");
  const [r, g, b] = [byte(c.red), byte(c.green), byte(c.blue)];
  const entries = colorTable(rtf);
  const n = entries.length + 1;
  const per = (v) => Math.round((v / 255) * 100000);
  rtf = rtf.replace(/(\{\\colortbl;[^}]*)\}/, `$1\\red${r}\\green${g}\\blue${b};}`);
  rtf = rtf.replace(/(\{\\\*\\expandedcolortbl;[^}]*)\}/, `$1\\csgenericrgb\\c${per(r)}\\c${per(g)}\\c${per(b)};}`);
  // ProPresenter's own spacing: "\\cf2 \\outl0\\strokewidth-40 \\strokec3 ".
  rtf = rtf.replace(/(\\cf\d+) ?/g, `$1 \\outl0\\strokewidth${-Math.round(width * 20)} \\strokec${n} `);
  setRtf(t, rtf);
  t.attributes.stroke_width = -width;
  t.attributes.stroke_color = c;
}

/** A shadow behind the letters: true for ProPresenter's default (black, 5 points, down and right), false for none. */
export function setTextShadow(el, on) {
  const t = textOfBox(el);
  t.shadow = { style: 0, angle: 315, offset: 5, radius: 5, color: { red: 0, green: 0, blue: 0, alpha: 1 }, opacity: 0.75, ...(t.shadow ?? {}), enable: Boolean(on) };
}

/** A soft edge on the box, as a fraction from 0 (hard) to 1, or "none". */
export function setFeather(el, amount) {
  const x = el.element;
  if (amount === "none" || amount === null || amount === 0) { x.feather = { ...(x.feather ?? {}), enable: false }; return; }
  if (!(typeof amount === "number" && amount > 0 && amount <= 1)) throw new Error("Feather is 0 (none) to 1.");
  x.feather = { ...(x.feather ?? {}), radius: amount, enable: true };
}

/** Space between the box's edge and its words, in slide pixels, each side or all four. */
export function setMargins(el, m) {
  const t = textOfBox(el);
  const all = typeof m === "number" ? { left: m, right: m, top: m, bottom: m } : m ?? {};
  for (const [k, v] of Object.entries(all)) if (!["left", "right", "top", "bottom"].includes(k) || !(typeof v === "number" && v >= 0 && v <= 2000)) throw new Error("Margins are left, right, top and bottom, each 0 to 2000.");
  t.margins = { ...(t.margins ?? {}), ...all };
}

// ProPresenter's list styles by number_type, as model.js reads them back: the bullets by name, then 1, a, A, i, I.
const LIST_TYPES = ["box", "check", "circle", "diamond", "disc", "hyphen", "square", "1", "a", "A", "i", "I"];

/**
 * A list on a text box, or "none". A style is a bullet (box, check, circle, diamond, disc, hyphen, square) or
 * a number (1, a, A, i, I) with "(" before and "." or ")" after, as ProPresenter offers them: "1.", "(a)",
 * "A)". `start` is the first number; `indent` the hanging indent in points (ProPresenter's 80 unless the box
 * already has one). Written in the RTF and the paragraph style both, as ProPresenter writes it.
 * @param {any} el
 * @param {"none" | null | string | { style: string, start?: number, indent?: number }} spec
 */
export function setList(el, spec) {
  const t = textOfBox(el);
  const ps = (t.attributes.paragraph_style ??= {});
  if (spec === "none" || spec === null) {
    setRtf(t, listRtf(rtfOf(t), null));
    // The indent and tab stops go too when they are the ones a list writes; a box's own are kept.
    const fromList = ps.tab_stops?.length === 2 && ps.tab_stops[0].location === 1 && ps.tab_stops[1].location === ps.head_indent;
    if (fromList) for (const k of ["head_indent", "tab_stops"]) delete ps[k];
    ps.text_list = {};
    delete ps.text_lists;
    return;
  }
  const { style, start = 1, indent = ps.head_indent || 80 } = typeof spec === "string" ? { style: spec } : spec ?? {};
  const m = /^(\(?)(1|a|A|i|I)([.)]?)$/.exec(style ?? "");
  const bullet = LIST_TYPES.indexOf(style);
  if (!m && !(bullet >= 0 && bullet < 7)) throw new Error(`A list is a bullet (${LIST_TYPES.slice(0, 7).join(", ")}) or a number like 1. (a) A) i., or "none".`);
  if (!(Number.isInteger(start) && start >= 1 && start <= 9999)) throw new Error("A list starts at a whole number from 1.");
  if (!(typeof indent === "number" && indent > 0 && indent <= 1000)) throw new Error("A list's indent is above 0 and at most 1000 points.");
  const list = m
    ? { number_type: LIST_TYPES.indexOf(m[2]), ...(m[1] ? { prefix: m[1] } : {}), ...(m[3] ? { postfix: m[3] } : {}), starting_number: start }
    : { number_type: bullet, starting_number: start };
  setRtf(t, listRtf(rtfOf(t), { ...list, indent }));
  ps.head_indent = indent;
  ps.tab_stops = [{ location: 1 }, { location: indent, alignment: 4 }];
  ps.text_list = { is_enabled: true, ...list };
  ps.text_lists = [list];
}
