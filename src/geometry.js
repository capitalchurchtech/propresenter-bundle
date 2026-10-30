import { fallbackMetrics } from "./metrics.js";

// Pure, with no Node built-ins, so a browser page can import it ("propresenter-bundle/geometry").
//
// Where ProPresenter will put the words, worked out ahead of it, for the things on a slide that have
// to follow the words but are not part of them: the box behind a bold phrase, a kicker above a
// title, a box tall enough for its lines.
//
// ProPresenter wraps the way Cocoa does: greedily, at spaces, inside the box.
//
// CALIBRATED on Helvetica Neue in ProPresenter 21 on macOS, at 1920x1080: a hand-drawn box behind a
// bold phrase ran x532 to x942 where these rules, with measured metrics, put it at 528.7 to 935.3;
// lines sat size x 1.2 apart. Other fonts and versions are unverified.

/** The gap between lines, for a size and the box's line-height multiple. */
export const linePitch = (size, multiple = 1) => size * 1.2 * (multiple || 1);

/** Breathing room either side of a bold phrase's box. */
export const BOX_PAD = 4;

/**
 * COCOA'S LINE-FRAGMENT PADDING: text is inset 5px from each side of its box, so it starts 5px in and
 * wraps 10px narrower than the box. Found on a real bundle: a line measured 1564 in a box ending at
 * 1568, and ProPresenter still moved its last word to the next line.
 */
export const LINE_PADDING = 5;

/**
 * Words a line should not end on, and the things that read as one: an English table. Pass another
 * to `createGeometry` for another language.
 */
export const englishBreaks = {
  weakEnd: new Set(("a an the and or but nor so yet to of in on at for with by from into onto as if than " +
    "our your my their his her its is are was were be been will can may we they i who which").split(" ")),
  month: /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)$/,
  // "5:00 / pm"
  dayPart: /^(a\.?m|p\.?m)\b/i,
  // "Room / 110"
  numbered: /^(room|suite|ages?|grades?)$/,
};

/**
 * The layout functions, bound to one font table and one language.
 * @param {{ metrics?: import("./metrics.js").Metrics, breaks?: typeof englishBreaks }} [opts]
 */
