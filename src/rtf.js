import protobuf from "protobufjs";

export { markdownRuns, linkRuns } from "./runs.js";

// Text in a ProPresenter box, written the way ProPresenter itself writes it.
//
// A box stores its words TWICE, and both have to agree: once as RTF (what is drawn), and once as a
// list of character ranges each naming a font (custom attributes, field 12 of each, which the community
// schema does not define - it is carried as raw bytes). Replacing the RTF and leaving the ranges from
// the old text makes ProPresenter restyle the new text by the old text's character positions.
//
// So the RTF is rebuilt from the theme's own header, and the ranges are rebuilt to match, run for run.

/** @typedef {{ name: string, size: number, bold: boolean, family: string }} RangeFont */

/**
 * The font a range names: field 12 of a custom attribute, decoded by hand.
 * @param {Uint8Array} raw
 * @returns {RangeFont}
 */
export function readRangeFont(raw) {
  const r = protobuf.Reader.create(raw);
  const f = { name: "", size: 0, bold: false, family: "" };
  while (r.pos < r.len) {
    const tag = r.uint32();
    const fn = tag >>> 3, wt = tag & 7;
    if (fn === 1 && wt === 2) f.name = r.string();
    else if (fn === 2 && wt === 1) f.size = r.double();
    else if (fn === 8 && wt === 0) f.bold = r.uint32() !== 0;
    else if (fn === 9 && wt === 2) f.family = r.string();
    else r.skipType(wt);
  }
  return f;
}

/** @param {RangeFont} f @returns {Uint8Array} */
export function writeRangeFont(f) {
  const w = protobuf.Writer.create();
  w.uint32((1 << 3) | 2).string(f.name);
  w.uint32((2 << 3) | 1).double(f.size);
  if (f.bold) w.uint32((8 << 3) | 0).uint32(1);
  w.uint32((9 << 3) | 2).string(f.family);
  return w.finish();
}

/** The bold face of a font, by the name ProPresenter's fonts use. @param {string} name */
export function boldOf(name) {
  if (/-Bold$/.test(name)) return name;
  return name.replace(/-(Regular|Medium|Light|Roman)$/, "") + "-Bold";
}

function escape(s) {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === "\\" || ch === "{" || ch === "}") out += "\\" + ch;
    else if (ch === "\n") out += "\\\n";
    else if (c < 0x80) out += ch;
    // Anything else as a Unicode escape with no fallback character, which is how Cocoa writes it.
    else if (c > 0xffff) { const u = String.fromCodePoint(c); out += `\\uc0\\u${u.charCodeAt(0) - 65536}\\u${u.charCodeAt(1) - 65536} `; }
    else out += `\\uc0\\u${c > 32767 ? c - 65536 : c} `;
  }
  return out;
}

/**
 * New RTF for a box, keeping everything the theme set except the words: its paragraph style, colour
 * table and size. The font table is rewritten to exactly the faces the runs use, regular as \f0 and
 * bold as \f1.
 * @param {string} templateRtf
 * @param {import("./runs.js").Run[]} runs
 * @param {string} regular
 * @param {string} bold
 */
export function buildRtf(templateRtf, runs, regular, bold) {
  // The words start on the first LINE that opens with a font switch. Not the first "\f0" anywhere:
  // that is inside the font table, and cutting there threw the font table, colour table and
  // paragraph style away with the old words.
  const m = /\n\\f\d/.exec(templateRtf);
  const cut = m ? m.index : templateRtf.lastIndexOf("\n");
  let header = templateRtf.slice(0, cut + 1);
  const content = templateRtf.slice(cut + 1);
  const fs = /\\fs(\d+)/.exec(content)?.[1] ?? /\\fs(\d+)/.exec(templateRtf)?.[1] ?? "80";
  const cf = /\\cf(\d+)/.exec(content)?.[1] ?? "2";
  header = header.replace(/\{\\fonttbl[^}]*\}/, `{\\fonttbl\\f0\\fnil\\fcharset0 ${regular};\\f1\\fnil\\fcharset0 ${bold};}`);
  let out = header;
  let last = null;
  for (const r of runs) {
    if (r.bold !== last) out += `${last === null ? "" : "\n"}\\f${r.bold ? 1 : 0}${r.bold ? "\\b" : last === null ? "" : "\\b0"}\\fs${fs} \\cf${cf} `;
    last = r.bold;
    out += escape(r.text);
  }
  return out + "}";
}

/**
 * The ranges that go with buildRtf's runs, in UTF-16 units as NSAttributedString counts them.
 * @param {import("./runs.js").Run[]} runs
 * @param {RangeFont} regular
 */
export function buildRanges(runs, regular) {
  const out = [];
  let at = 0;
  for (const r of runs) {
    const len = r.text.length; // JS strings are UTF-16 already
    if (!len) continue;
    const font = r.bold ? { ...regular, name: boldOf(regular.name), bold: true } : regular;
    const prev = out.at(-1);
    const payload = writeRangeFont(font);
    if (prev && Buffer.compare(Buffer.from(prev._unknown_12[0]), Buffer.from(payload)) === 0) prev.range.end = at + len;
    else out.push({ range: at ? { start: at, end: at + len } : { end: at + len }, _unknown_12: [payload] });
    at += len;
  }
  return out;
}

/**
 * The words a box draws, from its RTF: everything after the first colour switch, control words and
 * braces removed. A line break comes back as nothing, as ProPresenter's own plain text does.
 * @param {string} rtf
 */
export const plainText = (rtf) => rtf.split(/\\cf\d+ /).slice(1).join("").replace(/\\'([0-9a-f]{2})/gi, (_, h) => new TextDecoder("windows-1252").decode(Uint8Array.of(parseInt(h, 16)))).replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}\\\n]/g, "");

/**
 * The same, keeping line breaks and decoding \uN escapes, for showing a person what a slide says.
 * @param {string} rtf
 */
const CP1252 = new TextDecoder("windows-1252");
const ESCAPED = { "{": "\ue001", "}": "\ue002", "\\": "\ue003" };
const UNESCAPED = { "\ue001": "{", "\ue002": "}", "\ue003": "\\" };
export function readableText(rtf) {
  const body = rtf.split(/\\cf\d+ /).slice(1).join("");
  return body
    .replace(/\\uc0\\u(-?\d+) ?/g, (_, n) => String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n)))
    // \'hh: one byte in the Windows-1252 code page, which is how Cocoa writes curly quotes and dashes.
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => CP1252.decode(Uint8Array.of(parseInt(h, 16))))
    .replace(/\\\n/g, "\u0001") // a line break the person typed
    .replace(/[\u2028\u2029]/g, "\u0001") // Shift-Return (line separator), and a paragraph separator
    .replace(/\n/g, "") // RTF's own formatting newlines
    .replace(/\\([\\{}])/g, (_, c) => ESCAPED[c]) // literal braces and backslashes the person typed
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/[\ue001-\ue003]/g, (c) => UNESCAPED[c])
    .replace(/\u0001/g, "\n")
    .replace(/\n+$/, "");
}
