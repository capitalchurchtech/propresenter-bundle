// How wide words are drawn. Every layout prediction in this package (wraps, line counts, the box
// behind a bold phrase, a speaker box's fit) is only as good as the table behind it.
//
// THE PACKAGE SHIPS NO REAL FONT TABLE. Advance widths describe fonts a church licenses, so a real
// table is that church's data: measured from its own installed fonts and passed in. Without one the
// fallback below is used, and anything measured with it is a rough guess, not a prediction.

/** @typedef {"body" | "head" | "bold"} Face  body: regular text; head: titles; bold: bold runs */
/** @typedef {{ widthOf(text: string, size: number, face: Face): number, measured: boolean }} Metrics */

/**
 * Metrics from advance-width tables, one per face, in 1/1000 em: `{ body: { d, w: { "a": 537, ... } } }`.
 * `d` is the width of a character the table does not list. A missing face falls back to `body`.
 * @param {Partial<Record<Face, { d: number, w: Record<string, number> }>>} tables
 * @returns {Metrics}
 */
export function tableMetrics(tables) {
  return {
    measured: true,
    widthOf(text, size, face = "body") {
      const m = tables[face] ?? tables.body;
      return size * [...text].reduce((sum, c) => sum + (m.w[c] ?? m.d) / 1000, 0);
    },
  };
}

// The fallback: a coarse sans-serif shape (narrow, average and wide letters), not any one font.
const NARROW = new Set([..."ijlI.,:;'!|`()[]{}"]);
const WIDE = new Set([..."mwMW@%"]);
const charEm = (c) => (c === " " ? 0.28 : NARROW.has(c) ? 0.26 : WIDE.has(c) ? 0.86 : /[A-Z0-9]/.test(c) ? 0.64 : 0.54);

/** @type {Metrics} */
export const fallbackMetrics = {
  measured: false,
  widthOf(text, size, face = "body") {
    const scale = face === "bold" ? 1.06 : face === "head" ? 1.03 : 1;
    return size * scale * [...text].reduce((sum, c) => sum + charEm(c), 0);
  },
};
