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

/** Text as RTF: braces and backslashes escaped, line breaks as RTF breaks, anything past ASCII as Cocoa writes it. */
export function escape(s) {
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

// A list's marker on each line ("1.", a bullet) is RTF the list draws, not words the person typed.
const LIST_TEXT = /\{\\listtext[^{}]*\}/g;

/**
 * Every \\uN as its character. Cocoa writes \\uc0 once and then a run of \\uN (Hebrew with its vowel
 * points is six in a row); \\ucN says how many fallback characters follow each \\uN, and those are skipped.
 * Negative N wraps (UTF-16 above 32767), and a surrogate pair arrives as two \\uN, so each is one code unit.
 * @param {string} body
 */
function decodeUnicode(body) {
  let skip = 1; // RTF's default, until a \\ucN says otherwise
  // Not after a backslash: "\\\\u" is a backslash the person typed, then a "u".
  return body.replace(/(?<!\\)\\uc(\d+) ?|(?<!\\)\\u(-?\d+) ?((?:\\'[0-9a-fA-F]{2}|[^\\{}])*)/g, (m, uc, n, after) => {
    if (uc !== undefined) {
      skip = Number(uc);
      return "";
    }
    const code = Number(n) < 0 ? Number(n) + 65536 : Number(n);
    // Drop the fallback characters (a \\'hh counts as one), keep the rest.
    let rest = after;
    for (let i = 0; i < skip && rest; i++) rest = rest.startsWith("\\'") ? rest.slice(4) : rest.slice(1);
    return String.fromCharCode(code) + rest;
  });
}

const CP1252 = new TextDecoder("windows-1252");
const ESCAPED = { "{": "\ue001", "}": "\ue002", "\\": "\ue003" };
const UNESCAPED = { "\ue001": "{", "\ue002": "}", "\ue003": "\\" };

/**
 * The words a box draws, from its RTF: everything after the first colour switch, control words and
 * braces removed. A line break comes back as nothing, as ProPresenter's own plain text does.
 * @param {string} rtf
 */
export const plainText = (rtf) =>
  decodeUnicode(rtf.split(/\\cf\d+ /).slice(1).join("").replace(LIST_TEXT, ""))
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => CP1252.decode(Uint8Array.of(parseInt(h, 16))))
    // Literal braces and backslashes the person typed, kept apart from control words: "C:\\users" is
    // a path, not a control word "\\users" to strip.
    .replace(/\\([\\{}])/g, (_, c) => ESCAPED[c])
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}\\\n]/g, "")
    .replace(/[\ue001-\ue003]/g, (c) => UNESCAPED[c]);

/**
 * The same, keeping line breaks and decoding \uN escapes, for showing a person what a slide says.
 * @param {string} rtf
 */
export function readableText(rtf, { listMarkers = false } = {}) {
  // A list's markers are left out (they are not words anyone typed) unless asked for: ProPresenter's own
  // API puts them in a slide's text, so a search index matching it keeps them.
  const body = rtf.split(/\\cf\d+ /).slice(1).join("").replace(LIST_TEXT, (m) => (listMarkers ? m.slice("{\\listtext".length, -1) : ""));
  return decodeUnicode(body)
    // \'hh: one byte in the Windows-1252 code page, which is how Cocoa writes curly quotes and dashes.
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => CP1252.decode(Uint8Array.of(parseInt(h, 16))))
    .replace(/\\\n/g, "\u0001") // a line break the person typed
    .replace(/[\u2028\u2029]/g, "\u0001") // Shift-Return (line separator), and a paragraph separator
    // RTF's own formatting newlines. Each still ends a control word ("\\kerning0", newline, "2 Corinthians"
    // must not become "\\kerning02 Corinthians"), so it goes only after the control words are gone.
    .replace(/\n/g, "\u0002")
    .replace(/\\([\\{}])/g, (_, c) => ESCAPED[c]) // literal braces and backslashes the person typed
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}\u0002]/g, "")
    .replace(/[\ue001-\ue003]/g, (c) => UNESCAPED[c])
    .replace(/\u0001/g, "\n")
    .replace(/\n+$/, "");
}

// A LIST, as ProPresenter 21 writes one (checked against every style on a test sheet it made): a list table
// and override in the header, a hanging indent on each \\pard, and at the start of every line \\ls1\\ilvl0
// with the line's marker in a {\\listtext} group. The paragraph style holds the same list as text_list.
// number_type is ProPresenter's: 0 box, 1 check, 2 circle, 3 diamond, 4 disc, 5 hyphen, 6 square, 7 1, 8 a,
// 9 A, 10 i, 11 I.
const BULLETS = [["box", 9643], ["check", 10003], ["circle", 9702], ["diamond", 9670], ["disc", 8226], ["hyphen", 8259], ["square", 9642]];
const NUMBERS = [["decimal", 0], ["lower-alpha", 4], ["upper-alpha", 3], ["lower-roman", 2], ["upper-roman", 1]];
const roman = (n) => {
  let out = "";
  for (const [v, s] of [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]]) while (n >= v) { out += s; n -= v; }
  return out;
};
const alpha = (n) => String.fromCharCode(97 + ((n - 1) % 26)).repeat(Math.ceil(n / 26));
const NUMBER = [String, alpha, (n) => alpha(n).toUpperCase(), roman, (n) => roman(n).toUpperCase()];
const hex2 = (n) => `\\'${n.toString(16).padStart(2, "0")}`;