export function createGeometry({ metrics = fallbackMetrics, breaks = englishBreaks } = {}) {
  const textWidth = (text, size, face) => metrics.widthOf(text, size, face);

  /**
   * A word as ProPresenter breaks it: from space to space, whatever runs it crosses. "**October 11**."
   * is two words, "October" and "11.", and the full stop never starts a line of its own. `parts`
   * locates the bold inside each word, for the box.
   */
  function words(runs, size, regular = "body") {
    const out = [];
    const spaceW = textWidth(" ", size, regular);
    let cur = null;
    for (const r of runs) {
      for (const part of r.text.split(/( +|\n)/)) {
        if (!part) continue;
        // A deliberate line break, as the natural-breaks pass below writes them.
        if (part === "\n") {
          if (cur) { out.push(cur); cur = null; }
          if (out.length) out[out.length - 1].breakAfter = true;
          continue;
        }
        if (/^ +$/.test(part)) {
          if (cur) { cur.space += spaceW * part.length; out.push(cur); cur = null; }
          else if (out.length) out[out.length - 1].space += spaceW * part.length;
          continue;
        }
        const w = textWidth(part, size, r.bold ? "bold" : regular);
        if (!cur) cur = { text: "", w: 0, space: 0, parts: [] };
        cur.parts.push({ text: part, bold: r.bold, x: cur.w, w });
        cur.text += part;
        cur.w += w;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  /** Each line as its words, greedily filled to the width. A word longer than the box gets a line to itself. */
  function wrapRuns(runs, size, width, regular = "body") {
    const lines = [];
    let line = [], w = 0;
    for (const word of words(runs, size, regular)) {
      const prevSpace = line.length ? line[line.length - 1].space : 0;
      if (line.length && w + prevSpace + word.w > width) { lines.push(line); line = []; w = 0; }
      w += (line.length ? line[line.length - 1].space : 0) + word.w;
      line.push(word);
      if (word.breakAfter) { lines.push(line); line = []; w = 0; }
    }
    if (line.length) lines.push(line);
    return lines;
  }

  /**
   * What it costs to end a line after word `a` and start the next with `b`: negative where the break
   * falls on punctuation, positive where it cuts a phrase.
   */
  function breakCost(a, b) {
    const t = a.text;
    let c = 0;
    if (/[.!?;:]["'”’)]*$/.test(t)) c -= 20;
    else if (/[,—–]["'”’)]*$/.test(t)) c -= 12;
    else {
      const bare = t.toLowerCase().replace(/[^a-z']/g, "");
      if (breaks.weakEnd.has(bare)) c += 40;
      // A date, a time or a room is one thing to read.
      if (breaks.month.test(bare) && /^\d/.test(b.text)) c += 40;
      if (/\d$/.test(t) && breaks.dayPart.test(b.text)) c += 40;
      if (breaks.numbered.test(bare) && /^\d/.test(b.text)) c += 40;
    }
    // Splitting a bold phrase across two lines gives it two highlight boxes.
    if (a.parts.at(-1)?.bold && b.parts[0]?.bold) c += 12;
    return c;
  }

  const lineWidth = (ws) => ws.reduce((n, w, i) => n + w.w + (i < ws.length - 1 ? w.space : 0), 0);

  /**
   * BREAKS THAT READ NATURALLY, at the same number of lines. ProPresenter fills each line and breaks
   * wherever the words run out, which lands mid-phrase and can leave a last line of one word. This
   * chooses the breaks instead: the same line count the greedy wrap gives, every line within the box,
   * spending a little raggedness to end lines on punctuation and not on a weak word, a month before its
   * day or a time before its "pm". A one-word last line costs a lot (60) but is not forbidden.
   *
   * Works on markdown text and returns it with "\n" inserted, so every later step reads the same
   * breaks. Text the wrap already breaks well comes back unchanged; breaks already in the text are kept
   * and each paragraph is set on its own. (Named for its first job, the orphan pass.)
   */
  function withoutOrphan(markdown, size, boxWidth, regular = "body") {
    if (markdown.includes("\n")) return markdown.split("\n").map((seg) => withoutOrphan(seg, size, boxWidth, regular)).join("\n");
    const runs = markdown.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p) =>
      p.startsWith("**") && p.endsWith("**") ? { text: p.slice(2, -2), bold: true } : { text: p, bold: false });
    const W = boxWidth - LINE_PADDING * 2;
    const ws = words(runs, size, regular);
    const n = ws.length;
    const greedy = wrapRuns(runs, size, W, regular);
    const L = greedy.length;
    if (L < 2 || n < 3) return markdown;

    const raggedness = (i, j) => { const r = (W - lineWidth(ws.slice(i, j))) / W; return r * r * 60; };
    const lastLine = (i) => (n - i === 1 ? 60 : 0);
    const cost = (starts) => starts.reduce((c, i, k) => {
      const j = starts[k + 1] ?? n;
      return c + (k < starts.length - 1 ? raggedness(i, j) + breakCost(ws[j - 1], ws[j]) : lastLine(i));
    }, 0);
    const greedyStarts = greedy.reduce((acc, line, k) => (k === 0 ? [0] : [...acc, acc[k - 1] + greedy[k - 1].length]), []);

    // best[k][i]: cheapest way to set words i.. in k more lines (every line fits, or is one long word).
    const fits = (i, j) => j - i === 1 || lineWidth(ws.slice(i, j)) <= W;
    const best = Array.from({ length: L + 1 }, () => Array.from({ length: n + 1 }, () => ({ c: Infinity, next: -1 })));
    best[0][n].c = 0;
    for (let k = 1; k <= L; k++) {
      for (let i = n - 1; i >= 0; i--) {
        for (let j = i + 1; j <= n; j++) {
          if (!fits(i, j)) break;
          const rest = best[k - 1][j].c;
          if (rest === Infinity) continue;
          const here = k === 1 ? lastLine(i) : raggedness(i, j) + breakCost(ws[j - 1], ws[j]);
          if (k === 1 && j !== n) continue;
          if (here + rest < best[k][i].c) best[k][i] = { c: here + rest, next: j };
        }
      }
    }
    if (best[L][0].c === Infinity || best[L][0].c >= cost(greedyStarts) - 5) return markdown; // not worth moving
    const starts = [0];
    for (let k = L, i = 0; k > 1; k--) { i = best[k][i].next; starts.push(i); }

    // Write the chosen breaks in: the word each new line starts with, counted the way the wrap counts them.
    const breakBefore = new Set(starts.slice(1));
    let seen = 0, out = "";
    for (const t of markdown.split(/( +)/)) {
      if (t && !/^ +$/.test(t)) {
        if (breakBefore.has(seen) && out.endsWith(" ")) out = out.replace(/ +$/, "") + "\n";
        seen++;
      }
      out += t;
    }
    return out;
  }

  /**
   * A box behind every stretch of bold, one per line it touches, as offsets from the text box's
   * top-left. Adjacent bold words on a line share one box, spaces between them included.
   */
  function boldBoxes(runs, size, width, pitch, height) {
    const out = [];
    wrapRuns(runs, size, width - LINE_PADDING * 2).forEach((line, i) => {
      let x = LINE_PADDING;
      let open = null;
      const close = () => {
        if (open) out.push({ x: open.x - BOX_PAD, y: i * pitch, w: open.end - open.x + BOX_PAD * 2, h: height });
        open = null;
      };
      line.forEach((word, j) => {
        for (const p of word.parts) {
          if (p.bold) { if (open) open.end = x + p.x + p.w; else open = { x: x + p.x, end: x + p.x + p.w }; }
          else close();
        }
        x += word.w + (j < line.length - 1 ? word.space : 0);
      });
      close();
    });
    return out;
  }

  /** How many lines a title takes in its box, in the face titles are drawn in. */
  function titleLines(text, size, boxWidth) {
    return wrapRuns([{ text: text.trim(), bold: false }], size, boxWidth - LINE_PADDING * 2, "head").length;
  }

  return { metrics, textWidth, wrapRuns, withoutOrphan, boldBoxes, titleLines };
}