/** The marker a list draws on its nth line (from 1), as RTF. */
function marker(list, n) {
  const t = list.number_type ?? 0;
  if (t < 7) return `\\uc0\\u${BULLETS[t][1]} `;
  return escape(`${list.prefix ?? ""}${NUMBER[t - 7](n + (list.starting_number ?? 1) - 1)}${list.postfix ?? ""}`);
}

function listTable(list) {
  const t = list.number_type ?? 0;
  const start = list.starting_number ?? 1;
  let nfc, name, text, numbers;
  if (t < 7) {
    [name] = BULLETS[t];
    nfc = 23;
    text = `\\'01\\uc0\\u${BULLETS[t][1]} ;`;
    numbers = "";
  } else {
    [name, nfc] = NUMBERS[t - 7];
    const pre = list.prefix ?? "", post = list.postfix ?? "";
    text = `${hex2(pre.length + post.length + 1)}${escape(pre)}\\'00${escape(post)};`;
    numbers = hex2(pre.length + 1);
  }
  const brace = (s) => s.replace(/[{}]/g, (c) => `\\${c}`);
  return `{\\*\\listtable{\\list\\listtemplateid1\\listhybrid{\\listlevel\\levelnfc${nfc}\\levelnfcn${nfc}\\leveljc0\\leveljcn0\\levelfollow0\\levelstartat${start}\\levelspace360\\levelindent0` +
    `{\\*\\levelmarker ${brace(`${t < 7 ? "" : list.prefix ?? ""}{${name}}${t < 7 ? "" : list.postfix ?? ""}`)}}{\\leveltext\\leveltemplateid1${text}}{\\levelnumbers${numbers};}\\fi-360\\li720\\lin720 }{\\listname ;}\\listid1}}\n` +
    "{\\*\\listoverridetable{\\listoverride\\listid1\\listoverridecount0\\ls1}}\n";
}

/** A group starting at `at` ("{"), up to and including its closing brace. */
function groupEnd(s, at) {
  let depth = 0;
  for (let i = at; i < s.length; i++) {
    if (s[i] === "\\") { i++; continue; }
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i + 1;
  }
  return s.length;
}

/**
 * A box's RTF with its list markup taken out, then, when `list` is given, ProPresenter's for that list put
 * in. `list` is the paragraph style's text_list plus `indent`, the hanging indent in points. `like` is RTF
 * whose markers' style to keep (the box's old RTF, when its words were rebuilt), else `rtf`'s own.
 * @param {string} rtf
 * @param {{ number_type?: number, prefix?: string, postfix?: string, starting_number?: number, indent: number } | null} list
 * @param {string} [like]
 */
export function listRtf(rtf, list, like = rtf) {
  const had = rtf.includes("{\\*\\listtable");
  if (!had && !list) return rtf;
  // A marker styled apart from the words (ProPresenter writes a bold one as "\\n\\f1\\b 1.\\n\\f0\\b0 ") keeps
  // its style when the list is rebuilt.
  const styled = /\{\\listtext\t(\n\\[^\s{}]+ )[^{}]*?(\n\\[^\s{}]+ )\t\}/.exec(like);
  const [pre, post] = styled ? [styled[1], styled[2]] : ["", ""];
  for (const head of ["{\\*\\listtable", "{\\*\\listoverridetable"]) {
    const at = rtf.indexOf(head);
    if (at >= 0) { const end = groupEnd(rtf, at); rtf = rtf.slice(0, at) + rtf.slice(end).replace(/^\n/, ""); }
  }
  rtf = rtf.replace(LIST_TEXT, "").replace(/\\ls\d+\\ilvl\d+\n?/g, "");
  const twips = list ? Math.round(list.indent * 20) : 0;
  rtf = rtf.replace(/\\pard(?![a-z])((?:\\[a-z]+-?\d*)*)/g, (_, rest) => {
    const kept = rest.replace(/\\tx\d+|\\li\d+|\\fi-?\d+/g, "");
    if (!list) return `\\pard${kept}`;
    const tab = /^\\pardeftab\d+/.exec(kept)?.[0] ?? "";
    return `\\pard\\tx20\\tx${twips}${tab}\\li${twips}\\fi-${twips}${kept.slice(tab.length)}`;
  });
  if (!list) return rtf;
  // The tables go after the colour tables, before \\deftab, where ProPresenter puts them.
  const tables = /\n\\deftab|\n\\pard/.exec(rtf);
  rtf = tables ? rtf.slice(0, tables.index + 1) + listTable(list) + rtf.slice(tables.index + 1) : rtf;
  // Each line: after the first colour switch, and after every line break the person typed (a backslash
  // that is not itself escaped, then a newline), past any \\pard that starts the new paragraph.
  let n = 1;
  const item = () => `\\ls1\\ilvl0{\\listtext\t${pre}${marker(list, n++)}${post}\t}`;
  const first = /\\cf\d+ /.exec(rtf);
  if (!first) return rtf;
  const head = rtf.slice(0, first.index + first[0].length);
  const one = item().replace("\\ls1\\ilvl0", "");
  const body = rtf.slice(head.length).replace(/(?<!\\)((?:\\\\)*\\\n)(\\pard[^\n]*\n)?/g, (_, brk, pard = "") => `${brk}${pard}${item()}`);
  return head.replace(/(\\pard[^\n]*\n)(?![\s\S]*\\pard)/, "$1\\ls1\\ilvl0\n") + one + body;
}
